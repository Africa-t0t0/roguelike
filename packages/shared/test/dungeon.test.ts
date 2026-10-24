import { describe, expect, it } from "vitest";
import { CORRIDOR_WIDTH } from "../src/constants";
import { generateDungeon, isWalkableTile, roomSpawnPoints, type Dungeon } from "../src/dungeon";

function roomCenter(d: Dungeon, id: number) {
  const r = d.rooms[id]!;
  return { x: r.x + Math.floor(r.w / 2), z: r.z + Math.floor(r.h / 2) };
}

function bfsRooms(d: Dungeon): number[] {
  const dist = new Array<number>(d.rooms.length).fill(-1);
  dist[d.startRoomId] = 0;
  const queue = [d.startRoomId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of d.rooms[cur]!.neighbors) {
      if (dist[n] === -1) {
        dist[n] = dist[cur]! + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

describe("generateDungeon", () => {
  it("es determinista", () => {
    expect(generateDungeon(7, 1)).toEqual(generateDungeon(7, 1));
  });

  it("semillas distintas generan tiles distintos", () => {
    expect(generateDungeon(7, 1).tiles).not.toEqual(generateDungeon(8, 1).tiles);
  });

  it(`no hay pasos más angostos que CORRIDOR_WIDTH (${CORRIDOR_WIDTH} casillas)`, () => {
    // toda casilla de suelo pertenece a algún cuadrado de CORRIDOR_WIDTH×CORRIDOR_WIDTH todo suelo
    const n = CORRIDOR_WIDTH;
    for (const floor of [1, 2, 3]) {
      for (let seed = 1; seed <= 50; seed++) {
        const d = generateDungeon(seed, floor);
        const allFloor = (x0: number, z0: number) => {
          for (let z = z0; z < z0 + n; z++) {
            for (let x = x0; x < x0 + n; x++) if (!isWalkableTile(d, x, z)) return false;
          }
          return true;
        };
        for (let z = 0; z < d.height; z++) {
          for (let x = 0; x < d.width; x++) {
            if (!isWalkableTile(d, x, z)) continue;
            let ok = false;
            for (let z0 = z - n + 1; z0 <= z && !ok; z0++) {
              for (let x0 = x - n + 1; x0 <= x && !ok; x0++) ok = allFloor(x0, z0);
            }
            expect(ok, `seed ${seed} piso ${floor} casilla (${x},${z})`).toBe(true);
          }
        }
      }
    }
  });

  for (const floor of [1, 2, 3]) {
    it(`cumple las invariantes en el piso ${floor} (semillas 1..50)`, () => {
      for (let seed = 1; seed <= 50; seed++) {
        const d = generateDungeon(seed, floor);
        const ctx = `seed ${seed}`;
        expect(d.rooms.length, ctx).toBe(6 + 2 * floor);
        expect(d.tiles.length).toBe(d.width * d.height);

        // borde siempre muro
        for (let i = 0; i < d.width; i++) {
          expect(d.tiles[i], ctx).toBe(0);
          expect(d.tiles[(d.height - 1) * d.width + i], ctx).toBe(0);
        }
        for (let j = 0; j < d.height; j++) {
          expect(d.tiles[j * d.width], ctx).toBe(0);
          expect(d.tiles[j * d.width + d.width - 1], ctx).toBe(0);
        }

        // tamaño de salas y separación
        for (const r of d.rooms) {
          expect(r.w).toBeGreaterThanOrEqual(5);
          expect(r.w).toBeLessThanOrEqual(9);
          expect(r.h).toBeGreaterThanOrEqual(5);
          expect(r.h).toBeLessThanOrEqual(9);
        }
        for (const a of d.rooms) {
          for (const b of d.rooms) {
            if (a.id >= b.id) continue;
            const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
            const gapZ = Math.max(b.z - (a.z + a.h), a.z - (b.z + b.h));
            expect(Math.max(gapX, gapZ), `${ctx} salas ${a.id},${b.id}`).toBeGreaterThanOrEqual(2);
          }
        }

        // todo el suelo alcanzable desde el centro de start
        const c = roomCenter(d, d.startRoomId);
        const seen = new Uint8Array(d.tiles.length);
        const stack = [c.z * d.width + c.x];
        seen[stack[0]!] = 1;
        while (stack.length > 0) {
          const i = stack.pop()!;
          const x = i % d.width;
          const z = Math.floor(i / d.width);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx;
            const nz = z + dz;
            if (!isWalkableTile(d, nx, nz)) continue;
            const ni = nz * d.width + nx;
            if (!seen[ni]) {
              seen[ni] = 1;
              stack.push(ni);
            }
          }
        }
        for (let i = 0; i < d.tiles.length; i++) {
          if (d.tiles[i] === 1) expect(seen[i], `${ctx} casilla ${i}`).toBe(1);
        }

        // start / boss
        expect(d.startRoomId).toBe(0);
        expect(d.bossRoomId).not.toBe(d.startRoomId);
        const dist = bfsRooms(d);
        expect(dist.every((v) => v >= 0), ctx).toBe(true);
        expect(dist[d.bossRoomId], ctx).toBe(Math.max(...dist));
        expect(d.rooms[d.bossRoomId]!.kind).toBe("boss");
        expect(d.rooms[d.startRoomId]!.kind).toBe("start");
      }
    });
  }
});

describe("roomSpawnPoints", () => {
  it("devuelve puntos distintos sobre casillas caminables", () => {
    const d = generateDungeon(3, 1);
    const pts = roomSpawnPoints(d, d.startRoomId, 4);
    expect(pts).toHaveLength(4);
    expect(new Set(pts.map((p) => `${p.x},${p.z}`)).size).toBe(4);
    for (const p of pts) {
      expect(isWalkableTile(d, Math.floor(p.x / 2), Math.floor(p.z / 2))).toBe(true);
    }
  });
});

describe("isWalkableTile", () => {
  it("es false fuera de rango", () => {
    const d = generateDungeon(1, 1);
    expect(isWalkableTile(d, -1, 0)).toBe(false);
    expect(isWalkableTile(d, 0, d.height)).toBe(false);
  });
});
