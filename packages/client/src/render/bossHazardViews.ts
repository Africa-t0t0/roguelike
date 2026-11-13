import { Constants } from "@babylonjs/core/Engines/constants";
import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import { DRAGON } from "@roguelike/shared";
import type { HazardSnapshot, WorldSnapshot } from "../net/connection";
import { flameTexture, PARTICLE_SPEED } from "./fxTextures";

const FLOOR_Y = 0.045;
const CLAW = new Color3(1, 0.22, 0.08);
const FIRE = new Color3(1, 0.45, 0.08);
const STOMP = new Color3(1, 0.62, 0.2);
/** Opacidad del fondo del aviso y de su relleno, que crece hasta el golpe. */
const BACK_ALPHA = 0.22;
const FILL_ALPHA = 0.55;
const FAN_SEGMENTS = 24;
/** La franja se apaga en sus últimos segundos. */
const STRIP_FADE_S = 0.8;
const STRIP_FLAME_RATE_PER_M = 14;

/** Los peligros que dibuja esta vista (los del dragón); la zona y el rayo van en `HazardViews`. */
export const BOSS_HAZARDS: readonly HazardSnapshot["kind"][] = ["arc", "cone", "ring", "strip"];

/**
 * Abanico plano sobre el suelo, de radio 1 y `arcDeg` grados, centrado en +Z (el `facing` 0 del juego). Con
 * 360° es un disco.
 */
