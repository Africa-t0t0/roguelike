import { describe, expect, it } from "vitest";
import { FlowField, hasLineOfSight, isWalkableTile, tileCenter, TILE_SIZE, type Dungeon } from "../src";

/** Mapa en "L" de 20x20: sala A (1..5,1..5), pasillo horizontal z=3 (x 6..14),
 *  pasillo vertical x=14 (z 4..12) y sala B (12..16,13..17). */
function lDungeon(): Dungeon {
  const width = 20;
  const height = 20;
  const tiles = new Uint8Array(width * height);
  const fill = (x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) tiles[z * width + x] = 1;
  };
  fill(1, 1, 5, 5);
  fill(6, 3, 14, 3);
  fill(14, 4, 14, 12);
  fill(12, 13, 16, 17);
  return { seed: 0, floor: 1, width, height, tiles, rooms: [], startRoomId: 0, bossRoomId: 0 };
}

describe("FlowField", () => {
  it("distancia 0 en la fuente, Infinity en muro y largo exacto en la otra punta", () => {
    const d = lDungeon();
    const flow = new FlowField(d);
    flow.rebuild([{ tx: 1, tz: 3 }]);
    expect(flow.distance(1, 3)).toBe(0);
    expect(flow.distance(0, 0)).toBe(Infinity);
    expect(flow.distance(-5, 40)).toBe(Infinity);
    // 13 pasos por el pasillo + 10 bajando; la esquina no se corta (sería 22)
    expect(flow.distance(14, 13)).toBe(23);
  });

  it("seguir next llega a la fuente en distance pasos sin pisar muros ni cortar esquinas", () => {
    const d = lDungeon();
    const flow = new FlowField(d);
    flow.rebuild([{ tx: 1, tz: 3 }]);
    let cur: { tx: number; tz: number } = { tx: 14, tz: 13 };
    const total = flow.distance(cur.tx, cur.tz);
    let steps = 0;
    for (;;) {
      const n = flow.next(cur.tx, cur.tz);
      if (!n) break;
      expect(isWalkableTile(d, n.tx, n.tz)).toBe(true);
      if (n.tx !== cur.tx && n.tz !== cur.tz) {
        expect(isWalkableTile(d, n.tx, cur.tz)).toBe(true);
        expect(isWalkableTile(d, cur.tx, n.tz)).toBe(true);
      }
      cur = n;
      steps++;
      expect(steps).toBeLessThanOrEqual(total);
    }
    expect(steps).toBe(total);
    expect(cur).toEqual({ tx: 1, tz: 3 });
    expect(flow.next(0, 0)).toBeNull();
  });

  it("con dos fuentes cada casilla apunta a la más cercana por recorrido", () => {
    const d = lDungeon();
    const flow = new FlowField(d);
    flow.rebuild([
      { tx: 3, tz: 3 },
      { tx: 14, tz: 16 },
    ]);
    expect(flow.distance(14, 8)).toBe(8);
    expect(flow.next(14, 8)).toEqual({ tx: 14, tz: 9 });
    expect(flow.next(8, 3)).toEqual({ tx: 7, tz: 3 });
    expect(flow.next(3, 3)).toBeNull();
    expect(flow.next(14, 16)).toBeNull();
  });

  it("sourcesKey no depende del orden de las fuentes", () => {
    const flow = new FlowField(lDungeon());
    flow.rebuild([{ tx: 3, tz: 3 }, { tx: 14, tz: 16 }]);
    const a = flow.sourcesKey;
    flow.rebuild([{ tx: 14, tz: 16 }, { tx: 3, tz: 3 }]);
    expect(flow.sourcesKey).toBe(a);
    flow.rebuild([{ tx: 3, tz: 3 }]);
    expect(flow.sourcesKey).not.toBe(a);
  });

  it("rebuild en un tablero de 60x60 tarda menos de 5 ms de media", () => {
    const width = 60;
    const tiles = new Uint8Array(width * width).fill(1);
    const d: Dungeon = { seed: 0, floor: 1, width, height: width, tiles, rooms: [], startRoomId: 0, bossRoomId: 0 };
    const flow = new FlowField(d);
    flow.rebuild([{ tx: 30, tz: 30 }]);
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) flow.rebuild([{ tx: i % 60, tz: 30 }, { tx: 5, tz: 5 }]);
    expect((Date.now() - t0) / 100).toBeLessThan(5);
  });
});

describe("hasLineOfSight", () => {
  const d = lDungeon();
  const c = (tx: number, tz: number) => tileCenter(tx, tz);

  it("true dentro de una sala", () => {
    const a = c(1, 1);
    const b = c(5, 5);
    expect(hasLineOfSight(d, a.x, a.z, b.x, b.z, 0.4)).toBe(true);
  });

  it("false a través del codo de la L", () => {
    const a = c(1, 3);
    const b = c(14, 13);
    expect(hasLineOfSight(d, a.x, a.z, b.x, b.z, 0.4)).toBe(false);
    const e = c(10, 3);
    const f = c(14, 8);
    expect(hasLineOfSight(d, e.x, e.z, f.x, f.z, 0.1)).toBe(false);
  });

  it("false si el segmento roza un muro a menos de radius", () => {
    const a = c(7, 3);
    const b = c(13, 3);
    expect(hasLineOfSight(d, a.x, a.z, b.x, b.z, 0.5)).toBe(true);
    // el pasillo mide TILE_SIZE de ancho: ±1.5 m se sale
    expect(hasLineOfSight(d, a.x, a.z, b.x, b.z, TILE_SIZE * 0.75)).toBe(false);
  });
});
