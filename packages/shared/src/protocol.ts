import { NAME_MAX_LEN } from "./constants";

export interface JoinOptions {
  name: string;
  token: string;
}

export type JoinErrorCode = "invalid-name" | "name-taken" | "room-full";

export const JOIN_ERROR_STATUS: Record<JoinErrorCode, number> = {
  "invalid-name": 4001,
  "name-taken": 4002,
  "room-full": 4003,
};

/** Mensajes cliente/servidor. `welcome` lleva `{ key: string }`. */
export const MSG = { input: "input", welcome: "welcome" } as const;

const NAME_CHARS = /^[\p{L}\p{N} _-]+$/u;

/** Normaliza un nombre: recorta, colapsa espacios internos, valida largo y caracteres. */
export function normalizeName(raw: unknown): { display: string; key: string } | null {
  if (typeof raw !== "string") return null;
  const display = raw.trim().replace(/\s+/g, " ");
  if (display.length === 0 || [...display].length > NAME_MAX_LEN) return null;
  if (!NAME_CHARS.test(display)) return null;
  return { display, key: display.toLowerCase() };
}
