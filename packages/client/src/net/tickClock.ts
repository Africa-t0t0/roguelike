import { SnapshotBuffer } from "./SnapshotBuffer";

/**
 * Tick del servidor por instante de recepción, en el mismo reloj que la interpolación de enemigos:
 * `sample(ahora − INTERP_DELAY_MS)` es el tick que se está viendo, el `viewTick` de cada input.
 */
export function createTickClock(): { push(receivedAtMs: number, tick: number): void; sample(atMs: number): number } {
  const buffer = new SnapshotBuffer<number>((a, b, t) => a + (b - a) * t);
  return {
    push: (receivedAtMs, tick) => buffer.push(receivedAtMs, tick),
    sample: (atMs) => buffer.sample(atMs) ?? 0,
  };
}
