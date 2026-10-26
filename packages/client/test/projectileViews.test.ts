import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import type { Nature } from "@roguelike/shared";
import { arcPoints, ProjectileViews, projectileLook } from "../src/render/projectileViews";
import type { WorldSnapshot } from "../src/net/connection";

// En node no hay canvas: DynamicTexture pide un OffscreenCanvas. Uno falso con un contexto 2D que no dibuja.
const noop = () => undefined;
const ctx2d = new Proxy(
  {},
  { get: (_t, k) => (k === "createRadialGradient" ? () => ({ addColorStop: noop }) : noop), set: () => true },
);
class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return ctx2d;
  }
}
beforeAll(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas ??= FakeCanvas;
});

const world = (ids: string[], nature: Nature = "none") =>
  ({ projectiles: new Map(ids.map((id) => [id, { x: 1, z: 2, nature, dirX: 0, dirZ: 1 }])) }) as unknown as WorldSnapshot;

describe("aspecto por naturaleza", () => {
  it("el proyectil sin naturaleza es el orbe arcano, no el verde plano de antes", () => {
    const l = projectileLook("none");
    expect(l.shape).toBe("orb");
    expect(l.motes).toBe(3);
    expect(l.core).not.toEqual(l.halo); // núcleo claro, halo esmeralda
    expect(l.halo[1]).toBeGreaterThan(l.halo[0]);
  });

  it("fuego: halo naranja y brasas; hielo: esquirla alargada con borde; rayo: halo amarillo con arcos", () => {
    expect(projectileLook("fire").halo).toEqual([1, 0.45, 0.1]);
    expect(projectileLook("fire").embers).toBe(true);
    expect(projectileLook("ice").shape).toBe("shard");
    expect(projectileLook("ice").core).toEqual([0.55, 0.95, 1]);
    expect(projectileLook("ice").outline).not.toBeNull();
    expect(projectileLook("ice").trail.gravityY).toBeLessThan(0); // copos que caen
    expect(projectileLook("lightning").halo).toEqual([1, 0.92, 0.4]);
    expect(projectileLook("lightning").arcs).toBe(true);
    expect(projectileLook("fire").trail.gravityY).toBeGreaterThan(0); // llamas que suben
  });

  it("el estallido toma el color de su naturaleza", () => {
    expect(projectileLook("ice").burst.color2).toEqual([0.55, 0.95, 1]);
    expect(projectileLook("fire").burst.color2).toEqual([1, 0.45, 0.1]);
  });

  it("los arcos son deterministas por ranura de tiempo y cambian de una a otra", () => {
    const a = arcPoints(3, 10, 0).map((v) => v.asArray());
    expect(arcPoints(3, 10, 0).map((v) => v.asArray())).toEqual(a);
    expect(arcPoints(3, 11, 0).map((v) => v.asArray())).not.toEqual(a);
  });
});

describe("proyectiles de los monstruos", () => {
  it("el orbe arcano crea núcleo, halo, 3 motas y estela; al desaparecer deja un estallido que se libera solo", () => {
    const scene = new Scene(new NullEngine());
    const views = new ProjectileViews(scene);
    views.push(world(["p1"]), 0);
    views.render(10);
    expect(scene.meshes.length).toBe(5);
    expect(scene.particleSystems.length).toBe(1);
    views.push(world([]), 20);
    views.render(30);
    expect(scene.meshes.length).toBe(0);
    expect(scene.particleSystems.length).toBe(1); // el estallido
    views.render(1000);
    expect(scene.particleSystems.length).toBe(0);
    views.dispose();
  });

  it("cada naturaleza se libera por completo: mallas, partículas y materiales", () => {
    for (const nature of ["none", "fire", "ice", "lightning"] as const) {
      const scene = new Scene(new NullEngine());
      const views = new ProjectileViews(scene);
      views.push(world(["a", "b"], nature), 0);
      views.render(10);
      views.render(100); // otra ranura de arcos
      views.setPaused(true);
      views.push(world([], nature), 120);
      views.render(130);
      views.render(2000);
      expect(scene.meshes.length, nature).toBe(0);
      expect(scene.particleSystems.length, nature).toBe(0);
      views.dispose();
      expect(scene.materials.length, nature).toBe(0);
    }
  });

  it("los materiales se comparten entre proyectiles de la misma naturaleza", () => {
    const scene = new Scene(new NullEngine());
    const views = new ProjectileViews(scene);
    views.push(world(["a"], "fire"), 0);
    const n = scene.materials.length;
    views.push(world(["a", "b", "c"], "fire"), 5);
    expect(scene.materials.length).toBe(n);
    views.dispose();
  });
});