export function fanMesh(name: string, arcDeg: number, scene: Scene): Mesh {
  const half = (Math.min(360, arcDeg) * Math.PI) / 360;
  const positions = [0, 0, 0];
  const indices: number[] = [];
  for (let i = 0; i <= FAN_SEGMENTS; i++) {
    const a = -half + (2 * half * i) / FAN_SEGMENTS;
    positions.push(Math.sin(a), 0, Math.cos(a));
    if (i > 0) indices.push(0, i, i + 1);
  }
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

/** Fracción llena del aviso: de 0 al empezar a 1 al golpear. */
export function warnFill(left: number, total: number): number {
  return total <= 0 ? 1 : Math.min(1, Math.max(0, 1 - left / total));
}

/** Metros de franja ya quemados (como el servidor): avanzan con el vuelo desde que pasa a fuego. */
export function stripBurntM(h: Pick<HazardSnapshot, "phase" | "left" | "total" | "length">): number {
  if (h.phase !== "fire") return 0;
  return Math.min(h.length, Math.max(0, (h.total - h.left) * DRAGON.flyby.speed));
}

interface View {
  data: HazardSnapshot;
  meshes: Mesh[];
  back?: Mesh;
  fill?: Mesh;
  /** la franja: aviso o tramo quemado */
  strip?: Mesh;
  flames?: ParticleSystem;
}

/** Avisos y fuego del dragón: zarpazo y lanzallamas (abanicos), pisotón (anillo) y franja de la pasada. */
export class BossHazardViews {
  private readonly views = new Map<string, View>();
  private readonly mats = new Map<string, StandardMaterial>();
  private flame?: DynamicTexture;
  private paused = false;

  constructor(private readonly scene: Scene) {}

  private mat(key: string, color: Color3): StandardMaterial {
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(`bossHazard-${key}`, this.scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = color;
      m.disableLighting = true;
      m.fogEnabled = false;
      m.backFaceCulling = false;
      m.alphaMode = Constants.ALPHA_ADD;
      this.mats.set(key, m);
    }
    return m;
  }

  push(world: WorldSnapshot): void {
    for (const [id, h] of world.hazards) {
      if (!BOSS_HAZARDS.includes(h.kind)) continue;
      let view = this.views.get(id);
      // La franja cambia de aviso a fuego: se rehace.
      if (view && view.data.phase !== h.phase) {
        this.disposeView(view);
        view = undefined;
      }
      if (!view) this.views.set(id, (view = this.create(id, h)));
      view.data = h;
    }
    for (const [id, view] of this.views) {
      if (world.hazards.has(id)) continue;
      this.disposeView(view);
      this.views.delete(id);
    }
  }

  private create(id: string, h: HazardSnapshot): View {
    const at = (m: Mesh) => {
      m.position.set(h.x, FLOOR_Y, h.z);
      m.rotation.y = Math.atan2(h.dirX, h.dirZ);
      return m;
    };
    if (h.kind === "arc" || h.kind === "cone") {
      const color = h.kind === "arc" ? CLAW : FIRE;
      const back = at(fanMesh(`bossFanBack-${id}`, h.size, this.scene));
      back.scaling.setAll(h.length);
      back.material = this.mat(`${h.kind}-back`, color);
      back.visibility = BACK_ALPHA;
      const fill = at(fanMesh(`bossFanFill-${id}`, h.size, this.scene));
      fill.material = this.mat(`${h.kind}-fill`, color);
      fill.position.y += 0.005;
      return { data: h, meshes: [back, fill], back, fill };
    }
    if (h.kind === "ring") {
      const back = at(fanMesh(`bossRingBack-${id}`, 360, this.scene));
      back.scaling.setAll(h.size);
      back.material = this.mat("ring-back", STOMP);
      back.visibility = BACK_ALPHA;
      const fill = at(fanMesh(`bossRingFill-${id}`, 360, this.scene));
      fill.material = this.mat("ring-fill", STOMP);
      fill.position.y += 0.005;
      const edge = CreateTorus(`bossRingEdge-${id}`, { diameter: h.size * 2, thickness: 0.1, tessellation: 48 }, this.scene);
      edge.position.set(h.x, FLOOR_Y, h.z);
      edge.material = this.mat("ring-edge", STOMP);
      edge.isPickable = false;
      return { data: h, meshes: [back, fill, edge], back, fill };
    }
    // Franja: un rectángulo de 1 × 1 que se escala a su ancho y a su largo (o a lo ya quemado).
    const strip = CreateGround(`bossStrip-${id}`, { width: 1, height: 1 }, this.scene);
    strip.rotation.y = Math.atan2(h.dirX, h.dirZ);
    strip.isPickable = false;
    const view: View = { data: h, meshes: [strip], strip };
    if (h.phase === "warn") {
      strip.material = this.mat("strip-warn", CLAW);
      return view;
    }
    strip.material = this.mat("strip-fire", FIRE);
    // Llamas que suben de todo el tramo quemado: el emisor es la propia franja (su caja sigue su escala y giro).
    const ps = new ParticleSystem(`bossStripFlames-${id}`, 600, this.scene);
    ps.particleTexture = (this.flame ??= flameTexture(this.scene, "boss-flame"));
    ps.emitter = strip;
    ps.minEmitBox = new Vector3(-0.45, 0, -0.5);
    ps.maxEmitBox = new Vector3(0.45, 0, 0.5);
    ps.color1 = new Color4(1, 0.7, 0.2, 0.9);
    ps.color2 = new Color4(1, 0.35, 0.05, 0.8);
    ps.colorDead = new Color4(0.25, 0.05, 0, 0);
    ps.minSize = 0.35;
    ps.maxSize = 0.8;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 0.8;
    ps.minEmitPower = 0.4;
    ps.maxEmitPower = 1;
    ps.direction1 = new Vector3(-0.1, 1, -0.1);
    ps.direction2 = new Vector3(0.1, 1.6, 0.1);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
    ps.start();
    view.flames = ps;
    return view;
  }

  /** `nowMs`: reloj de juego (el parpadeo se congela en la pausa). */
  render(nowMs: number): void {
    const flicker = 0.8 + 0.2 * Math.sin(nowMs / 45);
    for (const view of this.views.values()) {
      const h = view.data;
      if (view.fill) {
        // El lanzallamas encendido: lleno y titilando; los avisos se llenan hasta el golpe.
        const burning = h.kind === "cone" && h.phase === "fire";
        const r = (h.kind === "ring" ? h.size : h.length) * (burning ? 1 : warnFill(h.left, h.total));
        view.fill.scaling.setAll(Math.max(0.001, r));
        // Encendido se atenúa: el fuego lo dibujan las llamas del aliento; el suelo solo marca la zona.
        view.fill.visibility = burning ? 0.3 * flicker : FILL_ALPHA;
        if (view.back) view.back.visibility = burning ? 0.2 : BACK_ALPHA;
      }
      if (view.strip) {
        const fire = h.phase === "fire";
        const len = fire ? stripBurntM(h) : h.length;
        view.strip.position.set(h.x + (h.dirX * len) / 2, FLOOR_Y, h.z + (h.dirZ * len) / 2);
        view.strip.scaling.set(h.size, 1, Math.max(0.001, len));
        if (!fire) view.strip.visibility = 0.25 + 0.2 * warnFill(h.left, h.total) * flicker;
        else {
          const fade = Math.min(1, h.left / STRIP_FADE_S);
          view.strip.visibility = 0.55 * fade * flicker;
          if (view.flames) view.flames.emitRate = this.paused ? 0 : len * STRIP_FLAME_RATE_PER_M * fade;
        }
      }
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const v of this.views.values()) if (v.flames) v.flames.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  }

  private disposeView(view: View): void {
    view.flames?.dispose(false);
    for (const m of view.meshes) m.dispose();
  }

  dispose(): void {
    for (const v of this.views.values()) this.disposeView(v);
    this.views.clear();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    this.flame?.dispose();
  }
}
