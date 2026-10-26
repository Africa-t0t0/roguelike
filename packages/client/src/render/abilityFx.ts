import { Constants } from "@babylonjs/core/Engines/constants";
import { Material } from "@babylonjs/core/Materials/material";
import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import {
  ABILITIES,
  KICK_ARC_DEG,
  KICK_IMPACT_AT,
  SLAM_IMPACT_S,
  THRUST_IMPACT_FRAC,
  THRUST_WIDTH,
  type AbilityId,
  type Nature,
} from "@roguelike/shared";
import { generated, PARTICLE_SPEED, radial, sparkTexture } from "./fxTextures";
import { natureTint } from "./natureLooks";

/** Temblor de cámara del Golpe sísmico, si el jugador propio está a menos de `rangeM`. */
export const SLAM_SHAKE = { durationS: 0.25, intensity: 0.08, rangeM: 8 } as const;

const FIRE = new Color3(1, 0.45, 0.1);
const GOLD = new Color3(1, 0.78, 0.25);
const WARM_WHITE = new Color3(1, 0.92, 0.75);
const TRAIL = new Color3(1, 0.8, 0.5);

const RING_START_M = 0.5;
const WHIRL_RING_Y = 1.0; // m: a la altura del giro del mandoble
const WARCRY_RADIUS_M = 4;
const WARCRY_GROW_S = 0.5;
const WARCRY_RING_Y = 0.3;
const SHOCK_GROW_S = 0.4;
const CRACKS_FADE_S = 1.5;
const KICK_FLASH_S = 0.15;
const KICK_Y = 0.7;
const TRAIL_FADE_S = 0.3;
const TRAIL_Y = 0.9;
const FLOOR_Y = 0.04; // m: sobre el suelo, sin pelear con él por la profundidad
const SPARK_LIFE_MAX_S = 0.5;
const DUST_EMIT_S = 0.12;
const DUST_LIFE_MAX_S = 1.2;
type Pose = { x: number; z: number; facing: number };

/** Un paso del efecto: qué se dibuja, cuándo empieza (s desde el inicio de la habilidad) y cuánto dura. */
export type FxStep =
  | { kind: "ring"; startS: number; durS: number; to: number; color: Color3; y: number }
  | { kind: "sparks"; startS: number; durS: number; emitS: number; radius: number; nature: Nature }
  | { kind: "shock"; startS: number; durS: number; radius: number; color: Color3 }
  | { kind: "cracks"; startS: number; durS: number; radius: number; nature: Nature }
  | { kind: "dust"; startS: number; durS: number; emitS: number; radius: number }
  | { kind: "flash"; startS: number; durS: number; radius: number; color: Color3 }
  | { kind: "trail"; startS: number; durS: number; range: number; color: Color3 };

/**
 * Los pasos del efecto de cada habilidad; los momentos de impacto salen de las constantes de `cards.ts`.
 * Los colores fijos pasan por `natureTint`: sin naturaleza quedan como siempre.
 */
export function abilityTimeline(id: AbilityId, rank: number, nature: Nature = "none"): FxStep[] {
  const def = ABILITIES[id];
  const r = def.ranks[Math.min(3, Math.max(1, rank)) - 1]!;
  switch (id) {
    case "whirlwind":
      return [
        { kind: "ring", startS: 0, durS: def.animS, to: r.radius!, color: natureTint(FIRE, nature), y: WHIRL_RING_Y },
        { kind: "sparks", startS: 0, durS: def.animS + SPARK_LIFE_MAX_S, emitS: def.animS, radius: r.radius!, nature },
      ];
    case "kick":
      return [{ kind: "flash", startS: KICK_IMPACT_AT * def.animS, durS: KICK_FLASH_S, radius: r.radius!, color: natureTint(WARM_WHITE, nature) }];
    case "warcry":
      return [{ kind: "ring", startS: 0, durS: WARCRY_GROW_S, to: WARCRY_RADIUS_M, color: GOLD, y: WARCRY_RING_Y }];
    case "slam":
      return [
        { kind: "shock", startS: SLAM_IMPACT_S, durS: SHOCK_GROW_S, radius: r.radius!, color: natureTint(FIRE, nature) },
        { kind: "cracks", startS: SLAM_IMPACT_S, durS: CRACKS_FADE_S, radius: r.radius!, nature },
        { kind: "dust", startS: SLAM_IMPACT_S, durS: DUST_EMIT_S + DUST_LIFE_MAX_S, emitS: DUST_EMIT_S, radius: r.radius! },
      ];
    case "thrust":
      return [{ kind: "trail", startS: THRUST_IMPACT_FRAC * def.animS, durS: TRAIL_FADE_S, range: r.range!, color: natureTint(TRAIL, nature) }];
    default:
      return [];
  }
}

