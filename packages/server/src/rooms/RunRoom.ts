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
  roomSpawnPoints,
  sanitizeInput,
  SIM_DT,
  SIM_HZ,
  stepPlayer,
  TILE_SIZE,
  tileCenter,
  type Dungeon,
  type KinematicState,
} from "@roguelike/shared";
import { PlayerRegistry, type PlayerRecord } from "./PlayerRegistry";
import { createRoomCode } from "./roomCode";
import { PlayerState, RunState } from "./RunState";

export interface RunRoomCreateOptions {
  seed?: number;
  emptyRoomTtlMs?: number;
}

/** Código de cierre que recibe la conexión vieja cuando otra pestaña toma el control del jugador. */
export const TAKEOVER_CLOSE_CODE = 4005;

const ROOM_CODE_ATTEMPTS = 5;
const ALLY_SPAWN_RADIUS = 2;

const tileOf = (v: number): number => Math.floor(v / TILE_SIZE);

export class RunRoom extends Room<{ state: RunState }> {
  private readonly registry = new PlayerRegistry();
  private dungeon!: Dungeon;
  private emptyRoomTtlMs = EMPTY_ROOM_TTL_MS;
  private emptyTimer: { clear(): void } | undefined;

  async onCreate(options: RunRoomCreateOptions = {}): Promise<void> {
    const rng = createRng(randomInt(2 ** 32));
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt++) {
      this.roomId = createRoomCode(rng);
      if ((await matchMaker.query({ roomId: this.roomId })).length === 0) break;
    }

    const seed = typeof options.seed === "number" ? options.seed : randomInt(2 ** 32);
    if (typeof options.emptyRoomTtlMs === "number") this.emptyRoomTtlMs = options.emptyRoomTtlMs;
    this.dungeon = generateDungeon(seed, 1);
    this.state = new RunState({ seed, floor: 1 });

    this.autoDispose = false;
    this.setPatchRate(PATCH_RATE_MS);
    this.setTimestep(() => this.tick(), 1000 / SIM_HZ);
    this.onMessage(MSG.input, (client, raw) => this.enqueueInput(client, raw));
    // Una sala creada a la que nadie llega a entrar (reserva vencida) no pasa por onLeave.
    this.armEmptyTimer();
  }

  onJoin(client: Client, options: { name?: unknown; token?: unknown } = {}): void {
    const key = normalizeName(options.name)?.key;
    const result = this.registry.join(
      { name: options.name, token: options.token, sessionId: client.sessionId },
      () => this.spawnFor(key),
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
    this.syncPlayer(ps, record);
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

  private tick(): void {
    for (const record of this.registry.connected()) {
      const batch = record.inputQueue.splice(0, MAX_INPUTS_PER_TICK);
      if (batch.length === 0) continue;
      for (const input of batch) {
        record.kinematic = stepPlayer(record.kinematic, input, this.dungeon, SIM_DT);
        record.lastSeq = input.seq;
      }
      const ps = this.state.players.get(record.key);
      if (ps) this.syncPlayer(ps, record);
    }
  }

  private syncPlayer(ps: PlayerState, record: PlayerRecord): void {
    const k = record.kinematic;
    ps.x = k.x;
    ps.z = k.z;
    ps.facing = k.facing;
    ps.dodgeTime = k.dodgeTime;
    ps.dodgeCooldown = k.dodgeCooldown;
    ps.dodgeDirX = k.dodgeDirX;
    ps.dodgeDirZ = k.dodgeDirZ;
    ps.lastSeq = record.lastSeq;
  }

  /**
   * Determinista según el estado actual (el registro puede llamarla más de una vez).
   * Junto a un aliado: primera casilla caminable libre a distancia de Chebyshev ≤ 2 de su casilla.
   * Si no hay aliado (o no hay hueco), un punto libre de la sala inicial.
   */
  private spawnFor(joiningKey: string | undefined): KinematicState {
    const others = this.registry.connected().filter((r) => r.key !== joiningKey);
    const occupied = new Set(others.map((r) => `${tileOf(r.kinematic.x)},${tileOf(r.kinematic.z)}`));
    const free = (tx: number, tz: number) => isWalkableTile(this.dungeon, tx, tz) && !occupied.has(`${tx},${tz}`);

    const ally = others[0];
    if (ally) {
      const [ax, az] = [tileOf(ally.kinematic.x), tileOf(ally.kinematic.z)];
      for (let dz = -ALLY_SPAWN_RADIUS; dz <= ALLY_SPAWN_RADIUS; dz++) {
        for (let dx = -ALLY_SPAWN_RADIUS; dx <= ALLY_SPAWN_RADIUS; dx++) {
          if (free(ax + dx, az + dz)) return still(tileCenter(ax + dx, az + dz));
        }
      }
    }
    const points = roomSpawnPoints(this.dungeon, this.dungeon.startRoomId, MAX_PLAYERS + 1);
    const point = points.find((p) => free(tileOf(p.x), tileOf(p.z))) ?? points[0]!;
    return still(point);
  }
}

function still(p: { x: number; z: number }): KinematicState {
  return { x: p.x, z: p.z, facing: 0, dodgeTime: 0, dodgeCooldown: 0, dodgeDirX: 0, dodgeDirZ: 0 };
}
