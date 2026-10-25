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
  newComboTimers,
  normalizeName,
  PATCH_RATE_MS,
  playerMods,
  PICKUP_RANGE,
  PROTOCOL_VERSION,
  roomSpawnPoints,
  sanitizeInput,
  SIM_DT,
  SIM_HZ,
  stepPlayer,
  TAKEOVER_CLOSE_CODE,
  TILE_SIZE,
  tileCenter,
  WEAPONS,
  type CombatEvent,
  type Dungeon,
  type KinematicState,
  type PlayerInput,
  type WeaponId,
} from "@roguelike/shared";
import { CombatSystem, newCombatState, type CombatState, type ImpactResult } from "../sim/CombatSystem";
import { EnemySystem, type SimPlayer } from "../sim/EnemySystem";
import { LevelUpSystem, type ChoiceEvent } from "../sim/LevelUpSystem";
import { OrbSystem } from "../sim/OrbSystem";
import { PositionHistory } from "../sim/PositionHistory";
import { WaveDirector } from "../sim/WaveDirector";
import { resolveCreateOptions, type RunRoomCreateOptions } from "./createOptions";
import { PlayerRegistry, type FloorWeapon, type PlayerRecord } from "./PlayerRegistry";
import { createRoomCode } from "./roomCode";
import { PlayerState, RunState } from "./RunState";
import { syncPlayer, syncWorld } from "./syncState";

const ROOM_CODE_ATTEMPTS = 5;
const ALLY_SPAWN_RADIUS = 2;

const ENEMY_RNG_SALT = 0x5eed;
const WAVE_RNG_SALT = 0x7a3e;
const ORB_RNG_SALT = 0x0b5e;
const CARD_RNG_SALT = 0xca7d;
/** lo que cura la carta Vitalidad al aplicarse */
const VITALITY_HEAL = 20;

const tileOf = (v: number): number => Math.floor(v / TILE_SIZE);

/** Un muerto no se mueve, no salta, no ataca ni usa habilidades; se conserva su orientación. */
const deadInput = (input: PlayerInput, k: KinematicState): PlayerInput => ({
  ...input,
  moveX: 0,
  moveZ: 0,
  facing: k.facing,
  sprint: false,
  jump: false,
  attack: false,
  interact: false,
  abilities: 0,
});

export class RunRoom extends Room<{ state: RunState }> {
  private readonly registry = new PlayerRegistry();
  private dungeon!: Dungeon;
  private emptyRoomTtlMs = EMPTY_ROOM_TTL_MS;
  private emptyTimer: { clear(): void } | undefined;
  private enemySystem!: EnemySystem;
  private director!: WaveDirector;
  private orbs!: OrbSystem;
  private levelUp!: LevelUpSystem;
  private floorTime = 0;
  private readonly history = new PositionHistory();
  private readonly combat = new CombatSystem();

  async onCreate(options: RunRoomCreateOptions = {}): Promise<void> {
    const rng = createRng(randomInt(2 ** 32));
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt++) {
      this.roomId = createRoomCode(rng);
      if ((await matchMaker.query({ roomId: this.roomId })).length === 0) break;
    }

    const { seed, emptyRoomTtlMs, floorTimeStart } = resolveCreateOptions(options, process.env.NODE_ENV);
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.dungeon = generateDungeon(seed, 1);
    this.enemySystem = new EnemySystem(this.dungeon, createRng(seed ^ ENEMY_RNG_SALT));
    this.director = new WaveDirector(this.dungeon, createRng(seed ^ WAVE_RNG_SALT));
    this.orbs = new OrbSystem(createRng(seed ^ ORB_RNG_SALT));
    this.levelUp = new LevelUpSystem(createRng(seed ^ CARD_RNG_SALT));
    this.floorTime = floorTimeStart;
    this.state = new RunState({
      seed, floor: 1, tick: 0, level: 1, xp: 0, xpToNext: 0, floorTime: floorTimeStart, paused: false, pauseLeft: 0,
    });
    syncWorld(this.state, [], [], this.combat, []);

