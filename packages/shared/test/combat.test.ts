import { describe, expect, it } from "vitest";
import {
  TILE_SIZE,
  circlesOverlap,
  enemiesForRoom,
  inArc,
  moveCircle,
  playerStats,
  sanitizeInput,
  xpToNext,
  type Dungeon,
} from "../src/index";

function makeDungeon(): Dungeon {
  const width = 12;
  const height = 12;
  const tiles = new Uint8Array(width * height);
  for (let z = 1; z <= 10; z++) for (let x = 1; x <= 10; x++) tiles[z * width + x] = 1;
  return { seed: 0, floor: 1, width, height, tiles, rooms: [], startRoomId: 0, bossRoomId: 0 } as unknown as Dungeon;
}

describe("stats y conteos", () => {
  it("playerStats", () => {
    expect(playerStats("warrior", 1)).toEqual({ maxHp: 120, damage: 12 });
    expect(playerStats("warrior", 3)).toEqual({ maxHp: 144, damage: 16 });
  });
  it("xpToNext", () => {
    expect(xpToNext(1)).toBe(20);
    expect(xpToNext(4)).toBe(50);
  });
  it("enemiesForRoom", () => {
    expect(enemiesForRoom(1, 1)).toBe(4);
    expect(enemiesForRoom(3, 4)).toBe(9);
  });
});

describe("inArc", () => {
  const o = { x: 0, z: 0, facing: 0 };
  it("dentro y fuera", () => {
    expect(inArc(o, { x: 0, z: 2, radius: 0.4 }, 2.2, 120)).toBe(true);
    expect(inArc(o, { x: 0, z: 2.7, radius: 0.4 }, 2.2, 120)).toBe(false);
    expect(inArc(o, { x: 2, z: 0.1, radius: 0.4 }, 2.2, 120)).toBe(false);
    expect(inArc(o, { x: 0, z: -0.2, radius: 0.4 }, 2.2, 120)).toBe(true);
    expect(inArc({ x: 0, z: 0, facing: Math.PI / 2 }, { x: 2, z: 0, radius: 0.4 }, 2.2, 120)).toBe(true);
  });
});

describe("circlesOverlap", () => {
  it("borde exacto no solapa", () => {
    const a = { x: 0, z: 0, radius: 0.5 };
    expect(circlesOverlap(a, { x: 1, z: 0, radius: 0.5 })).toBe(false);
    expect(circlesOverlap(a, { x: 0.99, z: 0, radius: 0.5 })).toBe(true);
  });
});

describe("moveCircle", () => {
  it("se detiene en bordeDelMuro - radio", () => {
    const d = makeDungeon();
    const edge = 11 * TILE_SIZE;
    const r = moveCircle(d, 10.5 * TILE_SIZE, 6 * TILE_SIZE, 100, 0, 0.5);
    expect(r.x).toBeCloseTo(edge - 0.5, 6);
    expect(r.z).toBe(6 * TILE_SIZE);
  });
});

describe("sanitizeInput ataque", () => {
  it("attack y viewTick", () => {
    expect(sanitizeInput({ seq: 1, attack: "y", viewTick: -3 })).toMatchObject({ attack: false, viewTick: 0 });
    expect(sanitizeInput({ seq: 1, attack: true, viewTick: 41.5 })).toMatchObject({ attack: true, viewTick: 41.5 });
  });
});