/** Cuánto dura (ms) el efecto completo de esa habilidad y rango, desde su inicio. */
export function abilityFxDurationMs(id: AbilityId, rank: number): number {
  return Math.max(0, ...abilityTimeline(id, rank).map((s) => (s.startS + s.durS) * 1000));
}

/** Una pieza viva de un efecto (malla o sistema de partículas), con sus tiempos en el reloj de juego. */
interface Piece {
  startMs: number;
  endMs: number;
  started: boolean;
  mesh?: Mesh;
  mat?: StandardMaterial;
  ps?: ParticleSystem;
  emitEndMs?: number;
  /** radio actual, solo de los aros (para los tests) */
  ring?: number;
  onStart?(): void;
  /** `t`: fracción transcurrida de la pieza, en [0, 1] */
  apply?(t: number): void;
}

/** Grietas desde el centro: líneas oscuras con borde naranja (o del color de la naturaleza). Pseudoaleatorias con semilla (siempre iguales). */
function drawCracks(ctx: CanvasRenderingContext2D, s: number, edge: Color3 | undefined): void {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const paths: [number, number][][] = [];
  const BRANCHES = 9;
  for (let i = 0; i < BRANCHES; i++) {
    let angle = (i / BRANCHES) * Math.PI * 2 + rnd() * 0.5;
    let x = s / 2;
    let y = s / 2;
    const path: [number, number][] = [[x, y]];
    const len = s * (0.3 + rnd() * 0.18);
    for (let d = 0; d < len; d += s * 0.05) {
      angle += (rnd() - 0.5) * 0.9;
      x += Math.cos(angle) * s * 0.05;
      y += Math.sin(angle) * s * 0.05;
      path.push([x, y]);
    }
    paths.push(path);
  }
  const stroke = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of paths) {
      ctx.beginPath();
      path.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
    }
  };
  stroke(edge ? `rgba(${Math.round(edge.r * 255)}, ${Math.round(edge.g * 255)}, ${Math.round(edge.b * 255)}, 0.85)` : "rgba(255, 120, 30, 0.85)", s * 0.03);
  stroke("rgba(20, 12, 6, 0.95)", s * 0.012);
  radial(ctx, s, [
    [0, "rgba(20, 12, 6, 0.9)"],
    [0.12, "rgba(60, 25, 8, 0.6)"],
    [0.2, "rgba(0, 0, 0, 0)"],
  ]);
}

/**
 * Efectos visuales de las habilidades del guerrero: aros, onda, grietas, destellos, estelas y partículas.
 * Sin luces (solo materiales emisivos sin iluminación). Corre con el reloj de juego: en la pausa `update`
 * no avanza nada y las partículas se detienen (`setPaused`). Cada pieza se libera al terminar; las
 * texturas se generan una vez y se comparten.
 */
export class AbilityFx {
  /** Impacto del Golpe sísmico en (x, z), en el instante del impacto (p. ej. para el temblor de cámara). */
  onSlamImpact?: (x: number, z: number) => void;

  private readonly pieces: Piece[] = [];
  private readonly spark: DynamicTexture;
  private readonly ringTex: DynamicTexture;
  private readonly cracks: DynamicTexture;
  /** texturas de grietas de las naturalezas, creadas al primer uso */
  private readonly natureCracks = new Map<Nature, DynamicTexture>();
  private paused = false;
  private seq = 0;

