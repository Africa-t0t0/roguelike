import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import { INTERP_DELAY_MS, SPELLS } from "@roguelike/shared";
import type { HazardSnapshot, WorldSnapshot } from "../net/connection";
import { CASTER_COLORS } from "./casterLooks";
import { generated, PARTICLE_SPEED, radial, sparkTexture } from "./fxTextures";

const FLOOR_Y = 0.04; // m: a ras del suelo, sin pelear con él por la profundidad
const BEAM_Y = 1; // m: altura del rayo
const BEAM_WARN_WIDTH = 0.12; // m: grosor del cilindro del aviso (con el ojo a ~3 m, menos no se lee)
const BEAM_STRIP_Y = 0.05; // m: franja del suelo que marca la zona que dañará
const BEAM_STRIP_ALPHA = 0.18;
const BEAM_FLICKER_HZ = 8;
const TRACK_ALPHA = 0.4;
const ZONE_RING_THICKNESS = 0.08;
const ZONE_DISC_ALPHA = 0.4;
const SCORCH_FADE_S = 1.5;
const SCORCH_ALPHA = 0.8;
const BURST_S = 0.5;
const BURST_COUNT = 30;
const BEAM_SPARK_RATE = 80;

/** Fracción llena del disco de una zona: de 0 al empezar el aviso a 1 al estallar. */
export function zoneFill(left: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - left / total));
}

/**
 * Opacidad del aviso del rayo: 0,4 mientras sigue al objetivo; desde que se fija (a `trackFrac` del aviso)
 * sube de 0,5 a 1. El parpadeo se aplica aparte, con el reloj.
 */
export function beamWarnAlpha(left: number, total: number, trackFrac: number): number {
  const lockedS = total * (1 - trackFrac); // lo que queda de aviso al fijarse
  if (total <= 0 || lockedS <= 0 || left > lockedS + 1e-6) return TRACK_ALPHA;
  return 1 - 0.5 * Math.min(1, Math.max(0, left / lockedS));
}

/** Piezas vivas de un peligro; se reconstruyen si cambia de fase. */
interface HazardView {
  data: HazardSnapshot;
  meshes: Mesh[];
  /** disco que crece (zona) o cilindro del rayo: el que se anima por fase */
  main: Mesh;
  /** franja del suelo bajo el rayo en aviso */
  strip?: Mesh;
  sparks?: ParticleSystem;
  /** punto del extremo del rayo para las chispas (se reutiliza cada frame) */
  sparkAt?: Vector3;
  goneAtMs?: number;
}

/** Marca chamuscada que se apaga con el reloj de juego. */
interface Scorch {
  mesh: Mesh;
  startMs: number;
}

interface Burst {
  ps: ParticleSystem;
  endMs: number;
}

/** Zonas del piromante y rayos del invocador: aviso en el suelo, estallido con marca chamuscada y rayo con chispas. */
export class HazardViews {
  private readonly views = new Map<string, HazardView>();
  private readonly scorches: Scorch[] = [];
  private readonly bursts: Burst[] = [];
  private readonly ringMat: StandardMaterial;
  private readonly discMat: StandardMaterial;
  private readonly beamWarnMat: StandardMaterial;
  private readonly beamFireMat: StandardMaterial;
  private readonly beamStripMat: StandardMaterial;
  private readonly scorchMat: StandardMaterial;
  private readonly spark: DynamicTexture;
  private readonly scorchTex: DynamicTexture;
  private paused = false;

