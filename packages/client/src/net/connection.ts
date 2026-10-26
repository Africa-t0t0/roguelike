import { Client, type Room } from "@colyseus/sdk";
import {
  FLOOR_WEAPON_TTL_S,
  MSG,
  STAT_CARDS,
  PROTOCOL_VERSION,
  STARTING_WEAPON,
  TAKEOVER_CLOSE_CODE,
  isWeaponId,
  isWeaponTier,
  type AbilityId,
  type CardOffer,
  type CombatEvent,
  type DevCommand,
  type EnemyKind,
  type JoinOptions,
  type KinematicState,
  type PlayerInput,
  type WeaponId,
  type WeaponTier,
} from "@roguelike/shared";
import type { LevelChoice } from "../ui/cardPanel";
import { isAbilityId, type AbilitySlotView } from "./LocalAbility";
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
  /** casillas en orden (la tecla i+1 usa la i-ésima), sin la pasiva; `cooldown` en s */
  abilities: (AbilitySlotView & { rank: number })[];
  /** rango de la Onda de corte; 0 si no la tiene */
  passiveRank: number;
  blocking: boolean;
  /** el mayor Grito activo sobre él (0 si ninguno) */
  buffDamage: number;
  /** multiplicador de movimiento de sus cartas (sin el del Bloqueo) */
  moveSpeedMult: number;
  attackSpeedMult: number;
  /** multiplicador de enfriamiento de habilidades (Celeridad) */
  cooldownMult: number;
  /** tiene una elección de carta abierta */
  choosing: boolean;
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
  /** segundos que le quedan aturdido */
  stunned: number;
  /** tier del hechizo (0 si no es hechicero) */
  spellTier: number;
}

/** Peligro en el suelo: zona circular o rayo, con aviso ("warn") y luego daño ("fire"). */
export interface HazardSnapshot {
  kind: "zone" | "beam";
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  length: number;
  size: number;
  left: number;
  total: number;
  phase: "warn" | "fire";
}

const HAZARD_NUMBERS = ["x", "z", "dirX", "dirZ", "length", "size", "left", "total"] as const;

/** Valida un peligro crudo del estado: null si el kind o la fase no se conocen o algún número no es finito. */
export function parseHazard(raw: unknown): HazardSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const h = raw as Record<string, unknown>;
  if (h.kind !== "zone" && h.kind !== "beam") return null;
  if (h.phase !== "warn" && h.phase !== "fire") return null;
  for (const k of HAZARD_NUMBERS) if (typeof h[k] !== "number" || !Number.isFinite(h[k])) return null;
  return {
    kind: h.kind,
    x: h.x as number,
    z: h.z as number,
    dirX: h.dirX as number,
    dirZ: h.dirZ as number,
    length: h.length as number,
    size: h.size as number,
    left: h.left as number,
    total: h.total as number,
    phase: h.phase,
  };
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

/** Onda de corte de un jugador. */
export interface PlayerShotSnapshot {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  radius: number;
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
  playerShots: Map<string, PlayerShotSnapshot>;
  hazards: Map<string, HazardSnapshot>;
  /** el grupo está eligiendo cartas: la simulación no avanza */
  paused: boolean;
  /** segundos que quedan de la elección en curso de la pausa */
  pauseLeft: number;
}

export type { CombatEvent };

/** Arma tirada en el suelo, propia de este jugador. */
export interface FloorWeapon {
  weaponId: WeaponId;
  tier: WeaponTier;
  x: number;
  z: number;
  /** segundos que le quedaban al llegar el mensaje (el cliente los baja con el reloj del juego) */
  ttl: number;
}

/**
 * Valida el mensaje `floorWeapons` (`{ items: { weaponId, tier, x, z, ttl }[] }`); descarta lo que no encaje.
 * Sin `tier` vale 1; con un tier inválido el ítem se descarta. Sin `ttl` (o inválido) vale FLOOR_WEAPON_TTL_S.
 */
