import { describe, expect, it } from "vitest";
import { parseDevCommand, SANDBOX_MAX_CLOCK_STEP_S, SANDBOX_MAX_LEVELS, SANDBOX_MAX_SPAWN } from "../src";

describe("parseDevCommand", () => {
  it("acepta cada comando bien formado", () => {
    const ok = [
      { cmd: "levelUp", count: 1, choose: true },
      { cmd: "levelUp", count: SANDBOX_MAX_LEVELS, choose: false },
      { cmd: "card", card: { kind: "stat", id: "haste" } },
      { cmd: "card", card: { kind: "ability", id: "thrust", rank: 3 } },
      { cmd: "clearCards" },
      { cmd: "god", on: true },
      { cmd: "noCooldown", on: false },
      { cmd: "waves", on: true },
      { cmd: "heal" },
      { cmd: "spawn", kind: "brute", count: SANDBOX_MAX_SPAWN, tier: 3 },
      { cmd: "spawn", kind: "mage", count: 1, tier: 0 },
      { cmd: "killAll" },
      { cmd: "freeze", on: true },
      { cmd: "castNow" },
      { cmd: "chest" },
      { cmd: "clock", seconds: 60 },
      { cmd: "weapon", weaponId: "great-sword", tier: 2, nature: "none" },
      { cmd: "weapon", weaponId: "great-sword", tier: 3, nature: "ice" },
      { cmd: "weapon", weaponId: "great-sword", tier: 4, nature: "fire" },
      { cmd: "gear", slot: "boots", tier: 4, action: "equip" },
      { cmd: "gear", slot: "helmet", tier: 1, action: "drop" },
      { cmd: "gear", slot: "belt", tier: 3, action: "equip" },
      { cmd: "relic", id: "glassHeart" },
    ];
    for (const c of ok) expect(parseDevCommand(c)).toEqual(c);
  });

  it("weapon sin nature da \"none\"", () => {
    expect(parseDevCommand({ cmd: "weapon", weaponId: "great-sword", tier: 2 })).toEqual({
      cmd: "weapon", weaponId: "great-sword", tier: 2, nature: "none",
    });
  });

  it("descarta campos de más", () => {
    expect(parseDevCommand({ cmd: "heal", extra: 1 })).toEqual({ cmd: "heal" });
  });

  it("rechaza comandos desconocidos o fuera de rango", () => {
    const bad: unknown[] = [
      null,
      "heal",
      { cmd: "nope" },
      { cmd: "levelUp", count: 0, choose: true },
      { cmd: "levelUp", count: SANDBOX_MAX_LEVELS + 1, choose: true },
      { cmd: "levelUp", count: 1.5, choose: true },
      { cmd: "levelUp", count: 1 },
      { cmd: "card", card: { kind: "stat", id: "toString" } },
      { cmd: "card", card: { kind: "ability", id: "thrust", rank: 4 } },
      { cmd: "card", card: null },
      { cmd: "god", on: 1 },
      { cmd: "freeze" },
      { cmd: "spawn", kind: "dragon", count: 1, tier: 1 },
      { cmd: "spawn", kind: "minion", count: SANDBOX_MAX_SPAWN + 1, tier: 1 },
      { cmd: "spawn", kind: "minion", count: 1, tier: 4 },
      { cmd: "clock", seconds: 0 },
      { cmd: "clock", seconds: SANDBOX_MAX_CLOCK_STEP_S + 1 },
      { cmd: "clock", seconds: Number.NaN },
      { cmd: "weapon", weaponId: "axe", tier: 1 },
      { cmd: "weapon", weaponId: "great-sword", tier: 0 },
      { cmd: "weapon", weaponId: "great-sword", tier: 5 },
      { cmd: "weapon", weaponId: "great-sword", tier: 1, nature: "water" },
    ];
    for (const c of bad) expect(parseDevCommand(c)).toBeNull();
  });
});

describe("parseDevCommand: élites y estados", () => {
  it("spawn acepta elite y nature opcionales y rechaza valores inválidos", () => {
    expect(parseDevCommand({ cmd: "spawn", kind: "brute", count: 1, tier: 2, elite: true, nature: "ice" })).toEqual({
      cmd: "spawn", kind: "brute", count: 1, tier: 2, elite: true, nature: "ice",
    });
    expect(parseDevCommand({ cmd: "spawn", kind: "brute", count: 1, tier: 2, elite: true })).toEqual({
      cmd: "spawn", kind: "brute", count: 1, tier: 2, elite: true,
    });
    expect(parseDevCommand({ cmd: "spawn", kind: "brute", count: 1, tier: 2, elite: "si" })).toBeNull();
    expect(parseDevCommand({ cmd: "spawn", kind: "brute", count: 1, tier: 2, elite: true, nature: "water" })).toBeNull();
  });

  it("status acepta burn, slow y stun", () => {
    for (const kind of ["burn", "slow", "stun"]) expect(parseDevCommand({ cmd: "status", kind })).toEqual({ cmd: "status", kind });
    expect(parseDevCommand({ cmd: "status", kind: "poison" })).toBeNull();
    expect(parseDevCommand({ cmd: "status" })).toBeNull();
  });
});

describe("parseDevCommand gear y relic", () => {
  it("rechaza ranura, tier, acción o id desconocidos", () => {
    expect(parseDevCommand({ cmd: "gear", slot: "cape", tier: 1, action: "equip" })).toBeNull();
    expect(parseDevCommand({ cmd: "gear", slot: "boots", tier: 5, action: "equip" })).toBeNull();
    expect(parseDevCommand({ cmd: "gear", slot: "boots", tier: 1, action: "sell" })).toBeNull();
    expect(parseDevCommand({ cmd: "relic", id: "nope" })).toBeNull();
    expect(parseDevCommand({ cmd: "relic", id: "toString" })).toBeNull();
  });
});
