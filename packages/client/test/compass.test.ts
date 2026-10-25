import { describe, expect, it } from "vitest";
import { compassOffset } from "../src/ui/compass";

describe("compassOffset", () => {
  it("mirando al norte: N al centro, E a la derecha, O a la izquierda, S fuera", () => {
    expect(compassOffset(0, 0)).toBeCloseTo(0);
    expect(compassOffset(Math.PI / 2, 0)).toBeCloseTo(1);
    expect(compassOffset(-Math.PI / 2, 0)).toBeCloseTo(-1);
    expect(compassOffset(Math.PI, 0)).toBeUndefined();
  });

  it("girar la cámara a la derecha corre las marcas a la izquierda", () => {
    expect(compassOffset(0, Math.PI / 4)).toBeCloseTo(-0.5);
    expect(compassOffset(Math.PI / 2, Math.PI / 4)).toBeCloseTo(0.5);
  });

  it("da la vuelta por ±π sin saltos", () => {
    expect(compassOffset(Math.PI, Math.PI - 0.1)).toBeCloseTo(0.1 / (Math.PI / 2));
    expect(compassOffset(Math.PI, -Math.PI + 0.1)).toBeCloseTo(-0.1 / (Math.PI / 2));
  });
});
