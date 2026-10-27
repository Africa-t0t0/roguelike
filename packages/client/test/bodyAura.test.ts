import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { AURA_BONES, auraParams, BodyAura, SetAuraFx, setAura, setAuraParams } from "../src/render/bodyAura";
import { flameTexture, PARTICLE_SPEED } from "../src/render/fxTextures";
import type { BoneSource } from "../src/render/gearLooks";
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

function character(scene: Scene, keys: string[] = AURA_BONES.map((b) => b.bone)): BoneSource {
  const root = new TransformNode("root", scene);
  const bones = new Map(keys.map((k) => [k, new TransformNode(k, scene)]));
  return { root, height: 1.8, boneMount: (k) => (bones.has(k) ? { node: bones.get(k)!, perMeter: 2 } : undefined) };
}

describe("auraParams", () => {
  it("el élite usa el color de su naturaleza, dorado si no tiene", () => {
    expect(auraParams("elite", 1, "fire").color).toBe(NATURE_COLORS.fire);
    expect(auraParams("elite", 1, "none").color.r).toBe(1);
    expect(auraParams("elite", 1, "none").color.b).toBeLessThan(0.5);
  });
  it("el élite arde más fuerte que cualquier hechicero", () => {
    const e = auraParams("elite");
    const c = auraParams("pyromancer", 3);
    expect(e.rate).toBeGreaterThan(c.rate);
    expect(e.size).toBeGreaterThan(c.size);
    expect(e.alpha).toBeGreaterThan(c.alpha);
  });
  it("el tier del hechicero sube ritmo, tamaño y opacidad (y se acota a 1..3)", () => {
    const [a, b, c] = [1, 2, 3].map((t) => auraParams("mage", t));
    expect(b!.rate).toBeGreaterThan(a!.rate);
    expect(c!.rate).toBeGreaterThan(b!.rate);
    expect(c!.size).toBeGreaterThan(a!.size);
    expect(c!.alpha).toBeGreaterThan(a!.alpha);
    expect(auraParams("mage", 9)).toEqual(c);
    expect(auraParams("mage", 0)).toEqual(a);
  });
  it("cada hechicero lleva el color de su tipo", () => {
    expect(auraParams("pyromancer").color.r).toBe(1);
    expect(auraParams("mage").color.g).toBe(1);
  });
  it("como mucho 8 emisores, y tamaños dentro de 0,2–0,5 m", () => {
    expect(AURA_BONES.length).toBeLessThanOrEqual(8);
    const p = auraParams("elite");
    for (const b of AURA_BONES) {
      expect(p.size * b.size * 1.3).toBeLessThanOrEqual(0.62);
      expect(p.size * b.size * 0.7).toBeGreaterThanOrEqual(0.15);
    }
  });
});

describe("BodyAura", () => {
  it("crea un emisor por hueso presente, congela en la pausa, deja de emitir y no deja nada al liberar", () => {
    const scene = new Scene(new NullEngine());
    const flame = flameTexture(scene);
    const ch = character(scene, ["spine2", "head", "leftarm"]);
    const aura = new BodyAura(scene, flame, ch, auraParams("elite", 1, "ice"), 2.16);
    expect(aura.emitterCount).toBe(3);
    expect(scene.particleSystems).toHaveLength(3);
    const ps = scene.particleSystems[0] as { updateSpeed: number; emitRate: number };
    expect(ps.updateSpeed).toBe(PARTICLE_SPEED);
    aura.setPaused(true);
    expect(scene.particleSystems.every((p) => (p as { updateSpeed: number }).updateSpeed === 0)).toBe(true);
    aura.setPaused(false);
    expect(ps.updateSpeed).toBe(PARTICLE_SPEED);
    const rate = ps.emitRate;
    expect(rate).toBeGreaterThan(0);
    aura.setActive(false);
    expect(scene.particleSystems.every((p) => p.emitRate === 0)).toBe(true);
    aura.setActive(true);
    expect(ps.emitRate).toBe(rate);

    aura.dispose();
    flame.dispose();
    ch.root.dispose();
    for (const n of scene.transformNodes.slice()) n.dispose();
    expect(scene.particleSystems).toHaveLength(0);
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
    expect(scene.textures).toHaveLength(0);
  });
});

