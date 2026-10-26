import type { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { CasterKind } from "@roguelike/shared";

/** Color de cada hechicero: tinte del cuerpo, aura, esfera de carga y proyectiles. */
export const CASTER_COLORS: Record<CasterKind, Color3> = {
  mage: new Color3(0.3, 1, 0.55),
  pyromancer: new Color3(1, 0.45, 0.1),
  stormcaller: new Color3(1, 0.92, 0.4), // el color del rayo (antes celeste, que ahora es el del hielo)
};

const TINT_STRENGTH = 0.6;

/** Tinte emisivo suave del cuerpo del hechicero: color de su tipo y la fracción que va al emisivo. */
export function casterTint(kind: CasterKind): { color: Color3; strength: number } {
  return { color: CASTER_COLORS[kind], strength: TINT_STRENGTH };
}

const CHARGE_MIN = 0.15;

/** Tamaño de la esfera de carga (fracción del máximo): crece de 0,15 a 1 durante la preparación. */
export function chargeScale(aiTime: number, telegraphS: number): number {
  const f = telegraphS > 0 ? aiTime / telegraphS : 1;
  return CHARGE_MIN + (1 - CHARGE_MIN) * Math.min(1, Math.max(0, f));
}

type Emissive = Material & { emissiveColor: Color3 };
const hasEmissive = (m: Material): m is Emissive => (m as { emissiveColor?: unknown }).emissiveColor instanceof Color3;

/** Original → clones teñidos por tipo; y de cada clon, su original (para no clonar clones). */
const clones = new WeakMap<Material, Map<CasterKind, Material>>();
const sourceOf = new WeakMap<Material, Material>();

function tinted(source: Material, kind: CasterKind): Material {
  if (!(source instanceof MultiMaterial || hasEmissive(source))) return source;
  let byKind = clones.get(source);
  if (!byKind) clones.set(source, (byKind = new Map()));
  let clone = byKind.get(kind);
  if (!clone) {
    if (source instanceof MultiMaterial) {
      const multi = new MultiMaterial(`${source.name}-${kind}`, source.getScene());
      multi.subMaterials = source.subMaterials.map((sub) => (sub ? tinted(sub, kind) : sub));
      clone = multi;
    } else {
      clone = source.clone(`${source.name}-${kind}`) ?? source;
      if (clone !== source && hasEmissive(clone)) {
        const { color, strength } = casterTint(kind);
        clone.emissiveColor = color.scale(strength);
      }
    }
    byKind.set(kind, clone);
    if (clone !== source) sourceOf.set(clone, source);
  }
  return clone;
}

/**
 * Tiñe el emisivo de las mallas bajo `root` con el color del hechicero (sin luces: solo material).
 * Cada material se clona como mucho una vez por (material, tipo) y se reutiliza entre instancias.
 */
export function applyCasterTint(root: TransformNode, kind: CasterKind): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.getClassName() === "InstancedMesh") continue;
    const current = mesh.material;
    if (!current) continue;
    const next = tinted(sourceOf.get(current) ?? current, kind);
    if (next !== current) mesh.material = next;
  }
}
