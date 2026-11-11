import { Constants } from "@babylonjs/core/Engines/constants";
import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { WorldSnapshot } from "../net/connection";
import { telegraphTexture } from "./fxTextures";

const BANNER_COLOR = new Color3(0.45, 1, 0.55);
const POLE_HEIGHT = 2.8; // m
const FLAG_W = 0.9;
const FLAG_H = 0.6;
const RING_Y = 0.045; // m: sobre las marcas del suelo
/** Aparece y se va en este tiempo (s). */
const FADE_S = 0.5;
/** El aro late y la tela ondea con el reloj de juego (quietos en la pausa). */
const PULSE_RAD_S = 3;
const SWAY_RAD_S = 2.2;

interface BannerView {
  root: TransformNode;
  ring: Mesh;
  /** nodo del que cuelga la tela: gira sobre el mástil para ondear */
  hinge: TransformNode;
  meshes: Mesh[];
  left: number;
  total: number;
}

/**
 * Estandartes clavados por los jugadores: un mástil con su tela y un aro en el suelo que marca la zona donde
 * el grupo se cura. Uno por zona `banner` del estado; se desvanece al aparecer y al acabarse.
 */
export class BannerViews {
  private readonly views = new Map<string, BannerView>();
  private readonly ringTex: DynamicTexture;
  private readonly ringMat: StandardMaterial;
  private readonly clothMat: StandardMaterial;
  private readonly poleMat: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.ringTex = telegraphTexture(scene, "banner-ring");
    const glow = (name: string, alpha: number) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = BANNER_COLOR.clone();
      m.disableLighting = true;
      m.fogEnabled = false;
      m.backFaceCulling = false;
      m.alpha = alpha;
      return m;
    };
    this.ringMat = glow("bannerRing", 0.9);
    this.ringMat.opacityTexture = this.ringTex;
    this.ringMat.alphaMode = Constants.ALPHA_ADD;
    this.clothMat = glow("bannerCloth", 0.95);
    this.poleMat = new StandardMaterial("bannerPole", scene);
    this.poleMat.diffuseColor = new Color3(0.32, 0.24, 0.16);
    this.poleMat.specularColor = Color3.Black();
  }

  push(world: WorldSnapshot): void {
    for (const [id, z] of world.zones) {
      if (z.kind !== "banner") continue;
      let view = this.views.get(id);
      if (!view) this.views.set(id, (view = this.create(id, z.x, z.z, z.radius)));
      view.left = z.left;
      view.total = z.total;
    }
    for (const [id, view] of this.views) {
      if (world.zones.get(id)?.kind === "banner") continue;
      view.root.dispose(false, false); // los materiales son compartidos
      this.views.delete(id);
    }
  }

  /** `nowMs`: reloj de juego. */
  render(nowMs: number): void {
    const t = nowMs / 1000;
    for (const view of this.views.values()) {
      const fade = Math.min(1, view.left / FADE_S, (view.total - view.left) / FADE_S + 0.2);
      for (const m of view.meshes) m.visibility = fade;
      view.ring.visibility = fade * (0.75 + 0.25 * Math.sin(t * PULSE_RAD_S));
      view.hinge.rotation.y = 0.35 * Math.sin(t * SWAY_RAD_S);
    }
  }

  dispose(): void {
    for (const view of this.views.values()) view.root.dispose(false, false);
    this.views.clear();
    for (const m of [this.ringMat, this.clothMat, this.poleMat]) m.dispose();
    this.ringTex.dispose();
  }

  private create(id: string, x: number, z: number, radius: number): BannerView {
    const root = new TransformNode(`banner-${id}`, this.scene);
    root.position.set(x, 0, z);
    const ring = CreateGround(`bannerRing-${id}`, { width: 2, height: 2 }, this.scene);
    ring.material = this.ringMat;
    ring.scaling.set(radius, 1, radius);
    ring.position.y = RING_Y;
    const pole = CreateCylinder(`bannerPole-${id}`, { height: POLE_HEIGHT, diameter: 0.08, tessellation: 8 }, this.scene);
    pole.material = this.poleMat;
    pole.position.y = POLE_HEIGHT / 2;
    // La tela cuelga del tope del mástil, hacia +X; su nodo gira en el mástil para ondear.
    const hinge = new TransformNode(`bannerHinge-${id}`, this.scene);
    hinge.parent = root;
    hinge.position.y = POLE_HEIGHT - FLAG_H / 2 - 0.05;
    const flag = CreatePlane(`bannerCloth-${id}`, { width: FLAG_W, height: FLAG_H }, this.scene);
    flag.material = this.clothMat;
    flag.parent = hinge;
    flag.position.x = FLAG_W / 2 + 0.04;
    const meshes = [ring, pole, flag];
    for (const m of [ring, pole]) m.parent = root;
    for (const m of meshes) m.isPickable = false;
    return { root, ring, hinge, meshes, left: 0, total: 1 };
  }
}
