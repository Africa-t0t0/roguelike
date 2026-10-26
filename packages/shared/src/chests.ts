import { MAX_PLAYERS } from "./constants";
import { isWalkableTile, roomSpawnPoints, tileCenter, type Dungeon } from "./dungeon";
import { WEAPONS } from "./weapons";

/** Reparto del botín de un cofre (arma, equipo, reliquia, orbes, curación; suman 1) y probabilidad de subir un tier el arma que da. */
export const CHEST_LOOT = { weapon: 0.37, gear: 0.3, relic: 0.08, orbs: 0.15, heal: 0.1, orbXp: 30, tierBumpChance: 0.3 } as const;

/**
 * Un cofre cada dos salas de combate (índices pares por id), en la primera casilla caminable pegada a un muro
 * (se recorre la sala por z y luego por x). Se salta lo reservado en `roomSpawnPoints` (aparición de jugadores y
 * armas iniciales). Los enemigos de las salas de combate nacen en casillas aleatorias elegidas por el servidor, así
 * que no se pueden excluir aquí: basta con que la casilla sea caminable y esté pegada a la pared (la separación
 * entre enemigos los aparta). Determinista.
 */
export function chestSpots(d: Dungeon): { x: number; z: number }[] {
  const reserved = Object.keys(WEAPONS).length - 1;
  const spots: { x: number; z: number }[] = [];
  const combat = d.rooms.filter((r) => r.kind === "combat");
  for (let i = 0; i < combat.length; i += 2) {
    const room = combat[i]!;
    const taken = new Set(
      roomSpawnPoints(d, room.id, MAX_PLAYERS + reserved).map((p) => `${p.x},${p.z}`),
    );
    let found: { x: number; z: number } | null = null;
    for (let tz = room.z; tz < room.z + room.h && !found; tz++) {
      for (let tx = room.x; tx < room.x + room.w && !found; tx++) {
        if (!isWalkableTile(d, tx, tz)) continue;
        const nearWall =
          !isWalkableTile(d, tx - 1, tz) || !isWalkableTile(d, tx + 1, tz) || !isWalkableTile(d, tx, tz - 1) || !isWalkableTile(d, tx, tz + 1);
        const c = tileCenter(tx, tz);
        if (nearWall && !taken.has(`${c.x},${c.z}`)) found = c;
      }
    }
    if (found) spots.push(found);
  }
  return spots;
}
