import { describe, expect, it } from "vitest";
import { SIM_DT, stepPlayer, type Dungeon, type KinematicState, type PlayerInput } from "@roguelike/shared";
import { FixedStep } from "../src/net/fixedStep";
import { PauseClock } from "../src/net/pauseClock";
import { Predictor } from "../src/net/Predictor";

const N = 60;
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
const start: KinematicState = { x: 10, z: 40, facing: 0, y: 0, vy: 0 };
const walk = (seq: number): PlayerInput => ({
  seq, moveX: 1, moveZ: 0, facing: 0, sprint: false, jump: false, attack: false, interact: false, abilities: 0, viewTick: 0,
});
const FRAME_S = 1 / 60;

describe("PauseClock", () => {
  it("se detiene en la pausa y sigue sin salto al reanudar", () => {
    const c = new PauseClock();
    expect(c.now(1000)).toBe(1000);
    c.setPaused(true, 2000);
    expect(c.now(2000)).toBe(2000);
    expect(c.now(9000)).toBe(2000);
    c.setPaused(false, 22_000);
    expect(c.now(22_000)).toBe(2000);
    expect(c.now(22_016)).toBe(2016);
    c.setPaused(false, 23_000); // repetir el mismo estado no cambia nada
    expect(c.now(23_000)).toBe(3000);
  });
});

describe("pausa en el bucle (Foco 2)", () => {
  /**
   * Bucle del cliente reducido: FixedStep decide cuántos pasos hay, cada paso predice y "envía" un input.
   * El servidor procesa lo que le llegó hasta la pausa; en ella descarta lo que llegue y confirma su seq.
   */
  function setup() {
    const predictor = new Predictor(start, dungeon);
    const steps = new FixedStep();
    const sent: PlayerInput[] = [];
    let seq = 0;
    const frame = (paused: boolean) => {
      const n = steps.advance(FRAME_S, paused);
      for (let i = 0; i < n; i++) {
        const input = walk(++seq);
        predictor.applyLocal(input);
        sent.push(input);
      }
    };
    return { predictor, steps, sent, frame };
  }

  it("en la pausa N frames no mueven la posición predicha ni el punto de interpolación", () => {
    const { predictor, steps, sent, frame } = setup();
    for (let i = 0; i < 30; i++) frame(false);
    const pos = { ...predictor.current };
    const alpha = steps.alpha;
    const sentBefore = sent.length;
    for (let i = 0; i < 600; i++) frame(true);
    expect(predictor.current).toEqual(pos);
    expect(steps.alpha).toBe(alpha);
    expect(sent.length).toBe(sentBefore); // en la pausa no se envía nada: seq queda igual
  });

  it("al reanudar no hay salto: la reconciliación no corrige nada y no hay ráfaga de pasos", () => {
    const { predictor, sent, frame } = setup();
    for (let i = 0; i < 30; i++) frame(false);
    // Los dos últimos inputs llegaron ya en la pausa: el servidor los descarta pero confirma su seq.
    const processed = sent.slice(0, -2);
    let server = start;
    for (const input of processed) server = stepPlayer(server, input, dungeon, SIM_DT);
    const lastSeq = sent.at(-1)!.seq;
    // Primer estado de la pausa: corrige una vez (los descartados).
    predictor.reconcile(server, lastSeq);
    const paused = { ...predictor.current };
    expect(paused).toEqual(server);
    for (let i = 0; i < 600; i++) {
      frame(true);
      // Los parches de la pausa traen lo mismo: nada cambia.
      predictor.reconcile(server, lastSeq);
    }
    expect(predictor.current).toEqual(paused);
    // Reanuda: el primer parche aún es el estado de la pausa; no hay corrección.
    const before = { ...predictor.current };
    expect(predictor.reconcile(server, lastSeq)).toEqual(before);
    // El primer frame tras la pausa da a lo sumo un paso (el acumulado no creció en la pausa).
    const n = sent.length;
    frame(false);
    expect(sent.length - n).toBeLessThanOrEqual(1);
    // El servidor procesa los inputs nuevos (seq > lastSeq) igual que la predicción.
    for (const input of sent.slice(n)) server = stepPlayer(server, input, dungeon, SIM_DT);
    const predicted = { ...predictor.current };
    predictor.reconcile(server, sent.at(-1)!.seq);
    expect(predictor.current.x).toBeCloseTo(predicted.x, 9);
    expect(predictor.current.z).toBeCloseTo(predicted.z, 9);
  });

  it("FixedStep: un frame largo da varios pasos y guarda el resto", () => {
    const s = new FixedStep();
    expect(s.advance(SIM_DT * 2.5, false)).toBe(2);
    expect(s.alpha).toBeCloseTo(0.5);
    expect(s.advance(10, true)).toBe(0);
    expect(s.alpha).toBeCloseTo(0.5);
  });
});
