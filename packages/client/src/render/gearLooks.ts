import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import { RELICS, TIERS, type GearItem, type GearSlot, type Nature, type RelicId, type WeaponTier } from "@roguelike/shared";
import type { EquippedGear } from "../net/connection";
import { PARTICLE_SPEED, sparkTexture } from "./fxTextures";
import { NATURE_COLORS } from "./natureLooks";

/** Brillo de una pieza de equipo (partículas pegadas al hueso). */
export interface GearGlow {
  color: Color3;
  /** partículas por segundo y emisor */
  rate: number;
  /** tamaño máximo de la partícula (m) */
  size: number;
  /** tier 3+: se suman partículas grandes y tenues, a modo de halo */
  halo: boolean;
}

/** Dorado de la legendaria y de la reliquia. */
export const GOLD = new Color3(1, 0.8, 0.3);
const RELIC_RED = new Color3(0.9, 0.12, 0.1);

/** Tier 1 no brilla; 2 azul y suave, 3 violeta, denso y con halo, 4 dorado y más vistoso. Con elemento, el color es el del elemento. */
export function gearGlow(tier: WeaponTier, glow: string): GearGlow | null {
  if (tier === 1) return null;
  const t = TIERS[tier].glow!;
  const element = glow === "fire" || glow === "ice" || glow === "lightning" ? NATURE_COLORS[glow] : undefined;
  const color = element ?? new Color3(t[0], t[1], t[2]);
  switch (tier) {
    case 2: return { color, rate: 6, size: 0.05, halo: false };
    case 3: return { color, rate: 12, size: 0.07, halo: true };
    default: return { color, rate: 18, size: 0.09, halo: true };
  }
}

/** Elemento de la resistencia más alta de una pieza (como lo calcula el servidor para `glow`). */
export function itemGlow(item: GearItem): Nature {
  const res = { fire: 0, ice: 0, lightning: 0 };
  for (const e of item.stats) {
    if (e.stat === "resFire") res.fire += e.value;
    else if (e.stat === "resIce") res.ice += e.value;
    else if (e.stat === "resLightning") res.lightning += e.value;
  }
  let best: Nature = "none";
  let bestV = 0;
  for (const k of ["fire", "ice", "lightning"] as const) if (res[k] > bestV) [best, bestV] = [k, res[k]];
  return best;
}

/** Huesos (claves de `boneKey`) donde se pega cada ranura. */
export const GEAR_BONES: Record<GearSlot, readonly string[]> = {
  helmet: ["head"],
  chest: ["spine2"],
  gloves: ["lefthand", "righthand"],
  boots: ["leftfoot", "rightfoot"],
};

const SPARKLE_PERIOD_MS = 1500;
const SPARKLE_COUNT = 6;
const ORBIT_RAD_PER_S = 1.6;
const ORBIT_RADIUS_M = 0.5;
const ORBIT_HEIGHT = 0.6; // fracción de la altura del personaje (el pecho)
const GEM_SIZE_M = 0.07;
const HALO_SIZE_M = 0.3;

/** Texturas y materiales compartidos por todos los jugadores de una escena; se liberan con `dispose`. */
export class GearFxShared {
  readonly spark: DynamicTexture;
  readonly gemGold: StandardMaterial;
  readonly gemRed: StandardMaterial;
  readonly haloGold: StandardMaterial;

  constructor(scene: Scene) {
    this.spark = sparkTexture(scene, "gear-spark");
    const emissive = (name: string, c: Color3, alpha = 1) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = c;
      m.disableLighting = true;
      m.fogEnabled = false;
      m.alpha = alpha;
      return m;
    };
    this.gemGold = emissive("gear-gem-gold", GOLD);
    this.gemRed = emissive("gear-gem-red", RELIC_RED);
    this.haloGold = emissive("gear-halo", GOLD, 0.7);
    this.haloGold.emissiveTexture = this.spark;
    this.haloGold.opacityTexture = this.spark;
    this.haloGold.backFaceCulling = false;
  }

  dispose(): void {
    for (const m of [this.gemGold, this.gemRed, this.haloGold]) m.dispose();
    this.spark.dispose();
  }
}

