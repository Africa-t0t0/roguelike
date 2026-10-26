import { TILE_SIZE } from "./constants";
import { isWalkableTile, type Dungeon } from "./dungeon";

/** Sello de la sala inicial: segmento en metros sobre el borde de la sala, que cubre una abertura contigua hacia un pasillo. */
export interface Seal {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * Aberturas de la sala inicial: recorre el perímetro del rectángulo de la sala y agrupa, por lado, las casillas
 * del borde cuyo vecino de afuera es caminable en un segmento contiguo. Determinista (orden: N, S, O, E).
 */
export function startSeals(d: Dungeon): Seal[] {
  const r = d.rooms[d.startRoomId]!;
  const seals: Seal[] = [];
  const T = TILE_SIZE;
  // Un lado: `n` casillas del borde; open(i) dice si la casilla i del borde tiene abertura hacia afuera.
  const side = (n: number, open: (i: number) => boolean, seg: (a: number, b: number) => Seal): void => {
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const o = i < n && open(i);
      if (o && start < 0) start = i;
      else if (!o && start >= 0) {
        seals.push(seg(start, i));
        start = -1;
      }
    }
  };
  const walk = (tx: number, tz: number): boolean => isWalkableTile(d, tx, tz);
  side(r.w, (i) => walk(r.x + i, r.z) && walk(r.x + i, r.z - 1), (a, b) => ({ x0: (r.x + a) * T, z0: r.z * T, x1: (r.x + b) * T, z1: r.z * T }));
  side(r.w, (i) => walk(r.x + i, r.z + r.h - 1) && walk(r.x + i, r.z + r.h), (a, b) => ({ x0: (r.x + a) * T, z0: (r.z + r.h) * T, x1: (r.x + b) * T, z1: (r.z + r.h) * T }));
  side(r.h, (i) => walk(r.x, r.z + i) && walk(r.x - 1, r.z + i), (a, b) => ({ x0: r.x * T, z0: (r.z + a) * T, x1: r.x * T, z1: (r.z + b) * T }));
  side(r.h, (i) => walk(r.x + r.w - 1, r.z + i) && walk(r.x + r.w, r.z + i), (a, b) => ({ x0: (r.x + r.w) * T, z0: (r.z + a) * T, x1: (r.x + r.w) * T, z1: (r.z + b) * T }));
  return seals;
}

/** ¿La casilla de (x,z) (metros) queda fuera del rectángulo de la sala inicial? */
export function outsideStartRoom(d: Dungeon, x: number, z: number): boolean {
  const r = d.rooms[d.startRoomId]!;
  const tx = Math.floor(x / TILE_SIZE);
  const tz = Math.floor(z / TILE_SIZE);
  return tx < r.x || tx >= r.x + r.w || tz < r.z || tz >= r.z + r.h;
}
