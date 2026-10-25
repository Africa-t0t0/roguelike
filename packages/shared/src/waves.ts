import type { EnemyKind } from "./combat";
import type { Rng } from "./rng";
import type { WeaponTier } from "./weapons";

/** Segundo del piso en que sale el primer grupo de oleada. */
export const WAVE_FIRST_AT_S = 10;

/** Banda de distancia de recorrido (casillas) donde aparecen los de oleada. */
export const WAVE_SPAWN_BAND = { min: 8, max: 30 };
/** Distancia mínima si no hay casillas dentro de la banda. */
export const WAVE_SPAWN_FALLBACK_MIN = 6;

// Orbes de XP
export const ORB_MAGNET_RADIUS = 3;
export const ORB_SPEED = 8;
export const ORB_PICKUP_RADIUS = 0.8;
export const MAX_ORBS = 150;

/** Intensidad del director: crece 1 por minuto. */
function intensity(floorTime: number): number {
  return 1 + floorTime / 60;
}

/** Segundos entre grupos de oleada. */
export function waveInterval(floorTime: number): number {
  return Math.max(2, 10 / intensity(floorTime));
}

/** Enemigos por grupo: crece con el tiempo y con cada jugador extra. */
export function waveGroupSize(floorTime: number, players: number): number {
  return 1 + Math.floor(floorTime / 90) + (players - 1);
}

/** Tipos de enemigo permitidos según el tiempo del piso. */
export function waveKinds(floorTime: number): EnemyKind[] {
  if (floorTime < 60) return ["minion"];
  if (floorTime < 120) return ["minion", "brute"];
  return ["minion", "brute", "mage"];
}

/** Tope de enemigos vivos (todos los que no están en `dead`). */
export function maxLiveEnemies(players: number): number {
  return 30 + 10 * (players - 1);
}

/** Pesos [tier1, tier2, tier3] con t = tiempo del piso + 60 s por piso previo. */
export function tierWeights(floorTime: number, floor: number): [number, number, number] {
  const t = floorTime + 60 * (floor - 1);
  if (t < 120) return [1, 0, 0];
  if (t < 240) return [0.7, 0.25, 0.05];
  return [0.4, 0.4, 0.2];
}

export function rollTier(rng: Rng, floorTime: number, floor: number): WeaponTier {
  const w = tierWeights(floorTime, floor);
  const r = rng.next();
  if (r < w[0]) return 1;
  if (r < w[0] + w[1]) return 2;
  return w[2] > 0 ? 3 : w[1] > 0 ? 2 : 1;
}

/** Reparte la XP en orbes enteros de 1 a 4 cuya suma es exactamente `xp`. */
export function splitXp(xp: number, rng: Rng): number[] {
  const out: number[] = [];
  let left = Math.floor(xp);
  while (left > 0) {
    const v = Math.min(rng.int(1, 4), left);
    out.push(v);
    left -= v;
  }
  return out;
}