describe("setAura", () => {
  const g = (...t: number[]) => Object.fromEntries(["helmet", "chest", "gloves", "belt", "boots"].slice(0, t.length).map((s, i) => [s, { tier: t[i] }])) as never;
  it("sin piezas o solo tier 1: nada", () => {
    expect(setAura({})).toBeNull();
    expect(setAura(g(1, 1, 1, 1, 1))).toBeNull();
  });
  it("las de tier 1 no cuentan", () => {
    expect(setAura(g(1, 1, 3))).toEqual({ tier: 3, count: 1, intensity: 0.12 });
  });
  it("gana el tier con más piezas; en empate, el mayor", () => {
    expect(setAura(g(2, 2, 3))).toMatchObject({ tier: 2, count: 2, intensity: 0.22 });
    expect(setAura(g(2, 2, 3, 3))).toMatchObject({ tier: 3, count: 2 });
    expect(setAura(g(2, 3, 4))).toMatchObject({ tier: 4, count: 1 });
  });
  it("la intensidad crece con las piezas y el conjunto completo es 1", () => {
    const i = [1, 2, 3, 4, 5].map((n) => setAura(g(...Array(n).fill(4)))!.intensity);
    expect(i).toEqual([0.12, 0.22, 0.35, 0.55, 1]);
    expect(setAura(g(3, 3, 3, 3, 3))).toEqual({ tier: 3, count: 5, intensity: 1 });
  });
  it("params: color del tier y el conjunto completo ≈ aura del élite", () => {
    const full = setAuraParams(4, 1);
    const elite = auraParams("elite");
    expect(full.rate).toBe(elite.rate);
    expect(full.alpha).toBe(elite.alpha);
    expect(setAuraParams(2, 0.12).alpha).toBeLessThan(0.1);
    expect(setAuraParams(2, 0.12).color.b).toBe(1);
  });
});

describe("SetAuraFx", () => {
  it("reconstruye solo al cambiar, respeta pausa y muerte, y no deja nada al liberar", () => {
    const scene = new Scene(new NullEngine());
    let flame: ReturnType<typeof flameTexture> | undefined;
    const ch = character(scene);
    const fx = new SetAuraFx(scene, () => (flame ??= flameTexture(scene, "t")), ch);
    fx.set({});
    expect(scene.particleSystems).toHaveLength(0);
    fx.set({ helmet: { tier: 3 }, chest: { tier: 3 } });
    const a = fx.current;
    expect(scene.particleSystems).toHaveLength(AURA_BONES.length);
    fx.set({ helmet: { tier: 3 }, chest: { tier: 3 }, belt: { tier: 1 } });
    expect(fx.current).toBe(a);
    fx.setPaused(true);
    fx.setActive(false);
    fx.set({ helmet: { tier: 3 }, chest: { tier: 3 }, gloves: { tier: 3 } });
    expect(fx.current).not.toBe(a);
    expect(scene.particleSystems).toHaveLength(AURA_BONES.length);
    expect(scene.particleSystems.every((p) => p.emitRate === 0 && p.updateSpeed === 0)).toBe(true);
    fx.setActive(true);
    expect(scene.particleSystems.every((p) => p.emitRate > 0)).toBe(true);
    fx.set({});
    expect(scene.particleSystems).toHaveLength(0);
    fx.set({ boots: { tier: 4 } });
    fx.dispose();
    flame?.dispose();
    ch.root.dispose();
    for (const n of scene.transformNodes.slice()) n.dispose();
    expect(scene.particleSystems).toHaveLength(0);
    expect(scene.meshes).toHaveLength(0);
    expect(scene.textures).toHaveLength(0);
  });
});
