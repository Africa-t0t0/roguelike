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
  private pending: PlayerInput[] = [];
  private mods: MoveMods = NO_MOVE_MODS;

  constructor(
    initial: KinematicState,
    private readonly dungeon: Dungeon,
  ) {
    this.state = { ...initial };
  }

  /** Los mismos modificadores de movimiento que usa el servidor (los informa el estado sincronizado). */
  setMoveMods(mods: MoveMods): void {
    this.mods = { ...mods };
  }

  applyLocal(input: PlayerInput): KinematicState {
    this.state = stepPlayer(this.state, input, this.dungeon, SIM_DT, this.mods);
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING_INPUTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_INPUTS);
    }
    return this.state;
  }

  reconcile(server: KinematicState, ackSeq: number): KinematicState {
    this.pending = this.pending.filter((i) => i.seq > ackSeq);
    let s = { ...server };
    for (const input of this.pending) s = stepPlayer(s, input, this.dungeon, SIM_DT, this.mods);
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
