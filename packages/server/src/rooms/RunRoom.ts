import { randomInt } from "node:crypto";
import { matchMaker, Room, ServerError, type Client } from "colyseus";
import {
  createRng,
  EMPTY_ROOM_TTL_MS,
  generateDungeon,
  isWalkableTile,
  JOIN_ERROR_STATUS,
  MAX_INPUTS_PER_TICK,
  MAX_PLAYERS,
  MAX_QUEUED_INPUTS,
  MSG,
  normalizeName,
  PATCH_RATE_MS,
  PROTOCOL_VERSION,
  roomSpawnPoints,
  sanitizeInput,
  SIM_DT,
  SIM_HZ,
  stepPlayer,
  TAKEOVER_CLOSE_CODE,
  TILE_SIZE,
  tileCenter,
  type CombatEvent,
  type Dungeon,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";
import { CombatSystem, newCombatState, type CombatState } from "../sim/CombatSystem";
import { EnemySystem, type SimPlayer } from "../sim/EnemySystem";
import { PositionHistory } from "../sim/PositionHistory";
import { resolveCreateOptions, type RunRoomCreateOptions } from "./createOptions";
import { PlayerRegistry, type PlayerRecord } from "./PlayerRegistry";
import { createRoomCode } from "./roomCode";
import { PlayerState, RunState } from "./RunState";
import { syncPlayer, syncWorld } from "./syncState";

const ROOM_CODE_ATTEMPTS = 5;
const ALLY_SPAWN_RADIUS = 2;

const ENEMY_RNG_SALT = 0x5eed;

const tileOf = (v: number): number => Math.floor(v / TILE_SIZE);

/** Un muerto no se mueve, no salta, no esquiva ni ataca; se conserva su orientación. */
const deadInput = (input: PlayerInput, k: KinematicState): PlayerInput => ({
  ...input,
  moveX: 0,
  moveZ: 0,
  facing: k.facing,
  dodge: false,
  sprint: false,
  jump: false,
  attack: false,
});

export class RunRoom extends Room<{ state: RunState }> {
  private readonly registry = new PlayerRegistry();
  private dungeon!: Dungeon;
  private emptyRoomTtlMs = EMPTY_ROOM_TTL_MS;
  private emptyTimer: { clear(): void } | undefined;
  private enemySystem!: EnemySystem;
  private readonly history = new PositionHistory();
  private readonly combat = new CombatSystem();

  async onCreate(options: RunRoomCreateOptions = {}): Promise<void> {
    const rng = createRng(randomInt(2 ** 32));
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt++) {
      this.roomId = createRoomCode(rng);
      if ((await matchMaker.query({ roomId: this.roomId })).length === 0) break;
    }

    const { seed, emptyRoomTtlMs } = resolveCreateOptions(options, process.env.NODE_ENV);
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.dungeon = generateDungeon(seed, 1);
    this.enemySystem = new EnemySystem(this.dungeon, createRng(seed ^ ENEMY_RNG_SALT));
    this.state = new RunState({ seed, floor: 1, tick: 0, level: 1, xp: 0, xpToNext: 0 });
    syncWorld(this.state, [], [], this.combat);

    this.autoDispose = false;
    this.setPatchRate(PATCH_RATE_MS);
    this.setTimestep(() => this.tick(), 1000 / SIM_HZ);
    this.onMessage(MSG.input, (client, raw) => this.enqueueInput(client, raw));
    // Una sala creada a la que nadie llega a entrar (reserva vencida) no pasa por onLeave.
    this.armEmptyTimer();
  }

  onJoin(client: Client, options: { name?: unknown; token?: unknown; version?: unknown } = {}): void {
    // Una pestaña con código viejo se rechaza antes de tocar el registro.
    if (options.version !== PROTOCOL_VERSION) {
      throw new ServerError(JOIN_ERROR_STATUS["version-mismatch"], "version-mismatch");
    }
    const key = normalizeName(options.name)?.key;
    const result = this.registry.join(
      { name: options.name, token: options.token, sessionId: client.sessionId },
      () => this.spawnFor(key),
      () => newCombatState("warrior", this.combat.level),
    );
    if (!result.ok) throw new ServerError(JOIN_ERROR_STATUS[result.code], result.code);

    if (result.replacedSessionId !== undefined) {
      const old = this.clients.find((c) => c.sessionId === result.replacedSessionId);
      old?.leave(TAKEOVER_CLOSE_CODE, "takeover");
    }

    const { record } = result;
    let ps = this.state.players.get(record.key);
    if (!ps) {
      ps = new PlayerState();
      this.state.players.set(record.key, ps);
    }
    ps.name = record.displayName;
    syncPlayer(ps, record);
    client.send(MSG.welcome, { key: record.key });

    this.emptyTimer?.clear();
    this.emptyTimer = undefined;
  }

  // Sin onDrop: en 0.18 un cierre sin consentimiento cae aquí directamente. No hay allowReconnection,
  // porque la reconexión es por nombre. También llega aquí un cliente cuyo onJoin falló.
  onLeave(client: Client): void {
    const record = this.registry.leave(client.sessionId);
    // Si fue reemplazado por takeover, el registro ya apunta a la sesión nueva y no se toca.
    if (record) this.state.players.delete(record.key);

    if (this.registry.connected().length === 0) this.armEmptyTimer();
  }

  private armEmptyTimer(): void {
    this.emptyTimer?.clear();
    this.emptyTimer = this.clock.setTimeout(() => void this.disconnect(), this.emptyRoomTtlMs);
  }

  private enqueueInput(client: Client, raw: unknown): void {
    const record = this.registry.bySession(client.sessionId);
    const input = sanitizeInput(raw);
    if (!record || !input) return;
    // Los mensajes llegan en orden; cualquier seq que no sea mayor que el último visto es repetido o viejo.
    const newest = record.inputQueue.at(-1)?.seq ?? record.lastSeq;
    if (input.seq <= Math.max(newest, record.lastSeq)) return;
    record.inputQueue.push(input);
    if (record.inputQueue.length > MAX_QUEUED_INPUTS) {
      record.inputQueue.splice(0, record.inputQueue.length - MAX_QUEUED_INPUTS);
    }
  }

  private emit(event: CombatEvent): void {
    this.broadcast(MSG.combat, event);
  }

  private tick(): void {
    const connected = this.registry.connected();
    const allStates = new Map(this.registry.all().map((r) => [r.key, r.combat] as const));

    // 1. Inputs (y ataques) de cada jugador conectado.
    for (const record of connected) {
      for (const raw of record.inputQueue.splice(0, MAX_INPUTS_PER_TICK)) {
        const input = record.combat.dead ? deadInput(raw, record.kinematic) : raw;
        record.kinematic = stepPlayer(record.kinematic, input, this.dungeon, SIM_DT);
        record.lastSeq = input.seq;
        if (input.attack) this.attack(record, input, allStates);
      }
    }

    // 2.
    this.state.tick++;
    const nowS = this.state.tick * SIM_DT;

    // 3-4. Enemigos (solo ven a los conectados vivos).
    const alive: SimPlayer[] = connected
      .filter((r) => !r.combat.dead)
      .map((r) => ({ key: r.key, x: r.kinematic.x, z: r.kinematic.z, alive: true }));
    this.enemySystem.activateRooms(alive, this.registry.size());
    const states = new Map<string, CombatState>(connected.map((r) => [r.key, r.combat]));
    this.combat.queueEnemyHits(states, this.enemySystem.step(alive, SIM_DT), nowS);

    // 5. Daño, muertes y reapariciones (los desconectados quedan congelados).
    const kin = new Map(connected.map((r) => [r.key, r.kinematic]));
    const { damaged, respawned } = this.combat.step(states, kin, nowS, SIM_DT);
    for (const d of damaged) {
      const k = kin.get(d.key)!;
      this.emit({ type: "damage", targetKind: "player", targetId: d.key, amount: d.amount, x: k.x, z: k.z });
    }
    for (const key of respawned) {
      const r = connected.find((x) => x.key === key)!;
      r.kinematic = this.spawnFor(key);
    }

    // 6.
    this.history.record(this.state.tick, this.enemySystem.enemies);

    // 7. Schema.
    for (const record of connected) {
      const ps = this.state.players.get(record.key);
      if (ps) syncPlayer(ps, record);
    }
    syncWorld(this.state, this.enemySystem.enemies, this.enemySystem.projectiles, this.combat);
  }

  private attack(record: PlayerRecord, input: PlayerInput, allStates: Map<string, CombatState>): void {
    const res = this.combat.attack(record.combat, record.kinematic, input, this.state.tick, this.enemySystem, this.history);
    if (res.swung) this.emit({ type: "swing", key: record.key, step: res.step });
    for (const h of res.hits) {
      this.emit({ type: "damage", targetKind: "enemy", targetId: h.enemyId, amount: h.amount, x: h.x, z: h.z });
    }
    // Todos los registros (también los desconectados) suben su vida máxima con el nivel del grupo.
    for (const level of this.combat.grantXp(allStates, res.xpGained)) this.emit({ type: "levelUp", level });
  }

  /**
   * Determinista según el estado actual (el registro puede llamarla más de una vez).
   * Junto a un aliado: casilla caminable libre más cercana (Chebyshev ≤ 2) a la suya.
   * Si no hay aliado (o no hay hueco), un punto libre de la sala inicial.
   */
  private spawnFor(joiningKey: string | undefined): KinematicState {
    const others = this.registry.connected().filter((r) => r.key !== joiningKey);
    const occupied = new Set(others.map((r) => `${tileOf(r.kinematic.x)},${tileOf(r.kinematic.z)}`));
    const free = (tx: number, tz: number) => isWalkableTile(this.dungeon, tx, tz) && !occupied.has(`${tx},${tz}`);

    const ally = others[0];
    if (ally) {
      const [ax, az] = [tileOf(ally.kinematic.x), tileOf(ally.kinematic.z)];
      // La casilla libre más cercana al aliado; a igual distancia, por dz y luego dx ascendentes.
      const candidates: { dx: number; dz: number }[] = [];
      for (let dz = -ALLY_SPAWN_RADIUS; dz <= ALLY_SPAWN_RADIUS; dz++) {
        for (let dx = -ALLY_SPAWN_RADIUS; dx <= ALLY_SPAWN_RADIUS; dx++) candidates.push({ dx, dz });
      }
      candidates.sort((a, b) => a.dx ** 2 + a.dz ** 2 - (b.dx ** 2 + b.dz ** 2) || a.dz - b.dz || a.dx - b.dx);
      const pick = candidates.find((c) => free(ax + c.dx, az + c.dz));
      if (pick) return still(tileCenter(ax + pick.dx, az + pick.dz));
    }
    const points = roomSpawnPoints(this.dungeon, this.dungeon.startRoomId, MAX_PLAYERS + 1);
    const point = points.find((p) => free(tileOf(p.x), tileOf(p.z))) ?? points[0]!;
    return still(point);
  }
}

function still(p: { x: number; z: number }): KinematicState {
  return { x: p.x, z: p.z, facing: 0, dodgeTime: 0, dodgeCooldown: 0, dodgeDirX: 0, dodgeDirZ: 0, y: 0, vy: 0 };
}
