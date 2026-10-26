import { describe, expect, it } from "vitest";
import { chestSpots } from "../src/chests";
import { generateDungeon, isWalkableTile } from "../src/dungeon";
import { TILE_SIZE } from "../src/constants";

describe("chestSpots", () => {
  const d = generateDungeon(123, 1);
  it("uno cada dos salas de combate", () => {
    const combat = d.rooms.filter((r) => r.kind === "combat").length;
    expect(chestSpots(d)).toHaveLength(Math.ceil(combat / 2));
  });
  it("cada punto es caminable y pegado a un muro", () => {
    for (const p of chestSpots(d)) {
      const tx = Math.floor(p.x / TILE_SIZE);
      const tz = Math.floor(p.z / TILE_SIZE);
      expect(isWalkableTile(d, tx, tz)).toBe(true);
      const wall = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) => !isWalkableTile(d, tx + dx!, tz + dz!));
      expect(wall).toBe(true);
    }
  });
  it("es determinista", () => {
    expect(chestSpots(d)).toEqual(chestSpots(generateDungeon(123, 1)));
  });
});
