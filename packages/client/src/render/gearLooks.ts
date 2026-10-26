import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { RELICS, TIERS, type GearItem, type GearSlot, type Nature, type RelicId, type WeaponTier } from "@roguelike/shared";
import type { EquippedGear } from "../net/connection";
import { createFlameEmitter, disposeFlameEmitter, type FlameEmitter } from "./bodyAura";
import { flameTexture, PARTICLE_SPEED, sparkTexture } from "./fxTextures";

/** Llamas de una pieza de equipo (mismo aspecto que el aura de los enemigos). */
export interface GearGlow {
  color: Color3;
  /** llamas por segundo en un emisor de peso 1 */
  rate: number;
  /** tamaño medio de la llama (m), en un personaje de 1,8 m */
  size: number;
  /** opacidad máxima del núcleo de la llama */
  alpha: number;
}

/** Dorado de la legendaria y de la reliquia. */
export const GOLD = new Color3(1, 0.8, 0.3);
const RELIC_RED = new Color3(0.9, 0.12, 0.1);

/** Solo por rareza: tier 1 no arde; 2 azul y sutil, 3 violeta y claro, 4 dorado y lo más fuerte. */
export function gearGlow(tier: WeaponTier): GearGlow | null {
  if (tier === 1) return null;
  const t = TIERS[tier].glow!;
  const color = new Color3(t[0], t[1], t[2]);
  switch (tier) {
    case 2: return { color, rate: 3.5, size: 0.17, alpha: 0.3 };
    case 3: return { color, rate: 6, size: 0.22, alpha: 0.5 };
    default: return { color, rate: 9, size: 0.27, alpha: 0.7 };
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

/** Huesos (claves de `boneKey`) de cada ranura, con peso de ritmo y de tamaño; como mucho 2 por ranura. */
export const GEAR_BONES: Record<GearSlot, readonly { bone: string; rate: number; size: number }[]> = {
  helmet: [{ bone: "head", rate: 1.2, size: 1 }],
  chest: [
    { bone: "spine2", rate: 1.3, size: 1.25 }, // pecho y espalda
    { bone: "hips", rate: 0.8, size: 1.05 },
  ],
  gloves: [
    { bone: "lefthand", rate: 0.8, size: 0.7 },
    { bone: "righthand", rate: 0.8, size: 0.7 },
  ],
  boots: [
    { bone: "leftfoot", rate: 0.8, size: 0.75 },
    { bone: "rightfoot", rate: 0.8, size: 0.75 },
  ],
};

const SPARKLE_PERIOD_MS = 1500;
const SPARKLE_COUNT = 6;
const ORBIT_RAD_PER_S = 1.6;
const ORBIT_RADIUS_M = 0.5;
const ORBIT_HEIGHT = 0.6; // fracción de la altura del personaje (el pecho)
const GEM_SIZE_M = 0.07;
const HALO_SIZE_M = 0.3;
const REF_HEIGHT = 1.8;

/** Texturas y materiales compartidos por todos los jugadores de una escena; se liberan con `dispose`. */
export class GearFxShared {
  readonly spark: DynamicTexture;
  readonly flame: DynamicTexture;
  readonly gemGold: StandardMaterial;
  readonly gemRed: StandardMaterial;
  readonly haloGold: StandardMaterial;

  constructor(scene: Scene) {
    this.spark = sparkTexture(scene, "gear-spark");
    this.flame = flameTexture(scene, "gear-flame");
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
    this.flame.dispose();
  }
}

/** Lo que `GearLooks` pide al personaje: huesos con su escala y un nodo del que colgar la reliquia. */
export interface BoneSource {
  boneMount(key: string): { node: TransformNode; perMeter: number } | undefined;
  readonly root: TransformNode;
  readonly height: number;
}

interface Piece {
  key: string;
  legendary: boolean;
  emitters: FlameEmitter[];
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
 * Brillo del equipo y reliquia de UN personaje: llamas como las del aura de los enemigos solo sobre la parte del cuerpo de cada
 * ranura y en el color de su rareza (casco 1 emisor, pechera 2, guantes 2, botas 2 = 7), con la textura compartida; las legendarias lanzan una ráfaga dorada cada ~1,5 s del reloj de juego.
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
      const piece = g ? this.buildPiece(slot, key, g) : undefined;
      if (piece) this.pieces.set(slot, piece);
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
        // Las llamas del destello ya nacieron: se vuelve a la emisión continua.
        if (p.emitters.every((e) => e.ps.manualEmitCount <= 0)) {
          for (const e of p.emitters) e.ps.manualEmitCount = -1; // Babylon lo deja en 0 tras el destello: -1 devuelve la emisión continua
          p.sparkling = false;
        }
      } else if (p.nextSparkMs < 0) {
        p.nextSparkMs = nowMs + SPARKLE_PERIOD_MS + (-1 - p.nextSparkMs) * (SPARKLE_PERIOD_MS / 4);
      } else if (p.legendary && nowMs >= p.nextSparkMs) {
        p.nextSparkMs = nowMs + SPARKLE_PERIOD_MS;
        p.sparkling = true;
        for (const e of p.emitters) e.ps.manualEmitCount = SPARKLE_COUNT; // ráfaga de llamas doradas
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

  private buildPiece(slot: GearSlot, key: string, g: Pick<EquippedGear, "tier" | "legendary" | "glow">): Piece | undefined {
    const glow = gearGlow(g.tier);
    if (!glow) return undefined;
    const k = Math.min(1.5, Math.max(0.8, this.character.height / REF_HEIGHT));
    const emitters: FlameEmitter[] = [];
    for (const spec of GEAR_BONES[slot]) {
      const mount = this.character.boneMount(spec.bone);
      if (!mount) continue;
      const e = createFlameEmitter(this.scene, this.shared.flame, mount, `gear-${slot}-${spec.bone}`, glow.color, glow.rate * spec.rate, glow.size * spec.size * k, glow.alpha, k);
      e.ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
      emitters.push(e);
    }
    // nextSparkMs < 0: el primer destello se programa en `render`, escalonado por ranura para que no destellen todas a la vez.
    return { key, legendary: g.legendary, emitters, nextSparkMs: -1 - Object.keys(GEAR_BONES).indexOf(slot), sparkling: false };
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
    for (const e of p.emitters) disposeFlameEmitter(e);
  }

  private disposeRelic(): void {
    this.relicFx?.halo.dispose();
    this.relicFx?.gem.dispose();
    this.relicFx?.orbit.dispose();
    this.relicFx = undefined;
  }
}
