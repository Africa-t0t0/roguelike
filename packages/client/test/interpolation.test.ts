import { describe, expect, it } from "vitest";
import { CorrectionSmoother, lerpAngle } from "../src/render/interpolation";

describe("lerpAngle", () => {
  it("interpola normalmente entre ángulos cercanos", () => {
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5);
  });

  it("cruza ±π por el arco corto", () => {
    const mid = lerpAngle(3.1, -3.1, 0.5);
    expect(Math.abs(Math.cos(mid) - Math.cos(Math.PI))).toBeLessThan(1e-3);
    expect(Math.abs(Math.sin(mid))).toBeLessThan(1e-3);
  });
});

describe("CorrectionSmoother", () => {
  it("ignora correcciones de hasta 0,01 m", () => {
    const s = new CorrectionSmoother();
    s.correct({ x: 0, z: 0 }, { x: 0.005, z: 0 });
    expect(s.x).toBe(0);
  });

  it("una corrección grande se dibuja con desfase que casi desaparece en 100 ms", () => {
    const s = new CorrectionSmoother();
    s.correct({ x: 1, z: 0 }, { x: 0, z: 0 });
    expect(s.x).toBe(1);
    for (let i = 0; i < 6; i++) s.decay(1 / 60);
    expect(s.x).toBeLessThan(0.06);
    expect(s.x).toBeGreaterThan(0);
  });

  it("una corrección de más de 2,5 m salta sin suavizar (y descarta el desfase previo)", () => {
    const s = new CorrectionSmoother();
    s.correct({ x: 1, z: 0 }, { x: 0, z: 0 });
    s.correct({ x: 0, z: 0 }, { x: 0, z: 2.6 });
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it("2,5 m justos todavía se suavizan", () => {
    const s = new CorrectionSmoother();
    s.correct({ x: 2.5, z: 0 }, { x: 0, z: 0 });
    expect(s.x).toBe(2.5);
  });

  it("un impulso propio (glide) de ~3 m se absorbe en ~0,15 s, linealmente, sin saltar", () => {
    const s = new CorrectionSmoother();
    s.correct({ x: 0, z: 0 }, { x: 3, z: 0 }, true);
    expect(s.x).toBe(-3);
    s.decay(0.075);
    expect(s.x).toBeCloseTo(-1.5);
    s.decay(0.075);
    expect(s.x).toBeCloseTo(0);
  });

  it("glide no aplica a saltos enormes (reaparición) ni a correcciones chicas", () => {
    const s = new CorrectionSmoother();
    s.correct({ x: 0, z: 0 }, { x: 9, z: 0 }, true);
    expect(s.x).toBe(0);
    s.correct({ x: 0, z: 0 }, { x: 0.5, z: 0 }, true);
    expect(s.x).toBe(-0.5);
    s.decay(1 / 60); // sigue el decaimiento normal, no el lineal
    expect(s.x).toBeGreaterThan(-0.5);
    expect(s.x).toBeLessThan(-0.2);
  });
});
