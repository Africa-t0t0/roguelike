import { Client, type Room } from "@colyseus/sdk";
import {
  MSG,
  PROTOCOL_VERSION,
  TAKEOVER_CLOSE_CODE,
  type CombatEvent,
  type EnemyKind,
  type JoinOptions,
  type KinematicState,
  type PlayerInput,
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
}

export interface ProjectileSnapshot {
  x: number;
  z: number;
}

/** Todo lo del estado que no son jugadores. */
export interface WorldSnapshot {
  tick: number;
  level: number;
  xp: number;
  xpToNext: number;
  enemies: Map<string, EnemySnapshot>;
  projectiles: Map<string, ProjectileSnapshot>;
}

export type { CombatEvent };

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
  room.state.players.forEach((p: PlayerSnapshot, key: string) => {
    out.set(key, {
      name: p.name,
      x: p.x,
      z: p.z,
      facing: p.facing,
      dodgeTime: p.dodgeTime,
      dodgeCooldown: p.dodgeCooldown,
      dodgeDirX: p.dodgeDirX,
      dodgeDirZ: p.dodgeDirZ,
      y: p.y,
      vy: p.vy,
      lastSeq: p.lastSeq,
      hp: p.hp,
      maxHp: p.maxHp,
      dead: p.dead,
      respawnIn: p.respawnIn,
      comboStep: p.comboStep,
      swingTimer: p.swingTimer,
    });
  });
  return out;
}

function snapshotWorld(room: Room): WorldSnapshot {
  const enemies = new Map<string, EnemySnapshot>();
  room.state.enemies.forEach((e: EnemySnapshot, id: string) => {
    enemies.set(id, {
      kind: e.kind,
      x: e.x,
      z: e.z,
      facing: e.facing,
      hp: e.hp,
      maxHp: e.maxHp,
      ai: e.ai,
      aiTime: e.aiTime,
    });
  });
  const projectiles = new Map<string, ProjectileSnapshot>();
  room.state.projectiles.forEach((p: ProjectileSnapshot, id: string) => {
    projectiles.set(id, { x: p.x, z: p.z });
  });
  const st = room.state;
  return { tick: st.tick, level: st.level, xp: st.xp, xpToNext: st.xpToNext, enemies, projectiles };
}

/** Crea una sala (sin `code`) o entra a una existente. Rechaza con el `MatchMakeError` del SDK. */
export async function connect(opts: { code?: string; name: string; lag: LagConfig }): Promise<GameConnection> {
  const client = new Client(serverUrl());
  const joinOptions: JoinOptions = { name: opts.name, token: browserToken(), version: PROTOCOL_VERSION };
  const code = opts.code?.trim().toUpperCase();
  const room = code ? await client.joinById(code, joinOptions) : await client.create(ROOM_NAME, joinOptions);
  const lag = new LagSimulator(opts.lag);
  // LagSimulator no se puede cancelar: tras salir, sus entregas pendientes no hacen nada.
  let closed = false;
  let playersCb: ((players: PlayerSnapshots, receivedAtMs: number) => void) | undefined;
  let worldCb: ((world: WorldSnapshot, receivedAtMs: number) => void) | undefined;
  let combatCb: ((event: CombatEvent) => void) | undefined;
  let disconnectCb: ((reason: DisconnectReason) => void) | undefined;

  // Antes de cualquier otro await: `welcome` llega justo después del estado inicial, y los eventos
  // de combate pueden llegar en cualquier momento (sin manejador el SDK avisa en consola).
  room.onMessage(MSG.combat, (event: CombatEvent) => {
    lag.inbound(() => {
      if (!closed) combatCb?.(event);
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
