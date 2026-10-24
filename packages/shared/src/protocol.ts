import { NAME_MAX_LEN } from "./constants";

/** Sube cuando cambia el protocolo; el servidor rechaza versiones distintas. */
export const PROTOCOL_VERSION = 4;

export interface JoinOptions {
  name: string;
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

/** Mensajes cliente/servidor. `welcome` lleva `{ key: string }`. */
export const MSG = { input: "input", welcome: "welcome", combat: "combat", floorWeapons: "floorWeapons" } as const;

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
  | { type: "levelUp"; level: number };
