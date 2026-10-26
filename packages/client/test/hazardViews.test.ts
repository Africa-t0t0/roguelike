import { describe, expect, it } from "vitest";
import { beamWarnAlpha, zoneFill } from "../src/render/hazardViews";

describe("zoneFill", () => {
  it("va de 0 a 1 con el aviso", () => {
    expect(zoneFill(1.2, 1.2)).toBe(0);
    expect(zoneFill(0, 1.2)).toBe(1);
    expect(zoneFill(0.6, 1.2)).toBeCloseTo(0.5);
  });
  it("se acota a [0, 1]", () => {
    expect(zoneFill(-1, 1.2)).toBe(1);
    expect(zoneFill(2, 1.2)).toBe(0);
  });
});

describe("beamWarnAlpha", () => {
  it("0,4 mientras sigue al objetivo", () => expect(beamWarnAlpha(1.0, 1.1, 0.6)).toBeCloseTo(0.4));
  it("0,5 recién fijado", () => expect(beamWarnAlpha(0.44, 1.1, 0.6)).toBeCloseTo(0.5));
  it("1 al disparar", () => expect(beamWarnAlpha(0, 1.1, 0.6)).toBeCloseTo(1));
});
