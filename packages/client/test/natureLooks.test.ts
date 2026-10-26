import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { PARTICLE_SPEED } from "../src/render/fxTextures";
import { attachNatureFx, NATURE_COLORS, natureTint } from "../src/render/natureLooks";

// En node no hay canvas: DynamicTexture pide un OffscreenCanvas falso con un contexto 2D que no dibuja.
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

describe("colores de las naturalezas", () => {
  it("los del spec, exactos", () => {
    expect(NATURE_COLORS.fire.asArray()).toEqual([1, 0.45, 0.1]);
    expect(NATURE_COLORS.ice.asArray()).toEqual([0.55, 0.95, 1]);
    expect(NATURE_COLORS.lightning.asArray()).toEqual([1, 0.92, 0.4]);
  });

  it("natureTint devuelve la base sin naturaleza y el color de la naturaleza con ella", () => {
    const base = new Color3(0.2, 0.3, 0.4);
    expect(natureTint(base, "none")).toBe(base);
    expect(natureTint(base, "ice")).toBe(NATURE_COLORS.ice);
    expect(natureTint(base, "fire")).toBe(NATURE_COLORS.fire);
    expect(natureTint(base, "lightning")).toBe(NATURE_COLORS.lightning);
  });
});

describe("partículas de las armas con naturaleza", () => {
  it("nace un sistema, se congela en la pausa y se libera con el arma", () => {
    const scene = new Scene(new NullEngine());
    const grip = new TransformNode("grip", scene);
    const fx = attachNatureFx(scene, "fire", grip, false);
    expect(scene.particleSystems).toHaveLength(1);
    const ps = scene.particleSystems[0]!;
    expect(ps.updateSpeed).toBe(PARTICLE_SPEED);
    fx.setPaused(true);
    expect(ps.updateSpeed).toBe(0);
    fx.setPaused(false);
    expect(ps.updateSpeed).toBe(PARTICLE_SPEED);
    const meshes = scene.meshes.length;
    fx.dispose();
    expect(scene.particleSystems).toHaveLength(0);
    expect(scene.meshes.length).toBe(meshes - 1);
  });

  it("una arma que nace durante la pausa nace congelada, y todas comparten la textura", () => {
    const scene = new Scene(new NullEngine());
    const a = attachNatureFx(scene, "ice", new TransformNode("a", scene), true);
    const b = attachNatureFx(scene, "lightning", new TransformNode("b", scene), true);
    expect(scene.particleSystems.map((p) => p.updateSpeed)).toEqual([0, 0]);
    expect(scene.particleSystems[0]!.particleTexture).toBe(scene.particleSystems[1]!.particleTexture);
    a.dispose();
    b.dispose();
  });
});
