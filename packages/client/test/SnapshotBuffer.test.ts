import { describe, expect, it } from "vitest";
import { SnapshotBuffer } from "../src/net/SnapshotBuffer";

type S = { x: number };
const lerp = (a: S, b: S, t: number): S => ({ x: a.x + (b.x - a.x) * t });

describe("SnapshotBuffer", () => {
  it("interpola, sujeta a los extremos y devuelve undefined si está vacío", () => {
    const buf = new SnapshotBuffer<S>(lerp);
    expect(buf.sample(0)).toBeUndefined();
    buf.push(0, { x: 0 });
    buf.push(100, { x: 10 });
    expect(buf.sample(25)?.x).toBeCloseTo(2.5, 9);
    expect(buf.sample(-5)?.x).toBe(0);
    expect(buf.sample(500)?.x).toBe(10);
  });

  it("descarta los más viejos que keepMs respecto del último", () => {
    const buf = new SnapshotBuffer<S>(lerp, 1000);
    for (let t = 0; t <= 3000; t += 100) buf.push(t, { x: t });
    // t=1500 ya no existe: se sujeta al primero retenido (2000)
    expect(buf.sample(1500)?.x).toBe(2000);
    expect(buf.sample(2050)?.x).toBeCloseTo(2050, 9);
  });

  it("siempre conserva al menos 2 snapshots", () => {
    const buf = new SnapshotBuffer<S>(lerp, 1000);
    buf.push(0, { x: 0 });
    buf.push(5000, { x: 50 });
    expect(buf.sample(2500)?.x).toBeCloseTo(25, 9);
  });
});
