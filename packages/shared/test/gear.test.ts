import { describe, expect, it } from "vitest";
import {
  applyCard, combinedMods, createRng, gearName, gearStatText, LEGENDARY_POOL, newProgress, playerMods, rollGear,
  rollGearTier, RELICS, GEAR_SLOTS, LEGENDARY_TEXT, LEGENDARY_ABILITY, blockMoveMult, BLOCK_MOVE_MULT, type GearItem, type Progress,
} from "../src";

const prog = (stats: Progress["stats"] = {}): Progress => ({ stats, abilities: [] });
const chestT4 = (): GearItem => ({ slot: "chest", tier: 4, stats: [{ stat: "damageTaken", value: 0.125 }], legendary: null });

describe("rollGear", () => {
  it("botas tier 1: una stat y sin legendaria", () => {
    const g = rollGear(createRng(1), "boots", 1, "warrior");
    expect(g.stats).toEqual([{ stat: "moveSpeed", value: 0.05 }]);
    expect(g.legendary).toBeNull();
  });
  it("tier 3: 3 stats sin repetir, principal ×2", () => {
    for (let s = 0; s < 30; s++) {
      const g = rollGear(createRng(s), "boots", 3, "warrior");
      expect(g.stats).toHaveLength(3);
      expect(g.stats[0]).toEqual({ stat: "moveSpeed", value: 0.1 });
      expect(new Set(g.stats.map((e) => e.stat)).size).toBe(3);
    }
  });
  it("tier 4: allRes +0,10 y legendaria de la bolsa de botas", () => {
    const g = rollGear(createRng(7), "boots", 4, "warrior");
    expect(g.stats.find((e) => e.stat === "allRes")).toEqual({ stat: "allRes", value: 0.1 });
    expect(g.stats).toHaveLength(4);
    expect(LEGENDARY_POOL.warrior.boots).toContain(g.legendary);
  });
  it("stats planas enteras (regen a 1 decimal) en todos los tiers", () => {
    for (let s = 0; s < 40; s++) {
      for (const tier of [1, 2, 3, 4] as const) {
        for (const slot of ["helmet", "chest", "gloves", "belt", "boots"] as const) {
          for (const e of rollGear(createRng(s), slot, tier, "warrior").stats) {
            if (e.stat === "maxHp" || e.stat === "lifeOnKill") expect(Number.isInteger(e.value)).toBe(true);
            if (e.stat === "regen") expect(Math.round(e.value * 10) / 10).toBe(e.value);
          }
        }
      }
    }
  });
  it("determinista", () => {
    expect(rollGear(createRng(5), "helmet", 4, "warrior")).toEqual(rollGear(createRng(5), "helmet", 4, "warrior"));
  });
  it("rollGearTier acota", () => {
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) expect(rollGearTier(rng, 9999, 10, 2)).toBeLessThanOrEqual(2);
  });
});

describe("combinedMods", () => {
  it("pechera T4 + 10 Piel de hierro: tope 0,4", () => {
    expect(combinedMods(prog({ ironskin: 10 }), { chest: chestT4() }, null).damageTakenMult).toBe(0.4);
  });
  it("Reloj de arena baja el piso de enfriamiento a 0,4", () => {
    expect(combinedMods(prog({ haste: 20 }), {}, null).cooldownMult).toBe(0.5);
    const m = combinedMods(prog({ haste: 20 }), {}, "brokenHourglass");
    expect(m.cooldownMult).toBeCloseTo(0.4);
    expect(m.abilityHpCost).toBe(4);
  });
  it("Corazón de cristal", () => {
    const m = combinedMods(prog(), {}, "glassHeart");
    expect(m.damageMult).toBeCloseTo(1.6);
    expect(m.maxHpMult).toBe(0.75);
  });
  it("Colmillo del vampiro", () => {
    const m = combinedMods(prog(), {}, "vampireFang");
    expect(m.vampire).toBe(0.05);
    expect(m.noRegen).toBe(true);
  });
  it("resistencia acotada a 0,6", () => {
    const g: GearItem = { slot: "helmet", tier: 4, stats: [{ stat: "maxHp", value: 37.5 }, { stat: "resFire", value: 0.5 }, { stat: "allRes", value: 0.1 }], legendary: "warcryLong" };
    const m = combinedMods(prog(), { helmet: g }, "threeKingsStone");
    expect(m.resist.fire).toBe(0.6);
    expect(m.resist.ice).toBeCloseTo(0.25);
    expect(m.legendaries).toEqual(["warcryLong"]);
  });
  it("sin equipo ni reliquia coincide con playerMods", () => {
    const p = newProgress();
    for (const c of ["vitality", "fury", "haste", "ironskin", "magnet", "learning"] as const) {
      applyCard(p, { kind: "stat", id: c });
      applyCard(p, { kind: "stat", id: c });
    }
    const base = playerMods(p);
    const m = combinedMods(p, {}, null);
    for (const k of Object.keys(base) as (keyof typeof base)[]) expect(m[k]).toEqual(base[k]);
    expect(m.noRegen).toBe(false);
    expect(m.legendaries).toEqual([]);
  });
  it("hay 9 reliquias", () => expect(Object.keys(RELICS)).toHaveLength(9));
});

