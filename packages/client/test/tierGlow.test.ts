import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { TIERS } from "@roguelike/shared";
import { NATURE_COLORS } from "../src/render/natureLooks";
import { applyTierGlow, GLOW_STRENGTH } from "../src/render/tierGlow";

function weapon(scene: Scene, blade: PBRMaterial, hilt: StandardMaterial) {
  const root = new TransformNode("root", scene);
  const a = new Mesh("blade", scene);
  a.parent = root;
  a.material = blade;
  const b = new Mesh("hilt", scene);
  b.parent = a;
  b.material = hilt;
  return { root, a, b };
}

describe("brillo por tier", () => {
  it("tier 1 no toca nada", () => {
    const scene = new Scene(new NullEngine());
    const blade = new PBRMaterial("blade", scene);
    const hilt = new StandardMaterial("hilt", scene);
    const w = weapon(scene, blade, hilt);
    applyTierGlow(w.root, 1);
    expect(w.a.material).toBe(blade);
    expect(w.b.material).toBe(hilt);
  });

  it("tier ≥ 2 tiñe el emisivo con un clon cacheado por (material, tier), sin tocar el original", () => {
    const scene = new Scene(new NullEngine());
    const blade = new PBRMaterial("blade", scene);
    const hilt = new StandardMaterial("hilt", scene);
    const w1 = weapon(scene, blade, hilt);
    const w2 = weapon(scene, blade, hilt);
    applyTierGlow(w1.root, 2);
    applyTierGlow(w2.root, 2);
    // El brillo es el color del tier atenuado: la hoja conserva su sombreado.
    const [r, g, b] = TIERS[2].glow!.map((c) => c * GLOW_STRENGTH);
    const tinted = w1.a.material as PBRMaterial;
    expect(tinted).not.toBe(blade);
    expect(tinted.emissiveColor.r).toBeCloseTo(r!);
    expect(tinted.emissiveColor.g).toBeCloseTo(g!);
    expect(tinted.emissiveColor.b).toBeCloseTo(b!);
    expect((w1.b.material as StandardMaterial).emissiveColor.equalsWithEpsilon(tinted.emissiveColor)).toBe(true);
    expect(blade.emissiveColor.asArray()).toEqual([0, 0, 0]);
    expect(w2.a.material).toBe(tinted);
    expect(w2.b.material).toBe(w1.b.material);

    // Volver a teñir parte del original: tier 3 y de vuelta a 1.
    applyTierGlow(w1.root, 3);
    expect((w1.a.material as PBRMaterial).emissiveColor.asArray().map((c) => Math.round(c * 1000) / 1000)).toEqual(
      TIERS[3].glow!.map((c) => Math.round(c * GLOW_STRENGTH * 1000) / 1000),
    );
    applyTierGlow(w1.root, 2);
    expect(w1.a.material).toBe(tinted);
    applyTierGlow(w1.root, 1);
    expect(w1.a.material).toBe(blade);
  });

  it("tier 4 tiñe de dorado con la misma fuerza que los demás", () => {
    const scene = new Scene(new NullEngine());
    const blade = new PBRMaterial("blade", scene);
    const w = weapon(scene, blade, new StandardMaterial("hilt", scene));
    applyTierGlow(w.root, 4);
    const [r, g, b] = TIERS[4].glow!.map((c) => c * GLOW_STRENGTH);
    expect((w.a.material as PBRMaterial).emissiveColor.asArray()).toEqual([r, g, b]);
  });

  it("la naturaleza se suma al brillo del tier, con un clon por (material, tier, naturaleza)", () => {
    const scene = new Scene(new NullEngine());
    const blade = new PBRMaterial("blade", scene);
    const w1 = weapon(scene, blade, new StandardMaterial("hilt", scene));
    const w2 = weapon(scene, blade, new StandardMaterial("hilt", scene));
    applyTierGlow(w1.root, 1, "ice"); // sin brillo de tier: solo el del hielo
    applyTierGlow(w2.root, 1, "ice");
    const ice = w1.a.material as PBRMaterial;
    expect(ice).not.toBe(blade);
    expect(w2.a.material).toBe(ice);
    expect(ice.emissiveColor.r).toBeCloseTo(NATURE_COLORS.ice.r * GLOW_STRENGTH);
    expect(ice.emissiveColor.b).toBeCloseTo(NATURE_COLORS.ice.b * GLOW_STRENGTH);

    applyTierGlow(w1.root, 3, "fire");
    const sum = (w1.a.material as PBRMaterial).emissiveColor;
    expect(sum.r).toBeCloseTo((TIERS[3].glow![0] + NATURE_COLORS.fire.r) * GLOW_STRENGTH);
    expect(sum.g).toBeCloseTo((TIERS[3].glow![1] + NATURE_COLORS.fire.g) * GLOW_STRENGTH);

    applyTierGlow(w1.root, 1, "none");
    expect(w1.a.material).toBe(blade);
  });
});
