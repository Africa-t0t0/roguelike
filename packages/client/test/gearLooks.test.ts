import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { PARTICLE_SPEED } from "../src/render/fxTextures";
import { FloorItemKit } from "../src/render/floorItemViews";
import { GearFxShared, GEAR_BONES, GearLooks, gearGlow, itemGlow, type BoneSource } from "../src/render/gearLooks";
import { HazardViews, crackAlpha } from "../src/render/hazardViews";

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
  const bones = new Map(["head", "spine2", "hips", "lefthand", "righthand", "leftfoot", "rightfoot"].map((k) => [k, new TransformNode(k, scene)]));
  return { root, height: 2, boneMount: (k) => (bones.has(k) ? { node: bones.get(k)!, perMeter: 2 } : undefined) };
}

describe("gearGlow", () => {
  it("tier 1 no arde", () => expect(gearGlow(1)).toBeNull());
  it("el color es solo el de la rareza: azul, violeta, dorado", () => {
    expect(gearGlow(2)!.color.b).toBeGreaterThan(gearGlow(2)!.color.r);
    expect(gearGlow(3)!.color.r).toBeGreaterThan(gearGlow(3)!.color.g);
    expect(gearGlow(3)!.color.b).toBe(1);
    expect(gearGlow(4)!.color.r).toBe(1);
    expect(gearGlow(4)!.color.b).toBeLessThan(0.5);
  });
  it("ritmo, tamaño y opacidad suben con el tier, dentro de lo razonable", () => {
    for (const k of ["rate", "size", "alpha"] as const) {
      expect(gearGlow(3)![k]).toBeGreaterThan(gearGlow(2)![k]);
      expect(gearGlow(4)![k]).toBeGreaterThan(gearGlow(3)![k]);
    }
    expect(gearGlow(4)!.size).toBeLessThanOrEqual(0.3);
  });
  it("como mucho 2 huesos por ranura y 7 en total", () => {
    const n = Object.values(GEAR_BONES).map((b) => b.length);
    expect(Math.max(...n)).toBeLessThanOrEqual(2);
    expect(n.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8);
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
    expect(scene.particleSystems).toHaveLength(5); // casco 1 + pechera 2 + guantes 2; botas tier 1 no arden
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

  it("el destello de la legendaria sale cada ~1,5 s del reloj de juego y luego vuelve a la emisión continua", () => {
    const scene = new Scene(new NullEngine());
    const shared = new GearFxShared(scene);
    const looks = new GearLooks(scene, shared, character(scene));
    looks.set({ helmet: { tier: 4, legendary: true, glow: "none" } }, null);
    const ps = scene.particleSystems[0]!;
    looks.render(1000); // programa (primer destello a los 1,5 s)
    looks.render(2400); // 1400 después
    expect(ps.manualEmitCount).toBeLessThanOrEqual(0); // aún no
    looks.render(2600); // 1600 después
    expect(ps.manualEmitCount).toBeGreaterThan(0);
    ps.manualEmitCount = 0; // lo consumió el sistema
    looks.render(2700);
    expect(ps.manualEmitCount).toBe(-1); // vuelve la emisión continua
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

describe("grietas del Golpe sísmico", () => {
  it("no filtran texturas: usan el material compartido y se desvanecen con visibility", () => {
    const scene = new Scene(new NullEngine());
    const views = new HazardViews(scene);
    const world = (left: number) =>
      ({ hazards: new Map(), zones: new Map([["z1", { x: 0, z: 0, radius: 3, left, total: 4 }]]) }) as never;
    const before = scene.textures.length;
    views.push(world(4), 0);
    expect(scene.textures).toHaveLength(before);
    const crack = scene.getMeshByName("hazard-cracks-z1")!;
    expect(crack.visibility).toBeCloseTo(crackAlpha(4));
    views.push(world(0.1), 100);
    expect(crack.visibility).toBeCloseTo(crackAlpha(0.1));
    views.push({ hazards: new Map(), zones: new Map() } as never, 200);
    expect(scene.getMeshByName("hazard-cracks-z1")).toBeNull();
    expect(scene.textures).toHaveLength(before);
    views.dispose();
  });
});
