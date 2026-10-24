import { ErrorCode } from "@colyseus/sdk";
import { JOIN_ERROR_STATUS, MAX_PLAYERS, NAME_MAX_LEN } from "@roguelike/shared";

const MESSAGES: Record<number, string> = {
  [JOIN_ERROR_STATUS["name-taken"]]: "Ese nombre ya está en uso en esta sala",
  [JOIN_ERROR_STATUS["room-full"]]: `La sala está llena (máximo ${MAX_PLAYERS})`,
  [JOIN_ERROR_STATUS["invalid-name"]]: `Nombre inválido: usa de 1 a ${NAME_MAX_LEN} letras, números, espacios, _ o -`,
  [ErrorCode.MATCHMAKE_INVALID_ROOM_ID]: "No existe una sala con ese código",
};

const GENERIC = "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo";

/** Texto para el lobby a partir del error de `connect` (el SDK rechaza con `MatchMakeError { code }`). */
export function joinErrorMessage(err: unknown): string {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return (typeof code === "number" && MESSAGES[code]) || GENERIC;
}
