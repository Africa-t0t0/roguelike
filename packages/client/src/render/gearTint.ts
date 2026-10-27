import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TIERS, type GearSlot, type WeaponTier } from "@roguelike/shared";
import { boneKey } from "./animLibrary";

/** Orden de las regiones en el atributo (x, y, z, w) y en los uniformes `gearTint0..3`. */
export const TINT_SLOTS: readonly GearSlot[] = ["helmet", "chest", "gloves", "boots"];

/**
 * Región del cuerpo (ranura de equipo) de un hueso de Mixamo, por su nombre; null = ninguna (muslos).
 * Casco: cuello y cabeza. Pechera: cadera, columna, hombros y brazos (con hombreras). Guantes: antebrazos, manos y
 * dedos. Botas: espinillas, pies y puntas.
 */
export function boneRegion(name: string): GearSlot | null {
  const k = boneKey(name);
  if (k.startsWith("neck") || k.startsWith("head")) return "helmet";
  if (k.includes("forearm") || k.includes("hand")) return "gloves";
  if (k.includes("upleg")) return null;
  if (k.endsWith("leg") || k.includes("foot") || k.includes("toe")) return "boots";
  if (k.startsWith("hips") || k.startsWith("spine") || k.endsWith("shoulder") || k.endsWith("arm")) return "chest";
  return null;
}

/** Fuerza del tinte por rareza (0 = sin tinte): tier 2 sutil, 3 claro, 4 fuerte. */
export function tintStrength(tier: WeaponTier): number {
  switch (tier) {
    case 1: return 0;
    case 2: return 0.45;
    case 3: return 0.75;
    default: return 1;
  }
}

/** Color (r, g, b) y fuerza del tinte de una pieza; null si no tiñe (tier 1). */
export function tintOf(tier: WeaponTier): [number, number, number, number] | null {
  const glow = TIERS[tier].glow;
  const s = tintStrength(tier);
  return glow && s > 0 ? [glow[0], glow[1], glow[2], s] : null;
}

/**
 * Peso de cada región por vértice (vec4: casco, pechera, guantes, botas) = Σ pesos de piel de sus huesos. Los índices de
 * hueso de la malla son los de la matriz del esqueleto (`bone.getIndex()`, la articulación del glTF), no la posición
 * en `skeleton.bones`. null si la malla no trae los datos de piel en la CPU.
 */
export function regionWeights(mesh: AbstractMesh, skeleton: Skeleton): Float32Array | null {
  const n = mesh.getTotalVertices();
  const byIndex: number[] = [];
  for (const bone of skeleton.bones) {
    const slot = boneRegion(bone.name);
    byIndex[bone.getIndex()] = slot ? TINT_SLOTS.indexOf(slot) : -1;
  }
  const out = new Float32Array(n * 4);
  const sets: [string, string][] = [
    [VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesWeightsKind],
    [VertexBuffer.MatricesIndicesExtraKind, VertexBuffer.MatricesWeightsExtraKind],
  ];
  let any = false;
  for (const [ik, wk] of sets) {
    const idx = mesh.getVerticesData(ik);
    const w = mesh.getVerticesData(wk);
    if (!idx || !w || idx.length < n * 4 || w.length < n * 4) continue;
    any = true;
    for (let i = 0; i < n * 4; i++) {
      const r = byIndex[idx[i]!] ?? -1;
      if (r >= 0) out[(i & ~3) + r]! += w[i]!;
    }
  }
  return any ? out : null;
}

/** Atributo de vértice con los pesos de región (en la geometría, compartida por los clones del modelo). */
export const REGION_ATTRIBUTE = "gearRegion";

const VERTEX_DEFINITIONS = `#ifdef GEARTINT
attribute vec4 ${REGION_ATTRIBUTE};
varying vec4 vGearRegion;
#endif`;
const VERTEX_MAIN_END = `#ifdef GEARTINT
vGearRegion=${REGION_ATTRIBUTE};
#endif`;
const FRAGMENT_DEFINITIONS = `#ifdef GEARTINT
varying vec4 vGearRegion;
#endif`;
const FRAGMENT_UNIFORMS = `#ifdef GEARTINT
uniform vec4 gearTint0;
uniform vec4 gearTint1;
uniform vec4 gearTint2;
uniform vec4 gearTint3;
#endif`;
/**
 * Tras el procesado de imagen (como el overlay de los élites, que se dibuja encima): mezcla hacia el color de la pieza
 * (hasta 0,4 con fuerza 1) y suma un borde de Fresnel (más brillante de canto: el contorno).
 */
const fragmentBeforeFragColor = (out: string) => `#ifdef GEARTINT
{
vec4 gw=clamp(vGearRegion,0.0,1.0);
vec4 gs=vec4(gearTint0.a,gearTint1.a,gearTint2.a,gearTint3.a)*gw;
vec3 gc=gearTint0.rgb*gs.x+gearTint1.rgb*gs.y+gearTint2.rgb*gs.z+gearTint3.rgb*gs.w;
float gsum=gs.x+gs.y+gs.z+gs.w;
if (gsum>0.001) {
float rim=pow(1.0-clamp(dot(normalW,viewDirectionW),0.0,1.0),2.5);
${out}.rgb=mix(${out}.rgb,gc/gsum,clamp(gsum*0.4,0.0,0.4))+gc*(0.08+rim*1.6);
}
}
#endif`;

