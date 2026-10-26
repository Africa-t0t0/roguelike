import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import type { ChestSnapshot, WorldSnapshot } from "../net/connection";
import { PARTICLE_SPEED, sparkTexture } from "./fxTextures";

const OPEN_S = 0.4; // s que tarda la tapa en abrirse
const OPEN_ANGLE = (-110 * Math.PI) / 180;
const FLASH_S = 0.5;
const FLASH_COUNT = 24;
const W = 0.9;
const D = 0.6;
const BODY_H = 0.4;
const LID_H = 0.14;
const CAP_H = 0.06; // losa sobre la tapa: la abomba en escalón (alto total ~0,6 m)
const GOLD = new Color3(0.78, 0.58, 0.14); // dorado apagado: herrajes finos, no bloques amarillos

/** Ángulo (rad, sobre el eje x de la bisagra) de la tapa: 0 cerrada, −55° a 0,2 s y −110° desde 0,4 s. */
export function lidAngle(openSinceS: number): number {
  return OPEN_ANGLE * Math.min(1, Math.max(0, openSinceS / OPEN_S)) || 0; // sin -0
}

interface ChestView {
  data: ChestSnapshot;
  root: TransformNode;
  meshes: Mesh[];
  /** piezas de madera (cuerpo, tapa y losa): cambian a la madera "abierta" */
  woods: Mesh[];
  hinge: TransformNode;
  /** instante (reloj de dibujo) en que se abrió; −Infinity si ya venía abierto (sin destello) */
  openAtMs?: number;
  flashed: boolean;
  goneAtMs?: number;
}

interface Flash {
  ps: ParticleSystem;
  endMs: number;
}

/** Cofres de primitivas: caja de madera oscura con bordes dorados y tapa que gira al abrirse. */
export class ChestViews {
  private readonly views = new Map<string, ChestView>();
  private readonly flashes: Flash[] = [];
  private readonly wood: StandardMaterial;
  private readonly woodOpen: StandardMaterial;
  private readonly gold: StandardMaterial;
  private readonly spark: DynamicTexture;
  private paused = false;

