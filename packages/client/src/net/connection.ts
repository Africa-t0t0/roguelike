import { Client, type Room } from "@colyseus/sdk";
import {
  MSG,
  TAKEOVER_CLOSE_CODE,
  type JoinOptions,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";
import { generateToken } from "./token";
import { LagSimulator, type LagConfig } from "./LagSimulator";

export type PlayerSnapshot = KinematicState & { name: string; lastSeq: number };
export type PlayerSnapshots = Map<string, PlayerSnapshot>;

/** `takeover`: otra pestaña tomó el control del jugador. `lost`: cualquier otro corte no pedido. */
export type DisconnectReason = "takeover" | "lost";

export interface GameConnection {
  roomCode: string;
  myKey: string;
  seed: number;
  floor: number;
  sendInput(i: PlayerInput): void;
  onPlayers(cb: (players: PlayerSnapshots, receivedAtMs: number) => void): void;
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
      lastSeq: p.lastSeq,
    });
  });
  return out;
}

/** Crea una sala (sin `code`) o entra a una existente. Rechaza con el `MatchMakeError` del SDK. */
export async function connect(opts: { code?: string; name: string; lag: LagConfig }): Promise<GameConnection> {
  const client = new Client(serverUrl());
  const joinOptions: JoinOptions = { name: opts.name, token: browserToken() };
  const code = opts.code?.trim().toUpperCase();
  const room = code ? await client.joinById(code, joinOptions) : await client.create(ROOM_NAME, joinOptions);
  // Antes de cualquier otro await: `welcome` llega justo después del estado inicial.
  const welcome = new Promise<string>((resolve, reject) => {
    room.onMessage(MSG.welcome, (msg: { key: string }) => resolve(msg.key));
    room.onLeave.once((leaveCode) => reject(new Error(`la sala se cerró antes de entrar (${leaveCode})`)));
  });
  // Reconectamos por nombre + token, no con el token de reconexión del SDK.
  room.reconnection.enabled = false;
  const myKey = await welcome;

  const lag = new LagSimulator(opts.lag);
  // LagSimulator no se puede cancelar: tras salir, sus entregas pendientes no hacen nada.
  let closed = false;
  let playersCb: ((players: PlayerSnapshots, receivedAtMs: number) => void) | undefined;
  let disconnectCb: ((reason: DisconnectReason) => void) | undefined;

  const deliverState = () => {
    const players = snapshotPlayers(room);
    lag.inbound(() => {
      if (!closed) playersCb?.(players, performance.now());
    });
  };
  room.onStateChange(deliverState);
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
      deliverState();
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
