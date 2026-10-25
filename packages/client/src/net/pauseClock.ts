/**
 * Reloj de juego: el de `performance.now()` menos el tiempo pasado en pausas. Con él se dibuja todo lo que
 * depende del tiempo (interpolación, animaciones por instante, golpes, números de daño): en la pausa queda
 * quieto y al reanudar sigue desde el mismo instante, sin saltos.
 */
export class PauseClock {
  private offset = 0;
  private pausedAt: number | undefined;

  get paused(): boolean {
    return this.pausedAt !== undefined;
  }

  setPaused(paused: boolean, realMs: number): void {
    if (paused === this.paused) return;
    if (paused) this.pausedAt = realMs;
    else {
      this.offset += realMs - this.pausedAt!;
      this.pausedAt = undefined;
    }
  }

  /** El instante de juego que corresponde a `realMs` (en la pausa, el de cuando empezó). */
  now(realMs: number): number {
    return (this.pausedAt ?? realMs) - this.offset;
  }
}
