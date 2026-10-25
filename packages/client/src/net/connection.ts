import { Client, type Room } from "@colyseus/sdk";
import {
  MSG,
  PROTOCOL_VERSION,
  STARTING_WEAPON,
  TAKEOVER_CLOSE_CODE,
  isWeaponId,
  isWeaponTier,
  type CombatEvent,
  type EnemyKind,
  type JoinOptions,
  type KinematicState,
  type PlayerInput,
  type WeaponId,
  type WeaponTier,
} from "@roguelike/shared";
import { generateToken } from "./token";
import { LagSimulator, type LagConfig } from "./LagSimulator";

export type PlayerSnapshot = KinematicState & {
  name: string;
  lastSeq: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  respawnIn: number;
  comboStep: number;
  swingTimer: number;
  weaponId: WeaponId;
  weaponTier: WeaponTier;
};
export type PlayerSnapshots = Map<string, PlayerSnapshot>;

export interface EnemySnapshot {
  kind: EnemyKind;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  ai: string;
  aiTime: number;
  /** null si va desarmado */
  weaponId: WeaponId | null;
  weaponTier: WeaponTier | null;
}

export interface ProjectileSnapshot {
  x: number;
  z: number;
}

/** Orbe de XP en el suelo (compartido por el grupo). */
export interface OrbSnapshot {
  x: number;
  z: number;
  value: number;
}

/** Todo lo del estado que no son jugadores. */
export interface WorldSnapshot {
  tick: number;
  level: number;
  xp: number;
  xpToNext: number;
  /** segundos desde que empezó el piso */
  floorTime: number;
  enemies: Map<string, EnemySnapshot>;
  projectiles: Map<string, ProjectileSnapshot>;
  orbs: Map<string, OrbSnapshot>;
}

export type { CombatEvent };

/** Arma tirada en el suelo, propia de este jugador. */
export interface FloorWeapon {
  weaponId: WeaponId;
  tier: WeaponTier;
  x: number;
  z: number;
}

/**
 * Valida el mensaje `floorWeapons` (`{ items: { weaponId, tier, x, z }[] }`); descarta lo que no encaje.
 * Sin `tier` vale 1; con un tier inválido el ítem se descarta.
 */
