import { describe, expect, it } from "vitest";
import { generateDungeon, isWalkableTile, TILE_SIZE } from "@roguelike/shared";
import { flicker, nearestTorches, torchSpots } from "../src/render/torches";

describe("antorchas de pared", () => {
  const d = generateDungeon(12345, 1);
  const spots = torchSpots(d);

  it("son deterministas y hay a lo más dos por sala", () => {
    expect(torchSpots(generateDungeon(12345, 1))).toEqual(spots);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.length).toBeLessThanOrEqual(d.rooms.length * 2);
  });

  it("cuelgan de un muro: suelo delante y muro detrás", () => {
    for (const s of spots) {
      const tx = Math.floor(s.x / TILE_SIZE);
      const inward = s.yaw === 0 ? 1 : -1; // 0 mira a +Z
      const front = Math.floor((s.z + inward * 0.5) / TILE_SIZE);
      const back = Math.floor((s.z - inward * 0.5) / TILE_SIZE);
      expect(isWalkableTile(d, tx, front)).toBe(true);
      expect(isWalkableTile(d, tx, back)).toBe(false);
    }
  });

  it("nearestTorches ordena por distancia", () => {
    const list = [
      { x: 10, z: 0, yaw: 0 },
      { x: 1, z: 0, yaw: 0 },
      { x: 5, z: 0, yaw: 0 },
    ];
    expect(nearestTorches(list, 0, 0, 2)).toEqual([1, 2]);
    expect(nearestTorches(list, 0, 0, 5)).toEqual([1, 2, 0]);
  });

  it("flicker queda dentro de ±amount", () => {
    for (let t = 0; t < 10; t += 0.037) {
      const f = flicker(t, 3, 0.15);
      expect(f).toBeGreaterThanOrEqual(0.85 - 1e-9);
      expect(f).toBeLessThanOrEqual(1.15 + 1e-9);
    }
  });
});
