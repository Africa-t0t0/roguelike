import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { FloorItemKit } from "../src/render/floorItemViews";
import { GearFxShared, GearLooks, itemGlow, type BoneSource } from "../src/render/gearLooks";
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
  return { root, height: 2, boneMount: () => undefined };
}

describe("itemGlow", () => {
  it("itemGlow elige la resistencia más alta", () => {
    const item = { slot: "boots", tier: 3, legendary: null, stats: [{ stat: "resIce", value: 0.1 }, { stat: "resFire", value: 0.05 }] } as never;
    expect(itemGlow(item)).toBe("ice");
  });
});

describe("GearLooks", () => {
  it("la reliquia se crea, se cambia y se libera sin dejar restos ni partículas", () => {
    const scene = new Scene(new NullEngine());
    const shared = new GearFxShared(scene);
    const looks = new GearLooks(scene, shared, character(scene));
    const before = { meshes: scene.meshes.length, mats: scene.materials.length, tex: scene.textures.length };
    looks.set("glassHeart");
    expect(scene.meshes.length).toBeGreaterThan(before.meshes);
    expect(scene.particleSystems).toHaveLength(0); // el equipo ya no echa llamas
    looks.render(0);
    looks.render(10_000);
    looks.set("oakHeart");
    looks.set(null);
    expect(scene.meshes).toHaveLength(before.meshes);
    looks.set("vampireFang");
    looks.dispose();
    expect({ meshes: scene.meshes.length, mats: scene.materials.length, tex: scene.textures.length }).toEqual(before);
    shared.dispose();
    expect(scene.materials).toHaveLength(0);
    expect(scene.textures).toHaveLength(0);
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