/** Lo que `GearLooks` pide al personaje: huesos con su escala y un nodo del que colgar la reliquia. */
export interface BoneSource {
  boneMount(key: string): { node: TransformNode; perMeter: number } | undefined;
  readonly root: TransformNode;
  readonly height: number;
}

interface Emitter {
  node: Mesh;
  ps: ParticleSystem;
  /** colores del brillo, para volver a ellos tras un destello */
  base?: { c1: Color4; c2: Color4 };
}

interface Piece {
  key: string;
  legendary: boolean;
  emitters: Emitter[];
  /** instante (reloj de juego) del próximo destello; negativo = sin programar (−1 − índice de la ranura) */
  nextSparkMs: number;
  /** hay un destello pendiente de nacer: tras él se restauran los colores */
  sparkling: boolean;
}

interface RelicFx {
  id: RelicId;
  orbit: TransformNode;
  gem: Mesh;
  halo: Mesh;
}

/**
 * Brillo del equipo y reliquia de UN personaje: como mucho un emisor por hueso (casco 1, pechera 1, guantes 2,
 * botas 2 = 6), con la textura compartida; las legendarias lanzan un destello dorado cada ~1,5 s del reloj de juego.
 * La reliquia es una gema con halo que orbita el pecho (dorada, o roja con halo dorado si es de trade-off).
 */
export class GearLooks {
  private readonly pieces = new Map<GearSlot, Piece>();
  private relicFx: RelicFx | undefined;
  private paused = false;

  constructor(
    private readonly scene: Scene,
    private readonly shared: GearFxShared,
    private readonly character: BoneSource,
  ) {}

  /** Pone el equipo y la reliquia; solo rehace lo que cambió. */
  set(gear: Partial<Record<GearSlot, Pick<EquippedGear, "tier" | "legendary" | "glow">>>, relic: RelicId | null): void {
    for (const slot of Object.keys(GEAR_BONES) as GearSlot[]) {
      const g = gear[slot];
      const key = g ? `${g.tier}|${g.legendary}|${g.glow}` : "";
      const cur = this.pieces.get(slot);
      if (cur?.key === key) continue;
      if (cur) this.disposePiece(cur);
      this.pieces.delete(slot);
      if (g && (g.tier > 1 || g.legendary)) this.pieces.set(slot, this.buildPiece(slot, key, g));
    }
    if (this.relicFx?.id !== relic) {
      this.disposeRelic();
      if (relic) this.relicFx = this.buildRelic(relic);
    }
  }

  /** `nowMs`: reloj de juego (quieto en la pausa): destellos de las legendarias y órbita de la reliquia. */
  render(nowMs: number): void {
    for (const p of this.pieces.values()) {
      if (p.sparkling) {
        // Las partículas del destello ya nacieron con el color dorado: se vuelve al brillo normal.
        if (p.emitters.every((e) => e.ps.manualEmitCount <= 0)) {
          for (const e of p.emitters) this.restore(e);
          p.sparkling = false;
        }
      } else if (p.nextSparkMs < 0) {
        p.nextSparkMs = nowMs + SPARKLE_PERIOD_MS + (-1 - p.nextSparkMs) * (SPARKLE_PERIOD_MS / 4);
      } else if (p.legendary && nowMs >= p.nextSparkMs) {
        p.nextSparkMs = nowMs + SPARKLE_PERIOD_MS;
        p.sparkling = true;
        for (const e of p.emitters) {
          e.ps.color1 = new Color4(GOLD.r, GOLD.g, GOLD.b, 1);
          e.ps.color2 = new Color4(1, 1, 0.8, 0.9);
          e.ps.manualEmitCount = SPARKLE_COUNT;
        }
      }
    }
    const r = this.relicFx;
    if (r) {
      r.orbit.rotation.y = (nowMs / 1000) * ORBIT_RAD_PER_S;
      r.gem.rotation.y = (nowMs / 1000) * 2.4;
    }
  }

