import { describe, expect, it } from "vitest";
import { isValidCombatEvent, parseChest } from "../src/net/connection";

describe("parseo de la red: cofres y cadena", () => {
  it("el evento chain exige puntos", () => {
    expect(isValidCombatEvent({ type: "chain", points: [[0, 0], [1, 1]] })).toBe(true);
    expect(isValidCombatEvent({ type: "chain", points: [] })).toBe(false);
    expect(isValidCombatEvent({ type: "chain" })).toBe(false);
    expect(isValidCombatEvent({ type: "chain", points: [[0, "a"]] })).toBe(false);
  });

  it("parseChest acepta un cofre y descarta uno con números inválidos", () => {
    expect(parseChest({ x: 3, z: -2, open: false })).toEqual({ x: 3, z: -2, open: false });
    expect(parseChest({ x: Number.NaN, z: 1, open: false })).toBeNull();
    expect(parseChest({ x: 1, z: 1, open: "no" })).toBeNull();
    expect(parseChest(null)).toBeNull();
  });
});
