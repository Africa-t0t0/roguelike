import { randomInt } from "node:crypto";
import { EMPTY_ROOM_TTL_MS } from "@roguelike/shared";

export interface RunRoomCreateOptions {
  seed?: number;
  emptyRoomTtlMs?: number;
}

const MIN_EMPTY_ROOM_TTL_MS = 100;

/** `seed` y `emptyRoomTtlMs` son solo para pruebas: en producción cualquier cliente podría mandarlos. */
export function resolveCreateOptions(
  options: RunRoomCreateOptions | undefined,
  env: string | undefined,
  randomSeed: () => number = () => randomInt(2 ** 32),
): { seed: number; emptyRoomTtlMs: number } {
  const honor = env !== "production";
  const rawSeed = honor ? options?.seed : undefined;
  const rawTtl = honor ? options?.emptyRoomTtlMs : undefined;
  return {
    seed: typeof rawSeed === "number" && Number.isFinite(rawSeed) ? rawSeed >>> 0 : randomSeed(),
    emptyRoomTtlMs:
      typeof rawTtl === "number" && Number.isFinite(rawTtl)
        ? Math.min(EMPTY_ROOM_TTL_MS, Math.max(MIN_EMPTY_ROOM_TTL_MS, rawTtl))
        : EMPTY_ROOM_TTL_MS,
  };
}