  /** Las partículas avanzan con los cuadros: se congelan en la pausa. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const p of this.pieces.values()) for (const e of p.emitters) e.ps.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  }

  dispose(): void {
    for (const p of this.pieces.values()) this.disposePiece(p);
    this.pieces.clear();
    this.disposeRelic();
  }

  private buildPiece(slot: GearSlot, key: string, g: Pick<EquippedGear, "tier" | "legendary" | "glow">): Piece {
    const glow = gearGlow(g.tier, g.glow);
    const emitters: Emitter[] = [];
    for (const bone of GEAR_BONES[slot]) {
      const mount = this.character.boneMount(bone);
      if (mount) emitters.push(this.buildEmitter(slot, bone, mount, glow));
    }
    // nextSparkMs < 0: el primer destello se programa en `render`, escalonado por ranura para que no destellen todas a la vez.
    return { key, legendary: g.legendary, emitters, nextSparkMs: -1 - Object.keys(GEAR_BONES).indexOf(slot), sparkling: false };
  }

  private buildEmitter(slot: GearSlot, bone: string, mount: { node: TransformNode; perMeter: number }, glow: GearGlow | null): Emitter {
    const node = new Mesh(`gear-emitter-${slot}-${bone}`, this.scene);
    node.parent = mount.node;
    node.scaling.setAll(mount.perMeter); // el hueso está escalado: tamaños y velocidades quedan en metros
    node.isPickable = false;
    const c = glow?.color ?? GOLD;
    const c1 = new Color4(c.r, c.g, c.b, 0.9);
    const c2 = new Color4(Math.min(1, c.r + 0.3), Math.min(1, c.g + 0.3), Math.min(1, c.b + 0.3), 0.7);
    const ps = new ParticleSystem(`gear-${slot}-${bone}`, 40, this.scene);
    ps.particleTexture = this.shared.spark;
    ps.emitter = node;
    ps.createSphereEmitter(0.08, 0.5);
    ps.color1 = c1;
    ps.color2 = c2;
    ps.colorDead = new Color4(c.r, c.g, c.b, 0);
    const size = glow?.size ?? 0.05;
    ps.minSize = size * 0.5;
    ps.maxSize = glow?.halo ? size * 2.2 : size; // el halo: algunas partículas grandes y tenues
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 0.9;
    ps.emitRate = glow?.rate ?? 0; // legendaria sin brillo: solo destellos
    ps.minEmitPower = 0.1;
    ps.maxEmitPower = 0.35;
    ps.gravity = new Vector3(0, 0.6, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
    ps.start();
    return { node, ps, base: { c1, c2 } };
  }

  private restore(e: Emitter): void {
    if (!e.base) return;
    e.ps.color1 = e.base.c1;
    e.ps.color2 = e.base.c2;
    e.ps.manualEmitCount = -1; // Babylon lo deja en 0 tras el destello: -1 devuelve la emisión continua
  }

  private buildRelic(id: RelicId): RelicFx {
    const tradeoff = RELICS[id].tradeoff;
    const orbit = new TransformNode(`relic-orbit-${id}`, this.scene);
    orbit.parent = this.character.root;
    orbit.position.y = this.character.height * ORBIT_HEIGHT;
    const gem = CreatePolyhedron(`relic-gem-${id}`, { type: 1, size: GEM_SIZE_M }, this.scene); // octaedro
    gem.material = tradeoff ? this.shared.gemRed : this.shared.gemGold;
    gem.isPickable = false;
    gem.parent = orbit;
    gem.position.x = ORBIT_RADIUS_M;
    const halo = CreatePlane(`relic-halo-${id}`, { size: HALO_SIZE_M }, this.scene);
    halo.material = this.shared.haloGold;
    halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    halo.isPickable = false;
    halo.parent = gem;
    return { id, orbit, gem, halo };
  }

  // Sin materiales ni textura: son compartidos.
  private disposePiece(p: Piece): void {
    for (const e of p.emitters) {
      e.ps.dispose(false);
      e.node.dispose();
    }
  }

  private disposeRelic(): void {
    this.relicFx?.halo.dispose();
    this.relicFx?.gem.dispose();
    this.relicFx?.orbit.dispose();
    this.relicFx = undefined;
  }
}
