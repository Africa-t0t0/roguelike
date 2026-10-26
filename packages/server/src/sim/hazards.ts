import { TILE_SIZE, isWalkableTile, type Dungeon } from "@roguelike/shared";

/** Peligro de un hechicero: zona del pirómano o rayo del tormentoso. */
export interface Hazard {
  id: string;
  kind: "zone" | "beam";
  sourceId: string;
  /** centro de la zona u origen del rayo */
  x: number;
  z: number;
  /** dirección del rayo (unitaria); (0, 0) en una zona */
  dirX: number;
  dirZ: number;
  /** largo del rayo; 0 en una zona */
  length: number;
  /** radio de la zona o ancho del rayo */
  size: number;
  damage: number;
  /** segundos que le quedan a la fase actual */
  left: number;
  /** duración de la fase actual */
  total: number;
  phase: "warn" | "fire";
}

const BEAM_SAMPLE_M = TILE_SIZE / 8;

/** Distancia desde (x, z) en la dirección dada hasta el primer punto no caminable, con tope `max`. */
export function beamLength(dungeon: Dungeon, x: number, z: number, dirX: number, dirZ: number, max: number): number {
  for (let t = BEAM_SAMPLE_M; t < max; t += BEAM_SAMPLE_M) {
    if (!isWalkableTile(dungeon, Math.floor((x + dirX * t) / TILE_SIZE), Math.floor((z + dirZ * t) / TILE_SIZE))) return t;
  }
  return max;
}

/** El círculo (px, pz, pr) toca el rayo: distancia al segmento ≤ ancho/2 + pr. */
export function inBeam(h: Hazard, px: number, pz: number, pr: number): boolean {
  const rx = px - h.x;
  const rz = pz - h.z;
  const proj = rx * h.dirX + rz * h.dirZ;
  if (proj < 0) return false; // detrás del invocador: el rayo no sale hacia ahí
  const t = Math.min(h.length, proj);
  return Math.hypot(rx - h.dirX * t, rz - h.dirZ * t) <= h.size / 2 + pr;
}

/** El círculo (px, pz, pr) toca la zona: distancia al centro ≤ radio + pr. */
export function inZone(h: Hazard, px: number, pz: number, pr: number): boolean {
  return Math.hypot(px - h.x, pz - h.z) <= h.size + pr;
}
