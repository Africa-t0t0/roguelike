import type { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { TIERS, type WeaponTier } from "@roguelike/shared";

/** Material con color emisivo (StandardMaterial, PBRMaterial…). */
type Emissive = Material & { emissiveColor: Color3 };

const hasEmissive = (m: Material): m is Emissive => (m as { emissiveColor?: unknown }).emissiveColor instanceof Color3;

/** Original → clones teñidos por tier; y de cada clon, su original (para volver a teñir o quitar el tinte). */
const clones = new WeakMap<Material, Map<WeaponTier, Material>>();
const sourceOf = new WeakMap<Material, Material>();

function tinted(source: Material, tier: WeaponTier): Material {
  const glow = TIERS[tier].glow;
  if (!glow || !(source instanceof MultiMaterial || hasEmissive(source))) return source;
  let byTier = clones.get(source);
  if (!byTier) clones.set(source, (byTier = new Map()));
  let clone = byTier.get(tier);
  if (!clone) {
    if (source instanceof MultiMaterial) {
      const multi = new MultiMaterial(`${source.name}-tier${tier}`, source.getScene());
      multi.subMaterials = source.subMaterials.map((sub) => (sub ? tinted(sub, tier) : sub));
      clone = multi;
    } else {
      clone = source.clone(`${source.name}-tier${tier}`) ?? source;
      if (clone !== source && hasEmissive(clone)) clone.emissiveColor = new Color3(glow[0], glow[1], glow[2]);
    }
    byTier.set(tier, clone);
    if (clone !== source) sourceOf.set(clone, source);
  }
  return clone;
}

/**
 * Tiñe el color emisivo de las mallas bajo `root` con `TIERS[tier].glow` (sin luces: solo material). Cada
 * material se clona como mucho una vez por (material, tier) y se reutiliza; tier 1 deja el material original.
 * Se puede volver a llamar sobre el mismo nodo con otro tier. Los clones viven lo que la escena.
 */
export function applyTierGlow(root: TransformNode, tier: WeaponTier): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.getClassName() === "InstancedMesh") continue; // usa el material de su malla fuente
    const current = mesh.material;
    if (!current) continue;
    const source = sourceOf.get(current) ?? current;
    const next = tinted(source, tier);
    if (next !== current) mesh.material = next;
  }
}
