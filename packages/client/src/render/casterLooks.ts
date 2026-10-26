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

/** Original → clones teñidos por clave de tinte; y de cada clon, su original (para no clonar clones). */
const clones = new WeakMap<Material, Map<string, Material>>();
const sourceOf = new WeakMap<Material, Material>();

function tinted(source: Material, key: string, color: Color3, strength: number): Material {
  if (!(source instanceof MultiMaterial || hasEmissive(source))) return source;
  let byKey = clones.get(source);
  if (!byKey) clones.set(source, (byKey = new Map()));
  let clone = byKey.get(key);
  if (!clone) {
    if (source instanceof MultiMaterial) {
      const multi = new MultiMaterial(`${source.name}-${key}`, source.getScene());
      multi.subMaterials = source.subMaterials.map((sub) => (sub ? tinted(sub, key, color, strength) : sub));
      clone = multi;
    } else {
      clone = source.clone(`${source.name}-${key}`) ?? source;
      if (clone !== source && hasEmissive(clone)) clone.emissiveColor = color.scale(strength);
    }
    byKey.set(key, clone);
    if (clone !== source) sourceOf.set(clone, source);
  }
  return clone;
}

/** Las mallas del arma (cuelgan de un nodo `grip#…`) conservan su brillo de tier: el tinte es del cuerpo. */
function isWeaponPart(mesh: TransformNode): boolean {
  for (let n = mesh.parent; n; n = n.parent) if (n.name.startsWith("grip#")) return true;
  return false;
}

/** Marca una malla que cuelga del personaje pero no es su cuerpo (barra, aros, aura, rótulo…): `applyTint` la salta. */
export function markNoTint(mesh: TransformNode): void {
  mesh.metadata = { ...(mesh.metadata as object | null), noTint: true };
}

/**
 * Tiñe el emisivo de las mallas del cuerpo bajo `root` con `color` × `strength` (sin luces: solo material), o
 * con `tint = null` las devuelve a su material original. Cada material se clona como mucho una vez por
 * (material, clave) y se reutiliza entre instancias; cambiar de tinte siempre parte del original.
 */
export function applyTint(root: TransformNode, tint: { key: string; color: Color3; strength: number } | null): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.getClassName() === "InstancedMesh" || isWeaponPart(mesh) || (mesh.metadata as { noTint?: boolean } | null)?.noTint) continue;
    const current = mesh.material;
    if (!current) continue;
    const original = sourceOf.get(current) ?? current;
    const next = tint ? tinted(original, tint.key, tint.color, tint.strength) : original;
    if (next !== current) mesh.material = next;
  }
}

/** Tinte del hechicero (color de su tipo) sobre el cuerpo. */
export function applyCasterTint(root: TransformNode, kind: CasterKind): void {
  applyTint(root, { key: kind, ...casterTint(kind) });
}
