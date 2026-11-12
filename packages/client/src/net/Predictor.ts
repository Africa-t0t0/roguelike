import {
  MAX_PENDING_INPUTS,
  SIM_DT,
  NO_MOVE_MODS,
  deadInput,
  leapStep,
  stepPlayer,
  type Dungeon,
  type KinematicState,
  type MoveMods,
  type PlayerInput,
} from "@roguelike/shared";

/** Paso del salto del Golpe sísmico que acompaña a un input: hacia dónde y a qué velocidad (m/s). */
export interface LeapMove {
  facing: number;
  speed: number;
}

/** Predicción local con reconciliación contra el estado autoritativo. */
export class Predictor {
  private state: KinematicState;
  /** inputs sin confirmar, cada uno con los mods con que se predijo (el servidor usa los de ese input) */
  private pending: { input: PlayerInput; mods: MoveMods; leap?: LeapMove }[] = [];
  private mods: MoveMods = NO_MOVE_MODS;

  constructor(
    initial: KinematicState,
    private readonly dungeon: Dungeon,
  ) {
    this.state = { ...initial };
  }

  /**
   * Los mismos modificadores de movimiento que usa el servidor (los informa el estado sincronizado, con el
   * freno de las habilidades en curso). Valen para los próximos `applyLocal`; al reconciliar, cada input usa los suyos.
   */
  setMoveMods(mods: MoveMods): void {
    this.mods = { ...mods };
  }

  /**
   * `leap`: este input cae dentro del salto del Golpe sísmico propio. Como el servidor, no camina (el
   * llamador ya manda el input sin movimiento) y avanza un paso del salto; al reconciliar se repite igual.
   */
  applyLocal(input: PlayerInput, leap?: LeapMove): KinematicState {
    this.state = this.step(this.state, input, this.mods, leap);
    this.pending.push({ input, mods: this.mods, leap });
    if (this.pending.length > MAX_PENDING_INPUTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_INPUTS);
    }
    return this.state;
  }

  /** `dead`: el servidor ya lo tiene muerto, así que procesa los pendientes como `deadInput` (quieto y sin girar). */
  reconcile(server: KinematicState, ackSeq: number, dead = false): KinematicState {
    this.pending = this.pending.filter((p) => p.input.seq > ackSeq);
    let s = { ...server };
    for (const p of this.pending) s = this.step(s, dead ? deadInput(p.input, s) : p.input, p.mods, dead ? undefined : p.leap);
    this.state = s;
    return this.state;
  }

  private step(s: KinematicState, input: PlayerInput, mods: MoveMods, leap: LeapMove | undefined): KinematicState {
    const moved = stepPlayer(s, input, this.dungeon, SIM_DT, mods);
    return leap ? { ...moved, ...leapStep(this.dungeon, moved.x, moved.z, leap.facing, leap.speed) } : moved;
  }

  get current(): KinematicState {
    return this.state;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