/**
 * Plugin de material (PBR o Standard, GLSL) que tiñe cada región del cuerpo con el color de su pieza. Se activa una
 * vez y se apaga con el define GEARTINT (apagado, el shader es el de siempre); los colores son uniformes (cambiarlos no
 * recompila).
 */
export class GearTintPlugin extends MaterialPluginBase {
  /** (r, g, b, fuerza) por región, en el orden de `TINT_SLOTS` */
  readonly tints = new Float32Array(16);
  private enabled = false;

  constructor(material: Material) {
    super(material, "GearTint", 200, { GEARTINT: false }, true, true);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  set isEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.markAllDefinesAsDirty();
  }

  override getClassName(): string {
    return "GearTintPlugin";
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines, _scene: unknown, mesh: AbstractMesh): void {
    defines["GEARTINT"] = this.enabled && mesh.isVerticesDataPresent(REGION_ATTRIBUTE);
  }

  override getAttributes(attributes: string[], _scene: unknown, mesh: AbstractMesh): void {
    if (this.enabled && mesh.isVerticesDataPresent(REGION_ATTRIBUTE)) attributes.push(REGION_ATTRIBUTE);
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [0, 1, 2, 3].map((i) => ({ name: `gearTint${i}`, size: 4, type: "vec4" })),
      fragment: FRAGMENT_UNIFORMS,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    if (!this.enabled) return;
    const t = this.tints;
    for (let i = 0; i < 4; i++) uniformBuffer.updateFloat4(`gearTint${i}`, t[i * 4]!, t[i * 4 + 1]!, t[i * 4 + 2]!, t[i * 4 + 3]!);
  }

  override getCustomCode(shaderType: string): { [point: string]: string } | null {
    if (shaderType === "vertex") return { CUSTOM_VERTEX_DEFINITIONS: VERTEX_DEFINITIONS, CUSTOM_VERTEX_MAIN_END: VERTEX_MAIN_END };
    // La variable del color final se llama distinto en cada shader.
    const out = this._material.getClassName() === "StandardMaterial" ? "color" : "finalColor";
    return { CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DEFINITIONS, CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: fragmentBeforeFragColor(out) };
  }
}

/**
 * Tinte del equipo sobre el cuerpo de UN personaje: clona una vez el material de cada malla con esqueleto (el del
 * héroe es uno solo para todo el cuerpo), le pone `GearTintPlugin` y solo cambia uniformes al cambiar el equipo.
 * `dispose` devuelve los materiales originales y libera los clones con sus copias de textura (las del modelo quedan).
 */
export class GearTint {
  private readonly entries: { mesh: AbstractMesh; original: Material; clone: Material; plugin: GearTintPlugin }[] = [];
  private key = "";

  constructor(meshes: readonly AbstractMesh[]) {
    for (const mesh of meshes) {
      const original = mesh.material;
      const skeleton = mesh.skeleton;
      if (!original || !skeleton || mesh.getClassName() === "InstancedMesh") continue;
      if (!mesh.isVerticesDataPresent(REGION_ATTRIBUTE)) {
        const data = regionWeights(mesh, skeleton);
        if (!data) continue;
        mesh.setVerticesData(REGION_ATTRIBUTE, data, false, 4);
      }
      const clone = original.clone(`${original.name}-gear`);
      if (!clone) continue;
      const plugin = new GearTintPlugin(clone);
      mesh.material = clone;
      this.entries.push({ mesh, original, clone, plugin });
    }
  }

  /** Pone el color de la rareza de cada pieza en su región; sin piezas que tiñan, apaga el plugin. */
  set(gear: Partial<Record<GearSlot, { tier: WeaponTier }>>): void {
    const key = TINT_SLOTS.map((s) => gear[s]?.tier ?? 0).join("");
    if (key === this.key) return;
    this.key = key;
    for (const e of this.entries) {
      const t = e.plugin.tints;
      t.fill(0);
      let any = false;
      for (let i = 0; i < TINT_SLOTS.length; i++) {
        const g = gear[TINT_SLOTS[i]!];
        const tint = g ? tintOf(g.tier) : null;
        if (!tint) continue;
        t.set(tint, i * 4);
        any = true;
      }
      e.plugin.isEnabled = any;
    }
  }

  dispose(): void {
    for (const e of this.entries) {
      if (e.mesh.material === e.clone) e.mesh.material = e.original;
      // `clone` copia las texturas (objetos nuevos sobre la misma textura de GPU): se liberan las copias, no las del modelo.
      const own = new Set(e.original.getActiveTextures());
      for (const t of e.clone.getActiveTextures()) if (!own.has(t)) t.dispose();
      e.clone.dispose(false, false);
    }
    this.entries.length = 0;
  }
}
