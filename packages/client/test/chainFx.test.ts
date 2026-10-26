import { describe, expect, it } from "vitest";
import { chainArcPoints, chainJitter } from "../src/render/chainFx";
import { eliteName } from "../src/render/natureLooks";

describe("chainArcPoints", () => {
  it("sin desvío son segments + 1 puntos sobre la recta, a 1 m de altura", () => {
    const pts = chainArcPoints([0, 0], [4, 0], 4, () => 0);
    expect(pts).toHaveLength(5);
    pts.forEach((p, i) => {
      expect(p.x).toBeCloseTo(i);
      expect(p.y).toBe(1);
      expect(p.z).toBeCloseTo(0);
    });
  });
  it("el desvío es perpendicular y no mueve los extremos", () => {
    const pts = chainArcPoints([0, 0], [4, 0], 4, () => 0.3);
    expect(pts[0]!.z).toBeCloseTo(0);
    expect(pts[4]!.z).toBeCloseTo(0);
    expect(Math.abs(pts[2]!.z)).toBeCloseTo(0.3);
    expect(pts[2]!.x).toBeCloseTo(2);
  });
  it("el desvío por defecto es determinista", () => {
    expect(chainJitter(3)(2)).toBe(chainJitter(3)(2));
  });
});

describe("eliteName", () => {
  it("tipo + naturaleza", () => {
    expect(eliteName("brute", "ice")).toBe("Bruto de hielo");
    expect(eliteName("minion", "fire")).toBe("Esbirro de fuego");
  });
});
