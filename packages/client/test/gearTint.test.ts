import { beforeAll, describe, expect, it } from "vitest";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { TIERS } from "@roguelike/shared";
import { boneRegion, boneRegionWeight, THIGH_BOOTS_WEIGHT, GearTint, GearTintPlugin, REGION_ATTRIBUTE, regionWeights, tintOf, tintStrength } from "../src/render/gearTint";

const noop = () => undefined;
const ctx2d = new Proxy({}, { get: () => noop, set: () => true });
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

describe("boneRegion", () => {
  it.each([
    ["mixamorig:Head", "helmet"],
    ["mixamorig:Neck", "helmet"],
    ["mixamorig:HeadTop_End", "helmet"],
    ["mixamorig:Hips", "belt"],
    ["mixamorig:Spine", "belt"],
    ["mixamorig:Spine1", "chest"],
    ["mixamorig:Spine2", "chest"],
    ["mixamorig:LeftShoulder", "chest"],
    ["mixamorig:RightArm", "chest"],
    ["mixamorig:LeftForeArm", "gloves"],
    ["mixamorig:RightHand", "gloves"],
    ["mixamorig:LeftHandIndex3", "gloves"],
    ["mixamorig:LeftUpLeg", "boots"],
    ["mixamorig:LeftLeg", "boots"],
    ["mixamorig:RightLeg", "boots"],
    ["mixamorig:LeftFoot", "boots"],
    ["mixamorig:RightToeBase", "boots"],
  ])("%s → %s", (name, region) => expect(boneRegion(name)).toBe(region));
});

describe("boneRegionWeight", () => {
  it("el muslo pesa parcial en las botas; espinilla y pie, entero", () => {
    expect(boneRegionWeight("mixamorig:RightUpLeg")).toBe(THIGH_BOOTS_WEIGHT);
    expect(THIGH_BOOTS_WEIGHT).toBeCloseTo(0.45);
    for (const n of ["mixamorig:LeftLeg", "mixamorig:LeftFoot", "mixamorig:LeftToeBase", "mixamorig:Head", "mixamorig:Hips"]) expect(boneRegionWeight(n)).toBe(1);
  });
});

describe("tint por tier", () => {
  it("tier 1 no tiñe; la fuerza sube con el tier", () => {
    expect(tintOf(1)).toBeNull();
    expect(tintStrength(3)).toBeGreaterThan(tintStrength(2));
    expect(tintStrength(4)).toBeGreaterThan(tintStrength(3));
  });
  it("el color es el brillo de la rareza", () => {
    for (const t of [2, 3, 4] as const) expect(tintOf(t)!.slice(0, 3)).toEqual(TIERS[t].glow);
  });
});

/** Malla con esqueleto: 3 vértices; los índices de hueso son los de la matriz (no el orden en `bones`). */
function skinned(scene: Scene): Mesh {
  const skeleton = new Skeleton("sk", "sk", scene);
  // índice de matriz: 0 = mano, 1 = cabeza, 2 = muslo, 3 = pie
  new Bone("mixamorig:Head", skeleton, null, Matrix.Identity(), null, null, 1);
  new Bone("mixamorig:LeftHand", skeleton, null, Matrix.Identity(), null, null, 0);
  new Bone("mixamorig:LeftFoot", skeleton, null, Matrix.Identity(), null, null, 3);
  new Bone("mixamorig:LeftUpLeg", skeleton, null, Matrix.Identity(), null, null, 2);
  const mesh = new Mesh("body", scene);
  mesh.setVerticesData(VertexBuffer.PositionKind, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, [1, 0, 0, 0, 0, 3, 0, 0, 2, 3, 0, 0], false, 4);
  mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, [1, 0, 0, 0, 0.5, 0.5, 0, 0, 0.7, 0.3, 0, 0], false, 4);
  mesh.setIndices([0, 1, 2]);
  mesh.skeleton = skeleton;
  const mat = new PBRMaterial("kingslayermat", scene);
  mat.albedoTexture = new DynamicTexture("albedo", 4, scene);
  mesh.material = mat;
  return mesh;
}

describe("regionWeights", () => {
  it("suma los pesos de piel por región (casco, pechera, guantes, cinturón; botas en el atributo extra)", () => {
    const scene = new Scene(new NullEngine());
    const mesh = skinned(scene);
    const r = regionWeights(mesh, mesh.skeleton!)!;
    const w = Array.from(r.main);
    const b = Array.from(r.extra);
    expect(w.slice(0, 4)).toEqual([1, 0, 0, 0]); // cabeza
    expect(w.slice(4, 8)).toEqual([0, 0, 0.5, 0]); // mano (guantes); el pie va aparte
    expect(b[1]).toBeCloseTo(0.5); // pie → botas
    expect(w[8]).toBe(0); // muslo: no cae en las regiones principales
    expect(w[11]).toBe(0);
    expect(b[2]).toBeCloseTo(0.7 * THIGH_BOOTS_WEIGHT + 0.3); // muslo parcial + pie
  });
});

describe("GearTint", () => {
  it("clona el material una vez, solo cambia uniformes y lo libera todo con la vista", () => {
    const scene = new Scene(new NullEngine());
    const mesh = skinned(scene);
    const original = mesh.material!;
    const before = { mats: scene.materials.length, tex: scene.textures.length };
    const tint = new GearTint([mesh]);
    expect(mesh.isVerticesDataPresent(REGION_ATTRIBUTE)).toBe(true);
    expect(mesh.material).not.toBe(original);
    expect(scene.materials).toHaveLength(before.mats + 1);
    const plugin = mesh.material!.pluginManager!.getPlugin<GearTintPlugin>("GearTint")!;
    expect(plugin.isEnabled).toBe(false);

    tint.set({ helmet: { tier: 4 }, gloves: { tier: 3 }, boots: { tier: 1 } });
    expect(plugin.isEnabled).toBe(true);
    expect(Array.from(plugin.tints.slice(0, 4))).toEqual(tintOf(4)!.map(Math.fround));
    expect(Array.from(plugin.tints.slice(4, 8))).toEqual([0, 0, 0, 0]); // sin pechera
    expect(plugin.tints[11]).toBeCloseTo(tintStrength(3));
    expect(plugin.tints[15]).toBe(0); // sin cinturón
    expect(plugin.tints[19]).toBe(0); // botas tier 1
    tint.set({ belt: { tier: 2 } });
    expect(plugin.tints[15]).toBeCloseTo(tintStrength(2)); // cinturón: índice 3
    expect(plugin.tints.length).toBe(20);
    tint.set({ helmet: { tier: 4 }, gloves: { tier: 3 }, boots: { tier: 1 } });
    tint.set({ chest: { tier: 2 } });
    tint.set({ boots: { tier: 1 } });
    expect(plugin.isEnabled).toBe(false);
    expect(scene.materials).toHaveLength(before.mats + 1);

    tint.dispose();
    expect(mesh.material).toBe(original);
    expect(scene.materials).toHaveLength(before.mats);
    expect(scene.textures).toHaveLength(before.tex);
  });

  it("ignora las mallas sin esqueleto", () => {
    const scene = new Scene(new NullEngine());
    const mesh = new Mesh("sword", scene);
    mesh.material = new PBRMaterial("steel", scene);
    const n = scene.materials.length;
    const tint = new GearTint([mesh]);
    expect(scene.materials).toHaveLength(n);
    tint.dispose();
  });
});
