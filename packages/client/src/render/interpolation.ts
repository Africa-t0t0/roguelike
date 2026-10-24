import type { PlayerSnapshot } from "../net/connection";

const TAU = Math.PI * 2;

/** Interpola ángulos por el arco más corto (de 3,1 a −3,1 pasa por π, no por 0). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/** Interpolación para `SnapshotBuffer` de jugadores remotos. */
export function lerpSnapshot(a: PlayerSnapshot, b: PlayerSnapshot, t: number): PlayerSnapshot {
  return {
    ...b,
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    facing: lerpAngle(a.facing, b.facing, t),
  };
}

const MIN_CORRECTION = 0.01; // m
const CORRECTION_TAU_S = 0.035; // ~95 % absorbido en 100 ms

/**
 * Suaviza solo la vista del jugador propio cuando la reconciliación lo mueve.
 * La lógica (Predictor) salta de inmediato; aquí se dibuja con un desfase que decae.
 */
export class CorrectionSmoother {
  x = 0;
  z = 0;

  /** `before`/`after`: posición predicha antes y después de reconciliar. */
  correct(before: { x: number; z: number }, after: { x: number; z: number }): void {
    const dx = before.x - after.x;
    const dz = before.z - after.z;
    if (Math.hypot(dx, dz) <= MIN_CORRECTION) return;
    this.x += dx;
    this.z += dz;
  }

  decay(dtS: number): void {
    const k = Math.exp(-dtS / CORRECTION_TAU_S);
    this.x *= k;
    this.z *= k;
  }
}
