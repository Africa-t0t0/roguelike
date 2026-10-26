import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import "@babylonjs/core/Rendering/outlineRenderer"; // el borde brillante de la esquirla
import type { Scene } from "@babylonjs/core/scene";
import { createRng, ORB, type Nature } from "@roguelike/shared";
import type { ProjectileSnapshot, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";
import { PARTICLE_SPEED, sparkTexture } from "./fxTextures";

const FLIGHT_Y = 1.1; // m: altura a la que vuelan
const PULSE_AMOUNT = 0.1; // ±10 % de escala
const PULSE_HZ = 6;
const BURST_S = 0.25;
const BURST_COUNT = 14;
/** Los arcos del rayo y el parpadeo de su halo cambian cada tanto (determinista por tiempo). */
export const ARC_STEP_MS = 60;
const ARC_SEGMENTS = 4;
const ARC_COUNT = 3;
const ARC_LENGTH_M = 0.55;
const MOTE_ORBIT_HZ = 1.4;

type RGB = readonly [number, number, number];
type Shape = "orb" | "shard";

/** Descripción pura del aspecto de un proyectil según el elemento del monstruo (colores, forma, adornos y estela). */
export interface ProjectileLook {
  shape: Shape;
  /** diámetro del núcleo (m); en la esquirla, su anchura */
  coreSize: number;
  haloSize: number;
  haloAlpha: number;
  core: RGB;
  halo: RGB;
  /** motas que giran alrededor (orbe arcano) */
  motes: number;
  /** arcos quebrados y halo que parpadea (bola eléctrica) */
  arcs: boolean;
  /** borde brillante (esquirla) */
  outline: RGB | null;
  trail: {
    color1: RGB;
    color2: RGB;
    colorDead: RGB;
    size: readonly [number, number];
    life: readonly [number, number];
    rate: number;
    power: readonly [number, number];
    /** m/s²: positiva sube (llamas), negativa cae (escarcha) */
    gravityY: number;
  };
  /** brasas sueltas aparte de la estela (bola de fuego) */
  embers: boolean;
  /** color del estallido al desaparecer */
  burst: { color1: RGB; color2: RGB; colorDead: RGB };
}

const LOOKS: Record<Nature, ProjectileLook> = {
  // Orbe arcano: núcleo claro, halo esmeralda, motas en órbita y chispas verdes.
  none: {
    shape: "orb",
    coreSize: ORB.radius * 1.2,
    haloSize: ORB.radius * 2.4,
    haloAlpha: 0.4,
    core: [0.85, 1, 0.9],
    halo: [0.1, 0.8, 0.45],
    motes: 3,
    arcs: false,
    outline: null,
    trail: { color1: [0.7, 1, 0.8], color2: [0.3, 1, 0.55], colorDead: [0.05, 0.4, 0.25], size: [0.06, 0.16], life: [0.2, 0.4], rate: 50, power: [0, 0.3], gravityY: 0 },
    embers: false,
    burst: { color1: [0.7, 1, 0.8], color2: [0.3, 1, 0.55], colorDead: [0.1, 0.5, 0.3] },
  },
  // Bola de fuego: núcleo amarillo-blanco, halo naranja, llamas que suben de amarillo a rojo oscuro y brasas.
  fire: {
    shape: "orb",
    coreSize: ORB.radius * 1.3,
    haloSize: ORB.radius * 2.8,
    haloAlpha: 0.45,
    core: [1, 0.95, 0.6],
    halo: [1, 0.45, 0.1],
    motes: 0,
    arcs: false,
    outline: null,
    trail: { color1: [1, 0.9, 0.3], color2: [1, 0.45, 0.1], colorDead: [0.35, 0.03, 0], size: [0.14, 0.3], life: [0.3, 0.55], rate: 60, power: [0, 0.3], gravityY: 1.8 },
    embers: true,
    burst: { color1: [1, 0.9, 0.3], color2: [1, 0.45, 0.1], colorDead: [0.35, 0.03, 0] },
  },
  // Esquirla de hielo: alargada y puntiaguda, cian pálido translúcido con borde brillante y copos que caen.
  ice: {
    shape: "shard",
    coreSize: ORB.radius * 0.55,
    haloSize: ORB.radius * 1.6,
    haloAlpha: 0.22,
    core: [0.55, 0.95, 1],
    halo: [0.55, 0.95, 1],
    motes: 0,
    arcs: false,
    outline: [0.85, 1, 1],
    trail: { color1: [0.9, 1, 1], color2: [0.55, 0.95, 1], colorDead: [0.3, 0.6, 0.8], size: [0.04, 0.09], life: [0.4, 0.7], rate: 40, power: [0, 0.15], gravityY: -1.6 },
    embers: false,
    burst: { color1: [0.9, 1, 1], color2: [0.55, 0.95, 1], colorDead: [0.3, 0.6, 0.8] },
  },
  // Bola eléctrica: núcleo blanco, halo amarillo que parpadea, arcos quebrados y chispas.
  lightning: {
    shape: "orb",
    coreSize: ORB.radius * 1.1,
    haloSize: ORB.radius * 2.6,
    haloAlpha: 0.35,
    core: [1, 1, 1],
    halo: [1, 0.92, 0.4],
    motes: 0,
    arcs: true,
    outline: null,
    trail: { color1: [1, 1, 0.85], color2: [1, 0.92, 0.4], colorDead: [0.6, 0.5, 0.1], size: [0.04, 0.1], life: [0.1, 0.22], rate: 70, power: [0.6, 1.6], gravityY: 0 },
    embers: false,
    burst: { color1: [1, 1, 0.85], color2: [1, 0.92, 0.4], colorDead: [0.6, 0.5, 0.1] },
  },
};

/** Aspecto del proyectil de esa naturaleza ("none" = orbe arcano del hechicero normal). */
export function projectileLook(nature: Nature): ProjectileLook {
  return LOOKS[nature];
}

/** Entero determinista a partir de varios (mezcla simple) para sembrar los arcos. */
function hash(...v: number[]): number {
  let h = 2166136261;
  for (const x of v) h = Math.imul(h ^ (x | 0), 16777619);
  return h >>> 0;
}

/** Puntos de un arco quebrado (en el espacio del núcleo) que sale de él; fijo para la ranura de tiempo `slot`. */
export function arcPoints(seed: number, slot: number, arc: number): Vector3[] {
  const rng = createRng(hash(seed, slot, arc));
  const theta = rng.next() * Math.PI * 2;
  const phi = Math.acos(2 * rng.next() - 1);
  const dir = new Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
  const pts: Vector3[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const along = (i / ARC_SEGMENTS) * ARC_LENGTH_M;
    const jitter = i === 0 ? 0 : 0.09;
    pts.push(new Vector3(dir.x * along + (rng.next() - 0.5) * jitter, dir.y * along + (rng.next() - 0.5) * jitter, dir.z * along + (rng.next() - 0.5) * jitter));
  }
  return pts;
}

const lerpProjectile = (a: ProjectileSnapshot, b: ProjectileSnapshot, t: number): ProjectileSnapshot => ({
  ...b,
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

interface ProjectileView {
  nature: Nature;
  /** índice estable para sembrar los arcos de este proyectil */
  seed: number;
  buffer: SnapshotBuffer<ProjectileSnapshot>;
  /** núcleo: lleva la posición y el pulso; el halo, las motas y los arcos cuelgan de él */
  core: Mesh;
  halo: Mesh;
  motes: Mesh[];
  arcs: LinesMesh[];
  arcSlot: number;
  trails: ParticleSystem[];
  goneAtMs?: number;
}

/** Estallido corto en el último punto de un proyectil; muere con el reloj de juego. */
interface Burst {
  ps: ParticleSystem;
  endMs: number;
}

const rgba = (c: RGB, a: number) => new Color4(c[0], c[1], c[2], a);

/** Proyectiles de los monstruos: orbe arcano, bola de fuego, esquirla de hielo o bola eléctrica; estallido del color de su elemento. */
export class ProjectileViews {
  private readonly views = new Map<string, ProjectileView>();
  private readonly bursts: Burst[] = [];
  /** materiales compartidos por naturaleza (y de las motas), nunca por instancia */
  private readonly mats = new Map<string, StandardMaterial>();
  private readonly spark: DynamicTexture;
  private paused = false;
  private nextSeed = 0;

  constructor(private readonly scene: Scene) {
    this.spark = sparkTexture(scene, "projectile-spark");
  }

  private mat(key: string, color: RGB, alpha = 1): StandardMaterial {
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(`projectile-${key}`, this.scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = new Color3(color[0], color[1], color[2]);
      m.disableLighting = true;
      m.fogEnabled = false;
      m.alpha = alpha;
      this.mats.set(key, m);
    }
    return m;
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, p] of world.projectiles) {
      let view = this.views.get(id);
      if (view && view.nature !== p.nature) {
        this.disposeView(view); // el elemento no cambia en vuelo; si cambiara, se rehace
        view = undefined;
      }
      if (!view) {
        view = this.create(id, p.nature);
        this.views.set(id, view);
      }
      view.goneAtMs = undefined;
      view.buffer.push(receivedAtMs, p);
    }
    for (const [id, view] of this.views) {
      if (!world.projectiles.has(id)) view.goneAtMs ??= receivedAtMs;
    }
  }

  /** `renderAtMs`: reloj de juego interpolado; el pulso, las órbitas, los arcos y la vida de los estallidos se congelan en la pausa. */
  render(renderAtMs: number): void {
    const pulse = 1 + PULSE_AMOUNT * Math.sin((renderAtMs / 1000) * PULSE_HZ * Math.PI * 2);
    const slot = Math.floor(renderAtMs / ARC_STEP_MS);
    for (const [id, view] of this.views) {
      if (view.goneAtMs !== undefined && renderAtMs >= view.goneAtMs) {
        this.burst(view.core.position, view.nature, renderAtMs);
        this.disposeView(view);
        this.views.delete(id);
        continue;
      }
      const p = view.buffer.sample(renderAtMs);
      if (p) {
        view.core.position.set(p.x, FLIGHT_Y, p.z);
        // La esquirla apunta hacia donde vuela (su eje largo es +Z local).
        if (LOOKS[view.nature].shape === "shard" && (p.dirX !== 0 || p.dirZ !== 0)) view.core.rotation.y = Math.atan2(p.dirX, p.dirZ);
      }
      view.core.scaling.setAll(pulse);
      this.animateExtras(view, renderAtMs, slot);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (renderAtMs >= this.bursts[i]!.endMs) {
        this.bursts[i]!.ps.dispose(false);
        this.bursts.splice(i, 1);
      }
    }
  }

  /** Motas en órbita (orbe arcano), y arcos y halo que parpadean cada `ARC_STEP_MS` (bola eléctrica). */
  private animateExtras(view: ProjectileView, renderAtMs: number, slot: number): void {
    const look = LOOKS[view.nature];
    const t = renderAtMs / 1000;
    view.motes.forEach((m, i) => {
      const a = t * MOTE_ORBIT_HZ * Math.PI * 2 + (i / view.motes.length) * Math.PI * 2;
      const r = look.haloSize * 0.5;
      m.position.set(Math.cos(a) * r, Math.sin(a * 0.7 + i) * r * 0.5, Math.sin(a) * r);
    });
    if (look.arcs && slot !== view.arcSlot) {
      view.arcSlot = slot;
      view.arcs.forEach((l, i) => CreateLines(l.name, { points: arcPoints(view.seed, slot, i), instance: l }));
      view.halo.scaling.setAll(0.75 + 0.5 * createRng(hash(view.seed, slot, 99)).next());
    }
  }

  /** En la pausa las partículas (estelas y estallidos) dejan de avanzar. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    const speed = paused ? 0 : PARTICLE_SPEED;
    for (const v of this.views.values()) for (const t of v.trails) t.updateSpeed = speed;
    for (const b of this.bursts) b.ps.updateSpeed = speed;
  }

  dispose(): void {
    for (const view of this.views.values()) this.disposeView(view);
    this.views.clear();
    for (const b of this.bursts) b.ps.dispose(false);
    this.bursts.length = 0;
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    this.spark.dispose();
  }

  private trail(name: string, core: Mesh, look: ProjectileLook, embers: boolean): ParticleSystem {
    const t = look.trail;
    const ps = new ParticleSystem(name, 60, this.scene);
    ps.particleTexture = this.spark;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitter = core;
    ps.minEmitBox = ps.maxEmitBox = Vector3.Zero();
    ps.color1 = rgba(t.color1, 1);
    ps.color2 = rgba(t.color2, 1);
    ps.colorDead = rgba(t.colorDead, 0);
    if (embers) {
      // Brasas sueltas: puntos pequeños y vivos que saltan en todas direcciones y se enfrían despacio.
      ps.minSize = 0.03;
      ps.maxSize = 0.06;
      ps.minLifeTime = 0.4;
      ps.maxLifeTime = 0.8;
      ps.emitRate = 16;
      ps.minEmitPower = 0.4;
      ps.maxEmitPower = 1.1;
      ps.direction1 = new Vector3(-1, 0.2, -1);
      ps.direction2 = new Vector3(1, 1, 1);
      ps.gravity = new Vector3(0, -0.8, 0);
    } else {
      ps.minSize = t.size[0];
      ps.maxSize = t.size[1];
      ps.minLifeTime = t.life[0];
      ps.maxLifeTime = t.life[1];
      ps.emitRate = t.rate;
      ps.minEmitPower = t.power[0];
      ps.maxEmitPower = t.power[1];
      ps.gravity = new Vector3(0, t.gravityY, 0);
    }
    ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
    ps.start();
    return ps;
  }

  private create(id: string, nature: Nature): ProjectileView {
    const look = LOOKS[nature];
    const scene = this.scene;
    let core: Mesh;
    let halo: Mesh;
    if (look.shape === "shard") {
      // Octaedro estirado a lo largo de +Z: dos puntas; el borde brillante lo da el contorno de la malla.
      core = CreatePolyhedron(`projectile-${id}`, { type: 1, sizeX: look.coreSize, sizeY: look.coreSize, sizeZ: look.coreSize * 3.2 }, scene);
      core.material = this.mat(`core-${nature}`, look.core, 0.7);
      core.renderOutline = true;
      core.outlineColor = new Color3(look.outline![0], look.outline![1], look.outline![2]);
      core.outlineWidth = 0.02;
      halo = CreateSphere(`projectileHalo-${id}`, { diameter: look.haloSize, segments: 8 }, scene);
      halo.scaling.set(0.8, 0.8, 2.4); // halo alargado como la esquirla
    } else {
      core = CreateSphere(`projectile-${id}`, { diameter: look.coreSize, segments: 8 }, scene);
      core.material = this.mat(`core-${nature}`, look.core);
      halo = CreateSphere(`projectileHalo-${id}`, { diameter: look.haloSize, segments: 8 }, scene);
    }
    core.isPickable = false;
    halo.material = this.mat(`halo-${nature}`, look.halo, look.haloAlpha);
    halo.parent = core;
    halo.isPickable = false;

    const motes: Mesh[] = [];
    for (let i = 0; i < look.motes; i++) {
      const m = CreateSphere(`projectileMote-${id}-${i}`, { diameter: ORB.radius * 0.35, segments: 4 }, scene);
      m.material = this.mat("mote-none", [0.6, 1, 0.75]);
      m.parent = core;
      m.isPickable = false;
      motes.push(m);
    }
    const seed = this.nextSeed++;
    const arcs: LinesMesh[] = [];
    if (look.arcs) {
      for (let i = 0; i < ARC_COUNT; i++) {
        const l = CreateLines(`projectileArc-${id}-${i}`, { points: arcPoints(seed, 0, i), updatable: true }, scene);
        l.color = new Color3(1, 0.97, 0.7);
        l.parent = core;
        l.isPickable = false;
        arcs.push(l);
      }
    }

    const trails = [this.trail(`projectileTrail-${id}`, core, look, false)];
    if (look.embers) trails.push(this.trail(`projectileEmbers-${id}`, core, look, true));
    return { nature, seed, buffer: new SnapshotBuffer(lerpProjectile), core, halo, motes, arcs, arcSlot: -1, trails };
  }

  private burst(at: Vector3, nature: Nature, nowMs: number): void {
    const b = LOOKS[nature].burst;
    const ps = new ParticleSystem(`projectileBurst-${this.bursts.length}`, 60, this.scene);
    ps.particleTexture = this.spark;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.color1 = rgba(b.color1, 1);
    ps.color2 = rgba(b.color2, 1);
    ps.colorDead = rgba(b.colorDead, 0);
    ps.emitter = at.clone();
    ps.minEmitBox = Vector3.Zero();
    ps.maxEmitBox = Vector3.Zero();
    ps.minSize = 0.1;
    ps.maxSize = 0.25;
    ps.minLifeTime = BURST_S * 0.6;
    ps.maxLifeTime = BURST_S;
    ps.emitRate = 0;
    ps.manualEmitCount = BURST_COUNT;
    ps.minEmitPower = 1;
    ps.maxEmitPower = 2.5;
    ps.direction1 = new Vector3(-1, -0.3, -1);
    ps.direction2 = new Vector3(1, 0.8, 1);
    ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
    ps.start();
    this.bursts.push({ ps, endMs: nowMs + BURST_S * 1000 + 100 });
  }

  private disposeView(view: ProjectileView): void {
    for (const t of view.trails) t.dispose(false); // la textura es compartida
    view.core.dispose(); // arrastra al halo, las motas y los arcos (hijos)
  }
}
