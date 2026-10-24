import { TILE_SIZE } from "./constants";
import { createRng, type Rng } from "./rng";

export type RoomKind = "start" | "combat" | "boss";

export interface DungeonRoom {
  id: number;
  x: number;
  z: number;
  w: number;
  h: number;
  kind: RoomKind;
  neighbors: number[];
}

export interface Dungeon {
  seed: number;
  floor: number;
  width: number;
  height: number;
  /** 0 muro, 1 suelo; índice z*width+x */
  tiles: Uint8Array;
  rooms: DungeonRoom[];
  startRoomId: number;
  bossRoomId: number;
}

const MIN_SIZE = 5;
const MAX_SIZE = 9;
const MIN_GAP = 2;
const MAX_ATTEMPTS = 500;
const GROW_STEP = 8;

type Rect = { x: number; z: number; w: number; h: number };

function center(r: Rect): { x: number; z: number } {
  return { x: r.x + Math.floor(r.w / 2), z: r.z + Math.floor(r.h / 2) };
}

function tooClose(a: Rect, b: Rect): boolean {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapZ = Math.max(b.z - (a.z + a.h), a.z - (b.z + b.h));
  return Math.max(gapX, gapZ) < MIN_GAP;
}

/** Intenta colocar `count` salas; null si alguna no cabe en MAX_ATTEMPTS. */
function placeRooms(rng: Rng, size: number, count: number): Rect[] | null {
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !placed; attempt++) {
      const w = rng.int(MIN_SIZE, MAX_SIZE);
      const h = rng.int(MIN_SIZE, MAX_SIZE);
      // deja siempre 1 casilla de muro en el borde exterior
      const x = rng.int(1, size - w - 1);
      const z = rng.int(1, size - h - 1);
      const cand = { x, z, w, h };
      if (rects.every((r) => !tooClose(r, cand))) {
        rects.push(cand);
        placed = true;
      }
    }
    if (!placed) return null;
  }
  return rects;
}

/** Prim sobre los centros (distancia al cuadrado; empates por menor índice). */
function primEdges(rects: Rect[]): [number, number][] {
  const centers = rects.map(center);
  const inTree = new Array<boolean>(rects.length).fill(false);
  inTree[0] = true;
  const edges: [number, number][] = [];
  for (let step = 1; step < rects.length; step++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let a = 0; a < rects.length; a++) {
      if (!inTree[a]) continue;
      for (let b = 0; b < rects.length; b++) {
        if (inTree[b]) continue;
        const dx = centers[a]!.x - centers[b]!.x;
        const dz = centers[a]!.z - centers[b]!.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = [a, b];
        }
      }
    }
    inTree[best![1]] = true;
    edges.push(best!);
  }
  return edges;
}

function carveRoom(tiles: Uint8Array, width: number, r: Rect): void {
  for (let z = r.z; z < r.z + r.h; z++) {
    for (let x = r.x; x < r.x + r.w; x++) tiles[z * width + x] = 1;
  }
}

/** Pasillo en L de 1 casilla: horizontal en z de `a`, luego vertical en x de `b`. */
function carveCorridor(tiles: Uint8Array, width: number, a: Rect, b: Rect): void {
  const ca = center(a);
  const cb = center(b);
  const dx = Math.sign(cb.x - ca.x);
  for (let x = ca.x; x !== cb.x; x += dx) tiles[ca.z * width + x] = 1;
  const dz = Math.sign(cb.z - ca.z);
  for (let z = ca.z; z !== cb.z; z += dz) tiles[z * width + cb.x] = 1;
  tiles[cb.z * width + cb.x] = 1;
}

export function generateDungeon(seed: number, floor: number): Dungeon {
  const rng = createRng(seed ^ Math.imul(floor, 0x9e3779b1));
  const count = 6 + 2 * floor;
  let size = 40 + 8 * floor;
  let rects = placeRooms(rng, size, count);
  while (rects === null) {
    size += GROW_STEP;
    rects = placeRooms(rng, size, count);
  }

  const edges = primEdges(rects);
  // una arista extra entre salas aún no conectadas, para formar un ciclo
  const linked = new Set(edges.map(([a, b]) => `${Math.min(a, b)},${Math.max(a, b)}`));
  const candidates: [number, number][] = [];
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      if (!linked.has(`${a},${b}`)) candidates.push([a, b]);
    }
  }
  if (candidates.length > 0) edges.push(rng.pick(candidates));

  const tiles = new Uint8Array(size * size);
  for (const r of rects) carveRoom(tiles, size, r);
  for (const [a, b] of edges) carveCorridor(tiles, size, rects[a]!, rects[b]!);

  const rooms: DungeonRoom[] = rects.map((r, id) => ({ id, ...r, kind: "combat", neighbors: [] }));
  for (const [a, b] of edges) {
    rooms[a]!.neighbors.push(b);
    rooms[b]!.neighbors.push(a);
  }
  for (const room of rooms) room.neighbors.sort((p, q) => p - q);

  // BFS desde start; boss = mayor distancia, empate al id menor
  const dist = new Array<number>(count).fill(-1);
  dist[0] = 0;
  const queue = [0];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    for (const n of rooms[cur]!.neighbors) {
      if (dist[n] === -1) {
        dist[n] = dist[cur]! + 1;
        queue.push(n);
      }
    }
  }
  let bossRoomId = 0;
  for (let i = 1; i < count; i++) {
    if (dist[i]! > dist[bossRoomId]!) bossRoomId = i;
  }
  rooms[0]!.kind = "start";
  rooms[bossRoomId]!.kind = "boss";

  return { seed, floor, width: size, height: size, tiles, rooms, startRoomId: 0, bossRoomId };
}

export function isWalkableTile(d: Dungeon, tx: number, tz: number): boolean {
  if (!Number.isInteger(tx) || !Number.isInteger(tz)) return false;
  if (tx < 0 || tz < 0 || tx >= d.width || tz >= d.height) return false;
  return d.tiles[tz * d.width + tx] === 1;
}

export function tileCenter(tx: number, tz: number): { x: number; z: number } {
  return { x: (tx + 0.5) * TILE_SIZE, z: (tz + 0.5) * TILE_SIZE };
}

/** Centros de `count` casillas distintas de la sala, ordenadas por cercanía al centro. */
export function roomSpawnPoints(
  d: Dungeon,
  roomId: number,
  count: number,
): { x: number; z: number }[] {
  const room = d.rooms[roomId];
  if (!room) throw new Error(`roomSpawnPoints: sala ${roomId} inexistente`);
  const c = center(room);
  const tiles: { tx: number; tz: number; dist: number }[] = [];
  for (let tz = room.z; tz < room.z + room.h; tz++) {
    for (let tx = room.x; tx < room.x + room.w; tx++) {
      if (isWalkableTile(d, tx, tz)) {
        tiles.push({ tx, tz, dist: (tx - c.x) ** 2 + (tz - c.z) ** 2 });
      }
    }
  }
  tiles.sort((a, b) => a.dist - b.dist || a.tz - b.tz || a.tx - b.tx);
  return tiles.slice(0, count).map((t) => tileCenter(t.tx, t.tz));
}
