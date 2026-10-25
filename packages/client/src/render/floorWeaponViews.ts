import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { PICKUP_RANGE, type WeaponId } from "@roguelike/shared";
import type { FloorWeapon } from "../net/connection";
import { formatWeapon } from "../ui/hud";
import type { Assets } from "./assets";
import { WEAPON_LOOKS } from "./looks";

const SPIN_RAD_PER_S = 0.8;
const LIFT_M = 0.08; // la parte más baja del arma queda apenas sobre el piso
const GLOW_DIAMETER_M = 1.3;

/** "E: tomar Mandoble" */
export function pickupPrompt(weaponId: WeaponId): string {
  return `E: tomar ${formatWeapon(weaponId)}`;
}

/** El arma del suelo más cercana a ≤ PICKUP_RANGE de (x, z), como la elige el servidor; o undefined. */
export function nearestPickup(items: readonly FloorWeapon[], x: number, z: number): FloorWeapon | undefined {
  let best: FloorWeapon | undefined;
  let bestD2 = Infinity;
  for (const f of items) {
    const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
    if (d2 <= PICKUP_RANGE ** 2 && d2 < bestD2) [best, bestD2] = [f, d2];
  }
  return best;
}

/**
 * Armas del suelo del propio jugador (las manda solo a él el servidor): tendidas, girando despacio
 * sobre un disco que brilla. Cerca de una se muestra "E: tomar <nombre>" (DOM, con textContent).
 */
export class FloorWeaponViews {
  private items: FloorWeapon[] = [];
  private nodes: TransformNode[] = [];
  private readonly glow: StandardMaterial;
  private readonly hint = document.createElement("div");

  constructor(
    private readonly scene: Scene,
    private readonly assets: Assets,
    parent: HTMLElement = document.body,
  ) {
    const m = new StandardMaterial("floor-weapon-glow", scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(1, 0.8, 0.35);
    m.disableLighting = true;
    m.alpha = 0.3;
    this.glow = m;
    this.hint.className = "pickup-hint";
    this.hint.hidden = true;
    parent.append(this.hint);
  }

  /** Reemplaza todas las armas del suelo (el servidor siempre manda la lista completa). */
  set(items: readonly FloorWeapon[]): void {
    this.clear();
    this.items = items.map((f) => ({ ...f }));
    this.items.forEach((f, i) => this.nodes.push(this.build(f, i)));
  }

  /** Gira las armas y muestra el aviso si (x, z) está a alcance de una y se puede tomar. */
  render(dt: number, me: { x: number; z: number; canPickUp: boolean } | undefined): void {
    for (const n of this.nodes) n.rotation.y += SPIN_RAD_PER_S * dt;
    const near = me?.canPickUp ? nearestPickup(this.items, me.x, me.z) : undefined;
    this.hint.hidden = !near;
    if (near) {
      const text = pickupPrompt(near.weaponId);
      if (this.hint.textContent !== text) this.hint.textContent = text;
    }
  }

  dispose(): void {
    this.clear();
    this.glow.dispose();
    this.hint.remove();
  }

  private clear(): void {
    for (const n of this.nodes) n.dispose(); // sin materiales: los del arma son del contenedor
    this.nodes = [];
    this.items = [];
  }

  private build(f: FloorWeapon, i: number): TransformNode {
    const pivot = new TransformNode(`floor-weapon-${i}`, this.scene);
    pivot.position.set(f.x, 0, f.z);
    // Mismo cambio de unidades que en la mano; la hoja (+Y del modelo) queda horizontal.
    const { asset, grip } = WEAPON_LOOKS[f.weaponId];
    const tilt = new TransformNode(`floor-weapon-tilt-${i}`, this.scene);
    tilt.parent = pivot;
    tilt.rotation.x = Math.PI / 2;
    tilt.scaling.setAll(grip.scale);
    const model = this.assets.container(asset).instantiateModelsToScene((n) => `${n}-floor-${i}`, false, {
      doNotInstantiate: true,
    });
    for (const root of model.rootNodes) root.parent = tilt;
    for (const mesh of tilt.getChildMeshes()) mesh.isPickable = false;
    // Centra el arma sobre el pivote (gira sobre su centro) y la apoya en el piso.
    const { min, max } = pivot.getHierarchyBoundingVectors(true);
    tilt.position.set(f.x - (min.x + max.x) / 2, LIFT_M - min.y, f.z - (min.z + max.z) / 2);
    const disc = CreateDisc(`floor-weapon-glow-${i}`, { radius: GLOW_DIAMETER_M / 2, tessellation: 24 }, this.scene);
    disc.material = this.glow;
    disc.isPickable = false;
    disc.parent = pivot;
    disc.rotation.x = Math.PI / 2; // el disco mira hacia +Z: se acuesta mirando hacia arriba
    disc.position.y = 0.02;
    return pivot;
  }
}
