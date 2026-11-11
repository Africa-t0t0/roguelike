import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { FLASH_S, FLINCH_S, Flinches, flinchEnvelope, flinchStrength, leanRotation } from "../src/render/flinch";

describe("flinchEnvelope", () => {
  it("empieza y termina en 0 y llega a 1 al principio", () => {
    expect(flinchEnvelope(0)).toBe(0);
    expect(flinchEnvelope(FLINCH_S)).toBe(0);
    expect(flinchEnvelope(FLINCH_S * 2)).toBe(0);
    expect(flinchEnvelope(-1)).toBe(0);
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => flinchEnvelope((FLINCH_S * i) / 50)));
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThanOrEqual(1);
    // sube rápido, vuelve lento: a mitad de camino sigue inclinado
    expect(flinchEnvelope(FLINCH_S * 0.5)).toBeGreaterThan(0.3);
  });
});

describe("flinchStrength", () => {
  it("un golpe que quita más vida inclina más, con tope", () => {
    const light = flinchStrength(5, 100, 1.7);
    const heavy = flinchStrength(30, 100, 1.7);
    expect(heavy).toBeGreaterThan(light);
    expect(flinchStrength(1000, 100, 1.7)).toBe(flinchStrength(100, 100, 1.7));
  });

  it("los enemigos altos se inclinan menos", () => {
    expect(flinchStrength(10, 100, 2.4)).toBeLessThan(flinchStrength(10, 100, 1.7));
  });

  it("sin vida máxima conocida usa el golpe mínimo", () => {
    expect(flinchStrength(10, 0, 1.7)).toBe(flinchStrength(0, 100, 1.7));
  });
});

describe("leanRotation", () => {
  // La cabeza (1 m sobre los pies) debe irse hacia `dir` en el mundo, sea cual sea la mirada.
  const headAfter = (facing: number, dir: number) => {
    const scene = new Scene(new NullEngine());
    const root = new TransformNode("root", scene);
    root.rotation.y = facing;
    const body = new TransformNode("body", scene);
    body.parent = root;
    const r = leanRotation(dir - facing, 0.2);
    body.rotation.x = r.x;
    body.rotation.z = r.z;
    body.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(new Vector3(0, 1, 0), body.getWorldMatrix());
  };

  it.each([
    [0, 0],
    [0, Math.PI / 2],
    [1.1, Math.PI],
    [-2, -Math.PI / 2],
    [0.7, 2.3],
  ])("mirando a %f, inclina hacia %f", (facing, dir) => {
    const h = headAfter(facing, dir);
    const len = Math.hypot(h.x, h.z);
    expect(len).toBeGreaterThan(0.15);
    expect(h.x / len).toBeCloseTo(Math.sin(dir), 1);
    expect(h.z / len).toBeCloseTo(Math.cos(dir), 1);
  });
});

describe("Flinches", () => {
  it("dura FLINCH_S desde el golpe y lleva su dirección y fuerza", () => {
    const f = new Flinches();
    f.hit("e1", 1000, 1.5, 0.8);
    expect(f.sample("e1", 999)).toBeUndefined();
    const mid = f.sample("e1", 1000 + FLINCH_S * 300)!;
    expect(mid.dir).toBe(1.5);
    expect(mid.lean).toBeGreaterThan(0);
    expect(mid.lean).toBeLessThanOrEqual(0.8);
    expect(f.sample("e1", 1000 + FLINCH_S * 1000)).toBeUndefined();
    expect(f.sample("otro", 1000)).toBeUndefined();
  });

  it("el destello es más corto que el respingo y decae", () => {
    const f = new Flinches();
    f.hit("e1", 0, 0, 1);
    const a = f.sample("e1", 1)!.flash;
    const b = f.sample("e1", FLASH_S * 500)!.flash;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
    expect(f.sample("e1", FLASH_S * 1000 + 1)!.flash).toBe(0);
  });

  it("un golpe nuevo reemplaza al anterior y forget lo borra", () => {
    const f = new Flinches();
    f.hit("e1", 0, 0, 1);
    f.hit("e1", 100, 2, 0.5);
    expect(f.sample("e1", 150)!.dir).toBe(2);
    f.forget("e1");
    expect(f.sample("e1", 150)).toBeUndefined();
  });
});
