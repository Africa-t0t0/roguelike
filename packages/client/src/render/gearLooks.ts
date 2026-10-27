import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { RELICS, type GearItem, type Nature, type RelicId } from "@roguelike/shared";
import { sparkTexture } from "./fxTextures";

/** Dorado de la legendaria y de la reliquia. */
export const GOLD = new Color3(1, 0.8, 0.3);
const RELIC_RED = new Color3(0.9, 0.12, 0.1);

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

/** Lo que piden al personaje `GearLooks` (nodo para la reliquia) y el aura de los enemigos (huesos con su escala). */
export interface BoneSource {
  boneMount(key: string): { node: TransformNode; perMeter: number } | undefined;
  readonly root: TransformNode;
  readonly height: number;
}

interface RelicFx {
  id: RelicId;
  orbit: TransformNode;
  gem: Mesh;
  halo: Mesh;
}

/**
 * Reliquia de UN personaje: una gema con halo que orbita el pecho (dorada, o roja con halo dorado si es de trade-off).
 * El equipo ya no echa llamas: su color y contorno los pone `GearTint`.
 */
export class GearLooks {
  private relicFx: RelicFx | undefined;

  constructor(
    private readonly scene: Scene,
    private readonly shared: GearFxShared,
    private readonly character: BoneSource,
  ) {}

  /** Pone la reliquia; solo la rehace si cambió. */
  set(relic: RelicId | null): void {
    if (this.relicFx?.id !== relic) {
      this.disposeRelic();
      if (relic) this.relicFx = this.buildRelic(relic);
    }
  }

  /** `nowMs`: reloj de juego (quieto en la pausa): órbita de la reliquia. */
  render(nowMs: number): void {
    const r = this.relicFx;
    if (r) {
      r.orbit.rotation.y = (nowMs / 1000) * ORBIT_RAD_PER_S;
      r.gem.rotation.y = (nowMs / 1000) * 2.4;
    }
  }

  dispose(): void {
    this.disposeRelic();
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

  private disposeRelic(): void {
    this.relicFx?.halo.dispose();
    this.relicFx?.gem.dispose();
    this.relicFx?.orbit.dispose();
    this.relicFx = undefined;
  }
}
