import { describe, expect, it } from "vitest";
import {
  MAX_PENDING_INPUTS,
  SIM_DT,
  stepPlayer,
  type Dungeon,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";
import { Predictor } from "../src/net/Predictor";

const N = 40;
const dungeon: Dungeon = {
  seed: 0,
  floor: 1,
  width: N,
  height: N,
  tiles: new Uint8Array(N * N).fill(1),
  rooms: [],
  startRoomId: 0,
  bossRoomId: 0,
};

const initial: KinematicState = {
  x: 10,
  z: 40,
  facing: 0,
  dodgeTime: 0,
  dodgeCooldown: 0,
  dodgeDirX: 0,
  dodgeDirZ: 0,
  y: 0,
  vy: 0,
};

const input = (seq: number): PlayerInput => ({ seq, moveX: 1, moveZ: 0, facing: 0, dodge: false, sprint: false, jump: false });

function setup() {
  const p = new Predictor(initial, dungeon);
  for (let seq = 1; seq <= 10; seq++) p.applyLocal(input(seq));
  let server = initial;
  for (let seq = 1; seq <= 4; seq++) server = stepPlayer(server, input(seq), dungeon, SIM_DT);
  return { p, server };
}

describe("Predictor", () => {
  it("reconcile con el estado coherente del servidor no cambia current", () => {
    const { p, server } = setup();
    const before = p.current;
    const after = p.reconcile(server, 4);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
    expect(p.current.x).toBeCloseTo(before.x, 9);
    expect(p.pendingCount).toBe(6);
  });

  it("si el servidor corrige +1 m, los pendientes se re-simulan encima", () => {
    const { p, server } = setup();
    const before = p.current.x;
    p.reconcile({ ...server, x: server.x + 1 }, 4);
    expect(Math.abs(p.current.x - (before + 1))).toBeLessThan(1e-6);
  });

  it("un ack más viejo que el más antiguo pendiente re-simula todos", () => {
    const { p } = setup();
    p.reconcile(initial, 0);
    expect(p.pendingCount).toBe(10);
    expect(p.current.x).toBeGreaterThan(initial.x);
  });

  it("limita los pendientes a MAX_PENDING_INPUTS", () => {
    const p = new Predictor(initial, dungeon);
    for (let seq = 1; seq <= 200; seq++) p.applyLocal(input(seq));
    expect(p.pendingCount).toBe(MAX_PENDING_INPUTS);
  });
});