describe("cinturón", () => {
  it("orden de ranuras y principal regen ×tier (1 decimal)", () => {
    expect(GEAR_SLOTS).toEqual(["helmet", "chest", "gloves", "belt", "boots"]);
    const vals = ([1, 2, 3, 4] as const).map((t) => rollGear(createRng(3), "belt", t, "warrior").stats[0]);
    expect(vals).toEqual([1, 1.5, 2, 2.5].map((value) => ({ stat: "regen", value })));
  });
  it("regen no se repite como secundaria", () => {
    for (let s = 0; s < 100; s++) {
      const g = rollGear(createRng(s), "belt", 4, "warrior");
      expect(g.stats.filter((e) => e.stat === "regen")).toHaveLength(1);
      expect(new Set(g.stats.map((e) => e.stat)).size).toBe(g.stats.length);
    }
  });
  it("legendarias del cinturón: reserva, textos y habilidad", () => {
    expect(LEGENDARY_POOL.warrior.belt).toEqual(["warcryGuard", "blockFree"]);
    for (let s = 0; s < 20; s++) expect(LEGENDARY_POOL.warrior.belt).toContain(rollGear(createRng(s), "belt", 4, "warrior").legendary);
    expect(LEGENDARY_TEXT.warcryGuard).toBe("Grito de guerra también reduce el daño recibido un 20 % mientras dura");
    expect(LEGENDARY_TEXT.blockFree).toBe("Bloquear no te ralentiza");
    expect(LEGENDARY_ABILITY.warcryGuard).toBe("warcry");
    expect(LEGENDARY_ABILITY.blockFree).toBe("block");
  });
  it("nombre", () => {
    expect(gearName({ slot: "belt", tier: 2, stats: [], legendary: null })).toBe("Cinturón templado");
    expect(gearName({ slot: "belt", tier: 3, stats: [], legendary: null })).toBe("Cinturón rúnico");
    expect(gearName({ slot: "belt", tier: 4, stats: [], legendary: null })).toBe("Cinturón legendario");
  });
  it("blockMoveMult: mitad salvo con blockFree", () => {
    expect(blockMoveMult([])).toBe(BLOCK_MOVE_MULT);
    expect(blockMoveMult(["warcryGuard"])).toBe(BLOCK_MOVE_MULT);
    expect(blockMoveMult(["blockFree"])).toBe(1);
  });
});

describe("nombres y textos", () => {
  it("concordancia", () => {
    expect(gearName({ slot: "boots", tier: 2, stats: [], legendary: null })).toBe("Botas templadas");
    expect(gearName({ slot: "chest", tier: 3, stats: [], legendary: null })).toBe("Pechera rúnica");
    expect(gearName({ slot: "helmet", tier: 4, stats: [], legendary: null })).toBe("Yelmo legendario");
    expect(gearName({ slot: "gloves", tier: 2, stats: [], legendary: null })).toBe("Guanteletes templados");
  });
  it("formato de stats", () => {
    expect(gearStatText("moveSpeed", 0.075)).toBe("+7,5 % velocidad de movimiento");
    expect(gearStatText("resFire", 0.12)).toBe("+12 % resistencia al fuego");
    expect(gearStatText("damageTaken", 0.125)).toBe("-12,5 % daño recibido");
    expect(gearStatText("maxHp", 15)).toBe("+15 vida máxima");
    expect(gearStatText("allRes", 0.1)).toBe("+10 % resistencia a todos los elementos");
  });
});
