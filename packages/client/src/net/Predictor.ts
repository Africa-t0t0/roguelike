import {
  MAX_PENDING_INPUTS,
  SIM_DT,
  stepPlayer,
  type Dungeon,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";

/** Predicción local con reconciliación contra el estado autoritativo. */
export class Predictor {
  private state: KinematicState;
  private pending: PlayerInput[] = [];

  constructor(
    initial: KinematicState,
    private readonly dungeon: Dungeon,
  ) {
    this.state = { ...initial };
  }

  applyLocal(input: PlayerInput): KinematicState {
    this.state = stepPlayer(this.state, input, this.dungeon, SIM_DT);
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING_INPUTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_INPUTS);
    }
    return this.state;
  }

  reconcile(server: KinematicState, ackSeq: number): KinematicState {
    this.pending = this.pending.filter((i) => i.seq > ackSeq);
    let s = { ...server };
    for (const input of this.pending) s = stepPlayer(s, input, this.dungeon, SIM_DT);
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