  constructor(private readonly scene: Scene) {
    const mat = (name: string, color: Color3) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = color;
      m.specularColor = Color3.Black();
      m.emissiveColor = color.scale(0.2);
      return m;
    };
    this.wood = mat("chestWood", new Color3(0.2, 0.11, 0.055));
    this.woodOpen = mat("chestWoodOpen", new Color3(0.1, 0.06, 0.035));
    this.gold = mat("chestGold", GOLD);
    this.gold.emissiveColor = GOLD.scale(0.3);
    this.spark = sparkTexture(scene, "chest-spark");
  }

  push(world: WorldSnapshot, atMs: number): void {
    for (const [id, c] of world.chests) {
      let view = this.views.get(id);
      if (!view) {
        view = this.create(c);
        if (c.open) view.openAtMs = -Infinity;
        this.views.set(id, view);
      } else if (c.open && !view.data.open) view.openAtMs = atMs;
      view.goneAtMs = undefined;
      view.data = c;
    }
    for (const [id, view] of this.views) if (!world.chests.has(id)) view.goneAtMs ??= atMs;
  }

  /** `nowMs`: reloj de dibujo; la tapa y el destello se congelan en la pausa con él. */
  render(nowMs: number): void {
    for (const [id, view] of this.views) {
      if (view.goneAtMs !== undefined && nowMs >= view.goneAtMs) {
        this.disposeView(view);
        this.views.delete(id);
        continue;
      }
      const at = view.openAtMs;
      if (at === undefined || nowMs < at) continue;
      view.hinge.rotation.x = lidAngle((nowMs - at) / 1000);
      if (!view.flashed) {
        view.flashed = true;
        for (const m of view.woods) m.material = this.woodOpen;
        if (at !== -Infinity) this.flash(view.data, nowMs);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      if (nowMs >= this.flashes[i]!.endMs) {
        this.flashes[i]!.ps.dispose(false);
        this.flashes.splice(i, 1);
      }
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const f of this.flashes) f.ps.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  }

  dispose(): void {
    for (const v of this.views.values()) this.disposeView(v);
    this.views.clear();
    for (const f of this.flashes) f.ps.dispose(false);
    this.flashes.length = 0;
    for (const m of [this.wood, this.woodOpen, this.gold]) m.dispose();
    this.spark.dispose();
  }

  private create(c: ChestSnapshot): ChestView {
    const box = (name: string, w: number, h: number, d: number, material: StandardMaterial, parent: TransformNode | null, x: number, y: number, z: number) => {
      const m = CreateBox(name, { width: w, height: h, depth: d }, this.scene);
      m.material = material;
      m.parent = parent;
      m.position.set(x, y, z);
      m.isPickable = false;
      return m;
    };
    const root = new TransformNode("chest", this.scene);
    root.position.set(c.x, 0, c.z);
    const body = box("chestBody", W, BODY_H, D, this.wood, root, 0, BODY_H / 2, 0);
    // La bisagra está en el borde trasero de la caja; la tapa cuelga hacia delante (+z).
    const hinge = new TransformNode("chestHinge", this.scene);
    hinge.parent = root;
    hinge.position.set(0, BODY_H, -D / 2);
    const lid = box("chestLid", W, LID_H, D, this.wood, hinge, 0, LID_H / 2, D / 2);
    // Losa más estrecha encima de la tapa (abombado en escalón).
    const cap = box("chestCap", W - 0.1, CAP_H, D - 0.1, this.wood, hinge, 0, LID_H + CAP_H / 2, D / 2);
    const woods: Mesh[] = [body, lid, cap];
    const meshes: Mesh[] = [...woods];
    // Herrajes finos: dos flejes que rodean cuerpo y tapa, el borde del cuerpo y el cierre.
    for (const x of [-W * 0.32, W * 0.32]) {
      meshes.push(box("chestStrapBody", 0.05, BODY_H + 0.02, D + 0.02, this.gold, root, x, BODY_H / 2, 0));
      meshes.push(box("chestStrapLid", 0.05, LID_H + 0.02, D + 0.02, this.gold, hinge, x, LID_H / 2, D / 2));
      meshes.push(box("chestStrapCap", 0.05, CAP_H + 0.02, D - 0.08, this.gold, hinge, x, LID_H + CAP_H / 2, D / 2));
    }
    meshes.push(box("chestRim", W + 0.02, 0.03, D + 0.02, this.gold, root, 0, BODY_H - 0.015, 0));
    meshes.push(box("chestClasp", 0.08, 0.1, 0.04, this.gold, hinge, 0, 0.04, D + 0.01));
    return { data: c, root, meshes, woods, hinge, flashed: false };
  }

  /** Destello dorado corto al abrirse. */
  private flash(c: ChestSnapshot, nowMs: number): void {
    const ps = new ParticleSystem("chestFlash", FLASH_COUNT * 2, this.scene);
    ps.particleTexture = this.spark;
    ps.color1 = new Color4(1, 0.9, 0.5, 1);
    ps.color2 = new Color4(GOLD.r, GOLD.g, GOLD.b, 1);
    ps.colorDead = new Color4(GOLD.r, GOLD.g, GOLD.b, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitter = new Vector3(c.x, BODY_H, c.z);
    ps.minEmitBox = new Vector3(-0.3, 0, -0.2);
    ps.maxEmitBox = new Vector3(0.3, 0, 0.2);
    ps.minSize = 0.1;
    ps.maxSize = 0.25;
    ps.minLifeTime = FLASH_S * 0.5;
    ps.maxLifeTime = FLASH_S;
    ps.emitRate = 0;
    ps.manualEmitCount = FLASH_COUNT;
    ps.minEmitPower = 0.8;
    ps.maxEmitPower = 2;
    ps.direction1 = new Vector3(-0.4, 1, -0.4);
    ps.direction2 = new Vector3(0.4, 1.6, 0.4);
    ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
    ps.start();
    this.flashes.push({ ps, endMs: nowMs + FLASH_S * 1000 + 100 });
  }

  private disposeView(view: ChestView): void {
    view.root.dispose(false, false); // los materiales son compartidos
  }
}
