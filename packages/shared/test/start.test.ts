import { describe, expect, it } from "vitest";
import { generateDungeon, isWalkableTile, outsideStartRoom, startSeals, tileCenter, TILE_SIZE } from "../src";

describe("sellos de la sala inicial", () => {
  for (const seed of [123, 7, 2024]) {
    it(`semilla ${seed}: sellos válidos sobre el borde`, () => {
      const d = generateDungeon(seed, 1);
      const r = d.rooms[d.startRoomId]!;
      const seals = startSeals(d);
      expect(seals.length).toBeGreaterThanOrEqual(1);
      expect(startSeals(d)).toEqual(seals);
      for (const s of seals) {
        const horizontal = s.z0 === s.z1;
        const vertical = s.x0 === s.x1;
        expect(horizontal !== vertical).toBe(true);
        const len = horizontal ? s.x1 - s.x0 : s.z1 - s.z0;
        expect(len).toBeGreaterThan(0);
        expect(len % TILE_SIZE).toBe(0);
        for (let k = 0; k < len / TILE_SIZE; k++) {
          // casillas de dentro y de fuera adyacentes al tramo k
          let inside: [number, number];
          let outside: [number, number];
          if (horizontal) {
            const tx = s.x0 / TILE_SIZE + k;
            const tz = s.z0 / TILE_SIZE;
            const top = tz === r.z;
            expect(top || tz === r.z + r.h).toBe(true);
            inside = [tx, top ? tz : tz - 1];
            outside = [tx, top ? tz - 1 : tz];
          } else {
            const tz = s.z0 / TILE_SIZE + k;
            const tx = s.x0 / TILE_SIZE;
            const left = tx === r.x;
            expect(left || tx === r.x + r.w).toBe(true);
            inside = [left ? tx : tx - 1, tz];
            outside = [left ? tx - 1 : tx, tz];
          }
          expect(isWalkableTile(d, ...inside)).toBe(true);
          expect(isWalkableTile(d, ...outside)).toBe(true);
          const c = tileCenter(...outside);
          expect(outsideStartRoom(d, c.x, c.z)).toBe(true);
          const ci = tileCenter(...inside);
          expect(outsideStartRoom(d, ci.x, ci.z)).toBe(false);
        }
      }
    });
  }

  it("el centro de la sala inicial no está fuera", () => {
    const d = generateDungeon(123, 1);
    const r = d.rooms[d.startRoomId]!;
    expect(outsideStartRoom(d, (r.x + r.w / 2) * TILE_SIZE, (r.z + r.h / 2) * TILE_SIZE)).toBe(false);
  });
});
