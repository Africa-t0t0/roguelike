import { describe, expect, it } from "vitest";
import { lidAngle } from "../src/render/chestViews";

const DEG = Math.PI / 180;

describe("lidAngle", () => {
  it("cerrada al empezar", () => expect(lidAngle(0)).toBe(0));
  it("a mitad de camino, -55°", () => expect(lidAngle(0.2)).toBeCloseTo(-55 * DEG, 6));
  it("abierta del todo desde 0,4 s", () => {
    expect(lidAngle(0.4)).toBeCloseTo(-110 * DEG, 6);
    expect(lidAngle(1)).toBeCloseTo(-110 * DEG, 6);
  });
  it("un tiempo negativo la deja cerrada", () => expect(lidAngle(-1)).toBeCloseTo(0, 9));
});
