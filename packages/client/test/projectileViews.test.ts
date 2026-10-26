import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ProjectileViews } from "../src/render/projectileViews";
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

const world = (ids: string[]) =>
  ({ projectiles: new Map(ids.map((id) => [id, { x: 1, z: 2 }])) }) as unknown as WorldSnapshot;

describe("orbes de los hechiceros", () => {
  it("crea núcleo, halo y estela; al desaparecer deja un estallido que se libera solo", () => {
    const scene = new Scene(new NullEngine());
    const views = new ProjectileViews(scene);
    views.push(world(["p1"]), 0);
    views.render(10);
    expect(scene.meshes.length).toBe(2);
    expect(scene.particleSystems.length).toBe(1);
    views.push(world([]), 20);
    views.render(30);
    expect(scene.meshes.length).toBe(0);
    expect(scene.particleSystems.length).toBe(1); // el estallido
    views.render(1000);
    expect(scene.particleSystems.length).toBe(0);
    views.dispose();
  });

  it("dispose libera mallas, partículas y materiales", () => {
    const scene = new Scene(new NullEngine());
    const views = new ProjectileViews(scene);
    views.push(world(["p1", "p2"]), 0);
    views.render(10);
    views.dispose();
    expect(scene.meshes.length).toBe(0);
    expect(scene.particleSystems.length).toBe(0);
    expect(scene.materials.length).toBe(0);
  });
});
