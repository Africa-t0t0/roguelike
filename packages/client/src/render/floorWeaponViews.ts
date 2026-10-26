import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { FLOOR_WEAPON_BLINK_S, PICKUP_RANGE, TIERS, type AbilityId, type GearItem, type GearSlot, type Nature, type WeaponId, type WeaponTier } from "@roguelike/shared";
import type { FloorItem, FloorWeapon } from "../net/connection";
import { formatWeapon, pickupInfo, tierColor, type PickupInfo } from "../ui/hud";
import type { Assets } from "./assets";
import { WEAPON_LOOKS } from "./looks";
import { attachNatureFx, NATURE_COLORS, type NatureFx } from "./natureLooks";
import { FloorItemKit } from "./floorItemViews";
import { itemGlow } from "./gearLooks";
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
const CHEST_PROMPT_HEIGHT_M = 0.9; // ...y del cofre (mide ~0,6 m)
export const OPEN_CHEST_PROMPT = "Abrir cofre";

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
  /** partículas del arma si tiene naturaleza */
  fx?: NatureFx;
}

/** "Recoger Mandoble templado" (el aviso lo muestra en dos partes: verbo y nombre). */
export function pickupPrompt(weaponId: WeaponId, tier: WeaponTier, nature: Nature = "none"): string {
  return `Recoger ${formatWeapon(weaponId, tier, nature)}`;
}

/** El ítem del suelo más cercano a ≤ PICKUP_RANGE de (x, z), como lo elige el servidor; o undefined. */
export function nearestPickup<T extends { x: number; z: number }>(items: readonly T[], x: number, z: number): T | undefined {
  let best: T | undefined;
  let bestD2 = Infinity;
  for (const f of items) {
    const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
    if (d2 <= PICKUP_RANGE ** 2 && d2 < bestD2) [best, bestD2] = [f, d2];
  }
  return best;
}

/** El cofre cerrado más cercano a ≤ PICKUP_RANGE de (x, z), como lo elige el servidor; o undefined. */
export function nearestClosedChest<T extends { x: number; z: number; open: boolean }>(chests: Iterable<T>, x: number, z: number): T | undefined {
  let best: T | undefined;
  let bestD2 = Infinity;
  for (const c of chests) {
    const d2 = (c.x - x) ** 2 + (c.z - z) ** 2;
    if (!c.open && d2 <= PICKUP_RANGE ** 2 && d2 < bestD2) [best, bestD2] = [c, d2];
  }
  return best;
}

/**
 * Ítems del suelo del propio jugador (las manda solo a él el servidor). Las armas: de pie (punta clavada en el suelo, algo inclinadas), girando
 * despacio y oscilando sobre un disco que brilla. Desde tier 2, el disco y el arma brillan con el color del tier. Cerca de una se
 * muestra "E: tomar <nombre>" (DOM, con textContent). Cada arma vence: su `ttl` baja con el reloj de juego
 * (se congela en la pausa) y con ≤ 5 s parpadea. El equipo y las reliquias comparten lista, aviso (con comparación o texto),
 * aro y parpadeo; su forma sale de `FloorItemKit` (equipo con aro y brillo del tier; reliquia: gema con halo y rayo).
 */
