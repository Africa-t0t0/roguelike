import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import type { Seal } from "@roguelike/shared";
import { SealViews, sealFade } from "../src/render/sealViews";

// En node no hay canvas: DynamicTexture pide un OffscreenCanvas. Uno falso con un contexto 2D que no dibuja.
const noop = () => undefined;
const ctx2d = new Proxy(
  {},
  {
    get: (_t, k) => (k === "createRadialGradient" || k === "createLinearGradient" ? () => ({ addColorStop: noop }) : noop),
    set: () => true,
  },
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

const SEALS: Seal[] = [
  { x0: 4, z0: 10, x1: 8, z1: 10 },
  { x0: 12, z0: 2, x1: 12, z1: 6 },
];

describe("sealFade", () => {
  it("antes de empezar: opaco y sin elevar", () => {
    expect(sealFade(-1)).toEqual({ alpha: 0.35, lift: 0 });
  });
  it("a mitad de la disolución", () => {
    const f = sealFade(0.4);
    expect(f.alpha).toBeCloseTo(0.175);
    expect(f.lift).toBeCloseTo(0.3);
  });
  it("pasado el tiempo queda acotado", () => {
    expect(sealFade(2)).toEqual({ alpha: 0, lift: 0.6 });
  });
});

describe("SealViews", () => {
  const setup = () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    return { engine, scene };
  };
  const sealMeshes = (scene: Scene) => scene.meshes.length;

  it("crea un plano por sello y, al empezar, se disuelve y libera mallas y partículas", () => {
    const { engine, scene } = setup();
    const views = new SealViews(scene, SEALS);
    views.setStarted(false, 0);
    views.render(0);
    expect(sealMeshes(scene)).toBe(2);
    expect(scene.particleSystems).toHaveLength(2);
    views.setStarted(true, 1000);
    views.render(1400);
    expect(sealMeshes(scene)).toBe(2);
    views.render(1900);
    expect(sealMeshes(scene)).toBe(0);
    expect(scene.particleSystems).toHaveLength(0);
    views.dispose();
    expect(scene.materials).toHaveLength(0);
    expect(scene.textures).toHaveLength(0);
    scene.dispose();
    engine.dispose();
  });

  it("si el primer snapshot ya viene empezado no se crean sellos", () => {
    const { engine, scene } = setup();
    const views = new SealViews(scene, SEALS);
    views.setStarted(true, 0);
    views.render(10);
    expect(sealMeshes(scene)).toBe(0);
    expect(scene.particleSystems).toHaveLength(0);
    views.dispose();
    expect(scene.materials).toHaveLength(0);
    expect(scene.textures).toHaveLength(0);
    scene.dispose();
    engine.dispose();
  });

  it("dispose en pleno sello (sin empezar) también libera todo", () => {
    const { engine, scene } = setup();
    const views = new SealViews(scene, SEALS);
    views.setStarted(false, 0);
    views.setPaused(true);
    views.dispose();
    expect(sealMeshes(scene)).toBe(0);
    expect(scene.particleSystems).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
    expect(scene.textures).toHaveLength(0);
    scene.dispose();
    engine.dispose();
  });
});
