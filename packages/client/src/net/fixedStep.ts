import { SIM_DT } from "@roguelike/shared";

/** Pasos de tiempo fijo (SIM_DT) por frame, con el resto acumulado para interpolar entre pasos. */
export class FixedStep {
  private acc = 0;

  /** Cuántos pasos tocan en este frame. En la pausa ninguno, y el acumulado queda quieto. */
  advance(dtS: number, paused: boolean): number {
    if (paused) return 0;
    this.acc += dtS;
    let n = 0;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      n++;
    }
    return n;
  }

  /** Fracción del paso en curso, 0..1: dónde se dibuja entre el estado anterior y el actual. */
  get alpha(): number {
    return this.acc / SIM_DT;
  }
}