export class FloorWeaponViews {
  private items: FloorItem[] = [];
  private nodes: FloorNode[] = [];
  private ttls: number[] = []; // ttl de cada arma al llegar la lista
  private paused = false;
  private shownKey = ""; // aviso mostrado ahora (para no reescribir el DOM)
  private setAtMs = 0; // instante de juego (ms) en que llegó la lista
  private readonly glows = new Map<string, StandardMaterial>(); // material del velo y del aro por tier
  private readonly kit: FloorItemKit;
  private readonly hint = document.createElement("div");
  private readonly hintName = document.createElement("span");
  private readonly hintVerb = document.createElement("span");
  private readonly hintLines = document.createElement("div");
  private readonly world = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly assets: Assets,
    parent: HTMLElement = document.body,
  ) {
    this.kit = new FloorItemKit(scene);
    this.hint.className = "pickup-hint";
    this.hint.hidden = true;
    const key = document.createElement("span");
    key.className = "pickup-key";
    key.textContent = "E";
    this.hintVerb.className = "pickup-verb";
    this.hintVerb.textContent = "Recoger";
    this.hintName.className = "pickup-name";
    this.hintLines.className = "pickup-lines";
    this.hint.append(key, this.hintVerb, this.hintName, this.hintLines);
    parent.append(this.hint);
  }

  /** Reemplaza todas las armas del suelo (el servidor siempre manda la lista completa). */
  set(items: readonly FloorItem[], nowMs: number): void {
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
   * está a alcance de una y se puede tomar. Con un cofre cerrado a alcance, el aviso es "Abrir cofre" (el
   * servidor abre el cofre antes de recoger armas). `nowMs` es el reloj de juego (quieto en la pausa).
   */
  render(
    dt: number,
    me: { x: number; z: number; canPickUp: boolean; gear?: Partial<Record<GearSlot, GearItem>>; abilities?: readonly AbilityId[] } | undefined,
    nowMs: number,
    chests: Iterable<{ x: number; z: number; open: boolean }> = [],
  ): void {
    const nowS = nowMs / 1000;
    const elapsedS = Math.max(0, (nowMs - this.setAtMs) / 1000);
    this.nodes.forEach((n, i) => {
      n.spin.rotation.y += SPIN_RAD_PER_S * dt;
      n.weapon.position.y = BOB_AMPLITUDE_M * Math.sin(2 * Math.PI * BOB_HZ * nowS + i);
      n.pivot.setEnabled(floorWeaponBlink(this.ttls[i]! - elapsedS, nowS));
    });
    const chest = me?.canPickUp ? nearestClosedChest(chests, me.x, me.z) : undefined;
    if (chest) {
      const cat = this.project(chest.x, chest.z, CHEST_PROMPT_HEIGHT_M);
      this.hint.hidden = !cat;
      if (!cat) return;
      this.hintVerb.textContent = OPEN_CHEST_PROMPT;
      this.hintName.textContent = "";
      this.hintLines.replaceChildren();
      this.shownKey = "";
      this.hint.setAttribute("aria-label", OPEN_CHEST_PROMPT);
      this.hint.style.transform = `translate(${cat.x}px, ${cat.y}px)`;
      return;
    }
    const near = me?.canPickUp ? nearestPickup(this.items, me.x, me.z) : undefined;
    const at = near && this.project(near.x, near.z);
    this.hint.hidden = !at;
    if (!near || !at) return;
    const info = pickupInfo(near, me?.gear ?? {}, me?.abilities ?? []);
    this.showInfo(info);
    // Anclado sobre el arma: la línea guía (CSS) baja desde la esquina inferior izquierda del aviso.
    this.hint.style.transform = `translate(${at.x}px, ${at.y}px)`;
  }

  /** Texto del aviso (solo se reescribe el DOM cuando cambia). */
  private showInfo(info: PickupInfo): void {
    const key = JSON.stringify(info);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.hintVerb.textContent = info.verb;
    this.hintName.textContent = info.name;
    this.hintName.style.color = info.color;
    this.hint.setAttribute("aria-label", `${info.verb} ${info.name}`);
    this.hintLines.replaceChildren(
      ...info.lines.map((l) => {
        const line = document.createElement("div");
        line.className = l.inactive ? "pickup-line pickup-inactive" : "pickup-line";
        line.textContent = l.text;
        return line;
      }),
    );
  }

  /** Congela (o reanuda) las partículas de las armas con naturaleza: avanzan con los cuadros, no con el reloj de juego. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    for (const n of this.nodes) n.fx?.setPaused(paused);
  }

  /** Posición en pantalla (px CSS) del punto sobre el objeto; undefined si queda fuera de la vista. */
  private project(x: number, z: number, y = PROMPT_HEIGHT_M): { x: number; y: number } | undefined {
    const camera = this.scene.activeCamera;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!camera || !canvas) return undefined;
    const viewport = camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    this.world.set(x, y, z);
    const p = Vector3.Project(this.world, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), viewport);
    return p.z >= 0 && p.z <= 1 ? { x: p.x, y: p.y } : undefined;
  }

  dispose(): void {
    this.clear();
    for (const m of this.glows.values()) m.dispose();
    this.glows.clear();
    this.kit.dispose();
    this.hint.remove();
  }

  private clear(): void {
    // Sin materiales: los del arma son del contenedor (o clones de tier cacheados) y los discos se reutilizan.
    for (const n of this.nodes) {
      n.fx?.dispose();
      n.pivot.dispose();
    }
    this.nodes = [];
    this.ttls = [];
    this.items = [];
  }

  private glow(tier: WeaponTier, part: "veil" | "ring", nature: Nature): StandardMaterial {
    const id = nature === "none" ? `${part}-${tier}` : `${part}-${tier}-${nature}`;
    let m = this.glows.get(id);
    if (m) return m;
    const [r, g, b] = nature === "none" ? (TIERS[tier].glow ?? BASE_GLOW) : [NATURE_COLORS[nature].r, NATURE_COLORS[nature].g, NATURE_COLORS[nature].b];
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

  private build(item: FloorItem, i: number): FloorNode {
    const pivot = new TransformNode(`floor-weapon-${i}`, this.scene);
    pivot.position.set(item.x, 0, item.z);
    if (item.kind === "weapon") return this.buildWeapon(item, pivot, i);
    // Equipo y reliquias: oscilan y giran como las armas.
    const weapon = new TransformNode(`floor-item-bob-${i}`, this.scene);
    weapon.parent = pivot;
    const spin = new TransformNode(`floor-item-spin-${i}`, this.scene);
    spin.parent = weapon;
    if (item.kind === "gear") {
      const nature = itemGlow(item.item);
      this.kit.gear(spin, item.item.slot, item.item.tier, nature);
      this.addRing(pivot, item.item.tier, nature, i);
    } else {
      this.kit.relic(spin, weapon, item.id);
    }
    return { pivot, weapon, spin };
  }

  private buildWeapon(f: FloorWeapon, pivot: TransformNode, i: number): FloorNode {
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
    applyTierGlow(tilt, f.tier, f.nature);
    // Centra el arma sobre el eje (gira sobre su centro) y clava la punta SINK_M bajo el piso; la
    // inclinación se aplica después, alrededor del punto del suelo, así la punta no se corre.
    const { min, max } = pivot.getHierarchyBoundingVectors(true);
    tilt.position.set(f.x - (min.x + max.x) / 2, -SINK_M - min.y, f.z - (min.z + max.z) / 2);
    lean.rotation.z = LEAN_RAD;
    // Partículas del arma (antes del velo y el aro, que ensancharían la caja que se mide).
    const fx = f.nature === "none" ? undefined : attachNatureFx(this.scene, f.nature, pivot, this.paused);
    this.addRing(pivot, f.tier, f.nature, i);
    return { pivot, weapon, spin, fx };
  }

  /** Un velo tenue y un aro fino en el suelo que brillan con el color del tier (o del elemento). */
  private addRing(pivot: TransformNode, tier: WeaponTier, nature: Nature, i: number): void {
    const disc = CreateDisc(`floor-weapon-glow-${i}`, { radius: GLOW_DIAMETER_M / 2, tessellation: 32 }, this.scene);
    disc.material = this.glow(tier, "veil", nature);
    disc.isPickable = false;
    disc.parent = pivot;
    disc.rotation.x = Math.PI / 2; // el disco mira hacia +Z: se acuesta mirando hacia arriba
    disc.position.y = 0.02;
    const ring = CreateTorus(`floor-weapon-ring-${i}`, { diameter: GLOW_DIAMETER_M, thickness: 0.025, tessellation: 48 }, this.scene);
    ring.material = this.glow(tier, "ring", nature);
    ring.isPickable = false;
    ring.parent = pivot;
    ring.position.y = 0.03;
  }
}
