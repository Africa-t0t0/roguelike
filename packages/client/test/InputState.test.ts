import { describe, expect, it } from "vitest";
import { InputState, withoutActions } from "../src/input/InputState";

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

  it("un clic izquierdo (Mouse0) da attack=true en el siguiente sample", () => {
    const input = new InputState();
    expect(input.sample(1, 0).attack).toBe(false);
    input.keyDown("Mouse0");
    input.keyUp("Mouse0"); // clic corto, entre dos samples
    expect(input.sample(2, 0).attack).toBe(true);
    expect(input.sample(3, 0).attack).toBe(false);
  });

  it("mantener el clic da attack=true en samples sucesivos, y blur lo suelta", () => {
    const input = new InputState();
    input.keyDown("Mouse0");
    expect(input.sample(1, 0).attack).toBe(true);
    expect(input.sample(2, 0).attack).toBe(true);
    expect(input.sample(3, 0).attack).toBe(true);
    input.blur();
    expect(input.sample(4, 0).attack).toBe(false);
  });

  it("al atacar el facing pasa a mirar hacia donde mira la cámara", () => {
    const input = new InputState();
    input.keyDown("Mouse0");
    expect(input.sample(1, 1.1).facing).toBe(1.1);
    input.keyUp("Mouse0");
    expect(input.sample(2, 2).facing).toBe(1.1);
  });

  it("sample lleva el viewTick que se le pasa (0 si no)", () => {
    const input = new InputState();
    expect(input.sample(1, 0).viewTick).toBe(0);
    expect(input.sample(2, 0, 41.5).viewTick).toBe(41.5);
  });
});

describe("withoutActions", () => {
  it("anula movimiento, salto, esquiva, sprint y ataque; conserva seq, facing y viewTick", () => {
    const input = new InputState();
    for (const k of ["KeyW", "Space", "KeyC", "ShiftLeft", "Mouse0"]) input.keyDown(k);
    const s = withoutActions(input.sample(7, 0.5, 12));
    expect(s).toEqual({
      seq: 7, moveX: 0, moveZ: 0, facing: 0.5, dodge: false, sprint: false, jump: false, attack: false, viewTick: 12,
    });
  });
});
