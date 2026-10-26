import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ABILITIES, SLAM_IMPACT_S } from "@roguelike/shared";
import { AbilityFx, abilityFxDurationMs, abilityTimeline } from "../src/render/abilityFx";
import { NATURE_COLORS } from "../src/render/natureLooks";

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

function setup() {
  const scene = new Scene(new NullEngine());
  const meshes0 = scene.meshes.length;
  const textures0 = scene.textures.length;
  const fx = new AbilityFx(scene);
  return { scene, fx, meshes0, textures0 };
}

const AT = { x: 3, z: 4, facing: 0 };

describe("efectos de habilidades", () => {
  it("el Torbellino crea sus mallas y no deja ninguna al terminar", () => {
    const { scene, fx } = setup();
    const before = scene.meshes.length;
    fx.play("whirlwind", AT, 1, 1000);
    expect(scene.meshes.length).toBeGreaterThan(before);
    expect(scene.particleSystems.length).toBeGreaterThan(0);
    fx.update(1000);
    fx.update(1000 + ABILITIES.whirlwind.animS * 500);
    fx.update(1000 + abilityFxDurationMs("whirlwind", 1) + 100);
    expect(scene.meshes.length).toBe(before);
    expect(scene.particleSystems.length).toBe(0);
  });

  it("todas las habilidades activas terminan sin mallas ni partículas huérfanas", () => {
    const { scene, fx } = setup();
    const before = scene.meshes.length;
    for (const id of ["whirlwind", "kick", "warcry", "slam", "thrust"] as const) {
      for (const rank of [1, 2, 3]) {
        fx.play(id, AT, rank, 0);
        for (let t = 0; t <= abilityFxDurationMs(id, rank); t += 50) fx.update(t);
        fx.update(abilityFxDurationMs(id, rank) + 100);
        expect(scene.meshes.length, `${id} ${rank}`).toBe(before);
        expect(scene.particleSystems.length, `${id} ${rank}`).toBe(0);
      }
    }
  });

  it("Foco 5: con el tiempo congelado el aro no crece y las partículas se detienen", () => {
    const { fx } = setup();
    fx.play("whirlwind", AT, 1, 1000);
    fx.update(1300);
    const r = fx.ringRadius()!;
    expect(r).toBeGreaterThan(0.5);
    fx.setPaused(true);
    for (let i = 0; i < 5; i++) fx.update(1300);
    expect(fx.ringRadius()).toBe(r);
    expect(fx.particleSpeeds().every((s) => s === 0)).toBe(true);
    fx.setPaused(false);
    expect(fx.particleSpeeds().every((s) => s > 0)).toBe(true);
    fx.update(1400);
    expect(fx.ringRadius()!).toBeGreaterThan(r);
  });

  it("un sistema de partículas que arranca en la pausa nace detenido", () => {
    const { fx } = setup();
    fx.setPaused(true);
    fx.play("slam", AT, 1, 0);
    fx.update(SLAM_IMPACT_S * 1000 + 10);
    expect(fx.particleSpeeds().length).toBeGreaterThan(0);
    expect(fx.particleSpeeds().every((s) => s === 0)).toBe(true);
  });

  it("el Golpe sísmico avisa su impacto en el instante del impacto", () => {
    const { fx } = setup();
    const impacts: { x: number; z: number }[] = [];
    fx.onSlamImpact = (x, z) => impacts.push({ x, z });
    fx.play("slam", AT, 1, 0);
    fx.update(SLAM_IMPACT_S * 1000 - 10);
    expect(impacts).toEqual([]);
    fx.update(SLAM_IMPACT_S * 1000);
    fx.update(SLAM_IMPACT_S * 1000 + 50);
    expect(impacts).toEqual([{ x: 3, z: 4 }]);
  });

  it("la Patada y el Tajo salen hacia donde mira el jugador", () => {
    const { scene, fx } = setup();
    const at = { x: 0, z: 0, facing: Math.PI / 2 }; // mira a +X
    fx.play("thrust", at, 3, 0);
    fx.play("kick", at, 1, 0);
    fx.update(350); // Patada: 0,24–0,39 s; Tajo: 0,315–0,615 s
    for (const name of ["fx-thrust", "fx-kick"]) {
      const mesh = scene.meshes.find((m) => m.name.startsWith(name) && m.isEnabled());
      expect(mesh, name).toBeDefined();
      mesh!.computeWorldMatrix(true);
      const c = mesh!.getBoundingInfo().boundingBox.centerWorld;
      expect(c.x, name).toBeGreaterThan(0.5);
      expect(Math.abs(c.z), name).toBeLessThan(0.3);
    }
  });

  it("dispose() no deja mallas, partículas ni texturas", () => {
    const { scene, fx, meshes0, textures0 } = setup();
    fx.play("whirlwind", AT, 3, 0);
    fx.play("slam", AT, 3, 0);
    fx.update(600);
    fx.dispose();
    expect(scene.meshes.length).toBe(meshes0);
    expect(scene.particleSystems.length).toBe(0);
    expect(scene.textures.length).toBe(textures0);
    expect(scene.materials.filter((m) => m.name.startsWith("fx-")).length).toBe(0);
  });

  it("las habilidades sin efecto no hacen nada", () => {
    const { scene, fx } = setup();
    const before = scene.meshes.length;
    fx.play("block", AT, 1, 0);
    fx.play("cleave", AT, 1, 0);
    expect(scene.meshes.length).toBe(before);
  });

  it("el Torbellino usa el color de la naturaleza del arma y, sin ella, el de siempre", () => {
    const ring = (n?: "fire" | "ice" | "lightning" | "none") => {
      const step = abilityTimeline("whirlwind", 1, n).find((s) => s.kind === "ring");
      return step?.kind === "ring" ? step.color : undefined;
    };
    expect(ring("fire")).toBe(NATURE_COLORS.fire);
    expect(ring("ice")).toBe(NATURE_COLORS.ice);
    expect(ring("lightning")).toBe(NATURE_COLORS.lightning);
    expect(ring()!.asArray()).toEqual([1, 0.45, 0.1]);
    expect(ring("none")!.asArray()).toEqual([1, 0.45, 0.1]);
  });

  it("el Grito de guerra es siempre dorado, con cualquier naturaleza", () => {
    const ring = (n: "fire" | "ice" | "lightning" | "none") => {
      const step = abilityTimeline("warcry", 1, n).find((s) => s.kind === "ring");
      return step?.kind === "ring" ? step.color : undefined;
    };
    for (const n of ["ice", "fire", "lightning", "none"] as const) expect(ring(n)!.asArray(), n).toEqual([1, 0.78, 0.25]);
  });

  it("todas las habilidades con naturaleza terminan sin mallas, partículas ni texturas huérfanas", () => {
    const { scene, fx, meshes0 } = setup();
    for (const nature of ["fire", "ice", "lightning"] as const) {
      for (const id of ["whirlwind", "kick", "warcry", "slam", "thrust"] as const) {
        fx.play(id, AT, 3, 0, nature);
        for (let t = 0; t <= abilityFxDurationMs(id, 3); t += 50) fx.update(t);
        fx.update(abilityFxDurationMs(id, 3) + 100);
      }
    }
    expect(scene.meshes.length).toBe(meshes0);
    expect(scene.particleSystems.length).toBe(0);
    const textures = scene.textures.length;
    fx.dispose();
    expect(scene.textures.length).toBeLessThan(textures);
  });
});