export function parseFloorWeapons(msg: unknown): FloorWeapon[] {
  const items = (msg as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: FloorWeapon[] = [];
  for (const it of items as { weaponId?: unknown; tier?: unknown; x?: unknown; z?: unknown; ttl?: unknown }[]) {
    if (!it || !isWeaponId(it.weaponId) || !Number.isFinite(it.x) || !Number.isFinite(it.z)) continue;
    const tier = it.tier === undefined ? 1 : it.tier;
    if (!isWeaponTier(tier)) continue;
    const ttl = typeof it.ttl === "number" && Number.isFinite(it.ttl) ? it.ttl : FLOOR_WEAPON_TTL_S;
    out.push({ weaponId: it.weaponId, tier, x: it.x as number, z: it.z as number, ttl });
  }
  return out;
}

/** Un evento `ability` con id desconocido se ignora (las vistas indexan ABILITIES[id] y lanzarían). */
export function isValidCombatEvent(event: unknown): event is CombatEvent {
  const e = event as { type?: unknown; id?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  return e.type !== "ability" || isAbilityId(e.id);
}

function parseCard(raw: unknown): CardOffer | undefined {
  const c = raw as { kind?: unknown; id?: unknown; rank?: unknown } | null;
  if (c?.kind === "stat" && typeof c.id === "string" && Object.hasOwn(STAT_CARDS, c.id)) {
    return { kind: "stat", id: c.id as keyof typeof STAT_CARDS };
  }
  if (c?.kind === "ability" && isAbilityId(c.id) && (c.rank === 1 || c.rank === 2 || c.rank === 3)) {
    return { kind: "ability", id: c.id, rank: c.rank };
  }
  return undefined;
}

/** Valida el mensaje `levelChoice` (`{ offerId, cards, index, total, deadlineS }`); undefined si no encaja. */
export function parseLevelChoice(msg: unknown): (LevelChoice & { offerId: number }) | undefined {
  const m = msg as { offerId?: unknown; cards?: unknown; index?: unknown; total?: unknown; deadlineS?: unknown } | null;
  if (!m || !Number.isFinite(m.offerId) || !Array.isArray(m.cards) || m.cards.length === 0) return undefined;
  if (!Number.isFinite(m.index) || !Number.isFinite(m.total) || !Number.isFinite(m.deadlineS)) return undefined;
  const cards = m.cards.map(parseCard);
  if (cards.some((c) => !c)) return undefined;
  return {
    offerId: m.offerId as number,
    cards: cards as CardOffer[],
    index: m.index as number,
    total: m.total as number,
    deadlineS: m.deadlineS as number,
  };
}

/** `takeover`: otra pestaña tomó el control del jugador. `lost`: cualquier otro corte no pedido. */
export type DisconnectReason = "takeover" | "lost";

export interface GameConnection {
  roomCode: string;
  myKey: string;
  /** sala de pruebas: el servidor atiende `sendDev` */
  sandbox: boolean;
  seed: number;
  floor: number;
  sendInput(i: PlayerInput): void;
  onPlayers(cb: (players: PlayerSnapshots, receivedAtMs: number) => void): void;
  onWorld(cb: (world: WorldSnapshot, receivedAtMs: number) => void): void;
  onCombat(cb: (event: CombatEvent) => void): void;
  /** Armas del suelo propias; se entrega enseguida la última lista recibida, si ya llegó. */
  onFloorWeapons(cb: (items: FloorWeapon[]) => void): void;
  /**
   * Elección de carta abierta para este jugador (pausa del grupo, sin pausa, o reenviada tras un takeover). Si
   * llegó antes de registrar el manejador se entrega enseguida (si no venció), con `deadlineS` descontando lo
   * ya pasado.
   */
  onLevelChoice(cb: (choice: LevelChoice) => void): void;
  /** Elige la carta `index` de la última oferta recibida (el servidor ignora una oferta vieja). */
  chooseCard(index: number): void;
  /** Comando del panel de pruebas (solo hace algo en una sala sandbox). */
  sendDev(cmd: DevCommand): void;
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
  type RawPlayer = Omit<PlayerSnapshot, "weaponId" | "weaponTier" | "abilities"> & {
    weaponId: string;
    weaponTier: number;
    abilities: { forEach(cb: (s: { id: string; rank: number; cooldown: number }) => void): void };
  };
  room.state.players.forEach((p: RawPlayer, key: string) => {
    const abilities: PlayerSnapshot["abilities"] = [];
    // Con la misma PROTOCOL_VERSION toda id es conocida; una que no lo sea (no debería pasar) se descarta.
    p.abilities?.forEach((s) => {
      if (isAbilityId(s.id)) abilities.push({ id: s.id as AbilityId, rank: s.rank, cooldown: s.cooldown });
    });
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
      abilities,
      passiveRank: p.passiveRank ?? 0,
      blocking: p.blocking ?? false,
      buffDamage: p.buffDamage ?? 0,
      moveSpeedMult: p.moveSpeedMult || 1,
      attackSpeedMult: p.attackSpeedMult || 1,
      cooldownMult: Number.isFinite(p.cooldownMult) && p.cooldownMult > 0 ? p.cooldownMult : 1,
      choosing: p.choosing ?? false,
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
      stunned: e.stunned ?? 0,
      spellTier: e.spellTier ?? 0,
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
  const playerShots = new Map<string, PlayerShotSnapshot>();
  room.state.playerShots?.forEach((w: PlayerShotSnapshot, id: string) => {
    playerShots.set(id, { x: w.x, z: w.z, dirX: w.dirX, dirZ: w.dirZ, radius: w.radius });
  });
  const hazards = new Map<string, HazardSnapshot>();
  room.state.hazards?.forEach((raw: unknown, id: string) => {
    const h = parseHazard(raw);
    if (h) hazards.set(id, h);
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
    playerShots,
    hazards,
    paused: st.paused ?? false,
    pauseLeft: st.pauseLeft ?? 0,
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

/** Solo para pruebas en desarrollo: `?sandbox=1` crea una sala de pruebas con el panel (F2). */
export function parseSandbox(search: string): boolean {
  return new URLSearchParams(search).get("sandbox") === "1";
}

/**
 * Crea una sala (sin `code`) o entra a una existente. Rechaza con el `MatchMakeError` del SDK.
 * `floorTimeStart` y `sandbox` solo se mandan al crear (son opciones de prueba).
 */
export async function connect(opts: {
  code?: string;
  name: string;
  lag: LagConfig;
  floorTimeStart?: number;
  sandbox?: boolean;
}): Promise<GameConnection> {
  const client = new Client(serverUrl());
  const joinOptions: JoinOptions = { name: opts.name, token: browserToken(), version: PROTOCOL_VERSION };
  const code = opts.code?.trim().toUpperCase();
  const createOptions = {
    ...joinOptions,
    ...(opts.floorTimeStart === undefined ? {} : { floorTimeStart: opts.floorTimeStart }),
    ...(opts.sandbox ? { sandbox: true } : {}),
  };
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
  let choiceCb: ((choice: LevelChoice) => void) | undefined;
  // La elección sin pausa de quien vuelve llega justo tras `welcome`, mientras se cargan los modelos.
  let lastChoice: { choice: LevelChoice & { offerId: number }; receivedAt: number } | undefined;

  // Antes de cualquier otro await: `welcome` llega justo después del estado inicial (y tras él las armas
  // del suelo), y los eventos de combate pueden llegar en cualquier momento (sin manejador el SDK avisa
  // en consola).
  room.onMessage(MSG.combat, (event: CombatEvent) => {
    if (!isValidCombatEvent(event)) return;
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
  room.onMessage(MSG.levelChoice, (msg: unknown) => {
    const choice = parseLevelChoice(msg);
    if (!choice) return;
    lag.inbound(() => {
      if (closed) return;
      lastChoice = { choice, receivedAt: performance.now() };
      choiceCb?.(choice);
    });
  });
  const welcome = new Promise<{ key: string; sandbox?: boolean }>((resolve, reject) => {
    room.onMessage(MSG.welcome, (msg: { key: string; sandbox?: boolean }) => resolve(msg));
    room.onLeave.once((leaveCode) => reject(new Error(`la sala se cerró antes de entrar (${leaveCode})`)));
  });
  // Reconectamos por nombre + token, no con el token de reconexión del SDK.
  room.reconnection.enabled = false;
  const { key: myKey, sandbox = false } = await welcome;

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
    sandbox,
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
    onLevelChoice(cb) {
      choiceCb = cb;
      if (!lastChoice) return;
      const { choice, receivedAt } = lastChoice;
      // Vencida ya se resolvió en el servidor (carta al azar): no se muestra.
      const deadlineS = choice.deadlineS - (performance.now() - receivedAt) / 1000;
      if (deadlineS > 0) cb({ ...choice, deadlineS });
    },
    chooseCard(index) {
      const offerId = lastChoice?.choice.offerId;
      if (offerId === undefined) return;
      lag.outbound(() => {
        if (!closed) room.send(MSG.chooseCard, { offerId, index });
      });
    },
    sendDev(cmd) {
      lag.outbound(() => {
        if (!closed) room.send(MSG.dev, cmd);
      });
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
