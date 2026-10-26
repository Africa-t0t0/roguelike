import { describe, expect, it } from "vitest";
import { PICKUP_RANGE } from "@roguelike/shared";
import { parseFloorTimeStart, parseFloorWeapons, parseSandbox } from "../src/net/connection";
import { floorWeaponBlink, nearestClosedChest, nearestPickup, pickupPrompt } from "../src/render/floorWeaponViews";

describe("armas del suelo", () => {
  it("parseFloorWeapons acepta la lista del servidor y descarta lo que no encaja", () => {
    expect(
      parseFloorWeapons({
        items: [
          { weaponId: "great-sword", tier: 3, x: 1, z: 2, ttl: 12.5, nature: "fire" },
          { weaponId: "nope", x: 0, z: 0 },
          { weaponId: "great-sword", tier: 7, x: 0, z: 0 },
          { weaponId: "guard-sword", x: Number.NaN, z: 0 },
          null,
          { weaponId: "guard-sword", x: 3, z: -4 },
        ],
      }),
    ).toEqual([
      { weaponId: "great-sword", tier: 3, x: 1, z: 2, ttl: 12.5, nature: "fire" },
      { weaponId: "guard-sword", tier: 1, x: 3, z: -4, ttl: 40, nature: "none" }, // sin tier: 1; sin ttl: 40
    ]);
    expect(parseFloorWeapons(null)).toEqual([]);
    expect(parseFloorWeapons({ items: "x" })).toEqual([]);
  });

  it("nearestPickup: la más cercana a ≤ PICKUP_RANGE, o ninguna", () => {
    const items = [
      { weaponId: "great-sword" as const, tier: 1 as const, x: 1, z: 0, ttl: 40, nature: "none" as const },
      { weaponId: "guard-sword" as const, tier: 2 as const, x: -0.5, z: 0, ttl: 40, nature: "none" as const },
    ];
    expect(nearestPickup(items, 0, 0)?.weaponId).toBe("guard-sword");
    expect(nearestPickup(items, 1 + PICKUP_RANGE, 0)?.weaponId).toBe("great-sword"); // justo en el borde
    expect(nearestPickup(items, 1 + PICKUP_RANGE + 0.01, 0)).toBeUndefined();
    expect(nearestPickup([], 0, 0)).toBeUndefined();
  });

  it("nearestClosedChest: el cerrado más cercano a ≤ PICKUP_RANGE; los abiertos y lejanos no cuentan", () => {
    const chests = [
      { x: 1, z: 0, open: false },
      { x: 0.2, z: 0, open: true },
      { x: -0.8, z: 0, open: false },
    ];
    expect(nearestClosedChest(chests, 0, 0)).toBe(chests[2]);
    expect(nearestClosedChest(chests, 1 + PICKUP_RANGE, 0)).toBe(chests[0]);
    expect(nearestClosedChest(chests, 1 + PICKUP_RANGE + 0.01, 0)).toBeUndefined();
    expect(nearestClosedChest([{ x: 0, z: 0, open: true }], 0, 0)).toBeUndefined();
  });

  it("floorWeaponBlink: visible con ttl > 5 y alterna a 6 Hz con ttl <= 5", () => {
    expect(floorWeaponBlink(5.01, 0.01)).toBe(true);
    expect(floorWeaponBlink(5.01, 0.09)).toBe(true);
    expect(floorWeaponBlink(5, 0.01)).toBe(true); // fase visible
    expect(floorWeaponBlink(5, 1 / 12 + 0.01)).toBe(false); // fase oculta (medio periodo de 1/6 s)
    expect(floorWeaponBlink(1, 1 / 6 + 0.01)).toBe(true);
  });

  it("pickupPrompt", () => {
    expect(pickupPrompt("great-sword", 1)).toBe("Recoger Mandoble oxidado");
    expect(pickupPrompt("guard-sword", 3)).toBe("Recoger Espada de guardia rúnica");
  });
});

describe("parámetro de prueba floorTimeStart", () => {
  it("lee segundos ≥ 0 y si no, undefined", () => {
    expect(parseFloorTimeStart("?floorTimeStart=300")).toBe(300);
    expect(parseFloorTimeStart("?lag=100&floorTimeStart=0")).toBe(0);
    expect(parseFloorTimeStart("")).toBeUndefined();
    expect(parseFloorTimeStart("?floorTimeStart=")).toBeUndefined();
    expect(parseFloorTimeStart("?floorTimeStart=-5")).toBeUndefined();
    expect(parseFloorTimeStart("?floorTimeStart=abc")).toBeUndefined();
  });
});

describe("parseSandbox", () => {
  it("solo ?sandbox=1 activa la sala de pruebas", () => {
    expect(parseSandbox("?sandbox=1")).toBe(true);
    expect(parseSandbox("?lag=100&sandbox=1")).toBe(true);
    expect(parseSandbox("?sandbox=0")).toBe(false);
    expect(parseSandbox("")).toBe(false);
  });
});
