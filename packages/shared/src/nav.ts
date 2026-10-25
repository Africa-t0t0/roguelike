import { TILE_SIZE } from "./constants";
import { isWalkableTile, type Dungeon } from "./dungeon";

// 8 vecinos; las ortogonales primero para que los empates prefieran moverse recto.
const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Clave de un conjunto de fuentes (sin importar el orden); igual a `FlowField.sourcesKey` tras `rebuild`. */
export function flowSourcesKey(sources: readonly { tx: number; tz: number }[]): string {
  return sources
    .map((s) => `${s.tx},${s.tz}`)
    .sort()
    .join(";");
}

/**
 * Mapa de flujo por BFS multi-fuente sobre la grilla.
 * Distancias en pasos: un paso diagonal cuenta 1 (BFS tipo Chebyshev).
 * Una diagonal exige que las dos casillas ortogonales sean caminables (no corta esquinas).
 */
export class FlowField {
  /** Fuentes ordenadas y serializadas; sirve para saber si hace falta recalcular. */
  sourcesKey = "";
  private readonly dist: Int32Array;
  private readonly queue: Int32Array;
  /** índice de la casilla fuente desde la que llegó el BFS a cada casilla; -1 si no llegó */
  private readonly origin: Int32Array;

  constructor(private readonly dungeon: Dungeon) {
    this.dist = new Int32Array(dungeon.width * dungeon.height).fill(-1);
    this.queue = new Int32Array(dungeon.width * dungeon.height);
    this.origin = new Int32Array(dungeon.width * dungeon.height).fill(-1);
  }

  rebuild(sources: readonly { tx: number; tz: number }[]): void {
    const d = this.dungeon;
    const { width } = d;
    const dist = this.dist;
    const queue = this.queue;
    dist.fill(-1);
    this.origin.fill(-1);
    this.sourcesKey = flowSourcesKey(sources);
    let head = 0;
    let tail = 0;
    for (const s of sources) {
      if (!isWalkableTile(d, s.tx, s.tz)) continue;
      const i = s.tz * width + s.tx;
      if (dist[i] !== -1) continue;
      dist[i] = 0;
      this.origin[i] = i;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++]!;
      const tx = i % width;
      const tz = (i - tx) / width;
      const nd = dist[i]! + 1;
      for (const [dx, dz] of DIRS) {
        const nx = tx + dx;
        const nz = tz + dz;
        if (!isWalkableTile(d, nx, nz)) continue;
        if (dx !== 0 && dz !== 0 && (!isWalkableTile(d, nx, tz) || !isWalkableTile(d, tx, nz))) continue;
        const ni = nz * width + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = nd;
        this.origin[ni] = this.origin[i]!;
        queue[tail++] = ni;
      }
    }
  }

  /** Pasos hasta la fuente más cercana; Infinity si es muro, está fuera o es inalcanzable. */
  distance(tx: number, tz: number): number {
    if (!Number.isInteger(tx) || !Number.isInteger(tz)) return Infinity;
    if (tx < 0 || tz < 0 || tx >= this.dungeon.width || tz >= this.dungeon.height) return Infinity;
    const v = this.dist[tz * this.dungeon.width + tx]!;
    return v < 0 ? Infinity : v;
  }

  /** Casilla fuente más cercana por recorrido (la que alcanzó primero esta casilla); null si es inalcanzable. */
  source(tx: number, tz: number): { tx: number; tz: number } | null {
    if (this.distance(tx, tz) === Infinity) return null;
    const o = this.origin[tz * this.dungeon.width + tx]!;
    const sx = o % this.dungeon.width;
    return { tx: sx, tz: (o - sx) / this.dungeon.width };
  }

  /** Vecina con menor distancia; null si está en una fuente o es inalcanzable. */
  next(tx: number, tz: number): { tx: number; tz: number } | null {
    const here = this.distance(tx, tz);
    if (here === Infinity || here === 0) return null;
    const d = this.dungeon;
    let best: { tx: number; tz: number } | null = null;
    let bestD = here;
    for (const [dx, dz] of DIRS) {
      const nx = tx + dx;
      const nz = tz + dz;
      if (!isWalkableTile(d, nx, nz)) continue;
      if (dx !== 0 && dz !== 0 && (!isWalkableTile(d, nx, tz) || !isWalkableTile(d, tx, nz))) continue;
      const nd = this.distance(nx, nz);
      if (nd < bestD) {
        bestD = nd;
        best = { tx: nx, tz: nz };
      }
    }
    return best;
  }
}

function walkableAt(d: Dungeon, x: number, z: number): boolean {
  return isWalkableTile(d, Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE));
}

/** Línea de vista en metros: muestrea cada ≤ TILE_SIZE/4 y exige suelo en el punto y en sus cuatro desplazamientos ±radius. */
export function hasLineOfSight(
  d: Dungeon,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  radius: number,
): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / (TILE_SIZE / 4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (
      !walkableAt(d, x, z) ||
      !walkableAt(d, x + radius, z) ||
      !walkableAt(d, x - radius, z) ||
      !walkableAt(d, x, z + radius) ||
      !walkableAt(d, x, z - radius)
    ) {
      return false;
    }
  }
  return true;
}
