import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import { DRAGON, dragonFloorScale, ENEMY_DEFS } from "@roguelike/shared";
import type { EnemySnapshot, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";
import { SpeedMeter } from "./animState";
import type { Assets } from "./assets";
import { flameTexture, PARTICLE_SPEED } from "./fxTextures";
import { lerpAngle } from "./interpolation";

/** Alto del dragón en el juego (m): unas tres veces el bruto a lo largo. */
export const DRAGON_HEIGHT_M = 2.5;
/** Altura (m) a la que vuela en la pasada. */
const FLY_Y = 2.6;
/** Rapidez con que sube o baja hacia su altura objetivo (1/s). */
const LIFT_RATE = 4;
/** Caminando, el clip avanza a esta velocidad con el dragón a su velocidad de base. */
const WALK_CLIP_RATE = 1;
const MOVING_SPEED = 0.3; // m/s
/** Muerte: se ladea y se hunde en este tiempo, y luego se desvanece. */
const DEATH_TIP_S = 0.9;
const DEATH_FADE_S = 0.7;
const DEATH_TIP_RAD = 1.35;
const DEATH_SINK_M = 0.8;
/** Destello al recibir un golpe (s) y el rojo de la furia. */
const FLASH_S = 0.12;
const ENRAGE_GLOW = new Color3(0.9, 0.12, 0.04);
const SHADOW_RADIUS = 1.7;

type Clip = "Attack" | "AttackPose" | "Flying_loop" | "GroundToFly" | "Idle_loop" | "Walk_menacing_loop";
const LOOPED: readonly Clip[] = ["Flying_loop", "Idle_loop", "Walk_menacing_loop"];
const CLIP_ORDER: readonly Clip[] = ["AttackPose", "Attack", "Flying_loop", "GroundToFly", "Idle_loop", "Walk_menacing_loop"];

/** Vida de las llamas del aliento (s): su velocidad se ajusta para que lleguen al borde del cono. */
const BREATH_LIFE_S = 0.55;

/**
 * Qué clip va según su estado y a qué velocidad. `tempo`: el ritmo del piso (`dragonFloorScale`), que acorta sus
 * avisos como en el servidor.
 */
export function chooseDragonClip(e: Pick<EnemySnapshot, "ai" | "bossMove" | "bossStage" | "enraged">, speed: number, tempo = 1): { clip: Clip; rate: number } {
  const quick = (e.enraged ? 1 / DRAGON.enrageTimeMult : 1) * tempo;
  switch (e.bossMove) {
    case "flyby":
      if (e.bossStage === "warn") return { clip: "GroundToFly", rate: (0.83 / DRAGON.flyby.takeoffS) * quick };
      if (e.bossStage === "act") return { clip: "Flying_loop", rate: 1.6 };
      return { clip: "Idle_loop", rate: 1 };
    case "claw":
      return { clip: "Attack", rate: (0.92 / (DRAGON.claw.warnS + 0.15)) * quick };
    case "stomp":
      return { clip: "Attack", rate: (0.92 / (DRAGON.stomp.warnS + 0.15)) * quick };
    case "flame":
      return { clip: "AttackPose", rate: 0.6 * tempo };
    default:
      return speed > MOVING_SPEED ? { clip: "Walk_menacing_loop", rate: WALK_CLIP_RATE * (speed / ENEMY_DEFS.dragon.speed) } : { clip: "Idle_loop", rate: 1 };
  }
}

/** Altura objetivo según el tramo de la pasada: sube al final del despegue, vuela y baja al aterrizar. */
export function dragonAltitude(e: Pick<EnemySnapshot, "bossMove" | "bossStage" | "ai">): number {
  if (e.ai === "dead" || e.bossMove !== "flyby") return 0;
  return e.bossStage === "act" ? FLY_Y : e.bossStage === "warn" ? FLY_Y * 0.25 : 0;
}

function lerpEnemy(a: EnemySnapshot, b: EnemySnapshot, t: number): EnemySnapshot {
  return { ...b, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, facing: lerpAngle(a.facing, b.facing, t) };
}

interface DragonView {
  root: TransformNode;
  /** el modelo: se ladea al morir */
  body: TransformNode;
  meshes: AbstractMesh[];
  groups: Map<Clip, AnimationGroup>;
  playing?: Clip;
  mat?: PBRMaterial;
  buffer: SnapshotBuffer<EnemySnapshot>;
  speed: SpeedMeter;
  drawn?: EnemySnapshot;
  y: number;
  shadow: Mesh;
  /** boca (o la cabeza): de ahí sale el fuego */
  mouth: TransformNode;
  breath: ParticleSystem;
  /** el emisor del aliento: la boca en coordenadas del mundo (sin heredar el giro del hueso) */
  breathAt: Vector3;
  /** dirección y largo del cono de fuego en curso */
  flame: { dirX: number; dirZ: number; length: number };
  flashLeft: number;
  deadAtMs?: number;
  goneAtMs?: number;
}

/** El jefe: el dragón con su modelo y sus clips propios, interpolado como los demás enemigos. */
export class DragonViews {
  private readonly views = new Map<string, DragonView>();
  private readonly shadowMat: StandardMaterial;
  private readonly palette: Texture;
  private paused = false;
  private seq = 0;
  /** ritmo del piso: sus animaciones van tan rápido como sus ataques */
  private readonly tempo: number;

  /** `floor`: el piso elige la paleta del modelo (cuatro, en ciclo). */
  constructor(
    private readonly scene: Scene,
    private readonly assets: Assets,
    floor: number,
  ) {
    this.tempo = dragonFloorScale(floor).tempo;
    this.shadowMat = new StandardMaterial("dragonShadow", scene);
    this.shadowMat.diffuseColor = Color3.Black();
    this.shadowMat.specularColor = Color3.Black();
    this.shadowMat.alpha = 0.45;
    this.shadowMat.disableLighting = true;
    const url = `${import.meta.env.BASE_URL}assets/bosses/dragon-palette-${(Math.max(1, floor) - 1) % 4}.png`;
    this.palette = new Texture(url, scene, true, false, Texture.NEAREST_SAMPLINGMODE);
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    // El cono del lanzallamas (solo el dragón los crea): el fuego sale por donde marca y llega hasta donde marca.
    let cone: { dirX: number; dirZ: number; length: number } | undefined;
    for (const h of world.hazards.values()) if (h.kind === "cone") cone = { dirX: h.dirX, dirZ: h.dirZ, length: h.length };
    if (cone) for (const v of this.views.values()) v.flame = cone;
    for (const [id, e] of world.enemies) {
      if (e.kind !== "dragon") continue;
      let view = this.views.get(id);
      if (!view) this.views.set(id, (view = this.create(id)));
      view.goneAtMs = undefined;
      view.buffer.push(receivedAtMs, e);
    }
    for (const [id, view] of this.views) if (!world.enemies.has(id)) view.goneAtMs ??= receivedAtMs;
  }

  /** El dragón vivo tal como se dibuja (para la barra del jefe). */
  boss(): EnemySnapshot | undefined {
    for (const v of this.views.values()) if (v.drawn) return v.drawn;
    return undefined;
  }

  heightOf(id: string): number | undefined {
    return this.views.has(id) ? DRAGON_HEIGHT_M : undefined;
  }

  /** Destello al recibir un golpe. */
  flinch(id: string): void {
    const v = this.views.get(id);
    if (v) v.flashLeft = FLASH_S;
  }

  liveBodies(): { x: number; z: number; radius: number }[] {
    const out: { x: number; z: number; radius: number }[] = [];
    for (const v of this.views.values()) {
      const e = v.drawn;
      if (e && e.ai !== "dead" && !e.airborne) out.push({ x: e.x, z: e.z, radius: ENEMY_DEFS.dragon.radius });
    }
    return out;
  }

  private create(id: string): DragonView {
    const n = this.seq++;
    const root = new TransformNode(`dragon-${id}`, this.scene);
    const body = new TransformNode(`dragonBody-${id}`, this.scene);
    body.parent = root;
    const entries = this.assets.container("dragon").instantiateModelsToScene((name) => `${name}-dragon${n}`, false, { doNotInstantiate: true });
    for (const node of entries.rootNodes) node.parent = body;
    const meshes = body.getChildMeshes(false);
    // Escala: del alto del modelo en su pose de reposo al alto del juego.
    const { min, max } = body.getHierarchyBoundingVectors(true);
    const h = max.y - min.y;
    if (h > 0) body.scaling.setAll(DRAGON_HEIGHT_M / h);
    const groups = new Map<Clip, AnimationGroup>();
    for (const g of entries.animationGroups) {
      g.stop();
      // "AttackPose" antes que "Attack", que es su prefijo.
      const key = CLIP_ORDER.find((c) => g.name.startsWith(c));
      if (!key || groups.has(key)) {
        g.dispose();
        continue;
      }
      g.enableBlending = true;
      g.blendingSpeed = 0.08;
      groups.set(key, g);
    }
    // Su propia paleta (un clon del material: el del contenedor queda como está).
    let mat: PBRMaterial | undefined;
    for (const m of meshes) {
      if (m.material instanceof PBRMaterial) {
        mat ??= m.material.clone(`dragonMat-${id}`);
        mat.albedoTexture = this.palette;
        m.material = mat;
      }
    }
    const shadow = CreateDisc(`dragonShadow-${id}`, { radius: SHADOW_RADIUS, tessellation: 24 }, this.scene);
    shadow.rotation.x = Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.material = this.shadowMat;
    shadow.isPickable = false;
    const mouth = this.findMouth(body) ?? (() => {
      const t = new TransformNode(`dragonMouth-${id}`, this.scene);
      t.parent = root;
      t.position.set(0, DRAGON_HEIGHT_M * 0.7, 1.6);
      return t;
    })();
    const breathAt = new Vector3();
    const flame = { dirX: 0, dirZ: 1, length: DRAGON.flame.range };
    const breath = this.breath(breathAt, () => view.flame);
    const view: DragonView = {
      root, body, meshes, groups, mat, buffer: new SnapshotBuffer(lerpEnemy), speed: new SpeedMeter(), y: 0, shadow, mouth, breath, breathAt, flame, flashLeft: 0,
    };
    return view;
  }

  /** El hueso de la cabeza o la mandíbula, si el modelo lo tiene. */
  private findMouth(body: TransformNode): TransformNode | undefined {
    const nodes = body.getDescendants(false).filter((n): n is TransformNode => n instanceof TransformNode);
    const by = (re: RegExp) => nodes.find((n) => re.test(n.name));
    return by(/jaw/i) ?? by(/head/i);
  }

  /**
   * El aliento: sale de `at` (la boca, que se mueve cada cuadro) en abanico dentro del cono de `flame()`, con la
   * velocidad justa para llegar a su borde. Las direcciones van en coordenadas del mundo: si el emisor fuera el
   * hueso, heredarían su giro (y el fuego saldría hacia cualquier lado).
   */
  private breath(at: Vector3, flame: () => { dirX: number; dirZ: number; length: number }): ParticleSystem {
    const ps = new ParticleSystem("dragonBreath", 400, this.scene);
    ps.particleTexture = flameTexture(this.scene, "dragon-flame");
    ps.emitter = at;
    ps.color1 = new Color4(1, 0.75, 0.25, 1);
    ps.color2 = new Color4(1, 0.35, 0.05, 0.9);
    ps.colorDead = new Color4(0.3, 0.05, 0, 0);
    ps.minSize = 0.5;
    ps.maxSize = 1.4;
    ps.minLifeTime = BREATH_LIFE_S * 0.8;
    ps.maxLifeTime = BREATH_LIFE_S;
    ps.emitRate = 0;
    ps.minEmitPower = 0.75;
    ps.maxEmitPower = 1;
    ps.startPositionFunction = (_m, pos) => pos.copyFrom(at);
    const half = ((DRAGON.flame.arcDeg / 2) * Math.PI) / 180;
    ps.startDirectionFunction = (_m, dir) => {
      const f = flame();
      const a = Math.atan2(f.dirX, f.dirZ) + (Math.random() * 2 - 1) * half * 0.9;
      // Velocidad para llegar al borde en su vida (la potencia, de 0,75 a 1, reparte las llamas a lo largo).
      const v = f.length / BREATH_LIFE_S;
      dir.set(Math.sin(a) * v, -at.y / BREATH_LIFE_S, Math.cos(a) * v);
    };
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.updateSpeed = PARTICLE_SPEED;
    ps.start();
    return ps;
  }

  private play(view: DragonView, clip: Clip, rate: number): void {
    const g = view.groups.get(clip);
    if (!g) return;
    g.speedRatio = rate;
    if (view.playing === clip) return;
    if (view.playing) view.groups.get(view.playing)?.stop();
    view.playing = clip;
    g.start(LOOPED.includes(clip), rate);
  }

  /** `renderAtMs`: instante interpolado; `dtS`: segundos de este cuadro. */
  render(renderAtMs: number, dtS: number): void {
    for (const [id, view] of this.views) {
      if (view.goneAtMs !== undefined && renderAtMs >= view.goneAtMs) {
        this.disposeView(view);
        this.views.delete(id);
        continue;
      }
      const e = view.buffer.sample(renderAtMs);
      if (!e) continue;
      view.drawn = e;
      const dead = e.ai === "dead";
      // Sube o baja con suavidad hacia su altura del tramo.
      const target = dragonAltitude(e);
      view.y += (target - view.y) * Math.min(1, LIFT_RATE * dtS);
      view.root.position.set(e.x, view.y, e.z);
      view.root.rotation.y = e.facing;
      view.shadow.position.set(e.x, 0.03, e.z);
      view.shadow.scaling.setAll(1 - Math.min(0.5, view.y / (FLY_Y * 2)));
      const speed = view.speed.sample(e.x, e.z, dtS);
      if (dead) {
        view.deadAtMs ??= renderAtMs;
        const t = (renderAtMs - view.deadAtMs) / 1000;
        const tip = Math.min(1, t / DEATH_TIP_S);
        view.body.rotation.z = DEATH_TIP_RAD * tip * tip;
        view.body.position.y = -DEATH_SINK_M * tip;
        const fade = Math.min(1, Math.max(0, (t - DEATH_TIP_S) / DEATH_FADE_S));
        for (const m of view.meshes) m.visibility = 1 - fade;
        view.shadow.visibility = 1 - fade;
        for (const g of view.groups.values()) g.pause();
      } else {
        const { clip, rate } = chooseDragonClip(e, speed, this.tempo);
        this.play(view, clip, this.paused ? 0 : rate);
      }
      // Fuego por la boca mientras quema el lanzallamas.
      const breathing = !dead && e.bossMove === "flame" && e.bossStage === "act";
      view.breath.emitRate = breathing && !this.paused ? 320 : 0;
      if (breathing) view.breathAt.copyFrom(view.mouth.getAbsolutePosition());
      view.flashLeft = Math.max(0, view.flashLeft - dtS);
      if (view.mat) {
        const pulse = 0.55 + 0.45 * Math.sin(renderAtMs / 140);
        const base = e.enraged && !dead ? ENRAGE_GLOW.scale(pulse) : Color3.Black();
        view.mat.emissiveColor = view.flashLeft > 0 ? new Color3(0.9, 0.9, 0.9) : base;
      }
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const v of this.views.values()) v.breath.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  }

  private disposeView(view: DragonView): void {
    for (const g of view.groups.values()) g.dispose();
    view.breath.dispose(false);
    view.mat?.dispose(false, false);
    view.shadow.dispose();
    view.root.dispose(false, false);
  }

  dispose(): void {
    for (const v of this.views.values()) this.disposeView(v);
    this.views.clear();
    this.shadowMat.dispose();
    this.palette.dispose();
  }
}
