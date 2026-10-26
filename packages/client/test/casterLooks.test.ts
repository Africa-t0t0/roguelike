import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { applyTint, CASTER_COLORS, casterTint, chargeScale, markNoTint } from "../src/render/casterLooks";

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
