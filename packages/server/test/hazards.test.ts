import { describe, expect, it } from "vitest";
import { TILE_SIZE, type Dungeon } from "@roguelike/shared";
import { beamLength, inBeam, inZone, type Hazard } from "../src/sim/hazards";

/** Pasillo horizontal de una casilla de alto (z = 2) que llega hasta la casilla `end` (exclusiva). */
function corridor(end: number): Dungeon {
  const width = 20;
  const tiles = new Uint8Array(width * 5);
  for (let x = 0; x < end; x++) tiles[2 * width + x] = 1;
  return { seed: 1, floor: 1, width, height: 5, tiles, rooms: [], startRoomId: 0, bossRoomId: 0 };
}

const beam = (size: number, length: number): Hazard => ({
  id: "h1", kind: "beam", sourceId: "e1", x: 0, z: 0, dirX: 1, dirZ: 0, length, size,
  damage: 1, left: 1, total: 1, phase: "warn",
});

describe("beamLength", () => {
  it("se corta en el muro (a 5 m) o llega al tope", () => {
    const wallAt5 = beamLength(corridor(3), 1, 2.5 * TILE_SIZE, 1, 0, 14); // casillas 0..2 → muro en x = 6
    expect(wallAt5).toBeGreaterThanOrEqual(4.9);
    expect(wallAt5).toBeLessThanOrEqual(5.1);
    expect(beamLength(corridor(20), 1, 2.5 * TILE_SIZE, 1, 0, 14)).toBe(14);
  });
});

describe("inBeam / inZone", () => {
  it("el rayo usa ancho/2 + radio y se acaba en su final", () => {
    const b = beam(0.8, 10);
    expect(inBeam(b, 5, 0.3, 0)).toBe(true);
    expect(inBeam(b, 5, 0.5, 0)).toBe(false);
    expect(inBeam(b, 11, 0, 0)).toBe(false);
    expect(inBeam(b, 5, 0.5, 0.2)).toBe(true);
  });
  it("la zona usa radio + radio del jugador", () => {
    const z: Hazard = { ...beam(2.5, 0), kind: "zone", dirX: 0 };
    expect(inZone(z, 2.5, 0, 0)).toBe(true);
    expect(inZone(z, 2.6, 0, 0)).toBe(false);
    expect(inZone(z, 2.9, 0, 0.4)).toBe(true);
  });
});