  constructor(private readonly scene: Scene) {
    this.spark = sparkTexture(scene);
    this.ringTex = generated(scene, "fx-ring", 128, (ctx, s) =>
      radial(ctx, s, [
        [0, "rgba(255, 255, 255, 0)"],
        [0.62, "rgba(255, 255, 255, 0)"],
        [0.88, "rgba(255, 255, 255, 1)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]),
    );
    this.cracks = generated(scene, "fx-cracks", 256, (ctx, size) => drawCracks(ctx, size, undefined));
  }

  /** Arranca el efecto de `id` en `at` (pose dibujada del jugador al empezar), con `startMs` en el reloj de juego. */
  play(id: AbilityId, at: Pose, rank: number, startMs: number, nature: Nature = "none"): void {
    for (const step of abilityTimeline(id, rank, nature)) {
      const piece = this.build(step, at);
      piece.startMs = startMs + step.startS * 1000;
      piece.endMs = piece.startMs + step.durS * 1000;
      // Los sistemas de partículas dejan de emitir tras `emitS`; sus partículas viven hasta `endMs`.
      if (step.kind === "sparks" || step.kind === "dust") piece.emitEndMs = piece.startMs + step.emitS * 1000;
      if (step.kind === "shock") piece.onStart = () => this.onSlamImpact?.(at.x, at.z);
      piece.mesh?.setEnabled(false);
      this.pieces.push(piece);
    }
  }

  /** Avanza con el reloj de juego (quieto en la pausa). */
  update(nowMs: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i]!;
      if (nowMs >= p.endMs) {
        this.free(p);
        this.pieces.splice(i, 1);
        continue;
      }
      if (nowMs < p.startMs) continue;
      if (!p.started) {
        p.started = true;
        p.mesh?.setEnabled(true);
        if (p.ps) {
          p.ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
          p.ps.start();
        }
        p.onStart?.();
      }
      if (p.ps && p.emitEndMs !== undefined && nowMs >= p.emitEndMs && p.ps.isStarted()) p.ps.stop();
      p.apply?.(Math.min(1, (nowMs - p.startMs) / (p.endMs - p.startMs)));
    }
  }

  /** Detiene (o reanuda) las partículas: avanzan con los cuadros, no con el reloj de juego. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    for (const p of this.pieces) if (p.ps && p.started) p.ps.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  }

  /** Radio actual del último aro empezado (para los tests). */
  ringRadius(): number | undefined {
    return this.pieces.filter((p) => p.started && p.ring !== undefined).at(-1)?.ring;
  }

  /** `updateSpeed` de los sistemas de partículas empezados (para los tests). */
  particleSpeeds(): number[] {
    return this.pieces.filter((p) => p.ps && p.started).map((p) => p.ps!.updateSpeed);
  }

  dispose(): void {
    for (const p of this.pieces) this.free(p);
    this.pieces.length = 0;
    this.spark.dispose();
    this.ringTex.dispose();
    this.cracks.dispose();
    for (const t of this.natureCracks.values()) t.dispose();
    this.natureCracks.clear();
  }

  private cracksTexture(nature: Nature): DynamicTexture {
    if (nature === "none") return this.cracks;
    let tex = this.natureCracks.get(nature);
    if (!tex) {
      const edge = natureTint(FIRE, nature);
      tex = generated(this.scene, `fx-cracks-${nature}`, 256, (ctx, size) => drawCracks(ctx, size, edge));
      this.natureCracks.set(nature, tex);
    }
    return tex;
  }

  private free(p: Piece): void {
    p.mesh?.dispose(false, false);
    p.mat?.dispose(false, false);
    p.ps?.dispose(false); // la textura es compartida
  }

  /** Material emisivo sin iluminación, con mezcla aditiva y la opacidad de `opacity` si se da. */
  private glow(name: string, color: Color3, opacity?: DynamicTexture): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = color.clone();
    mat.backFaceCulling = false;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND; // siempre mezclado, también con alpha 1
    if (opacity) mat.opacityTexture = opacity;
    mat.alpha = 1;
    return mat;
  }

