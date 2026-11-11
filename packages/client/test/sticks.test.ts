import { describe, expect, it } from "vitest";
import { InputState } from "../src/input/InputState";
import { chooseAim, DEADZONE, stickAngle, stickVector } from "../src/input/sticks";

describe("stickVector", () => {
  it("dentro de la zona muerta no hay lectura", () => {
    expect(stickVector(0, 0)).toBeUndefined();
    expect(stickVector(DEADZONE * 0.9, 0)).toBeUndefined();
    expect(stickVector(Number.NaN, 0)).toBeUndefined();
  });

  it("sale de 0 en el borde de la zona muerta y llega a 1 a fondo, sin pasarse", () => {
    expect(Math.hypot(stickVector(DEADZONE + 0.01, 0)!.x)).toBeLessThan(0.05);
    expect(stickVector(1, 0)).toEqual({ x: 1, y: 0 });
    const diagonal = stickVector(1, 1)!;
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
  });

  it("arriba es +Z y derecha es +X", () => {
    expect(stickAngle({ x: 0, y: 1 })).toBeCloseTo(0);
    expect(stickAngle({ x: 1, y: 0 })).toBeCloseTo(Math.PI / 2);
  });
});

describe("chooseAim", () => {
  const base = { mouseAim: 1, aim: undefined, move: undefined, last: 2 };

  it("con ratón mira al cursor (o donde miraba si aún no hay cursor)", () => {
    expect(chooseAim({ ...base, device: "mouse" })).toBe(1);
    expect(chooseAim({ ...base, device: "mouse", mouseAim: undefined })).toBe(2);
  });

  it("con sticks: el derecho manda; suelto, hacia donde camina; quieto, donde miraba", () => {
    expect(chooseAim({ ...base, device: "stick", aim: { x: 1, y: 0 }, move: { x: 0, y: 1 } })).toBeCloseTo(Math.PI / 2);
    expect(chooseAim({ ...base, device: "stick", move: { x: 0, y: -1 } })).toBeCloseTo(Math.PI);
    expect(chooseAim({ ...base, device: "stick" })).toBe(2);
  });
});

describe("InputState con stick", () => {
  it("el stick conserva cuánto se empuja y al soltarlo vuelve el teclado", () => {
    const input = new InputState();
    input.setMove({ x: 0.5, y: 0 });
    expect(input.sample(1, 0)).toMatchObject({ moveX: 0.5, moveZ: 0 });
    input.setMove({ x: 3, y: 4 });
    const big = input.sample(2, 0);
    expect(Math.hypot(big.moveX, big.moveZ)).toBeCloseTo(1);
    input.setMove(undefined);
    input.keyDown("KeyW");
    expect(input.sample(3, 0)).toMatchObject({ moveX: 0, moveZ: 1 });
  });
});
