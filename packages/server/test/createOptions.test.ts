import { describe, expect, it } from "vitest";
import { EMPTY_ROOM_TTL_MS } from "@roguelike/shared";
import { resolveCreateOptions } from "../src/rooms/createOptions";

const dev = "development";

describe("resolveCreateOptions", () => {
  it("fuera de producción respeta seed y emptyRoomTtlMs", () => {
    expect(resolveCreateOptions({ seed: 123, emptyRoomTtlMs: 200 }, dev, () => 7)).toEqual({
      seed: 123,
      emptyRoomTtlMs: 200,
      floorTimeStart: 0,
    });
  });

  it("floorTimeStart: respeta un número finito >= 0 fuera de producción", () => {
    const start = (v: unknown, env = dev) => resolveCreateOptions({ floorTimeStart: v as number }, env, () => 7).floorTimeStart;
    expect(start(120)).toBe(120);
    expect(start(-5)).toBe(0);
    expect(start(Number.NaN)).toBe(0);
    expect(start("9")).toBe(0);
    expect(start(120, "production")).toBe(0);
  });

  it("acota emptyRoomTtlMs a [100, EMPTY_ROOM_TTL_MS] y descarta NaN", () => {
    const ttl = (v: unknown) => resolveCreateOptions({ emptyRoomTtlMs: v as number }, dev, () => 7).emptyRoomTtlMs;
    expect(ttl(Number.NaN)).toBe(EMPTY_ROOM_TTL_MS);
    expect(ttl(Infinity)).toBe(EMPTY_ROOM_TTL_MS);
    expect(ttl(1e12)).toBe(EMPTY_ROOM_TTL_MS);
    expect(ttl(-5)).toBe(100);
    expect(ttl("x")).toBe(EMPTY_ROOM_TTL_MS);
  });

  it("seed: entero sin signo de 32 bits si es finito; si no, aleatoria", () => {
    const seed = (v: unknown) => resolveCreateOptions({ seed: v as number }, dev, () => 7).seed;
    expect(seed(-5)).toBe(-5 >>> 0);
    expect(seed(2 ** 32 + 3)).toBe(3);
    expect(seed(Number.NaN)).toBe(7);
    expect(seed("1")).toBe(7);
  });

  it("en producción ignora las opciones", () => {
    expect(resolveCreateOptions({ seed: 123, emptyRoomTtlMs: 200 }, "production", () => 7)).toEqual({
      seed: 7,
      emptyRoomTtlMs: EMPTY_ROOM_TTL_MS,
      floorTimeStart: 0,
    });
  });
});
