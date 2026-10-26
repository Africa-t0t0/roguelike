import { hasLineOfSight, isWalkableTile, TILE_SIZE, tileCenter, type Dungeon, type KinematicState } from "@roguelike/shared";

/** A cuántos metros delante del jugador aparecen los enemigos del panel de pruebas. */
export const SANDBOX_SPAWN_AHEAD_M = 5;
/** ...y los cofres, que además nunca quedan a menos de SANDBOX_CHEST_MIN_M (para no salir pegados al jugador). */
export const SANDBOX_CHEST_AHEAD_M = 4;
export const SANDBOX_CHEST_MIN_M = 2.5;

const tileOf = (v: number): number => Math.floor(v / TILE_SIZE);

/**
 * Hasta `count` centros de casilla caminables, uno por casilla, lo más cerca posible de un punto a
 * `aheadM` (por defecto SANDBOX_SPAWN_AHEAD_M) delante de `k` (si hay un muro en medio, alrededor del jugador). Nunca la casilla del
 * jugador ni una sin línea de vista desde él ni (si se da `minDistM`) a menos de esa distancia. Determinista: por distancia al punto, luego por z y x de casilla.
 */
export function sandboxSpawnSpots(
  dungeon: Dungeon,
  k: KinematicState,
  count: number,
  aheadM = SANDBOX_SPAWN_AHEAD_M,
  minDistM = 0,
): { x: number; z: number }[] {
  const ahead = { x: k.x + Math.sin(k.facing) * aheadM, z: k.z + Math.cos(k.facing) * aheadM };
  const target = hasLineOfSight(dungeon, k.x, k.z, ahead.x, ahead.z, 0) ? ahead : { x: k.x, z: k.z };
  const [tx, tz] = [tileOf(target.x), tileOf(target.z)];
  const own = `${tileOf(k.x)},${tileOf(k.z)}`;
  // Búsqueda en anillos crecientes hasta juntar suficientes casillas.
  for (let r = 1; r <= 12; r++) {
    const found: { tx: number; tz: number; d2: number }[] = [];
    for (let z = tz - r; z <= tz + r; z++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (`${x},${z}` === own || !isWalkableTile(dungeon, x, z)) continue;
        const c = tileCenter(x, z);
        if (Math.hypot(c.x - k.x, c.z - k.z) < minDistM || !hasLineOfSight(dungeon, k.x, k.z, c.x, c.z, 0)) continue;
        found.push({ tx: x, tz: z, d2: (c.x - target.x) ** 2 + (c.z - target.z) ** 2 });
      }
    }
    if (found.length >= count || r === 12) {
      found.sort((a, b) => a.d2 - b.d2 || a.tz - b.tz || a.tx - b.tx);
      return found.slice(0, count).map((f) => tileCenter(f.tx, f.tz));
    }
  }
  return [];
}
