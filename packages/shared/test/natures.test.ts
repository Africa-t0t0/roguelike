import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng";
import { natureEffects } from "../src/natures";
import { newProgress, playerMods, rollOffer } from "../src/cards";
import { eliteChance } from "../src/waves";
import { weaponDisplayName } from "../src/weapons";

describe("natureEffects", () => {
  it("fuego: 0,2 base y 0,3 con Afinidad 2", () => {
    expect(natureEffects("fire", 0).burnFrac).toBeCloseTo(0.2);
    expect(natureEffects("fire", 2).burnFrac).toBeCloseTo(0.3);
  });
  it("hielo: 0,3 base y acotado a 0,6", () => {
    expect(natureEffects("ice", 0).slowFrac).toBeCloseTo(0.3);
    expect(natureEffects("ice", 4).slowFrac).toBeCloseTo(0.6);
    expect(natureEffects("ice", 10).slowFrac).toBeCloseTo(0.6);
  });
  it("rayo: 0,31 con Afinidad 1", () => {
    expect(natureEffects("lightning", 1).chainChance).toBeCloseTo(0.31);
  });
  it("sin naturaleza todo es 0", () => {
    expect(natureEffects("none", 3)).toEqual({ burnFrac: 0, slowFrac: 0, chainChance: 0 });
  });
});

describe("eliteChance", () => {
  it("curva por tiempo de piso", () => {
    expect(eliteChance(179)).toBe(0);
    expect(eliteChance(180)).toBeCloseTo(0.05);
    expect(eliteChance(300)).toBeCloseTo(0.07);
    expect(eliteChance(3000)).toBeCloseTo(0.15);
  });
});

describe("weaponDisplayName", () => {
  it("con y sin naturaleza", () => {
    expect(weaponDisplayName("great-sword", 4, "fire")).toBe("Mandoble legendario de fuego");
    expect(weaponDisplayName("guard-sword", 2)).toBe("Espada de guardia templada");
    expect(weaponDisplayName("guard-sword", 3, "lightning")).toBe("Espada de guardia rúnica del rayo");
  });
});

describe("Afinidad", () => {
  it("rollOffer solo la ofrece con arma de naturaleza", () => {
    const rng = createRng(5);
    let seen = false;
    for (let i = 0; i < 200; i++) {
      expect(rollOffer(rng, newProgress()).some((c) => c.kind === "stat" && c.id === "affinity")).toBe(false);
    }
    for (let i = 0; i < 200; i++) {
      if (rollOffer(rng, newProgress(), { natureWeapon: true }).some((c) => c.kind === "stat" && c.id === "affinity")) seen = true;
    }
    expect(seen).toBe(true);
  });
  it("playerMods cuenta las cartas", () => {
    const p = newProgress();
    p.stats.affinity = 2;
    expect(playerMods(p).affinity).toBe(2);
  });
});
