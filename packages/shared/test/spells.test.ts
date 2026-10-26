import { describe, expect, it } from "vitest";
import { ENEMY_DEFS, SPELLS, casterKinds, casterTelegraphS, isCaster } from "../src";

describe("casterKinds", () => {
  it("suma hechiceros con el tiempo del piso", () => {
    expect(casterKinds(0)).toEqual(["mage"]);
    expect(casterKinds(239.9)).toEqual(["mage"]);
    expect(casterKinds(240)).toEqual(["mage", "pyromancer"]);
    expect(casterKinds(360)).toEqual(["mage", "pyromancer", "stormcaller"]);
  });
});

describe("isCaster", () => {
  it("distingue hechiceros", () => {
    expect(isCaster("mage")).toBe(true);
    expect(isCaster("pyromancer")).toBe(true);
    expect(isCaster("stormcaller")).toBe(true);
    expect(isCaster("brute")).toBe(false);
  });
});

describe("casterTelegraphS", () => {
  it("usa el del tier solo para el tormentoso y acota el tier", () => {
    expect(casterTelegraphS("stormcaller", 1)).toBe(1.1);
    expect(casterTelegraphS("stormcaller", 2)).toBe(0.9);
    expect(casterTelegraphS("stormcaller", 3)).toBe(0.9);
    expect(casterTelegraphS("stormcaller", 0)).toBe(1.1);
    expect(casterTelegraphS("pyromancer", 3)).toBe(0.6);
    expect(casterTelegraphS("mage", 2)).toBe(0.7);
    expect(casterTelegraphS("brute", 1)).toBe(0.6);
  });
});

describe("SPELLS", () => {
  it("datos por tier", () => {
    expect(SPELLS.mage.tiers).toEqual({
      1: { count: 1, speed: 9, spreadDeg: 0 },
      2: { count: 1, speed: 12, spreadDeg: 0 },
      3: { count: 3, speed: 12, spreadDeg: 15 },
    });
    expect(SPELLS.pyromancer.tiers).toEqual({
      1: { count: 1, radius: 2.5 },
      2: { count: 1, radius: 3.2 },
      3: { count: 3, radius: 2.5 },
    });
    expect(SPELLS.stormcaller.tiers).toEqual({
      1: { telegraphS: 1.1, width: 0.8 },
      2: { telegraphS: 0.9, width: 0.8 },
      3: { telegraphS: 0.9, width: 1.3 },
    });
  });

  it("ENEMY_DEFS de los hechiceros nuevos", () => {
    expect(ENEMY_DEFS.pyromancer).toEqual({
      hp: 30, speed: 3, radius: 0.5, damage: 14, attackRange: 0, telegraphS: 0.6, cooldownS: 3, xp: 8,
      ranged: { preferredMin: 7, preferredMax: 12, losRadius: 0.3 },
    });
    expect(ENEMY_DEFS.stormcaller).toEqual({
      hp: 26, speed: 3, radius: 0.5, damage: 12, attackRange: 0, telegraphS: 1.1, cooldownS: 3.5, xp: 8,
      ranged: { preferredMin: 8, preferredMax: 13, losRadius: 0.3 },
    });
    expect(ENEMY_DEFS.mage.ranged).toEqual({ preferredMin: 6, preferredMax: 10, losRadius: 0.3 });
  });
});
