import type { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
// Registra el OutlineRenderer de la escena: sin él `renderOutline` y `renderOverlay` no dibujan nada.
import "@babylonjs/core/Rendering/outlineRenderer";
import { NATURE_COLORS } from "./natureLooks";
import type { CasterKind, Nature } from "@roguelike/shared";

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

/** Estado del cuerpo que tiñe el overlay: congelado manda sobre ralentizado, y ambos sobre el brillo de élite. */
export type BodyState = "base" | "slowed" | "frozen";

const ICE_OVERLAY = new Color3(0.55, 0.95, 1);
const ELITE_GOLD_GLOW = new Color3(1, 0.8, 0.25);
/** Grosor del contorno de élite, en metros: un borde fino. */
export const ELITE_OUTLINE_M = 0.01;
const ELITE_OVERLAY_ALPHA = 0.18;
const SLOW_OVERLAY_ALPHA = 0.25;
const FROZEN_OVERLAY_ALPHA = 0.55;

/** Brillo por-malla del cuerpo: contorno fino (élite) y capa de color semitransparente (élite, ralentizado, congelado). */
export interface BodyGlow {
  outline: { color: Color3; widthM: number } | null;
  overlay: { color: Color3; alpha: number } | null;
}

/**
 * Qué brillo lleva el cuerpo. El contorno es solo del élite (del color de su naturaleza, dorado si no tiene) y se
 * mantiene en cualquier estado; la capa la manda el estado: congelado > ralentizado > élite.
 */
export function bodyGlow(state: BodyState, elite: boolean, nature: Nature): BodyGlow {
  const eliteColor = nature === "none" ? ELITE_GOLD_GLOW : NATURE_COLORS[nature];
  const outline = elite ? { color: eliteColor, widthM: ELITE_OUTLINE_M } : null;
  if (state === "frozen") return { outline, overlay: { color: ICE_OVERLAY, alpha: FROZEN_OVERLAY_ALPHA } };
  if (state === "slowed") return { outline, overlay: { color: ICE_OVERLAY, alpha: SLOW_OVERLAY_ALPHA } };
  return { outline, overlay: elite ? { color: eliteColor, alpha: ELITE_OVERLAY_ALPHA } : null };
}

/**
 * Aplica `glow` a las mallas del cuerpo bajo `root` con `renderOutline` / `renderOverlay`, que no clonan
 * materiales y funcionan con mallas con esqueleto (el OutlineRenderer incluye los huesos). El grosor del contorno
 * está en unidades locales del modelo: `unitsPerMeter` convierte los metros. Saltan las armas (`grip#…`) y las marcadas `noTint`.
 */
export function applyBodyGlow(root: TransformNode, glow: BodyGlow, unitsPerMeter: number): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.getClassName() === "InstancedMesh" || isWeaponPart(mesh) || (mesh.metadata as { noTint?: boolean } | null)?.noTint) continue;
    if (glow.outline) {
      mesh.renderOutline = true;
      mesh.outlineColor = glow.outline.color;
      mesh.outlineWidth = glow.outline.widthM * unitsPerMeter;
    } else mesh.renderOutline = false;
    if (glow.overlay) {
      mesh.renderOverlay = true;
      mesh.overlayColor = glow.overlay.color;
      mesh.overlayAlpha = glow.overlay.alpha;
    } else mesh.renderOverlay = false;
  }
}

/** Tinte del hechicero (color de su tipo) sobre el cuerpo. */
export function applyCasterTint(root: TransformNode, kind: CasterKind): void {
  applyTint(root, { key: kind, ...casterTint(kind) });
}
