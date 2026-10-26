import type { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { TIERS, type Nature, type WeaponTier } from "@roguelike/shared";
import { NATURE_COLORS } from "./natureLooks";

/** Material con color emisivo (StandardMaterial, PBRMaterial…). */
type Emissive = Material & { emissiveColor: Color3 };

const hasEmissive = (m: Material): m is Emissive => (m as { emissiveColor?: unknown }).emissiveColor instanceof Color3;

/**
 * Fracción del color del tier que va al emisivo. Baja a propósito: las armas son PBR sin textura y de
 * albedo oscuro, y el emisivo (lineal) domina enseguida; así la hoja brilla sin perder su sombreado.
 */
export const GLOW_STRENGTH = 0.25;

/** Original → clones teñidos por (tier, naturaleza); y de cada clon, su original (para volver a teñir o quitar el tinte). */
const clones = new WeakMap<Material, Map<string, Material>>();
const sourceOf = new WeakMap<Material, Material>();

/** Emisivo del arma: el brillo del tier más el color de la naturaleza, ambos × `GLOW_STRENGTH`. */
function glowColor(tier: WeaponTier, nature: Nature): Color3 {
  const glow = TIERS[tier].glow;
  const c = glow ? new Color3(glow[0], glow[1], glow[2]) : new Color3(0, 0, 0);
  if (nature !== "none") c.addInPlace(NATURE_COLORS[nature]);
  return c.scale(GLOW_STRENGTH);
}

function tinted(source: Material, tier: WeaponTier, nature: Nature): Material {
  if ((!TIERS[tier].glow && nature === "none") || !(source instanceof MultiMaterial || hasEmissive(source))) return source;
  const key = `${tier}:${nature}`;
  const label = nature === "none" ? `${tier}` : `${tier}-${nature}`;
  let byTier = clones.get(source);
  if (!byTier) clones.set(source, (byTier = new Map()));
  let clone = byTier.get(key);
  if (!clone) {
    if (source instanceof MultiMaterial) {
      const multi = new MultiMaterial(`${source.name}-tier${label}`, source.getScene());
      multi.subMaterials = source.subMaterials.map((sub) => (sub ? tinted(sub, tier, nature) : sub));
      clone = multi;
    } else {
      clone = source.clone(`${source.name}-tier${label}`) ?? source;
      if (clone !== source && hasEmissive(clone)) clone.emissiveColor = glowColor(tier, nature);
    }
    byTier.set(key, clone);
    if (clone !== source) sourceOf.set(clone, source);
  }
  return clone;
}

/**
 * Tiñe el color emisivo de las mallas bajo `root` con `TIERS[tier].glow` × `GLOW_STRENGTH` (sin luces:
 * solo material), más el color de `nature` si la hay. Cada material se clona como mucho una vez por
 * (material, tier, naturaleza) y se reutiliza; tier 1 sin naturaleza deja el material original.
 * Se puede volver a llamar sobre el mismo nodo con otro tier. Los clones viven lo que la escena.
 */
export function applyTierGlow(root: TransformNode, tier: WeaponTier, nature: Nature = "none"): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.getClassName() === "InstancedMesh") continue; // usa el material de su malla fuente
    const current = mesh.material;
    if (!current) continue;
    const source = sourceOf.get(current) ?? current;
    const next = tinted(source, tier, nature);
    if (next !== current) mesh.material = next;
  }
}
