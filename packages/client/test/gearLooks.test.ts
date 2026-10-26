import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { PARTICLE_SPEED } from "../src/render/fxTextures";
import { FloorItemKit } from "../src/render/floorItemViews";
import { GearFxShared, GearLooks, gearGlow, itemGlow, type BoneSource } from "../src/render/gearLooks";
import { crackAlpha } from "../src/render/hazardViews";
import { NATURE_COLORS } from "../src/render/natureLooks";

// En node no hay canvas: DynamicTexture pide un OffscreenCanvas falso con un contexto 2D que no dibuja.
const noop = () => undefined;
const ctx2d = new Proxy({}, { get: (_t, k) => (k === "createRadialGradient" ? () => ({ addColorStop: noop }) : noop), set: () => true });
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

function character(scene: Scene): BoneSource {
  const root = new TransformNode("root", scene);
  const bones = new Map(["head", "spine2", "lefthand", "righthand", "leftfoot", "rightfoot"].map((k) => [k, new TransformNode(k, scene)]));
  return { root, height: 2, boneMount: (k) => (bones.has(k) ? { node: bones.get(k)!, perMeter: 2 } : undefined) };
}

describe("gearGlow", () => {
  it("tier 1 no brilla", () => expect(gearGlow(1, "none")).toBeNull());
  it("con elemento, el color es el del elemento", () => expect(gearGlow(4, "fire")!.color).toBe(NATURE_COLORS.fire));
  it("tier 3 lleva halo; tier 2 no; la densidad sube con el tier", () => {
    expect(gearGlow(3, "none")!.halo).toBe(true);
    expect(gearGlow(2, "none")!.halo).toBe(false);
    expect(gearGlow(4, "none")!.rate).toBeGreaterThan(gearGlow(3, "none")!.rate);
    expect(gearGlow(3, "none")!.rate).toBeGreaterThan(gearGlow(2, "none")!.rate);
  });
  it("itemGlow elige la resistencia más alta", () => {
    const item = { slot: "boots", tier: 3, legendary: null, stats: [{ stat: "resIce", value: 0.1 }, { stat: "resFire", value: 0.05 }] } as never;
    expect(itemGlow(item)).toBe("ice");
  });
});

describe("GearLooks", () => {
  it("crea y libera los emisores de 4 piezas y una reliquia sin dejar restos", () => {
    const scene = new Scene(new NullEngine());
    const shared = new GearFxShared(scene);
    const looks = new GearLooks(scene, shared, character(scene));
    const before = { meshes: scene.meshes.length, mats: scene.materials.length, tex: scene.textures.length };
    looks.set(
      {
        helmet: { tier: 2, legendary: false, glow: "none" },
        chest: { tier: 3, legendary: false, glow: "ice" },
        gloves: { tier: 4, legendary: true, glow: "fire" },
        boots: { tier: 1, legendary: true, glow: "none" },
      },
      "glassHeart",
    );
    expect(scene.particleSystems).toHaveLength(6);
    looks.render(0);
    looks.render(10_000);
    looks.render(10_100);
    looks.setPaused(true);
    expect(scene.particleSystems.every((p) => p.updateSpeed === 0)).toBe(true);
    looks.setPaused(false);
    expect(scene.particleSystems[0]!.updateSpeed).toBe(PARTICLE_SPEED);
    // Cambiar una pieza y quitar la reliquia libera lo anterior.
    looks.set({ helmet: { tier: 1, legendary: false, glow: "none" } }, null);
    expect(scene.particleSystems).toHaveLength(0);
    looks.set({ chest: { tier: 2, legendary: false, glow: "none" } }, "oakHeart");
    looks.dispose();
    expect(scene.particleSystems).toHaveLength(0);
    expect({ meshes: scene.meshes.length, mats: scene.materials.length, tex: scene.textures.length }).toEqual(before);
    shared.dispose();
    expect(scene.materials).toHaveLength(0);
    expect(scene.textures).toHaveLength(0);
  });

  it("el destello de la legendaria sale cada ~1,5 s del reloj de juego y vuelve al color del brillo", () => {
    const scene = new Scene(new NullEngine());
    const shared = new GearFxShared(scene);
    const looks = new GearLooks(scene, shared, character(scene));
    looks.set({ helmet: { tier: 2, legendary: true, glow: "none" } }, null);
    const ps = scene.particleSystems[0]!;
    const c1 = ps.color1.clone();
    looks.render(1000); // programa (primer destello a los 1,5 s)
    looks.render(2400); // 1400 después
    expect(ps.manualEmitCount).toBeLessThanOrEqual(0); // aún no
    looks.render(2600); // 1600 después
    expect(ps.manualEmitCount).toBeGreaterThan(0);
    expect(ps.color1.equals(c1)).toBe(false);
    ps.manualEmitCount = 0; // lo consumió el sistema
    looks.render(2700);
    expect(ps.color1.equals(c1)).toBe(true);
    looks.dispose();
    shared.dispose();
  });
});

describe("objetos del suelo", () => {
  it("el kit dibuja las 4 ranuras y una reliquia, y se libera entero", () => {
    const scene = new Scene(new NullEngine());
    const kit = new FloorItemKit(scene);
    const root = new TransformNode("r", scene);
    for (const slot of ["helmet", "chest", "gloves", "boots"] as const) kit.gear(root, slot, 3, "none");
    kit.relic(root, root, "vampireFang");
    expect(scene.meshes.length).toBeGreaterThan(8);
    root.dispose();
    kit.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
    expect(scene.textures).toHaveLength(0);
  });
});

describe("grietas", () => {
  it("llenas hasta el último tramo y luego se desvanecen", () => {
    expect(crackAlpha(3)).toBe(1);
    expect(crackAlpha(0.3)).toBeCloseTo(0.5);
    expect(crackAlpha(0)).toBe(0);
  });
});
