import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { FLOOR_WEAPON_BLINK_S, PICKUP_RANGE, TIERS, type WeaponId, type WeaponTier } from "@roguelike/shared";
import type { FloorWeapon } from "../net/connection";
import { formatWeapon, tierColor } from "../ui/hud";
import type { Assets } from "./assets";
import { WEAPON_LOOKS } from "./looks";
import { applyTierGlow } from "./tierGlow";

const SPIN_RAD_PER_S = 0.8;
const SINK_M = 0.1; // la punta queda clavada ~10 cm en el suelo
const LEAN_RAD = (10 * Math.PI) / 180; // inclinación de ~10° respecto de la vertical
const BOB_AMPLITUDE_M = 0.03; // oscilación vertical de ±3 cm
const BOB_HZ = 1;
const BLINK_HZ = 6;
const GLOW_DIAMETER_M = 1.3;
const BASE_GLOW: readonly [number, number, number] = [1, 0.8, 0.35]; // aro de las tier 1
const PROMPT_HEIGHT_M = 0.7; // el aviso se ancla un poco por encima del arma

/** Parpadeo de vencimiento: siempre visible con ttl > 5 s; con ttl ≤ 5 s alterna a 6 Hz según el reloj de juego. */
export function floorWeaponBlink(ttl: number, nowS: number): boolean {
  if (ttl > FLOOR_WEAPON_BLINK_S) return true;
  return Math.floor(nowS * BLINK_HZ * 2) % 2 === 0;
}

/** Nodos de un arma del suelo: el pivote (parpadea), el arma que oscila y el eje que gira. */
interface FloorNode {
  pivot: TransformNode;
  weapon: TransformNode;
  spin: TransformNode;
}