    this.autoDispose = false;
    this.setPatchRate(PATCH_RATE_MS);
    this.setTimestep(() => this.tick(), 1000 / SIM_HZ);
    this.onMessage(MSG.input, (client, raw) => this.enqueueInput(client, raw));
    this.onMessage(MSG.chooseCard, (client, raw) => this.chooseCard(client, raw));
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
      (equipped) => this.initialFloorWeapons(equipped),
    );
    if (!result.ok) throw new ServerError(JOIN_ERROR_STATUS[result.code], result.code);

    if (result.replacedSessionId !== undefined) {
      const old = this.clients.find((c) => c.sessionId === result.replacedSessionId);
      old?.leave(TAKEOVER_CLOSE_CODE, "takeover");
    }

    const { record } = result;
    // Quien entra a mitad de run elige las cartas de los niveles que ya subió el grupo.
    if (result.kind === "new") record.pendingChoices = this.combat.level - 1;
    let ps = this.state.players.get(record.key);
    if (!ps) {
      ps = new PlayerState();
      this.state.players.set(record.key, ps);
    }
    ps.name = record.displayName;
    client.send(MSG.welcome, { key: record.key });
    // Nuevo, reconexión o toma de control: sus armas del suelo, solo a él.
    this.sendFloorWeapons(client, record);
    // Sus elecciones pendientes, sin pausa; en una pausa entra en la siguiente elección del grupo o al final.
    // Si ya tenía una abierta (takeover), se le reenvía.
    if (this.levelUp.isChoosing(record.key)) this.handleChoices(this.levelUp.openOffer(record.key));
    else if (!this.levelUp.paused) this.handleChoices(this.levelUp.offerSolo(record));
    syncPlayer(ps, record, this.levelUp.isChoosing(record.key));

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

  private chooseCard(client: Client, raw: unknown): void {
    const record = this.registry.bySession(client.sessionId);
    const msg = raw as { offerId?: unknown; index?: unknown } | null;
    const offerId = msg?.offerId;
    const index = msg?.index;
    if (!record || typeof offerId !== "number" || typeof index !== "number") return;
    this.handleChoices(this.levelUp.choose(record, offerId, index));
  }

  /**
   * Único lugar donde se atienden los eventos de elección: la oferta va solo a ese cliente y "applied"
   * llega con la carta ya registrada en `progress`: se recalculan sus multiplicadores (y su vida máxima) y
   * Vitalidad cura 20.
   */
  private handleChoices(events: ChoiceEvent[]): void {
    for (const e of events) {
      const record = this.registry.all().find((r) => r.key === e.key);
      if (!record) continue;
      if (e.type === "offer") {
        const client = this.clients.find((c) => c.sessionId === record.sessionId);
        client?.send(MSG.levelChoice, {
          offerId: e.offerId, cards: e.cards, index: e.index, total: e.total, deadlineS: e.deadlineS,
        });
      } else {
        this.combat.setMods(record.combat, playerMods(record.progress));
        if (e.card.kind === "stat" && e.card.id === "vitality") this.combat.heal(record.combat, VITALITY_HEAL);
      }
    }
  }

  private emit(event: CombatEvent): void {
    this.broadcast(MSG.combat, event);
  }

  private emitPlayerDamage(key: string, amount: number, k: KinematicState): void {
    this.emit({ type: "damage", targetKind: "player", targetId: key, amount, x: k.x, z: k.z });
  }

  private tick(): void {
    const connected = this.registry.connected();
    const allStates = new Map(this.registry.all().map((r) => [r.key, r.combat] as const));

    // Elecciones de cartas: corre en la pausa y fuera de ella (las sin pausa vencen igual).
    this.handleChoices(this.levelUp.step(SIM_DT, connected));
    if (this.levelUp.paused) {
      this.pausedTick(connected);
      return;
    }

    // 1. Inputs (y ataques) de cada jugador conectado.
    for (const record of connected) {
      for (const raw of record.inputQueue.splice(0, MAX_INPUTS_PER_TICK)) {
        const input = record.combat.dead ? deadInput(raw, record.kinematic) : raw;
        record.kinematic = stepPlayer(record.kinematic, input, this.dungeon, SIM_DT, {
          speedMult: record.combat.mods.moveSpeedMult,
        });
        record.lastSeq = input.seq;
        // Combo, impacto y golpes pendientes avanzan por input, antes de empezar el swing de ese input.
        const res = this.combat.onInputProcessed(
          record.combat, record.kinematic, input, this.state.tick, this.enemySystem, this.history,
        );
        if (res.impact) this.impact(record, res.impact);
        if (res.damage > 0) this.emitPlayerDamage(record.key, res.damage, record.kinematic);
        // Antes del ataque de este input: con un swing en curso no se cambia de arma.
        if (input.interact && !record.combat.dead && record.combat.swingTimer === 0) this.tryPickup(record);
        if (input.attack) {
          const swing = this.combat.attack(record.combat, input);
          if (swing.swung) this.emit({ type: "swing", key: record.key, step: swing.step });
        }
      }
    }

    // 2.
    this.state.tick++;

    // 3-4. Enemigos (solo ven a los conectados vivos).
    const alive: SimPlayer[] = connected
      .filter((r) => !r.combat.dead)
      .map((r) => ({ key: r.key, x: r.kinematic.x, z: r.kinematic.z, alive: true, magnetMult: r.combat.mods.magnetMult }));
    // El reloj avanza solo con jugadores conectados; el sorteo de tiers de lo que se cree usa el reloj actual.
    if (connected.length > 0) this.floorTime += SIM_DT;
    this.enemySystem.setFloorClock(this.floorTime, this.dungeon.floor);
    this.enemySystem.activateRooms(alive, this.registry.size());
    if (connected.length > 0) this.director.step(this.floorTime, alive, this.registry.size(), this.enemySystem);
    const states = new Map<string, CombatState>(connected.map((r) => [r.key, r.combat]));
    this.combat.queueEnemyHits(states, this.enemySystem.step(alive, SIM_DT), this.state.tick);
    // Orbes: los atraen y recogen los vivos; la xp es del grupo y sube la vida máxima de todos los registros.
    // Si se sube de nivel, la pausa empieza al final de este tick.
    const levels = this.combat.grantXp(allStates, this.orbs.step(alive, SIM_DT));
    for (const level of levels) this.emit({ type: "levelUp", level });
    if (levels.length > 0) this.levelUp.onLevelsGained(levels.length, connected, this.registry.all());

    // 5. Golpes vencidos, muertes y reapariciones (los desconectados quedan congelados).
    const kin = new Map(connected.map((r) => [r.key, r.kinematic]));
    const { damaged, respawned } = this.combat.step(states, this.state.tick, SIM_DT);
    for (const d of damaged) this.emitPlayerDamage(d.key, d.amount, kin.get(d.key)!);
    for (const key of respawned) {
      const r = connected.find((x) => x.key === key)!;
      r.kinematic = this.spawnFor(key);
    }

    // 6.
    this.history.record(this.state.tick, this.enemySystem.enemies);

    // 7. Schema.
    this.syncPlayers(connected);
    this.state.floorTime = this.floorTime;
    syncWorld(this.state, this.enemySystem.enemies, this.enemySystem.projectiles, this.combat, this.orbs.orbs);
  }

  /**
   * Tick en pausa: no avanza nada (ni state.tick, ni el reloj, ni enemigos, orbes o combate). Los inputs se
   * descartan, pero su seq se confirma para que el cliente no los reenvíe al reanudar.
   */
  private pausedTick(connected: PlayerRecord[]): void {
    for (const record of connected) {
      const last = record.inputQueue.at(-1);
      record.inputQueue = [];
      if (last) record.lastSeq = last.seq;
    }
    this.syncPlayers(connected);
  }

  private syncPlayers(connected: PlayerRecord[]): void {
    for (const record of connected) {
      const ps = this.state.players.get(record.key);
      if (ps) syncPlayer(ps, record, this.levelUp.isChoosing(record.key));
    }
    this.state.paused = this.levelUp.paused;
    this.state.pauseLeft = this.levelUp.pauseLeft;
  }

  /**
   * Daño contra enemigos, orbes y armas soltadas: llegan en el impacto del swing, no en el clic.
   * Matar no da xp: deja orbes que hay que recoger.
   */
  private impact(record: PlayerRecord, res: ImpactResult): void {
    for (const h of res.hits) {
      this.emit({
        type: "damage",
        targetKind: "enemy",
        targetId: h.enemyId,
        amount: h.amount,
        x: h.x,
        z: h.z,
        sourceKey: record.key,
      });
    }
    for (const k of res.kills) {
      this.orbs.spawn(k.x, k.z, k.xp, this.state.tick);
      if (k.drop) this.dropWeapon({ ...k.drop, x: k.x, z: k.z });
    }
  }

  /** Cada jugador conectado recibe su propia copia del arma soltada y se le reenvía su lista. */
  private dropWeapon(item: FloorWeapon): void {
    for (const r of this.registry.connected()) {
      r.floorWeapons.push({ ...item });
      const client = this.clients.find((c) => c.sessionId === r.sessionId);
      if (client) this.sendFloorWeapons(client, r);
    }
  }

  /**
   * Todas las armas menos la equipada, en el orden de WEAPONS, sobre puntos fijos de la sala inicial
   * que siguen a los MAX_PLAYERS primeros (reservados para aparecer).
   */
  private initialFloorWeapons(equipped: WeaponId): FloorWeapon[] {
    const ids = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => id !== equipped);
    const points = roomSpawnPoints(this.dungeon, this.dungeon.startRoomId, MAX_PLAYERS + ids.length).slice(MAX_PLAYERS);
    if (points.length < ids.length) throw new Error("la sala inicial no tiene sitio para las armas del suelo");
    return ids.map((weaponId, i) => ({ weaponId, tier: 1, x: points[i]!.x, z: points[i]!.z }));
  }

  private sendFloorWeapons(client: Client, record: PlayerRecord): void {
    client.send(MSG.floorWeapons, {
      items: record.floorWeapons.map(({ weaponId, tier, x, z }) => ({ weaponId, tier, x, z })),
    });
  }

  /** Intercambia el arma equipada (con su tier) por la propia del suelo más cercana a ≤ PICKUP_RANGE, si la hay. */
  private tryPickup(record: PlayerRecord): void {
    const { x, z } = record.kinematic;
    let best = -1;
    let bestD2 = Infinity;
    record.floorWeapons.forEach((f, i) => {
      const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d2 <= PICKUP_RANGE ** 2 && d2 < bestD2) [best, bestD2] = [i, d2];
    });
    if (best === -1) return;
    const taken = record.floorWeapons[best]!;
    record.floorWeapons[best] = { weaponId: record.combat.weaponId, tier: record.combat.weaponTier, x: taken.x, z: taken.z };
    record.combat.weaponId = taken.weaponId;
    record.combat.weaponTier = taken.tier;
    Object.assign(record.combat, newComboTimers());
    const client = this.clients.find((c) => c.sessionId === record.sessionId);
    if (client) this.sendFloorWeapons(client, record);
  }

  /**
   * Determinista según el estado actual (el registro puede llamarla más de una vez).
   * Junto a un aliado conectado y vivo: casilla caminable libre más cercana (Chebyshev ≤ 2) a la suya.
   * Si no hay aliado vivo (o no hay hueco), un punto libre de la sala inicial.
   */
  private spawnFor(joiningKey: string | undefined): KinematicState {
    const others = this.registry.connected().filter((r) => r.key !== joiningKey);
    const occupied = new Set(others.map((r) => `${tileOf(r.kinematic.x)},${tileOf(r.kinematic.z)}`));
    const free = (tx: number, tz: number) => isWalkableTile(this.dungeon, tx, tz) && !occupied.has(`${tx},${tz}`);

    const ally = others.find((r) => !r.combat.dead);
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
  return { x: p.x, z: p.z, facing: 0, y: 0, vy: 0 };
}
