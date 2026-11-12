import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Nature } from "@roguelike/shared";
import { NATURE_COLORS } from "./natureLooks";

/** Color de la magia sin elemento: el del bastón sin naturaleza y el de los hechizos arcanos. */
export const ARCANE_COLOR = new Color3(0.72, 0.45, 1);

/** Color con que se dibuja la magia de esa naturaleza (arcano si no tiene). */
export function spellColor(nature: Nature): Color3 {
  return nature === "none" ? ARCANE_COLOR : NATURE_COLORS[nature];
}

/** Medidas del bastón (m): el origen es donde se agarra y la vara va por +Y, con el orbe arriba. */
const SHAFT_LENGTH = 1.55;
const SHAFT_BELOW_HAND = 0.95;
const ORB_DIAMETER = 0.2;

export interface StaffMesh {
  root: TransformNode;
  /** la vara y el aro (lo que se tiñe con el brillo del tier); el orbe no cuelga de aquí */
  shaft: TransformNode;
  /** cambia el color del orbe al de la naturaleza */
  setNature(nature: Nature): void;
}

interface StaffMaterials {
  wood: StandardMaterial;
  orbs: Map<Nature, StandardMaterial>;
}

/** Materiales compartidos por escena: la madera y un orbe emisivo por naturaleza. */
const materials = new WeakMap<Scene, StaffMaterials>();

function materialsOf(scene: Scene): StaffMaterials {
  let m = materials.get(scene);
  if (!m) {
    const wood = new StandardMaterial("staffWood", scene);
    // Sin luces: bajo la antorcha del jugador, tan cerca, la madera se quemaba a naranja vivo.
    wood.diffuseColor = Color3.Black();
    wood.specularColor = Color3.Black();
    wood.emissiveColor = new Color3(0.3, 0.19, 0.11);
    wood.disableLighting = true;
    m = { wood, orbs: new Map() };
    materials.set(scene, m);
    scene.onDisposeObservable.addOnce(() => materials.delete(scene));
  }
  return m;
}

function orbMaterial(scene: Scene, nature: Nature): StandardMaterial {
  const { orbs } = materialsOf(scene);
  let mat = orbs.get(nature);
  if (!mat) {
    const color = spellColor(nature);
    mat = new StandardMaterial(`staffOrb-${nature}`, scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = color.clone();
    mat.disableLighting = true;
    mat.fogEnabled = false;
    orbs.set(nature, mat);
  }
  return mat;
}

/**
 * Bastón hecho por código (no hay modelo): una vara que se afina hacia abajo, un aro en la punta y, dentro, un
 * orbe que brilla con el color de la naturaleza. Las mallas cuelgan de `root`; los materiales son de la escena.
 */
export function buildStaff(scene: Scene, name: string, nature: Nature): StaffMesh {
  const mats = materialsOf(scene);
  const root = new TransformNode(`staff-${name}`, scene);
  const shaft = new TransformNode(`staffShaft-${name}`, scene);
  shaft.parent = root;
  const top = SHAFT_LENGTH - SHAFT_BELOW_HAND;
  const pole = CreateCylinder(`staffPole-${name}`, { height: SHAFT_LENGTH, diameterTop: 0.075, diameterBottom: 0.05, tessellation: 8 }, scene);
  pole.position.y = top - SHAFT_LENGTH / 2;
  const ring = CreateTorus(`staffRing-${name}`, { diameter: ORB_DIAMETER + 0.06, thickness: 0.04, tessellation: 18 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = top + ORB_DIAMETER / 2;
  for (const m of [pole, ring] as Mesh[]) {
    m.material = mats.wood;
    m.parent = shaft;
    m.isPickable = false;
  }
  const orb = CreateSphere(`staffOrb-${name}`, { diameter: ORB_DIAMETER, segments: 10 }, scene);
  orb.position.y = top + ORB_DIAMETER / 2;
  orb.parent = root;
  orb.isPickable = false;
  orb.material = orbMaterial(scene, nature);
  return {
    root,
    shaft,
    setNature(n) {
      orb.material = orbMaterial(scene, n);
    },
  };
}
