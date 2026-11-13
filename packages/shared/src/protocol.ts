import type { AbilityId } from "./cards";
import type { ClassId } from "./combat";
import type { Nature } from "./natures";
import { NAME_MAX_LEN } from "./constants";

/** Sube cuando cambia el protocolo; el servidor rechaza versiones distintas. */
export const PROTOCOL_VERSION = 20;

export interface JoinOptions {
  name: string;
  /** rol elegido en el lobby; solo cuenta la primera vez que ese nombre entra a la sala */
  cls?: ClassId;
  token: string;
  version: number;
}

export type JoinErrorCode = "invalid-name" | "name-taken" | "room-full" | "version-mismatch";

export const JOIN_ERROR_STATUS: Record<JoinErrorCode, number> = {
  "invalid-name": 4101,
  "name-taken": 4102,
  "room-full": 4103,
  "version-mismatch": 4104,
};

/** Código de cierre que recibe la conexión vieja cuando otra pestaña toma el control del jugador. */
export const TAKEOVER_CLOSE_CODE = 4005;

/**
 * Mensajes cliente/servidor. `welcome` lleva `{ key: string; sandbox: boolean }`; `dev` lleva un `DevCommand`;
 * `fuse` lleva `{ ids: AbilityId[] }`: las dos primeras de la fusión o la que se le suma (gasta una fusión ganada al
 * matar al jefe).
 */
export const MSG = {
  input: "input",
  welcome: "welcome",
  combat: "combat",
  floorWeapons: "floorWeapons",
  levelChoice: "levelChoice",
  chooseCard: "chooseCard",
  dev: "dev",
  fuse: "fuse",
} as const;

const NAME_CHARS = /^[\p{L}\p{N} _-]+$/u;

/** Normaliza un nombre: recorta, colapsa espacios internos, valida largo y caracteres. */
export function normalizeName(raw: unknown): { display: string; key: string } | null {
  if (typeof raw !== "string") return null;
  const display = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (display.length === 0 || [...display].length > NAME_MAX_LEN) return null;
  if (!NAME_CHARS.test(display)) return null;
  return { display, key: display.toLowerCase() };
}

export type CombatEvent =
  | {
      type: "damage";
      targetKind: "enemy" | "player";
      targetId: string;
      amount: number;
      x: number;
      z: number;
      /** Solo en daño a enemigos: clave del jugador que golpeó. */
      sourceKey?: string;
    }
  | { type: "swing"; key: string; step: number }
  | { type: "levelUp"; level: number }
  /** un jugador empezó una habilidad activa; los demás clientes reproducen su animación */
  | { type: "ability"; key: string; id: AbilityId; aimDist?: number; rank?: number }
  /** Rayo arcano: puntos [x, z] del haz, del mago al primer golpeado y a cada rebote */
  | { type: "beam"; key: string; points: [number, number][]; nature?: Nature }
  /** algo estalló en (x, z) con ese radio: una mina, un meteorito, la marca del Rayo o el pulso de la Esfera */
  | { type: "blast"; kind: "mine" | "meteor" | "meteorBig" | "mark" | "orb" | "blade"; x: number; z: number; radius: number; nature?: Nature }
  /** un enemigo empieza un gesto de apoyo: el refuerzo en área del hechicero (aviso en el suelo de ese radio) */
  | { type: "enemyBuff"; x: number; z: number; radius: number; castS: number }
  /** un curandero curó a un aliado: de dónde a dónde va el haz */
  | { type: "enemyHeal"; from: [number, number]; to: [number, number]; amount: number; targetId: string }
  /** Sanación: a quiénes curó */
  | { type: "heal"; keys: string[] }
  /** salto del rayo: puntos [x, z] de la cadena, del golpeado a los siguientes blancos */
  | { type: "chain"; points: [number, number][] }
  /** el jefe aparece (`awake`), se enfurece (`enraged`) o cae (`down`) en (x, z) */
  | { type: "boss"; phase: "awake" | "enraged" | "down"; x: number; z: number }
  /** `key` sumó habilidades a su fusión: `ids` es la fusión entera tras sumarlas */
  | { type: "fused"; key: string; ids: AbilityId[] };
