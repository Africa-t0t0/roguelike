import { describe, expect, it } from "vitest";
import { INTERP_DELAY_MS, type CombatEvent } from "@roguelike/shared";
import { damageTiming } from "../src/render/damageTiming";

type Damage = Extract<CombatEvent, { type: "damage" }>;
const dmg = (over: Partial<Damage>): Damage => ({
  type: "damage", targetKind: "enemy", targetId: "e1", amount: 12, x: 0, z: 0, ...over,
});
const NOW = 5000;

describe("damageTiming", () => {
  it("el daño propio se ve ya en el reloj del presente", () => {
    expect(damageTiming(dmg({ targetKind: "player", targetId: "ana" }), "ana", NOW)).toEqual({
      numberAt: NOW, hitAt: NOW, hurtMe: true,
    });
  });

  it("un golpe propio a un enemigo se ve ya: número ahora y destello en el reloj interpolado", () => {
    expect(damageTiming(dmg({ sourceKey: "ana" }), "ana", NOW)).toEqual({
      numberAt: NOW, hitAt: NOW - INTERP_DELAY_MS, hurtMe: false,
    });
  });

  it("lo de otros se ve con el retardo de interpolación", () => {
    expect(damageTiming(dmg({ sourceKey: "beto" }), "ana", NOW)).toEqual({
      numberAt: NOW + INTERP_DELAY_MS, hitAt: NOW, hurtMe: false,
    });
    expect(damageTiming(dmg({ targetKind: "player", targetId: "beto" }), "ana", NOW)).toEqual({
      numberAt: NOW + INTERP_DELAY_MS, hitAt: NOW, hurtMe: false,
    });
  });
});
