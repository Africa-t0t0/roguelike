import {
  MAX_PENDING_INPUTS,
  SIM_DT,
  NO_MOVE_MODS,
  stepPlayer,
  type Dungeon,
  type KinematicState,
  type MoveMods,
  type PlayerInput,
} from "@roguelike/shared";

/** Predicción local con reconciliación contra el estado autoritativo. */
export class Predictor {
  private state: KinematicState;
  /** inputs sin confirmar, cada uno con los mods con que se predijo (el servidor usa los de ese input) */
  private pending: { input: PlayerInput; mods: MoveMods }[] = [];
  private mods: MoveMods = NO_MOVE_MODS;

  constructor(
    initial: KinematicState,
    private readonly dungeon: Dungeon,
  ) {
    this.state = { ...initial };
  }

  /**
   * Los mismos modificadores de movimiento que usa el servidor (los informa el estado sincronizado, con el
   * Bloqueo predicho). Valen para los próximos `applyLocal`; al reconciliar, cada input usa los suyos.
   */
  setMoveMods(mods: MoveMods): void {
    this.mods = { ...mods };
  }

  applyLocal(input: PlayerInput): KinematicState {
    this.state = stepPlayer(this.state, input, this.dungeon, SIM_DT, this.mods);
    this.pending.push({ input, mods: this.mods });
    if (this.pending.length > MAX_PENDING_INPUTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_INPUTS);
    }
    return this.state;
  }

  reconcile(server: KinematicState, ackSeq: number): KinematicState {
    this.pending = this.pending.filter((p) => p.input.seq > ackSeq);
    let s = { ...server };
    for (const p of this.pending) s = stepPlayer(s, p.input, this.dungeon, SIM_DT, p.mods);
    this.state = s;
    return this.state;
  }

  get current(): KinematicState {
    return this.state;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
