import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { generateDungeon } from "@roguelike/shared";
import { createTorches, LIGHTING, raiseLightBudget } from "../src/render/lighting";

function multi(scene: Scene) {
  const pbr = new PBRMaterial("pbr", scene);
  const std = new StandardMaterial("std", scene);
  const mm = new MultiMaterial("mm", scene);
  mm.subMaterials.push(pbr, null, std);
  return { pbr, std, mm };
}

describe("presupuesto de luces", () => {
  it("raiseLightBudget sube los submateriales de un MultiMaterial e ignora los vacíos", () => {
    const scene = new Scene(new NullEngine());
    const { pbr, std, mm } = multi(scene);
    expect(pbr.maxSimultaneousLights).toBe(4);
    raiseLightBudget(mm, 6);
    expect(pbr.maxSimultaneousLights).toBe(6);
    expect(std.maxSimultaneousLights).toBe(6);
    raiseLightBudget(null, 6); // no lanza
  });

  it("createTorches lo aplica al dibujar, también a materiales cambiados después", () => {
    const scene = new Scene(new NullEngine());
    const torches = createTorches(scene, generateDungeon(7, 1));
    const mesh = new Mesh("m", scene);
    const { pbr, std, mm } = multi(scene);
    mesh.material = mm;
    scene.onBeforeRenderObservable.notifyObservers(scene); // un cuadro, sin cámara
    expect(pbr.maxSimultaneousLights).toBe(LIGHTING.maxLightsPerMaterial);
    expect(std.maxSimultaneousLights).toBe(LIGHTING.maxLightsPerMaterial);
    const later = new PBRMaterial("later", scene);
    mesh.material = later;
    scene.onBeforeRenderObservable.notifyObservers(scene); // un cuadro, sin cámara
    expect(later.maxSimultaneousLights).toBe(LIGHTING.maxLightsPerMaterial);
    torches.dispose();
  });
});
