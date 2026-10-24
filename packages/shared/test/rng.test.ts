import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng";

describe("createRng", () => {
  it("misma semilla produce las mismas 100 salidas", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("semillas distintas difieren en las primeras 5 salidas", () => {
    const a = createRng(1);
    const b = createRng(2);
    const xs = Array.from({ length: 5 }, () => a.next());
    const ys = Array.from({ length: 5 }, () => b.next());
    expect(xs).not.toEqual(ys);
  });

  it("next() queda en [0,1)", () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int(3,7) cubre 3..7 y nada fuera", () => {
    const r = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) seen.add(r.int(3, 7));
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("pick de un solo elemento lo devuelve", () => {
    expect(createRng(1).pick(["a"])).toBe("a");
  });
});
