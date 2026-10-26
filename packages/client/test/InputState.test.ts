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

  it("Space da jump=true una sola vez por pulsación", () => {
    const input = new InputState();
    input.keyDown("Space");
    const s = input.sample(1, 0);
    expect(s.jump).toBe(true);
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

  it("E da interact=true una sola vez por pulsación, aunque se mantenga o se repita", () => {
    const input = new InputState();
    expect(input.sample(1, 0).interact).toBe(false);
    input.keyDown("KeyE");
    expect(input.sample(2, 0).interact).toBe(true);
    input.keyDown("KeyE"); // autorepetición
    expect(input.sample(3, 0).interact).toBe(false);
    input.keyUp("KeyE");
    expect(input.sample(4, 0).interact).toBe(false);
    input.keyDown("KeyE");
    input.keyUp("KeyE"); // pulsación corta entre dos samples
    expect(input.sample(5, 0).interact).toBe(true);
  });

  it("blur suelta una pulsación de E pendiente", () => {
    const input = new InputState();
    input.keyDown("KeyE");
    input.blur();
    expect(input.sample(1, 0).interact).toBe(false);
    input.keyDown("KeyE"); // tras el blur, una nueva pulsación vuelve a contar
    expect(input.sample(2, 0).interact).toBe(true);
  });

  it("las teclas 1-4 mantenidas dan la máscara de habilidades (1 y 3 → 0b0101)", () => {
    const input = new InputState();
    expect(input.sample(1, 0).abilities).toBe(0);
    input.keyDown("Digit1");
    input.keyDown("Digit3");
    expect(input.sample(2, 0).abilities).toBe(0b0101);
    expect(input.sample(3, 0).abilities).toBe(0b0101); // mantenida, no por pulsación
    input.keyUp("Digit1");
    input.keyDown("Digit4");
    expect(input.sample(4, 0).abilities).toBe(0b1100);
    input.blur();
    expect(input.sample(5, 0).abilities).toBe(0);
  });

  it("una pulsación corta de una tecla de habilidad entre dos samples cuenta una vez", () => {
    const input = new InputState();
    input.keyDown("Digit2");
    input.keyUp("Digit2");
    expect(input.sample(1, 0).abilities).toBe(0b0010);
    expect(input.sample(2, 0).abilities).toBe(0);
  });

  it("sample lleva el viewTick que se le pasa (0 si no)", () => {
    const input = new InputState();
    expect(input.sample(1, 0).viewTick).toBe(0);
    expect(input.sample(2, 0, 41.5).viewTick).toBe(41.5);
  });
});