export function parseFloorWeapons(msg: unknown): FloorWeapon[] {
  const items = (msg as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: FloorWeapon[] = [];
  for (const it of items as { weaponId?: unknown; tier?: unknown; x?: unknown; z?: unknown }[]) {
    if (!it || !isWeaponId(it.weaponId) || !Number.isFinite(it.x) || !Number.isFinite(it.z)) continue;
    const tier = it.tier === undefined ? 1 : it.tier;
    if (!isWeaponTier(tier)) continue;
    out.push({ weaponId: it.weaponId, tier, x: it.x as number, z: it.z as number });
  }
  return out;
}

/** `takeover`: otra pestaña tomó el control del jugador. `lost`: cualquier otro corte no pedido. */
export type DisconnectReason = "takeover" | "lost";

export interface GameConnection {
  roomCode: string;
  myKey: string;
  seed: number;
  floor: number;
  sendInput(i: PlayerInput): void;
  onPlayers(cb: (players: PlayerSnapshots, receivedAtMs: number) => void): void;
  onWorld(cb: (world: WorldSnapshot, receivedAtMs: number) => void): void;
  onCombat(cb: (event: CombatEvent) => void): void;
  /** Armas del suelo propias; se entrega enseguida la última lista recibida, si ya llegó. */
  onFloorWeapons(cb: (items: FloorWeapon[]) => void): void;
  onDisconnect(cb: (reason: DisconnectReason) => void): void;
  leave(): void;
}

const ROOM_NAME = "run";
const TOKEN_KEY = "roguelike.token";

/** En desarrollo el servidor corre aparte; en producción sirve el mismo origen. */
function serverUrl(): string {
  if (import.meta.env.DEV) return "ws://localhost:2567";
  const scheme = location.protocol === "https:" ? "wss://" : "ws://";
  return scheme + location.host;
}

/** Token por navegador: mismo nombre + mismo token = retomar el personaje (p. ej. tras recargar). */
let sessionToken: string | undefined; // si localStorage no está disponible, vale para esta pestaña

function browserToken(): string {
  try {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = generateToken();
      localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch {
    sessionToken ??= generateToken();
    return sessionToken;
  }
}

/** Copia el estado: el SDK lo muta en el sitio, y con lag simulado se entrega más tarde. */
function snapshotPlayers(room: Room): PlayerSnapshots {
  const out: PlayerSnapshots = new Map();
  type RawPlayer = Omit<PlayerSnapshot, "weaponId" | "weaponTier"> & { weaponId: string; weaponTier: number };
  room.state.players.forEach((p: RawPlayer, key: string) => {
    out.set(key, {
      name: p.name,
      x: p.x,
      z: p.z,
      facing: p.facing,
      y: p.y,
      vy: p.vy,
      lastSeq: p.lastSeq,
      hp: p.hp,
      maxHp: p.maxHp,
      dead: p.dead,
      respawnIn: p.respawnIn,
      comboStep: p.comboStep,
      swingTimer: p.swingTimer,
      weaponId: isWeaponId(p.weaponId) ? p.weaponId : STARTING_WEAPON,
      weaponTier: isWeaponTier(p.weaponTier) ? p.weaponTier : 1,
    });
  });
  return out;
}

function snapshotWorld(room: Room): WorldSnapshot {
  const enemies = new Map<string, EnemySnapshot>();
  type RawEnemy = Omit<EnemySnapshot, "weaponId" | "weaponTier"> & { weaponId: string; weaponTier: number };
  room.state.enemies.forEach((e: RawEnemy, id: string) => {
    // Desarmado: el servidor manda "" y 0.
    const armed = isWeaponId(e.weaponId) && isWeaponTier(e.weaponTier);
    enemies.set(id, {
      kind: e.kind,
      x: e.x,
      z: e.z,
      facing: e.facing,
      hp: e.hp,
      maxHp: e.maxHp,
      ai: e.ai,
      aiTime: e.aiTime,
      weaponId: armed ? (e.weaponId as WeaponId) : null,
      weaponTier: armed ? (e.weaponTier as WeaponTier) : null,
    });
  });
  const projectiles = new Map<string, ProjectileSnapshot>();
  room.state.projectiles.forEach((p: ProjectileSnapshot, id: string) => {
    projectiles.set(id, { x: p.x, z: p.z });
  });
  const orbs = new Map<string, OrbSnapshot>();
  room.state.orbs.forEach((o: OrbSnapshot, id: string) => {
    orbs.set(id, { x: o.x, z: o.z, value: o.value });
  });
  const st = room.state;
  return {
    tick: st.tick,
    level: st.level,
    xp: st.xp,
    xpToNext: st.xpToNext,
    floorTime: st.floorTime,
    enemies,
    projectiles,
    orbs,
  };
}

/**
 * Solo para pruebas en desarrollo: `?floorTimeStart=300` crea la sala con el reloj del piso ya en 300 s (el
 * servidor lo ignora en producción). undefined si falta o es inválido.
 */
export function parseFloorTimeStart(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("floorTimeStart");
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Crea una sala (sin `code`) o entra a una existente. Rechaza con el `MatchMakeError` del SDK.
 * `floorTimeStart` solo se manda al crear (es una opción de prueba).
 */
export async function connect(opts: {
  code?: string;
  name: string;
  lag: LagConfig;
  floorTimeStart?: number;
}): Promise<GameConnection> {
  const client = new Client(serverUrl());
  const joinOptions: JoinOptions = { name: opts.name, token: browserToken(), version: PROTOCOL_VERSION };
  const code = opts.code?.trim().toUpperCase();
  const createOptions =
    opts.floorTimeStart === undefined ? joinOptions : { ...joinOptions, floorTimeStart: opts.floorTimeStart };
  const room = code ? await client.joinById(code, joinOptions) : await client.create(ROOM_NAME, createOptions);
  const lag = new LagSimulator(opts.lag);
  // LagSimulator no se puede cancelar: tras salir, sus entregas pendientes no hacen nada.
  let closed = false;
  let playersCb: ((players: PlayerSnapshots, receivedAtMs: number) => void) | undefined;
  let worldCb: ((world: WorldSnapshot, receivedAtMs: number) => void) | undefined;
  let combatCb: ((event: CombatEvent) => void) | undefined;
  let floorCb: ((items: FloorWeapon[]) => void) | undefined;
  let lastFloor: FloorWeapon[] | undefined; // llega justo tras `welcome`, antes de que haya manejador
  let disconnectCb: ((reason: DisconnectReason) => void) | undefined;

  // Antes de cualquier otro await: `welcome` llega justo después del estado inicial (y tras él las armas
  // del suelo), y los eventos de combate pueden llegar en cualquier momento (sin manejador el SDK avisa
  // en consola).
  room.onMessage(MSG.combat, (event: CombatEvent) => {
    lag.inbound(() => {
      if (!closed) combatCb?.(event);
    });
  });
  room.onMessage(MSG.floorWeapons, (msg: unknown) => {
    const items = parseFloorWeapons(msg);
    lag.inbound(() => {
      if (closed) return;
      lastFloor = items;
      floorCb?.(items);
    });
  });
  const welcome = new Promise<string>((resolve, reject) => {
    room.onMessage(MSG.welcome, (msg: { key: string }) => resolve(msg.key));
    room.onLeave.once((leaveCode) => reject(new Error(`la sala se cerró antes de entrar (${leaveCode})`)));
  });
  // Reconectamos por nombre + token, no con el token de reconexión del SDK.
  room.reconnection.enabled = false;
  const myKey = await welcome;

  const deliverPlayers = () => {
    const players = snapshotPlayers(room);
    lag.inbound(() => {
      if (!closed) playersCb?.(players, performance.now());
    });
  };
  const deliverWorld = () => {
    const world = snapshotWorld(room);
    lag.inbound(() => {
      if (!closed) worldCb?.(world, performance.now());
    });
  };
  room.onStateChange(() => {
    deliverPlayers();
    deliverWorld();
  });
  room.onLeave((leaveCode) => {
    if (closed) return;
    closed = true;
    disconnectCb?.(leaveCode === TAKEOVER_CLOSE_CODE ? "takeover" : "lost");
  });

  return {
    roomCode: room.roomId,
    myKey,
    seed: room.state.seed,
    floor: room.state.floor,
    sendInput(input) {
      lag.outbound(() => {
        if (!closed) room.send(MSG.input, input);
      });
    },
    onPlayers(cb) {
      playersCb = cb;
      // El estado inicial llegó antes de `welcome`; sin cambios no habría otro parche.
      deliverPlayers();
    },
    onWorld(cb) {
      worldCb = cb;
      deliverWorld();
    },
    onCombat(cb) {
      combatCb = cb;
    },
    onFloorWeapons(cb) {
      floorCb = cb;
      if (lastFloor) cb(lastFloor);
    },
    onDisconnect(cb) {
      disconnectCb = cb;
    },
    leave() {
      if (closed) return;
      closed = true;
      void room.leave(true);
    },
  };
}
