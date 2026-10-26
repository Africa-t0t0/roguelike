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
      { cmd: "clock", seconds: 60 },
      { cmd: "weapon", weaponId: "great-sword", tier: 2 },
    ];
    for (const c of ok) expect(parseDevCommand(c)).toEqual(c);
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
    ];
    for (const c of bad) expect(parseDevCommand(c)).toBeNull();
  });
});
