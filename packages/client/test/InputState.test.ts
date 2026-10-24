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

  it("C da dodge=true una sola vez por pulsación, aunque la tecla se repita", () => {
    const input = new InputState();
    input.keyDown("KeyC");
    expect(input.sample(1, 0).dodge).toBe(true);
    input.keyDown("KeyC"); // autorepetición del teclado
    expect(input.sample(2, 0).dodge).toBe(false);
    input.keyUp("KeyC");
    input.keyDown("KeyC");
    expect(input.sample(3, 0).dodge).toBe(true);
  });

  it("Space da jump=true una sola vez por pulsación y no esquiva", () => {
    const input = new InputState();
    input.keyDown("Space");
    const s = input.sample(1, 0);
    expect(s.jump).toBe(true);
    expect(s.dodge).toBe(false);
    input.keyDown("Space"); // autorepetición
    expect(input.sample(2, 0).jump).toBe(false);
  });

  it("sprint mientras se mantiene Shift (izquierdo o derecho) y se suelta con blur", () => {
    const input = new InputState();
    expect(input.sample(1, 0).sprint).toBe(false);
    input.keyDown("ShiftLeft");
    expect(input.sample(2, 0).sprint).toBe(true);
    input.keyUp("ShiftLeft");
    input.keyDown("ShiftRight");
    expect(input.sample(3, 0).sprint).toBe(true);
    input.blur();
    expect(input.sample(4, 0).sprint).toBe(false);
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