  private build(step: FxStep, at: Pose): Piece {
    const n = this.seq++;
    const piece: Piece = { startMs: 0, endMs: 0, started: false };
    const fwdX = Math.sin(at.facing);
    const fwdZ = Math.cos(at.facing);
    switch (step.kind) {
      case "ring": {
        // Toro construido al radio final (tubo de 0.05 m) y escalado por igual en los 3 ejes: el tubo solo
        // adelgaza al achicarse (nunca pasa de 0.05 m), así el anillo se mantiene fino.
        const mesh = CreateTorus(`fx-ring-${n}`, { diameter: 2 * step.to, thickness: 0.05, tessellation: 48 }, this.scene);
        const mat = this.glow(`fx-ringMat-${n}`, step.color);
        mesh.material = mat;
        mesh.position.set(at.x, step.y, at.z);
        mesh.isPickable = false;
        const apply = (t: number) => {
          const r = RING_START_M + (step.to - RING_START_M) * (1 - (1 - t) * (1 - t));
          piece.ring = r;
          const k = r / step.to;
          mesh.scaling.set(k, k, k);
          mat.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
        };
        Object.assign(piece, { mesh, mat, apply });
        break;
      }
      case "shock": {
        // Disco anular (textura de anillo) que crece hasta el radio y se desvanece.
        const mesh = CreateDisc(`fx-shock-${n}`, { radius: 1, tessellation: 48 }, this.scene);
        const mat = this.glow(`fx-shockMat-${n}`, step.color, this.ringTex);
        mesh.material = mat;
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(at.x, FLOOR_Y + 0.02, at.z);
        mesh.isPickable = false;
        piece.apply = (t) => {
          const r = Math.max(0.05, step.radius * (1 - (1 - t) * (1 - t)));
          mesh.scaling.set(r, r, 1);
          mat.alpha = 1 - t;
        };
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "cracks": {
        const size = step.radius * 2.2;
        const mesh = CreateGround(`fx-cracks-${n}`, { width: size, height: size }, this.scene);
        const mat = new StandardMaterial(`fx-cracksMat-${n}`, this.scene);
        mat.disableLighting = true;
        mat.diffuseTexture = this.cracksTexture(step.nature);
        mat.useAlphaFromDiffuseTexture = true;
        mat.diffuseColor = Color3.White();
        mat.specularColor = Color3.Black();
        mat.emissiveColor = Color3.Black();
        mat.zOffset = -1;
        mesh.material = mat;
        mesh.position.set(at.x, FLOOR_Y, at.z);
        mesh.rotation.y = at.facing;
        mesh.isPickable = false;
        piece.apply = (t) => (mat.alpha = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6);
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "flash": {
        // Cuña del cono de la Patada: el disco con arco va de +X local hacia +Y; tumbado (+Y → +Z), su
        // centro mira a π/2 − arco/2 (medido como `facing`, desde +Z hacia +X) y se gira hasta `facing`.
        const arc = KICK_ARC_DEG / 360;
        const mesh = CreateDisc(`fx-kick-${n}`, { radius: step.radius, tessellation: 24, arc }, this.scene);
        const mat = this.glow(`fx-kickMat-${n}`, step.color);
        mesh.material = mat;
        mesh.rotation.x = Math.PI / 2;
        mesh.rotation.y = at.facing - (Math.PI / 2 - (arc * Math.PI * 2) / 2);
        mesh.position.set(at.x, KICK_Y, at.z);
        mesh.isPickable = false;
        piece.apply = (t) => (mat.alpha = 0.85 * (1 - t));
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "trail": {
        // Plano alargado del ancho de la línea y del largo del alcance, desde donde se lanzó.
        const mesh = CreateGround(`fx-thrust-${n}`, { width: THRUST_WIDTH, height: step.range }, this.scene);
        const mat = this.glow(`fx-thrustMat-${n}`, step.color, this.spark);
        mesh.material = mat;
        mesh.position.set(at.x + (fwdX * step.range) / 2, TRAIL_Y, at.z + (fwdZ * step.range) / 2);
        mesh.rotation.y = at.facing;
        mesh.isPickable = false;
        piece.apply = (t) => (mat.alpha = 1 - t * t);
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "sparks": {
        const ps = new ParticleSystem(`fx-sparks-${n}`, 300, this.scene);
        ps.particleTexture = this.spark;
        ps.emitter = new Vector3(at.x, WHIRL_RING_Y, at.z);
        ps.createCylinderEmitter(step.radius, 0.3, 1, 0.2);
        if (step.nature === "none") {
          ps.color1 = new Color4(1, 0.75, 0.3, 1);
          ps.color2 = new Color4(1, 0.4, 0.08, 1);
          ps.colorDead = new Color4(0.6, 0.1, 0, 0);
        } else {
          // Chispas del tono de la naturaleza (sin aclararlas hacia el blanco: sumadas en aditivo, cientos de chispas
          // claras viran el aro y la nube a amarillo) y apagándose a su tono oscuro.
          const c = natureTint(FIRE, step.nature);
          ps.color1 = new Color4(c.r, c.g, c.b, 1);
          ps.color2 = new Color4(c.r * 0.8, c.g * 0.8, c.b * 0.8, 1);
          ps.colorDead = new Color4(c.r * 0.5, c.g * 0.5, c.b * 0.5, 0);
        }
        ps.minSize = 0.06;
        ps.maxSize = 0.16;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = SPARK_LIFE_MAX_S;
        ps.emitRate = 260;
        ps.minEmitPower = 1;
        ps.maxEmitPower = 3;
        ps.gravity = new Vector3(0, -6, 0);
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.updateSpeed = 0;
        piece.ps = ps;
        break;
      }
      case "dust": {
        const ps = new ParticleSystem(`fx-dust-${n}`, 200, this.scene);
        ps.particleTexture = this.spark;
        ps.emitter = new Vector3(at.x, 0.2, at.z);
        ps.createCylinderEmitter(step.radius * 0.7, 0.2, 1, 0.6);
        ps.color1 = new Color4(0.48, 0.38, 0.27, 0.6);
        ps.color2 = new Color4(0.36, 0.27, 0.18, 0.5);
        ps.colorDead = new Color4(0.3, 0.24, 0.17, 0);
        ps.minSize = 0.5;
        ps.maxSize = 1.3;
        ps.minLifeTime = 0.6;
        ps.maxLifeTime = DUST_LIFE_MAX_S;
        ps.emitRate = 1200;
        ps.minEmitPower = 0.8;
        ps.maxEmitPower = 2.2;
        ps.gravity = new Vector3(0, -1, 0);
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.updateSpeed = 0;
        piece.ps = ps;
        break;
      }
    }
    return piece;
  }
}
