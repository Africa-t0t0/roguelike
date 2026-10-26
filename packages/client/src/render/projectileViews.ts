import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import { ORB } from "@roguelike/shared";
import type { ProjectileSnapshot, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";
import { CASTER_COLORS } from "./casterLooks";
import { PARTICLE_SPEED, sparkTexture } from "./fxTextures";

const FLIGHT_Y = 1.1; // m: altura a la que vuelan
const CORE_DIAMETER = ORB.radius * 1.2;
const HALO_DIAMETER = ORB.radius * 2.4;
const HALO_ALPHA = 0.4;
const PULSE_AMOUNT = 0.1; // ±10 % de escala
const PULSE_HZ = 6;
const BURST_S = 0.25;
const BURST_COUNT = 14;

const lerpProjectile = (a: ProjectileSnapshot, b: ProjectileSnapshot, t: number): ProjectileSnapshot => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

interface ProjectileView {
  buffer: SnapshotBuffer<ProjectileSnapshot>;
  /** núcleo: lleva la posición y el pulso; el halo cuelga de él */
  core: Mesh;
  halo: Mesh;
  trail: ParticleSystem;
  goneAtMs?: number;
}

/** Estallido corto en el último punto de un orbe; muere con el reloj de juego. */
interface Burst {
  ps: ParticleSystem;
  endMs: number;
}

function emitter(name: string, texture: DynamicTexture, scene: Scene): ParticleSystem {
  const ps = new ParticleSystem(name, 60, scene);
  ps.particleTexture = texture;
  ps.color1 = new Color4(0.7, 1, 0.8, 1);
  ps.color2 = new Color4(CASTER_COLORS.mage.r, CASTER_COLORS.mage.g, CASTER_COLORS.mage.b, 1);
  ps.colorDead = new Color4(0.1, 0.5, 0.3, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  return ps;
}

/** Orbes arcanos de los hechiceros: núcleo, halo pulsante y estela de partículas; estallido al desaparecer. */
export class ProjectileViews {
  private readonly views = new Map<string, ProjectileView>();
  private readonly bursts: Burst[] = [];
  private readonly coreMat: StandardMaterial;
  private readonly haloMat: StandardMaterial;
  private readonly spark: DynamicTexture;
  private paused = false;
  private lastMs = 0;

  constructor(private readonly scene: Scene) {
    const emissive = (name: string, color: Color3, alpha = 1) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = color;
      m.disableLighting = true;
      m.fogEnabled = false;
      m.alpha = alpha;
      return m;
    };
    this.coreMat = emissive("projectile", new Color3(0.85, 1, 0.9));
    this.haloMat = emissive("projectileHalo", CASTER_COLORS.mage, HALO_ALPHA);
    this.spark = sparkTexture(scene, "projectile-spark");
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, p] of world.projectiles) {
      let view = this.views.get(id);
      if (!view) {
        view = this.create(id);
        this.views.set(id, view);
      }
      view.goneAtMs = undefined;
      view.buffer.push(receivedAtMs, p);
    }
    for (const [id, view] of this.views) {
      if (!world.projectiles.has(id)) view.goneAtMs ??= receivedAtMs;
    }
  }

  /** `renderAtMs`: reloj de juego interpolado; el pulso y la vida de los estallidos se congelan en la pausa. */
  render(renderAtMs: number): void {
    this.lastMs = renderAtMs;
    const pulse = 1 + PULSE_AMOUNT * Math.sin((renderAtMs / 1000) * PULSE_HZ * Math.PI * 2);
    for (const [id, view] of this.views) {
      if (view.goneAtMs !== undefined && renderAtMs >= view.goneAtMs) {
        this.burst(view.core.position, renderAtMs);
        this.disposeView(view);
        this.views.delete(id);
        continue;
      }
      const p = view.buffer.sample(renderAtMs);
      if (p) view.core.position.set(p.x, FLIGHT_Y, p.z);
      view.core.scaling.setAll(pulse);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (renderAtMs >= this.bursts[i]!.endMs) {
        this.bursts[i]!.ps.dispose(false);
        this.bursts.splice(i, 1);
      }
    }
  }

  /** En la pausa las partículas (estelas y estallidos) dejan de avanzar. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    const speed = paused ? 0 : PARTICLE_SPEED;
    for (const v of this.views.values()) v.trail.updateSpeed = speed;
    for (const b of this.bursts) b.ps.updateSpeed = speed;
  }

  dispose(): void {
    for (const view of this.views.values()) this.disposeView(view);
    this.views.clear();
    for (const b of this.bursts) b.ps.dispose(false);
    this.bursts.length = 0;
    this.coreMat.dispose();
    this.haloMat.dispose();
    this.spark.dispose();
  }

  private create(id: string): ProjectileView {
    const core = CreateSphere(`projectile-${id}`, { diameter: CORE_DIAMETER, segments: 8 }, this.scene);
    core.material = this.coreMat;
    core.isPickable = false;
    const halo = CreateSphere(`projectileHalo-${id}`, { diameter: HALO_DIAMETER, segments: 8 }, this.scene);
    halo.material = this.haloMat;
    halo.parent = core;
    halo.isPickable = false;
    const trail = emitter(`projectileTrail-${id}`, this.spark, this.scene);
    trail.emitter = core;
    trail.minEmitBox = trail.maxEmitBox = Vector3.Zero();
    trail.minSize = 0.08;
    trail.maxSize = 0.2;
    trail.minLifeTime = 0.15;
    trail.maxLifeTime = 0.35;
    trail.emitRate = 50;
    trail.minEmitPower = 0;
    trail.maxEmitPower = 0.3;
    trail.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
    trail.start();
    return { buffer: new SnapshotBuffer(lerpProjectile), core, halo, trail };
  }

  private burst(at: Vector3, nowMs: number): void {
    const ps = emitter(`projectileBurst-${this.bursts.length}`, this.spark, this.scene);
    ps.emitter = at.clone();
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
    view.trail.dispose(false); // la textura es compartida
    view.core.dispose(); // arrastra al halo (hijo)
  }
}
