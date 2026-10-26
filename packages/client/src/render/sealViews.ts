import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import type { Seal } from "@roguelike/shared";
import { PARTICLE_SPEED, sparkTexture } from "./fxTextures";

const SEAL_ALPHA = 0.35;
const SEAL_HEIGHT = 3; // m
const FADE_S = 0.8;
const LIFT_M = 0.6;
const FLASH_S = 0.3;
const WAVE_SCROLL = 0.12; // vueltas de la textura por segundo
const WAVE_TILE_M = 2; // m de sello que abarca una repetición de la textura
const BLUE = new Color3(0.3, 0.6, 1);

/** Opacidad y elevación del sello `sinceStartS` segundos después de empezar la partida (negativo = aún cerrado). */
export function sealFade(sinceStartS: number): { alpha: number; lift: number } {
  if (sinceStartS < 0) return { alpha: SEAL_ALPHA, lift: 0 };
  const k = Math.min(1, sinceStartS / FADE_S);
  return { alpha: SEAL_ALPHA * (1 - k), lift: LIFT_M * k };
}

/** Textura del sello: ondas suaves, borde inferior más brillante. Alfa en el canal alfa. */
function waveTexture(scene: Scene): DynamicTexture {
  const w = 128;
  const h = 128;
  const tex = new DynamicTexture("seal-wave", { width: w, height: h }, scene, true);
  tex.hasAlpha = true;
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);
  // Ondulado: franjas diagonales suaves que encajan al repetirse.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x += 2) {
      const a = 0.55 + 0.25 * Math.sin(((x + y * 0.6) / w) * Math.PI * 4) + 0.15 * Math.sin((y / h) * Math.PI * 6);
      ctx.fillStyle = `rgba(190, 225, 255, ${Math.min(1, Math.max(0.2, a)).toFixed(3)})`;
      ctx.fillRect(x, y, 2, 1);
    }
  }
  // Borde inferior brillante.
  const g = ctx.createLinearGradient(0, h * 0.8, 0, h);
  g.addColorStop(0, "rgba(255, 255, 255, 0)");
  g.addColorStop(1, "rgba(255, 255, 255, 1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.8, w, h * 0.2);
  tex.update();
  return tex;
}

interface SealView {
  mesh: Mesh;
  motes: ParticleSystem;
  baseY: number;
}

/**
 * Sellos azules translúcidos en las aberturas de la sala inicial. Se atraviesan (no hay colisión). Al empezar la
 * partida se disuelven en `FADE_S` s con un destello y se liberan. Todo corre con el reloj de juego.
 */
export class SealViews {
  private views: SealView[] = [];
  private readonly mat: StandardMaterial;
  private readonly wave: DynamicTexture;
  private readonly spark: DynamicTexture;
  private known = false;
  private startedAtMs: number | undefined;
  private paused = false;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly seals: readonly Seal[],
  ) {
    this.wave = waveTexture(scene);
    this.spark = sparkTexture(scene, "seal-spark");
    const m = new StandardMaterial("seal", scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = BLUE;
    m.emissiveTexture = this.wave;
    m.opacityTexture = this.wave;
    m.disableLighting = true;
    m.fogEnabled = false;
    m.backFaceCulling = false;
    m.alpha = SEAL_ALPHA;
    this.mat = m;
  }

  /**
   * Llamar con cada snapshot. El primero decide: si ya viene empezado no se crean sellos (sin destello); si no, se
   * dibujan, y el paso a `started` dispara la disolución en `nowMs` (reloj de juego).
   */
  setStarted(started: boolean, nowMs: number): void {
    if (this.disposed) return;
    if (!this.known) {
      this.known = true;
      if (started) {
        this.startedAtMs = nowMs;
        return;
      }
      this.build();
      return;
    }
    if (started && this.startedAtMs === undefined) {
      this.startedAtMs = nowMs;
      for (const v of this.views) v.motes.stop();
    }
  }

  render(nowMs: number): void {
    if (this.views.length === 0) return;
    const since = this.startedAtMs === undefined ? -1 : (nowMs - this.startedAtMs) / 1000;
    const { alpha, lift } = sealFade(since);
    if (since >= FADE_S) {
      this.clear();
      return;
    }
    this.mat.alpha = alpha;
    // Destello: arranca casi blanco y vuelve al azul.
    const flash = since < 0 ? 0 : Math.max(0, 1 - since / FLASH_S);
    Color3.LerpToRef(BLUE, Color3.White(), flash, this.mat.emissiveColor);
    this.wave.vOffset = -(nowMs / 1000) * WAVE_SCROLL;
    this.wave.uOffset = (nowMs / 1000) * WAVE_SCROLL * 0.5;
    for (const v of this.views) v.mesh.position.y = v.baseY + lift;
  }

  /** En la pausa las motas se congelan (las ondas y la disolución ya siguen el reloj de juego). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const v of this.views) v.motes.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    this.mat.dispose();
    this.wave.dispose();
    this.spark.dispose();
  }

  private build(): void {
    for (const s of this.seals) {
      const dx = s.x1 - s.x0;
      const dz = s.z1 - s.z0;
      const len = Math.hypot(dx, dz);
      const cx = (s.x0 + s.x1) / 2;
      const cz = (s.z0 + s.z1) / 2;
      const mesh = CreatePlane("seal", { width: len, height: SEAL_HEIGHT }, this.scene);
      mesh.material = this.mat;
      mesh.isPickable = false;
      // El plano mira a ±Z; un sello a lo largo de Z se gira un cuarto de vuelta.
      mesh.rotation.y = dz !== 0 ? Math.PI / 2 : 0;
      const baseY = SEAL_HEIGHT / 2;
      mesh.position.set(cx, baseY, cz);

      const ps = new ParticleSystem("sealMotes", 24, this.scene);
      ps.particleTexture = this.spark;
      ps.color1 = new Color4(0.6, 0.85, 1, 1);
      ps.color2 = new Color4(0.3, 0.6, 1, 1);
      ps.colorDead = new Color4(0.2, 0.4, 1, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.emitter = new Vector3(cx, 0.1, cz);
      const hx = dx / 2;
      const hz = dz / 2;
      ps.minEmitBox = new Vector3(-Math.abs(hx), 0, -Math.abs(hz));
      ps.maxEmitBox = new Vector3(Math.abs(hx), 0, Math.abs(hz));
      ps.minSize = 0.06;
      ps.maxSize = 0.14;
      ps.minLifeTime = 1.2;
      ps.maxLifeTime = 2.2;
      ps.emitRate = Math.max(2, len * 1.5);
      ps.minEmitPower = 0.4;
      ps.maxEmitPower = 0.9;
      ps.direction1 = new Vector3(-0.05, 1, -0.05);
      ps.direction2 = new Vector3(0.05, 1, 0.05);
      ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
      ps.start();
      this.views.push({ mesh, motes: ps, baseY });
    }
    // Una repetición de la textura cada WAVE_TILE_M m: se aproxima con el sello más largo.
    const longest = Math.max(WAVE_TILE_M, ...this.seals.map((s) => Math.hypot(s.x1 - s.x0, s.z1 - s.z0)));
    this.wave.uScale = longest / WAVE_TILE_M;
    this.wave.vScale = SEAL_HEIGHT / WAVE_TILE_M;
  }

  private clear(): void {
    for (const v of this.views) {
      v.motes.dispose(false); // la textura es compartida
      v.mesh.dispose();
    }
    this.views = [];
  }
}