/** "Recoger Mandoble templado" (el aviso lo muestra en dos partes: verbo y nombre). */
export function pickupPrompt(weaponId: WeaponId, tier: WeaponTier): string {
  return `Recoger ${formatWeapon(weaponId, tier)}`;
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
 * Armas del suelo del propio jugador (las manda solo a él el servidor): de pie (punta clavada en el suelo, algo inclinadas), girando
 * despacio y oscilando sobre un disco que brilla. Desde tier 2, el disco y el arma brillan con el color del tier. Cerca de una se
 * muestra "E: tomar <nombre>" (DOM, con textContent). Cada arma vence: su `ttl` baja con el reloj de juego
 * (se congela en la pausa) y con ≤ 5 s parpadea.
 */
export class FloorWeaponViews {
  private items: FloorWeapon[] = [];
  private nodes: FloorNode[] = [];
  private ttls: number[] = []; // ttl de cada arma al llegar la lista
  private setAtMs = 0; // instante de juego (ms) en que llegó la lista
  private readonly glows = new Map<string, StandardMaterial>(); // material del velo y del aro por tier
  private readonly hint = document.createElement("div");
  private readonly hintName = document.createElement("span");
  private readonly world = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly assets: Assets,
    parent: HTMLElement = document.body,
  ) {
    this.hint.className = "pickup-hint";
    this.hint.hidden = true;
    const key = document.createElement("span");
    key.className = "pickup-key";
    key.textContent = "E";
    const verb = document.createElement("span");
    verb.className = "pickup-verb";
    verb.textContent = "Recoger";
    this.hintName.className = "pickup-name";
    this.hint.append(key, verb, this.hintName);
    parent.append(this.hint);
  }

  /** Reemplaza todas las armas del suelo (el servidor siempre manda la lista completa). */
  set(items: readonly FloorWeapon[], nowMs: number): void {
    this.clear();
    this.setAtMs = nowMs;
    this.items = items.map((f) => ({ ...f }));
    this.items.forEach((f, i) => {
      this.nodes.push(this.build(f, i));
      this.ttls.push(f.ttl);
    });
  }

  /**
   * Gira y hace oscilar las armas, las hace parpadear si vencen pronto, y muestra el aviso si (x, z)
   * está a alcance de una y se puede tomar. `nowMs` es el reloj de juego (quieto en la pausa).
   */
  render(dt: number, me: { x: number; z: number; canPickUp: boolean } | undefined, nowMs: number): void {
    const nowS = nowMs / 1000;
    const elapsedS = Math.max(0, (nowMs - this.setAtMs) / 1000);
    this.nodes.forEach((n, i) => {
      n.spin.rotation.y += SPIN_RAD_PER_S * dt;
      n.weapon.position.y = BOB_AMPLITUDE_M * Math.sin(2 * Math.PI * BOB_HZ * nowS + i);
      n.pivot.setEnabled(floorWeaponBlink(this.ttls[i]! - elapsedS, nowS));
    });
    const near = me?.canPickUp ? nearestPickup(this.items, me.x, me.z) : undefined;
    const at = near && this.project(near.x, near.z);
    this.hint.hidden = !at;
    if (!near || !at) return;
    const name = formatWeapon(near.weaponId, near.tier);
    if (this.hintName.textContent !== name) {
      this.hintName.textContent = name;
      this.hintName.style.color = tierColor(near.tier);
      this.hint.setAttribute("aria-label", pickupPrompt(near.weaponId, near.tier));
    }
    // Anclado sobre el arma: la línea guía (CSS) baja desde la esquina inferior izquierda del aviso.
    this.hint.style.transform = `translate(${at.x}px, ${at.y}px)`;
  }

  /** Posición en pantalla (px CSS) del punto sobre el arma; undefined si queda fuera de la vista. */
  private project(x: number, z: number): { x: number; y: number } | undefined {
    const camera = this.scene.activeCamera;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!camera || !canvas) return undefined;
    const viewport = camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    this.world.set(x, PROMPT_HEIGHT_M, z);
    const p = Vector3.Project(this.world, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), viewport);
    return p.z >= 0 && p.z <= 1 ? { x: p.x, y: p.y } : undefined;
  }

  dispose(): void {
    this.clear();
    for (const m of this.glows.values()) m.dispose();
    this.glows.clear();
    this.hint.remove();
  }

  private clear(): void {
    // Sin materiales: los del arma son del contenedor (o clones de tier cacheados) y los discos se reutilizan.
    for (const n of this.nodes) n.pivot.dispose();
    this.nodes = [];
    this.ttls = [];
    this.items = [];
  }

  private glow(tier: WeaponTier, part: "veil" | "ring"): StandardMaterial {
    const id = `${part}-${tier}`;
    let m = this.glows.get(id);
    if (m) return m;
    const [r, g, b] = TIERS[tier].glow ?? BASE_GLOW;
    m = new StandardMaterial(`floor-weapon-${id}`, this.scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(r, g, b);
    m.disableLighting = true;
    m.fogEnabled = false;
    m.alpha = part === "ring" ? 0.9 : 0.12;
    this.glows.set(id, m);
    return m;
  }

  private build(f: FloorWeapon, i: number): FloorNode {
    const pivot = new TransformNode(`floor-weapon-${i}`, this.scene);
    pivot.position.set(f.x, 0, f.z);
    // Jerarquía: pivote → arma (oscila) → eje (gira) → inclinación (~10°) → tilt (punta abajo, escala).
    const weapon = new TransformNode(`floor-weapon-bob-${i}`, this.scene);
    weapon.parent = pivot;
    const spin = new TransformNode(`floor-weapon-spin-${i}`, this.scene);
    spin.parent = weapon;
    const lean = new TransformNode(`floor-weapon-lean-${i}`, this.scene);
    lean.parent = spin;
    // Mismo cambio de unidades que en la mano; la hoja (+Y del modelo) apunta hacia abajo.
    const { asset, grip } = WEAPON_LOOKS[f.weaponId];
    const tilt = new TransformNode(`floor-weapon-tilt-${i}`, this.scene);
    tilt.parent = lean;
    tilt.rotation.z = Math.PI;
    tilt.scaling.setAll(grip.scale);
    const model = this.assets.container(asset).instantiateModelsToScene((n) => `${n}-floor-${i}`, false, {
      doNotInstantiate: true,
    });
    for (const root of model.rootNodes) root.parent = tilt;
    for (const mesh of tilt.getChildMeshes()) mesh.isPickable = false;
    applyTierGlow(tilt, f.tier);
    // Centra el arma sobre el eje (gira sobre su centro) y clava la punta SINK_M bajo el piso; la
    // inclinación se aplica después, alrededor del punto del suelo, así la punta no se corre.
    const { min, max } = pivot.getHierarchyBoundingVectors(true);
    tilt.position.set(f.x - (min.x + max.x) / 2, -SINK_M - min.y, f.z - (min.z + max.z) / 2);
    lean.rotation.z = LEAN_RAD;
    // Un velo tenue y un aro fino que brillan con el color del tier.
    const disc = CreateDisc(`floor-weapon-glow-${i}`, { radius: GLOW_DIAMETER_M / 2, tessellation: 32 }, this.scene);
    disc.material = this.glow(f.tier, "veil");
    disc.isPickable = false;
    disc.parent = pivot;
    disc.rotation.x = Math.PI / 2; // el disco mira hacia +Z: se acuesta mirando hacia arriba
    disc.position.y = 0.02;
    const ring = CreateTorus(`floor-weapon-ring-${i}`, { diameter: GLOW_DIAMETER_M, thickness: 0.025, tessellation: 48 }, this.scene);
    ring.material = this.glow(f.tier, "ring");
    ring.isPickable = false;
    ring.parent = pivot;
    ring.position.y = 0.03;
    return { pivot, weapon, spin };
  }
}
