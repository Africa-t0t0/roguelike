import { describe, expect, it } from "vitest";
import type { Dungeon } from "@roguelike/shared";
import { chestStyle, FogOfWar, REVEAL_RADIUS_TILES } from "../src/ui/minimap";

/** 40×12: una sala 8×8 en x 2..9 y un pasillo de una casilla en z = 5 hasta x = 39. */
function corridorDungeon(): Dungeon {
  const width = 40;
  const height = 12;
  const tiles = new Uint8Array(width * height);
  for (let z = 2; z < 10; z++) for (let x = 2; x < 10; x++) tiles[z * width + x] = 1;
  for (let x = 10; x < width; x++) tiles[5 * width + x] = 1;
  return {
    seed: 1, floor: 1, width, height, tiles, startRoomId: 0, bossRoomId: 0,
    rooms: [{ id: 0, x: 2, z: 2, w: 8, h: 8, kind: "start", neighbors: [] }],
  };
}

describe("FogOfWar", () => {
  it("dentro de una sala la descubre entera, y nada de muros", () => {
    const fog = new FogOfWar(corridorDungeon());
    expect(fog.reveal(3, 3)).toBe(true);
    expect(fog.isSeen(9, 9)).toBe(true);
    expect(fog.isSeen(0, 0)).toBe(false); // muro
    expect(fog.isSeen(3 + REVEAL_RADIUS_TILES + 1, 5)).toBe(false); // pasillo fuera del radio
    expect(fog.isSeen(3 + REVEAL_RADIUS_TILES, 5)).toBe(true);
  });

  it("en un pasillo descubre solo el radio, y repetir no trae nada nuevo", () => {
    const fog = new FogOfWar(corridorDungeon());
    expect(fog.reveal(25, 5)).toBe(true);
    expect(fog.fresh.length).toBe(2 * REVEAL_RADIUS_TILES + 1);
    expect(fog.isSeen(3, 3)).toBe(false);
    expect(fog.reveal(25, 5)).toBe(false);
    expect(fog.reveal(26, 5)).toBe(true);
    expect(fog.fresh).toEqual([5 * 40 + 26 + REVEAL_RADIUS_TILES]);
  });

  it("fuera del mapa no rompe", () => {
    const fog = new FogOfWar(corridorDungeon());
    expect(() => fog.reveal(-5, -5)).not.toThrow();
    expect(fog.isSeen(-1, 3)).toBe(false);
  });
});

describe("cofres en el minimapa", () => {
  it("cerrado y abierto se pintan distinto", () => {
    expect(chestStyle(false)).not.toBe(chestStyle(true));
    expect(chestStyle(false)).toBe("#ffb000");
  });
});
