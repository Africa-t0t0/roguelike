import { describe, expect, it } from "vitest";
import { InputState } from "../src/input/InputState";

describe("InputState", () => {
  it("W con yaw 0 avanza hacia +Z", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    const s = input.sample(1, 0);
    expect(s.seq).toBe(1);
    expect(s.moveX).toBeCloseTo(0);
    expect(s.moveZ).toBeCloseTo(1);
  });

  it("W+D con yaw 0 tiene magnitud 1", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    input.keyDown("KeyD");
    const s = input.sample(1, 0);
    expect(Math.hypot(s.moveX, s.moveZ)).toBeCloseTo(1);
    expect(s.moveX).toBeGreaterThan(0);
    expect(s.moveZ).toBeGreaterThan(0);
  });

  it("W con yaw π/2 avanza hacia +X", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    const s = input.sample(1, Math.PI / 2);
    expect(s.moveX).toBeCloseTo(1);
    expect(s.moveZ).toBeCloseTo(0);
  });

  it("D con yaw 0 va hacia +X, y soltar la tecla detiene", () => {
    const input = new InputState();
    input.keyDown("KeyD");
    expect(input.sample(1, 0).moveX).toBeCloseTo(1);
    input.keyUp("KeyD");
    const s = input.sample(2, 0);
    expect(s.moveX).toBe(0);
    expect(s.moveZ).toBe(0);
  });

  it("mantener W y luego blur() deja el movimiento en 0", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    input.sample(1, 0);
    input.blur();
    const s = input.sample(2, 0);
    expect(s.moveX).toBe(0);
    expect(s.moveZ).toBe(0);
  });

  it("Space da dodge=true una sola vez por pulsación, aunque la tecla se repita", () => {
    const input = new InputState();
    input.keyDown("Space");
    expect(input.sample(1, 0).dodge).toBe(true);
    input.keyDown("Space"); // autorepetición del teclado
    expect(input.sample(2, 0).dodge).toBe(false);
    input.keyUp("Space");
    input.keyDown("Space");
    expect(input.sample(3, 0).dodge).toBe(true);
  });

  it("facing sigue al yaw mientras hay movimiento y se conserva al detenerse", () => {
    const input = new InputState();
    expect(input.sample(1, 1.2).facing).toBe(0);
    input.keyDown("KeyW");
    expect(input.sample(2, 0.7).facing).toBe(0.7);
    input.keyUp("KeyW");
    expect(input.sample(3, 2.5).facing).toBe(0.7);
  });
});
