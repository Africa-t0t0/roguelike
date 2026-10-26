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
    y: a.y + (b.y - a.y) * t,
    facing: lerpAngle(a.facing, b.facing, t),
  };
}

const MIN_CORRECTION = 0.01; // m
const CORRECTION_TAU_S = 0.035; // ~95 % absorbido en 100 ms
const SNAP_CORRECTION = 2.5; // m: más que esto (reaparición, teletransporte) se salta sin suavizar
/** Impulso propio del servidor (Tajo frontal con `thrustDash`, 3 m): se dibuja como un deslizamiento corto y lineal. */
const GLIDE_S = 0.15;
const GLIDE_MAX = 5; // m: más que esto sigue siendo un salto

/**
 * Suaviza solo la vista del jugador propio cuando la reconciliación lo mueve.
 * La lógica (Predictor) salta de inmediato; aquí se dibuja con un desfase que decae.
 */
export class CorrectionSmoother {
  x = 0;
  z = 0;
  /** segundos que le quedan al deslizamiento lineal (0: decae exponencial, lo normal) */
  private glideLeft = 0;

  /**
   * `before`/`after`: posición predicha antes y después de reconciliar. `glide`: la corrección viene de un
   * impulso propio que el cliente no predice (Tajo frontal con `thrustDash`): si es mayor que el salto
   * normal pero razonable, se dibuja deslizando en `GLIDE_S` en vez de teletransportar.
   */
  correct(before: { x: number; z: number }, after: { x: number; z: number }, glide = false): void {
    const dx = before.x - after.x;
    const dz = before.z - after.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= MIN_CORRECTION) return;
    if (glide && dist > SNAP_CORRECTION && dist <= GLIDE_MAX) {
      this.x += dx;
      this.z += dz;
      this.glideLeft = GLIDE_S;
      return;
    }
    if (dist > SNAP_CORRECTION) {
      this.glideLeft = 0;
      this.x = 0;
      this.z = 0;
      return;
    }
    this.x += dx;
    this.z += dz;
  }

  decay(dtS: number): void {
    if (this.glideLeft > 0) {
      const left = Math.max(0, this.glideLeft - dtS);
      const k = left / this.glideLeft;
      this.x *= k;
      this.z *= k;
      this.glideLeft = left;
      return;
    }
    const k = Math.exp(-dtS / CORRECTION_TAU_S);
    this.x *= k;
    this.z *= k;
  }
}
