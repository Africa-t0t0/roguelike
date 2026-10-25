import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { OrbViews, smoothToward } from "../src/render/orbViews";

type Orb = { x: number; z: number; value: number };
const orbs = (entries: [string, Orb][]) => new Map(entries);

describe("orbes de XP", () => {
  it("smoothToward: lerp exponencial con τ", () => {
    expect(smoothToward(0, 10, 0, 0.05)).toBe(0);
    expect(smoothToward(0, 10, 0.05, 0.05)).toBeCloseTo(10 * (1 - Math.exp(-1)), 6);
    expect(smoothToward(0, 10, 10, 0.05)).toBeCloseTo(10, 6);
  });

  it("crea una esfera por orbe con un solo material, sin luces, y libera las que desaparecen", () => {
    const scene = new Scene(new NullEngine());
    const views = new OrbViews(scene);
    const meshesBefore = scene.meshes.length;
    views.sync(orbs([["o1", { x: 1, z: 2, value: 1 }], ["o2", { x: 3, z: 4, value: 4 }]]));
    expect(views.ids()).toEqual(["o1", "o2"]);
    expect(scene.meshes.length).toBe(meshesBefore + 2);
    const mats = new Set(scene.meshes.slice(meshesBefore).map((m) => m.material));
    expect(mats.size).toBe(1);
    expect(scene.lights.length).toBe(0);

    views.sync(orbs([["o2", { x: 3, z: 4, value: 4 }]]));
    expect(views.ids()).toEqual(["o2"]);
    expect(scene.meshes.length).toBe(meshesBefore + 1);
    views.dispose();
    expect(scene.meshes.length).toBe(meshesBefore);
  });

  it("un orbe nuevo nace en su posición y después se suaviza hacia la del estado", () => {
    const scene = new Scene(new NullEngine());
    const views = new OrbViews(scene);
    views.sync(orbs([["o1", { x: 1, z: 2, value: 1 }]]));
    views.render(0.016, 0);
    expect(views.positionOf("o1")).toEqual({ x: 1, z: 2 });
    views.sync(orbs([["o1", { x: 3, z: 2, value: 1 }]]));
    views.render(0.05, 50);
    const p = views.positionOf("o1")!;
    expect(p.x).toBeCloseTo(1 + 2 * (1 - Math.exp(-1)), 6);
    expect(p.z).toBe(2);
    views.dispose();
  });
});