  constructor(private readonly scene: Scene) {
    const emissive = (name: string, color: Color3) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = color;
      m.disableLighting = true;
      m.fogEnabled = false;
      m.backFaceCulling = false;
      return m;
    };
    this.ringMat = emissive("hazardRing", CASTER_COLORS.pyromancer);
    this.discMat = emissive("hazardDisc", CASTER_COLORS.pyromancer);
    this.beamWarnMat = emissive("hazardBeamWarn", CASTER_COLORS.stormcaller);
    this.beamFireMat = emissive("hazardBeamFire", new Color3(0.85, 0.95, 1));
    this.beamStripMat = emissive("hazardBeamStrip", CASTER_COLORS.stormcaller);
    this.spark = sparkTexture(scene, "hazard-spark");
    this.scorchTex = generated(scene, "hazard-scorch", 128, (ctx, s) =>
      radial(ctx, s, [
        [0, "rgba(15, 8, 4, 0.95)"],
        [0.6, "rgba(30, 14, 6, 0.7)"],
        [1, "rgba(0, 0, 0, 0)"],
      ]),
    );
    this.scorchMat = new StandardMaterial("hazardScorch", scene);
    this.scorchMat.diffuseColor = Color3.Black();
    this.scorchMat.specularColor = Color3.Black();
    this.scorchMat.emissiveTexture = this.scorchTex;
    this.scorchMat.opacityTexture = this.scorchTex;
    this.scorchMat.disableLighting = true;
    this.scorchMat.backFaceCulling = false;
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, h] of world.hazards) {
      let view = this.views.get(id);
      if (view && view.data.phase !== h.phase) {
        this.disposeView(view);
        view = undefined;
      }
      if (!view) {
        view = this.create(h);
        this.views.set(id, view);
      }
      view.goneAtMs = undefined;
      view.data = h; // las zonas no se mueven; el rayo se re-apunta y animate() usa siempre el último snapshot
    }
    for (const [id, view] of this.views) {
      // La zona es estática: explota al recibir la desaparición, sin esperar la demora de interpolación.
      if (!world.hazards.has(id)) view.goneAtMs ??= view.data.kind === "zone" ? receivedAtMs - INTERP_DELAY_MS : receivedAtMs;
    }
  }

  /** `gameNowMs`: reloj de juego; el parpadeo, el apagado de las marcas y los estallidos se congelan en la pausa. */
  render(gameNowMs: number): void {
    for (const [id, view] of this.views) {
      if (view.goneAtMs !== undefined && gameNowMs >= view.goneAtMs) {
        if (view.data.kind === "zone") this.explode(view.data, gameNowMs);
        this.disposeView(view);
        this.views.delete(id);
        continue;
      }
      this.animate(view, gameNowMs);
    }
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i]!;
      const f = (gameNowMs - s.startMs) / (SCORCH_FADE_S * 1000);
      if (f >= 1) {
        s.mesh.dispose();
        this.scorches.splice(i, 1);
      } else s.mesh.visibility = SCORCH_ALPHA * (1 - Math.max(0, f));
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (gameNowMs >= this.bursts[i]!.endMs) {
        this.bursts[i]!.ps.dispose(false);
        this.bursts.splice(i, 1);
      }
    }
  }

  /** En la pausa las partículas dejan de avanzar. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    const speed = paused ? 0 : PARTICLE_SPEED;
    for (const v of this.views.values()) if (v.sparks) v.sparks.updateSpeed = speed;
    for (const b of this.bursts) b.ps.updateSpeed = speed;
  }

  dispose(): void {
    for (const view of this.views.values()) this.disposeView(view);
    this.views.clear();
    for (const s of this.scorches) s.mesh.dispose();
    this.scorches.length = 0;
    for (const b of this.bursts) b.ps.dispose(false);
    this.bursts.length = 0;
    for (const m of [this.ringMat, this.discMat, this.beamWarnMat, this.beamFireMat, this.beamStripMat, this.scorchMat]) m.dispose();
    this.spark.dispose();
    this.scorchTex.dispose();
  }

  private create(h: HazardSnapshot): HazardView {
    if (h.kind === "zone") {
      const ring = CreateTorus("hazardZoneRing", { diameter: h.size * 2, thickness: ZONE_RING_THICKNESS, tessellation: 40 }, this.scene);
      ring.material = this.ringMat;
      ring.position.set(h.x, FLOOR_Y, h.z);
      const disc = CreateDisc("hazardZoneDisc", { radius: h.size, tessellation: 40 }, this.scene);
      disc.material = this.discMat;
      disc.rotation.x = Math.PI / 2;
      disc.position.set(h.x, FLOOR_Y, h.z);
      for (const m of [ring, disc]) m.isPickable = false;
      return { data: h, meshes: [ring, disc], main: disc };
    }
    const fire = h.phase === "fire";
    // Cilindro de largo y diámetro 1 sobre +Z; animate() lo escala (largo, grosor) y lo gira hacia el rayo.
    const bar = CreateCylinder("hazardBeam", { height: 1, diameter: 1, tessellation: 12 }, this.scene);
    bar.material = fire ? this.beamFireMat : this.beamWarnMat;
    bar.rotation.x = Math.PI / 2;
    bar.isPickable = false;
    const view: HazardView = { data: h, meshes: [bar], main: bar };
    if (!fire) {
      const strip = CreateGround("hazardBeamStrip", { width: 1, height: 1 }, this.scene);
      strip.material = this.beamStripMat;
      strip.isPickable = false;
      strip.visibility = BEAM_STRIP_ALPHA;
      view.meshes.push(strip);
      view.strip = strip;
    }
    if (fire) {
      const ps = new ParticleSystem("hazardBeamSparks", 80, this.scene);
      ps.particleTexture = this.spark;
      ps.color1 = new Color4(0.9, 1, 1, 1);
      ps.color2 = new Color4(CASTER_COLORS.stormcaller.r, CASTER_COLORS.stormcaller.g, CASTER_COLORS.stormcaller.b, 1);
      ps.colorDead = new Color4(0.2, 0.4, 0.8, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      view.sparkAt = new Vector3(h.x + h.dirX * h.length, BEAM_Y, h.z + h.dirZ * h.length);
      ps.emitter = view.sparkAt;
      ps.minSize = 0.08;
      ps.maxSize = 0.2;
      ps.minLifeTime = 0.1;
      ps.maxLifeTime = 0.3;
      ps.emitRate = BEAM_SPARK_RATE;
      ps.minEmitPower = 1;
      ps.maxEmitPower = 3;
      ps.direction1 = new Vector3(-1, 0.2, -1);
      ps.direction2 = new Vector3(1, 1, 1);
      ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
      ps.start();
      view.sparks = ps;
    }
    return view;
  }

  private animate(view: HazardView, nowMs: number): void {
    const h = view.data;
    if (h.kind === "zone") {
      // En "fire" ya está llena; en el aviso crece con lo que falta.
      const fill = h.phase === "fire" ? 1 : zoneFill(h.left, h.total);
      view.main.scaling.set(Math.max(0.001, fill), Math.max(0.001, fill), 1);
      view.main.visibility = ZONE_DISC_ALPHA;
      return;
    }
    // El rayo se re-apunta durante el aviso: posición, giro y largo salen del último snapshot.
    const bar = view.main;
    const fire = h.phase === "fire";
    const thick = fire ? h.size : BEAM_WARN_WIDTH;
    const yaw = Math.atan2(h.dirX, h.dirZ);
    bar.position.set(h.x + (h.dirX * h.length) / 2, BEAM_Y, h.z + (h.dirZ * h.length) / 2);
    bar.rotation.y = yaw;
    bar.scaling.set(thick, Math.max(0.001, h.length), thick);
    if (view.strip) {
      view.strip.position.set(bar.position.x, BEAM_STRIP_Y, bar.position.z);
      view.strip.rotation.y = yaw;
      view.strip.scaling.set(h.size, 1, Math.max(0.001, h.length));
    }
    if (!fire) {
      const flicker = 0.75 + 0.25 * Math.sin((nowMs / 1000) * BEAM_FLICKER_HZ * Math.PI * 2);
      bar.visibility = beamWarnAlpha(h.left, h.total, SPELLS.stormcaller.trackFrac) * flicker;
    } else {
      bar.visibility = Math.min(1, Math.max(0, h.left / SPELLS.stormcaller.fireS));
      view.sparkAt?.copyFromFloats(h.x + h.dirX * h.length, BEAM_Y, h.z + h.dirZ * h.length);
    }
  }

  /** Estallido de la zona: partículas naranjas y marca chamuscada. */
  private explode(h: HazardSnapshot, nowMs: number): void {
    const c = CASTER_COLORS.pyromancer;
    const ps = new ParticleSystem("hazardBurst", BURST_COUNT * 2, this.scene);
    ps.particleTexture = this.spark;
    ps.color1 = new Color4(1, 0.85, 0.4, 1);
    ps.color2 = new Color4(c.r, c.g, c.b, 1);
    ps.colorDead = new Color4(0.4, 0.1, 0, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitter = new Vector3(h.x, 0.2, h.z);
    ps.minEmitBox = new Vector3(-h.size * 0.6, 0, -h.size * 0.6);
    ps.maxEmitBox = new Vector3(h.size * 0.6, 0, h.size * 0.6);
    ps.minSize = 0.15;
    ps.maxSize = 0.4;
    ps.minLifeTime = BURST_S * 0.5;
    ps.maxLifeTime = BURST_S;
    ps.emitRate = 0;
    ps.manualEmitCount = BURST_COUNT;
    ps.minEmitPower = 1.5;
    ps.maxEmitPower = 4;
    ps.direction1 = new Vector3(-0.6, 1, -0.6);
    ps.direction2 = new Vector3(0.6, 2, 0.6);
    ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
    ps.start();
    this.bursts.push({ ps, endMs: nowMs + BURST_S * 1000 + 100 });

    const mesh = CreateDisc("hazardScorch", { radius: h.size, tessellation: 32 }, this.scene);
    mesh.material = this.scorchMat;
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(h.x, FLOOR_Y - 0.01, h.z);
    mesh.isPickable = false;
    mesh.visibility = SCORCH_ALPHA;
    this.scorches.push({ mesh, startMs: nowMs });
  }

  private disposeView(view: HazardView): void {
    view.sparks?.dispose(false); // la textura es compartida
    for (const m of view.meshes) m.dispose();
  }
}
