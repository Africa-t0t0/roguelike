import { describe, expect, it } from "vitest";
import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { AnimLibrary, boneKey } from "../src/render/animLibrary";

describe("boneKey", () => {
  it("quita el prefijo de Mixamo y pasa a minúsculas", () => {
    expect(boneKey("mixamorig:RightHand")).toBe("righthand");
    expect(boneKey("mixamorig1:Hips")).toBe("hips");
    expect(boneKey("Spine")).toBe("spine");
  });
});

function fakeClip(scene: Scene, clipId: string, bones: string[]): AnimationGroup {
  const group = new AnimationGroup(clipId, scene);
  for (const bone of bones) {
    const node = new TransformNode(bone, scene);
    const anim = new Animation(`${bone}-pos`, "position.y", 30, Animation.ANIMATIONTYPE_FLOAT);
    anim.setKeys([
      { frame: 0, value: 0 },
      { frame: 30, value: 1 },
    ]);
    group.addTargetedAnimation(anim, node);
  }
  return group;
}

function nodesOf(scene: Scene, names: string[]): Map<string, TransformNode> {
  return new Map(names.map((n) => [boneKey(n), new TransformNode(n, scene)]));
}

describe("AnimLibrary.bind (Foco 5: huesos que faltan)", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const lib = new AnimLibrary(scene);
  lib.add(fakeClip(scene, "fake", ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:HeadTop_End"]));

  it("ignora el hueso que falta y conserva los demás", () => {
    const nodes = nodesOf(scene, ["mixamorig1:Hips", "mixamorig1:Spine"]);
    const group = lib.bind("fake", nodes, "fake#a");
    expect(group).not.toBeNull();
    expect(group!.targetedAnimations).toHaveLength(2);
    expect(group!.from).toBe(0);
    expect(group!.to).toBe(30);
    expect(lib.length("fake")).toBeCloseTo(1);
    expect(() => group!.start(true)).not.toThrow();
    group!.stop();
  });

  it("devuelve null si ningún hueso calza, o si el clip no existe", () => {
    expect(lib.bind("fake", nodesOf(scene, ["Root", "Tail"]), "fake#b")).toBeNull();
    expect(lib.bind("nope", nodesOf(scene, ["mixamorig1:Hips"]), "nope#c")).toBeNull();
    expect(lib.length("nope")).toBe(0);
  });
});

describe("AnimLibrary.bind: traslación de la cadera", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const lib = new AnimLibrary(scene);
  const src = new AnimationGroup("walk", scene);
  const hipsSrc = new TransformNode("mixamorig:Hips", scene);
  const anim = new Animation("hips-pos", "position", 30, Animation.ANIMATIONTYPE_VECTOR3);
  anim.setKeys([
    { frame: 0, value: new Vector3(0, 1, 0) },
    { frame: 15, value: new Vector3(1.5, 1.2, 0.3) },
    { frame: 30, value: new Vector3(3, 1, -2) },
  ]);
  src.addTargetedAnimation(anim, hipsSrc);
  lib.add(src);

  const keysFor = (restY: number) => {
    const hips = new TransformNode("mixamorig1:Hips", scene);
    hips.position.y = restY;
    const g = lib.bind("walk", new Map([["hips", hips]]), "walk#x")!;
    return g.targetedAnimations[0]!.animation.getKeys().map((k) => (k.value as Vector3).asArray().map((v) => +v.toFixed(4) || 0));
  };

  it("quita el avance en el plano (en el sitio) y conserva el vaivén y la altura", () => {
    expect(keysFor(1.1)).toEqual([
      [0, 1, 0],
      [0, 1.2, 1.3],
      [0, 1, 0],
    ]);
  });

  it("con otras unidades (cadera 100 veces más alta) reescala la traslación", () => {
    expect(keysFor(100)).toEqual([
      [0, 100, 0],
      [0, 120, 130],
      [0, 100, 0],
    ]);
  });
});
