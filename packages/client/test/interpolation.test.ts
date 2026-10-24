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
});
