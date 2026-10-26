import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { RELICS, TIERS, type GearSlot, type Nature, type RelicId, type WeaponTier } from "@roguelike/shared";
import { sparkTexture } from "./fxTextures";
import { GOLD } from "./gearLooks";
import { NATURE_COLORS } from "./natureLooks";

const STEEL = new Color3(0.42, 0.44, 0.48);
const BODY_GLOW = 0.3; // fracción del color del tier que va al emisivo del metal
const RELIC_RED = new Color3(0.9, 0.12, 0.1);
const RELIC_Y = 0.55; // m: la gema flota a esta altura
const GEAR_Y = 0.3; // m: el equipo, sobre el suelo
const GEM_SIZE_M = 0.14;
const HALO_SIZE_M = 0.6;
const BEAM_HEIGHT_M = 3;

/** Materiales y textura compartidos por todos los objetos del suelo (equipo y reliquias); se liberan con `dispose`. */
export class FloorItemKit {
  private readonly bodies = new Map<string, StandardMaterial>();
  private readonly spark: DynamicTexture;
  private readonly gemGold: StandardMaterial;
  private readonly gemRed: StandardMaterial;
  private readonly halo: StandardMaterial;
  private readonly beam: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.spark = sparkTexture(scene, "floor-item-spark");
    const emissive = (name: string, c: Color3, alpha: number) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = c;
      m.disableLighting = true;
      m.fogEnabled = false;
      m.backFaceCulling = false;
      m.alpha = alpha;
      return m;
    };
    this.gemGold = emissive("floor-relic-gold", GOLD, 1);
    this.gemRed = emissive("floor-relic-red", RELIC_RED, 1);
    this.halo = emissive("floor-relic-halo", new Color3(1, 0.93, 0.75), 0.8);
    this.halo.emissiveTexture = this.spark;
    this.halo.opacityTexture = this.spark;
    this.beam = emissive("floor-relic-beam", new Color3(1, 0.9, 0.6), 0.1);
  }

  /** Metal con el brillo del tier (o del elemento), un material por (tier, elemento). */
  private body(tier: WeaponTier, nature: Nature): StandardMaterial {
    const id = `${tier}-${nature}`;
    let m = this.bodies.get(id);
    if (m) return m;
    m = new StandardMaterial(`floor-gear-${id}`, this.scene);
    m.diffuseColor = STEEL;
    m.specularColor = new Color3(0.3, 0.3, 0.3);
    const glow = TIERS[tier].glow;
    const c = nature !== "none" ? NATURE_COLORS[nature] : glow ? new Color3(glow[0], glow[1], glow[2]) : Color3.Black();
    m.emissiveColor = c.scale(BODY_GLOW);
    this.bodies.set(id, m);
    return m;
  }

  /** Forma simple del equipo según la ranura, colgada de `parent` (que gira y oscila). */
  gear(parent: TransformNode, slot: GearSlot, tier: WeaponTier, nature: Nature): void {
    const mat = this.body(tier, nature);
    const part = (m: Mesh, x: number, y: number, z: number): Mesh => {
      m.material = mat;
      m.isPickable = false;
      m.parent = parent;
      m.position.set(x, GEAR_Y + y, z);
      return m;
    };
    const s = this.scene;
    switch (slot) {
      case "helmet": {
        part(CreateSphere("floor-helmet", { diameter: 0.36, slice: 0.5, segments: 12 }, s), 0, 0, 0); // semiesfera
        part(CreateBox("floor-helmet-crest", { width: 0.04, height: 0.1, depth: 0.28 }, s), 0, 0.17, 0); // cresta
        break;
      }
      case "chest": {
        part(CreateBox("floor-chest", { width: 0.3, height: 0.36, depth: 0.18 }, s), 0, 0, 0);
        part(CreateBox("floor-chest-shoulder-l", { width: 0.14, height: 0.1, depth: 0.2 }, s), -0.2, 0.15, 0); // hombros
        part(CreateBox("floor-chest-shoulder-r", { width: 0.14, height: 0.1, depth: 0.2 }, s), 0.2, 0.15, 0);
        break;
      }
      case "gloves": {
        part(CreateBox("floor-glove-l", { width: 0.12, height: 0.08, depth: 0.2 }, s), -0.11, -0.1, 0);
        part(CreateBox("floor-glove-r", { width: 0.12, height: 0.08, depth: 0.2 }, s), 0.11, -0.1, 0);
        break;
      }
      case "boots": {
        for (const x of [-0.1, 0.1]) {
          part(CreateBox("floor-boot-leg", { width: 0.1, height: 0.22, depth: 0.1 }, s), x, 0, -0.05); // caña + pie: una L
          part(CreateBox("floor-boot-foot", { width: 0.1, height: 0.08, depth: 0.24 }, s), x, -0.1, 0.02);
        }
        break;
      }
    }
  }

  /** Reliquia: gema (octaedro) con halo blanco cálido y un rayo vertical tenue; roja si es de trade-off. */
  relic(parent: TransformNode, bob: TransformNode, id: RelicId): void {
    const gem = CreatePolyhedron(`floor-relic-${id}`, { type: 1, size: GEM_SIZE_M }, this.scene);
    gem.material = RELICS[id].tradeoff ? this.gemRed : this.gemGold;
    gem.isPickable = false;
    gem.parent = parent;
    gem.position.y = RELIC_Y;
    const halo = CreatePlane(`floor-relic-halo-${id}`, { size: HALO_SIZE_M }, this.scene);
    halo.material = this.halo;
    halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    halo.isPickable = false;
    halo.parent = bob; // no gira con la gema
    halo.position.y = RELIC_Y;
    const beam = CreateCylinder(`floor-relic-beam-${id}`, { height: BEAM_HEIGHT_M, diameter: 0.08, tessellation: 8 }, this.scene);
    beam.material = this.beam;
    beam.isPickable = false;
    beam.parent = bob;
    beam.position.y = BEAM_HEIGHT_M / 2;
  }

  dispose(): void {
    for (const m of this.bodies.values()) m.dispose();
    this.bodies.clear();
    for (const m of [this.gemGold, this.gemRed, this.halo, this.beam]) m.dispose();
    this.spark.dispose();
  }
}
