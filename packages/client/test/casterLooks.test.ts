import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { NATURE_COLORS } from "../src/render/natureLooks";
import { applyBodyGlow, applyTint, bodyGlow, CASTER_COLORS, casterTint, chargeScale, markNoTint } from "../src/render/casterLooks";

describe("aspecto de los hechiceros", () => {
  it("chargeScale crece de 0,15 a 1 y se acota", () => {
    expect(chargeScale(0, 0.7)).toBeCloseTo(0.15, 6);
    expect(chargeScale(0.7, 0.7)).toBeCloseTo(1, 6);
    expect(chargeScale(2, 0.7)).toBe(1);
    expect(chargeScale(-1, 0.7)).toBeCloseTo(0.15, 6);
    expect(chargeScale(0.35, 0.7)).toBeCloseTo(0.575, 6);
  });

  it("CASTER_COLORS tiene los tres hechiceros", () => {
    expect(Object.keys(CASTER_COLORS).sort()).toEqual(["mage", "pyromancer", "stormcaller"]);
    expect(CASTER_COLORS.pyromancer.r).toBe(1);
  });

  it("el invocador usa el color del rayo", () => {
    expect(CASTER_COLORS.stormcaller.asArray()).toEqual([1, 0.92, 0.4]);
  });

  it("casterTint usa el color del tipo con fuerza 0,6", () => {
    expect(casterTint("stormcaller")).toEqual({ color: CASTER_COLORS.stormcaller, strength: 0.6 });
  });
});

describe("applyTint", () => {
  it("tiñe el cuerpo pero salta lo marcado con markNoTint (aura, rótulo, barra)", () => {
    const scene = new Scene(new NullEngine());
    const root = new TransformNode("root", scene);
    const mat = (name: string) => {
      const m = new StandardMaterial(name, scene);
      m.emissiveColor = Color3.Black();
      return m;
    };
    const body = CreateBox("body", {}, scene);
    body.material = mat("body");
    body.parent = root;
    const aura = CreateBox("aura", {}, scene);
    aura.material = mat("aura");
    aura.parent = root;
    markNoTint(aura);
    applyTint(root, { key: "t", color: new Color3(1, 0.5, 0), strength: 0.2 });
    expect((body.material as StandardMaterial).emissiveColor.asArray()).toEqual([0.2, 0.1, 0].map((v) => expect.closeTo(v, 6)));
    expect(aura.material!.name).toBe("aura");
    applyTint(root, null);
    expect(body.material!.name).toBe("body");
    scene.dispose();
  });
});

describe("brillo del cuerpo", () => {
  it("el contorno es solo del élite y sobrevive a los estados; la capa manda congelado > ralentizado > élite", () => {
    expect(bodyGlow("base", false, "none")).toEqual({ outline: null, overlay: null });
    const base = bodyGlow("base", true, "fire");
    expect(base.outline?.color).toBe(NATURE_COLORS.fire);
    expect(base.overlay).toEqual({ color: NATURE_COLORS.fire, alpha: 0.18 });
    const slow = bodyGlow("slowed", true, "fire");
    expect(slow.outline).toEqual(base.outline);
    expect(slow.overlay?.color.asArray()).toEqual([0.55, 0.95, 1]);
    expect(slow.overlay?.alpha).toBe(0.25);
    expect(bodyGlow("frozen", true, "fire").overlay?.alpha).toBe(0.55);
    expect(bodyGlow("frozen", false, "none").outline).toBeNull();
  });

  it("el élite sin naturaleza brilla en dorado", () => {
    expect(bodyGlow("base", true, "none").outline?.color.asArray()).toEqual([1, 0.8, 0.25]);
  });

  it("applyBodyGlow marca el cuerpo y salta las armas y lo noTint; quitarlo lo apaga", () => {
    const scene = new Scene(new NullEngine());
    const root = new TransformNode("root", scene);
    const body = CreateBox("body", { size: 1 }, scene);
    body.parent = root;
    const grip = new TransformNode("grip#sword", scene);
    grip.parent = root;
    const blade = CreateBox("blade", { size: 1 }, scene);
    blade.parent = grip;
    const bar = CreateBox("bar", { size: 1 }, scene);
    bar.parent = root;
    markNoTint(bar);
    applyBodyGlow(root, bodyGlow("base", true, "ice"), 50);
    expect(body.renderOutline).toBe(true);
    expect(body.outlineWidth).toBeCloseTo(0.01 * 50, 6);
    expect(body.renderOverlay).toBe(true);
    expect(body.overlayAlpha).toBe(0.18);
    for (const m of [blade, bar]) {
      expect(m.renderOutline).toBeFalsy();
      expect(m.renderOverlay).toBeFalsy();
    }
    applyBodyGlow(root, bodyGlow("base", false, "none"), 50);
    expect(body.renderOutline).toBe(false);
    expect(body.renderOverlay).toBe(false);
  });
});
