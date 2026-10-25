import { describe, expect, it } from "vitest";
import { PICKUP_RANGE } from "@roguelike/shared";
import { parseFloorWeapons } from "../src/net/connection";
import { nearestPickup, pickupPrompt } from "../src/render/floorWeaponViews";

describe("armas del suelo", () => {
  it("parseFloorWeapons acepta la lista del servidor y descarta lo que no encaja", () => {
    expect(
      parseFloorWeapons({
        items: [
          { weaponId: "great-sword", x: 1, z: 2 },
          { weaponId: "nope", x: 0, z: 0 },
          { weaponId: "guard-sword", x: Number.NaN, z: 0 },
          null,
          { weaponId: "guard-sword", x: 3, z: -4 },
        ],
      }),
    ).toEqual([
      { weaponId: "great-sword", x: 1, z: 2 },
      { weaponId: "guard-sword", x: 3, z: -4 },
    ]);
    expect(parseFloorWeapons(null)).toEqual([]);
    expect(parseFloorWeapons({ items: "x" })).toEqual([]);
  });

  it("nearestPickup: la más cercana a ≤ PICKUP_RANGE, o ninguna", () => {
    const items = [
      { weaponId: "great-sword" as const, x: 1, z: 0 },
      { weaponId: "guard-sword" as const, x: -0.5, z: 0 },
    ];
    expect(nearestPickup(items, 0, 0)?.weaponId).toBe("guard-sword");
    expect(nearestPickup(items, 1 + PICKUP_RANGE, 0)?.weaponId).toBe("great-sword"); // justo en el borde
    expect(nearestPickup(items, 1 + PICKUP_RANGE + 0.01, 0)).toBeUndefined();
    expect(nearestPickup([], 0, 0)).toBeUndefined();
  });

  it("pickupPrompt", () => {
    expect(pickupPrompt("great-sword")).toBe("E: tomar Mandoble");
  });
});
