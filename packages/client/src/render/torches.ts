import { isWalkableTile, TILE_SIZE, type Dungeon } from "@roguelike/shared";

/** Antorcha de pared: (x, z) sobre la cara del muro; `yaw` apunta hacia dentro de la sala (0 = +Z). */
export interface TorchSpot {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Hasta dos antorchas por sala, en la casilla más cercana al medio de su muro −Z y de su muro +Z que
 * tenga muro detrás (no una puerta). Determinista: solo depende de la mazmorra.
 */
export function torchSpots(d: Dungeon): TorchSpot[] {
  const spots: TorchSpot[] = [];
  for (const r of d.rooms) {
    for (const side of [-1, 1] as const) {
      const tz = side < 0 ? r.z : r.z + r.h - 1;
      const mid = r.x + Math.floor(r.w / 2);
      // Del medio hacia afuera: mid, mid+1, mid−1, mid+2, …
      for (let k = 0; k < r.w; k++) {
        const tx = mid + (k % 2 === 1 ? (k + 1) / 2 : -k / 2);
        if (tx < r.x || tx >= r.x + r.w) continue;
        if (!isWalkableTile(d, tx, tz) || isWalkableTile(d, tx, tz + side)) continue;
        spots.push({
          x: (tx + 0.5) * TILE_SIZE,
          z: (side < 0 ? tz : tz + 1) * TILE_SIZE,
          yaw: side < 0 ? 0 : Math.PI,
        });
        break;
      }
    }
  }
  return spots;
}

/** Índices de las `n` antorchas más cercanas a (x, z), de la más cercana a la más lejana. */
export function nearestTorches(spots: readonly TorchSpot[], x: number, z: number, n: number): number[] {
  return spots
    .map((s, i) => ({ i, d: (s.x - x) ** 2 + (s.z - z) ** 2 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, n)
    .map((e) => e.i);
}

/** Factor de parpadeo en [1 − amount, 1 + amount]: suma de senos incommensurables, distinta por `seed`. */
export function flicker(tS: number, seed: number, amount: number): number {
  const v =
    0.5 * Math.sin(tS * 7.3 + seed * 1.7) + 0.3 * Math.sin(tS * 13.1 + seed * 4.1) + 0.2 * Math.sin(tS * 23.7 + seed * 2.3);
  return 1 + amount * v;
}
