import type { EnemyKind } from "./combat";
import type { CasterKind } from "./spells";
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

/** Hechiceros permitidos según el tiempo del piso: el piromante desde 240 s y el tormentoso desde 360 s. */
export function casterKinds(floorTime: number): CasterKind[] {
  if (floorTime < 240) return ["mage"];
  if (floorTime < 360) return ["mage", "pyromancer"];
  return ["mage", "pyromancer", "stormcaller"];
}

/** Tope de enemigos vivos (todos los que no están en `dead`); crece 3 por minuto. */
export function maxLiveEnemies(players: number, floorTime: number): number {
  return Math.min(90, 45 + 10 * (players - 1) + 3 * Math.floor(floorTime / 60));
}

/** Escalado de vida y daño de los enemigos que se crean, según tiempo del piso y nivel del grupo. */
export function enemyScale(floorTime: number, partyLevel: number): { hpMult: number; damageMult: number } {
  const min = floorTime / 60;
  return {
    hpMult: (1 + 0.12 * (partyLevel - 1)) * (1 + 0.08 * min),
    damageMult: (1 + 0.06 * (partyLevel - 1)) * (1 + 0.04 * min),
  };
}

/** Probabilidad de que un enemigo nuevo sea élite: 0 antes de 180 s, 5% al llegar y +1% por minuto entero, tope 15%. */
export function eliteChance(floorTime: number): number {
  if (floorTime < 180) return 0;
  return Math.min(0.15, 0.05 + 0.01 * Math.floor(floorTime / 60 - 3));
}

/** Segundos que dura un arma tirada en el suelo (tiempo simulado) y cuántos finales parpadea. */
export const FLOOR_WEAPON_TTL_S = 40;
export const FLOOR_WEAPON_BLINK_S = 5;

/** Pesos [tier1, tier2, tier3] con t = tiempo del piso + 60 s por piso previo. */
export function tierWeights(floorTime: number, floor: number): [number, number, number] {
  const t = floorTime + 60 * (floor - 1);
  if (t < 120) return [1, 0, 0];
  if (t < 240) return [0.7, 0.25, 0.05];
  return [0.4, 0.4, 0.2];
}

export function rollTier(rng: Rng, floorTime: number, floor: number): 1 | 2 | 3 {
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
