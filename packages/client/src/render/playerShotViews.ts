import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/instancedMesh"; // registra Mesh.createInstance
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Nature } from "@roguelike/shared";
import type { PlayerShotSnapshot, ShotKind, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";
import { NATURE_COLORS } from "./natureLooks";
import { spellColor } from "./staffMesh";

const BASE_COLOR = new Color3(1, 0.85, 0.5);
const WAVE_Y = 1.0; // m: a la altura del tajo
/** Apertura del arco (rad) y grosor del tubo, para un radio 1 (se escala por el radio de la onda). */
const ARC = Math.PI * 0.75;
const THICKNESS = 0.12;

const lerpShot = (a: PlayerShotSnapshot, b: PlayerShotSnapshot, t: number): PlayerShotSnapshot => ({
  ...b,
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

/** La espada lanzada: largo de la hoja (m), grosor y vueltas por segundo. */
const SWORD_LENGTH = 1.7;
const SWORD_THICKNESS = 0.09;
const SWORD_SPIN_RAD_S = 26;

/** Proyectil del bastón: altura a la que vuela y cuánto se estira hacia atrás. */
const BOLT_Y = 1.2;
const BOLT_STRETCH = 2.4;
/** Remolino: vueltas por segundo y alturas y anchos (respecto de su radio) de sus aros, de abajo arriba. */
const GUST_SPIN_RAD_S = 14;
const GUST_RINGS: readonly { y: number; size: number; off: number }[] = [
  { y: 0.25, size: 0.45, off: 0.1 },
  { y: 0.8, size: 0.7, off: -0.14 },
  { y: 1.4, size: 0.95, off: 0.12 },
  { y: 2.0, size: 1.15, off: -0.1 },
];
const GUST_COLOR = new Color3(0.72, 1, 0.9);
/** Esfera: altura, diámetro del núcleo y latidos por segundo. */
const ORB_Y = 1.2;
const ORB_CORE_M = 1.1;
const ORB_PULSE_RAD_S = 12.6;

/** Proyectil del bastón propio, predicho: sale al instante en pantalla y se acaba contra un enemigo o un muro. */
interface LocalBolt {
  mesh: TransformNode;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  radius: number;
  /** metros que le quedan */
  left: number;
  lastMs: number;
}

interface ShotView {
  buffer: SnapshotBuffer<PlayerShotSnapshot>;
  mesh: TransformNode;
  kind: ShotKind;
  /** altura a la que se dibuja */
  y: number;
  /** la espada y el remolino giran sobre sí mismos; la onda no */
  spinRadS: number;
  /** núcleo de la Esfera, que late */
  core?: TransformNode;
  goneAtMs?: number;
}

/**
 * Ondas de corte de los jugadores: un arco luminoso (tubo emisivo, sin luces) que viaja interpolado, con la
 * comba hacia donde avanza. Una malla modelo de radio 1; cada onda es una instancia escalada a su radio.
 */
export class PlayerShotViews {
  private readonly views = new Map<string, ShotView>();
  /** Modelo y material por naturaleza ("none" es el dorado de siempre); los otros nacen al primer uso. */
  private readonly looks = new Map<Nature, { template: Mesh; material: StandardMaterial }>();
  /** hoja de la espada lanzada por naturaleza (comparte el material de la onda) */
  private readonly blades = new Map<Nature, Mesh>();
  /** mallas modelo y materiales de los proyectiles del mago; nacen al primer uso */
  private readonly spellTemplates = new Map<string, Mesh>();
  private localSeq = 0;
  private readonly spellMats: StandardMaterial[] = [];
  private readonly path: Vector3[] = [];
  private readonly segments = 16;

  constructor(private readonly scene: Scene) {
    // Arco en el plano XZ, centrado en el origen y combado hacia +Z (la dirección de avance).
    const n = this.segments;
    for (let i = 0; i <= n; i++) {
      const a = -ARC / 2 + (ARC * i) / n;
      this.path.push(new Vector3(Math.sin(a), 0, Math.cos(a) - 1));
    }
    this.look("none");
  }

  private look(nature: Nature): { template: Mesh; material: StandardMaterial } {
    let look = this.looks.get(nature);
    if (look) return look;
    const m = new StandardMaterial(nature === "none" ? "cleaveWave" : `cleaveWave-${nature}`, this.scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = nature === "none" ? BASE_COLOR : NATURE_COLORS[nature].clone();
    m.disableLighting = true;
    m.fogEnabled = false;
    m.alpha = 0.85;
    const n = this.segments;
    const template = CreateTube(
      nature === "none" ? "cleaveWaveTemplate" : `cleaveWaveTemplate-${nature}`,
      { path: this.path, radiusFunction: (i) => THICKNESS * Math.sin((Math.PI * i) / n) + 0.005, tessellation: 6, cap: 0 },
      this.scene,
    );
    template.material = m;
    template.isPickable = false;
    template.isVisible = false;
    look = { template, material: m };
    this.looks.set(nature, look);
    return look;
  }

  /** Hoja que gira: un tubo recto afinado en las puntas, centrado en el origen, del color de la naturaleza. */
  private blade(nature: Nature): Mesh {
    let blade = this.blades.get(nature);
    if (blade) return blade;
    const n = 8;
    const path = Array.from({ length: n + 1 }, (_, i) => new Vector3(0, 0, (i / n - 0.5) * SWORD_LENGTH));
    blade = CreateTube(
      `thrownSwordTemplate-${nature}`,
      { path, radiusFunction: (i) => SWORD_THICKNESS * Math.sin((Math.PI * i) / n) + 0.01, tessellation: 6, cap: 0 },
      this.scene,
    );
    blade.material = this.look(nature).material;
    blade.isPickable = false;
    blade.isVisible = false;
    this.blades.set(nature, blade);
    return blade;
  }

  /** `receivedAtMs`: instante de recepción en el reloj de juego. La naturaleza (color) viene en cada onda. */
  /**
   * Los proyectiles del bastón de este jugador se predicen (`predictBolt`) y los del servidor, que llegan una ida y
   * vuelta tarde, no se dibujan: se verían dos veces.
   */
  myKey = "";
  private readonly locals: LocalBolt[] = [];

  /**
   * Dispara ya, en pantalla, un proyectil del bastón propio desde (x, z) hacia `facing`. Es solo visual: el daño lo
   * decide el servidor con el suyo, que sale del mismo sitio y en la misma dirección.
   */
  predictBolt(x: number, z: number, facing: number, o: { speed: number; radius: number; range: number; nature: Nature }, nowMs: number): void {
    const mesh = this.boltMesh(`localBolt-${this.localSeq++}`, o.radius, o.nature, facing);
    mesh.position.set(x, BOLT_Y, z);
    this.locals.push({ mesh, x, z, dirX: Math.sin(facing), dirZ: Math.cos(facing), speed: o.speed, radius: o.radius, left: o.range, lastMs: nowMs });
  }

  /**
   * Avanza los proyectiles predichos con el reloj de juego. `blocked`: si ese punto es muro; `bodies`: los enemigos
   * tal como se ven, el primero que toca lo acaba.
   */
  renderLocal(nowMs: number, blocked: (x: number, z: number) => boolean, bodies: readonly { x: number; z: number; radius: number }[]): void {
    for (let i = this.locals.length - 1; i >= 0; i--) {
      const b = this.locals[i]!;
      const step = Math.min(b.left, (b.speed * Math.max(0, nowMs - b.lastMs)) / 1000);
      b.lastMs = nowMs;
      b.x += b.dirX * step;
      b.z += b.dirZ * step;
      b.left -= step;
      const hit = bodies.some((e) => (e.x - b.x) ** 2 + (e.z - b.z) ** 2 < (e.radius + b.radius) ** 2);
      if (b.left <= 0 || hit || blocked(b.x, b.z)) {
        b.mesh.dispose();
        this.locals.splice(i, 1);
        continue;
      }
      b.mesh.position.set(b.x, BOLT_Y, b.z);
    }
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, s] of world.playerShots) {
      if (s.kind === "bolt" && s.owner !== "" && s.owner === this.myKey) continue;
      let view = this.views.get(id);
      if (!view) {
        view = this.create(id, s);
        this.views.set(id, view);
      }
      view.goneAtMs = undefined;
      view.buffer.push(receivedAtMs, s);
    }
    for (const [id, view] of this.views) {
      if (!world.playerShots.has(id)) view.goneAtMs ??= receivedAtMs;
    }
  }

  /** `renderAtMs`: instante interpolado (ahora − INTERP_DELAY_MS), con el reloj de juego. */
  render(renderAtMs: number): void {
    for (const [id, view] of this.views) {
      if (view.goneAtMs !== undefined && renderAtMs >= view.goneAtMs) {
        view.mesh.dispose();
        this.views.delete(id);
        continue;
      }
      const s = view.buffer.sample(renderAtMs);
      if (s) view.mesh.position.set(s.x, view.y, s.z);
      if (view.spinRadS > 0) view.mesh.rotation.y = (renderAtMs / 1000) * view.spinRadS;
      if (view.core) view.core.scaling.setAll(1 + 0.12 * Math.sin((renderAtMs / 1000) * ORB_PULSE_RAD_S));
    }
  }

  private create(id: string, s: PlayerShotSnapshot): ShotView {
    const buffer = new SnapshotBuffer(lerpShot);
    const yaw = Math.atan2(s.dirX, s.dirZ);
    if (s.kind === "bolt") {
      // Gota de luz del color de la naturaleza del bastón, estirada hacia atrás.
      const mesh = this.boltMesh(`staffBolt-${id}`, s.radius, s.nature, yaw);
      return { buffer, mesh, kind: s.kind, y: BOLT_Y, spinRadS: 0 };
    }
    if (s.kind === "gust") {
      // Embudo de aros descentrados que giran: abajo estrecho, arriba ancho.
      const mesh = new TransformNode(`gust-${id}`, this.scene);
      for (const [i, ring] of GUST_RINGS.entries()) {
        const inst = this.gustRing(s.nature).createInstance(`gustRing-${id}-${i}`);
        inst.parent = mesh;
        inst.isPickable = false;
        inst.position.set(ring.off * s.radius, ring.y, -ring.off * s.radius);
        inst.scaling.set(ring.size * s.radius, 1, ring.size * s.radius);
      }
      return { buffer, mesh, kind: s.kind, y: 0, spinRadS: GUST_SPIN_RAD_S };
    }
    if (s.kind === "orb") {
      // Núcleo que late y, en el suelo, el aro de hasta dónde hace daño.
      const mesh = new TransformNode(`spellOrb-${id}`, this.scene);
      const core = this.spell("orb", s.nature).createInstance(`spellOrbCore-${id}`);
      core.parent = mesh;
      core.isPickable = false;
      core.position.y = ORB_Y;
      const reach = this.orbRing(s.nature).createInstance(`spellOrbReach-${id}`);
      reach.parent = mesh;
      reach.isPickable = false;
      reach.position.y = 0.06;
      reach.scaling.set(s.radius, 1, s.radius);
      return { buffer, mesh, kind: s.kind, y: 0, spinRadS: 0, core };
    }
    const sword = s.kind === "sword";
    const mesh = (sword ? this.blade(s.nature) : this.look(s.nature).template).createInstance(`${sword ? "thrownSword" : "cleaveWave"}-${id}`);
    mesh.isPickable = false;
    if (!sword) mesh.scaling.set(s.radius, 1, s.radius);
    mesh.rotation.y = yaw;
    return { buffer, mesh, kind: s.kind, y: WAVE_Y, spinRadS: sword ? SWORD_SPIN_RAD_S : 0 };
  }

  /** Gota de luz del color de la naturaleza del bastón, estirada hacia atrás, con su núcleo claro. */
  private boltMesh(name: string, radius: number, nature: Nature, yaw: number): TransformNode {
    const mesh = new TransformNode(name, this.scene);
    mesh.rotation.y = yaw;
    const halo = this.spell("bolt", nature).createInstance(`${name}-halo`);
    halo.scaling.set(radius * 1.5, radius * 1.5, radius * 2 * BOLT_STRETCH);
    halo.position.z = -radius * BOLT_STRETCH * 0.6;
    const core = this.boltCore().createInstance(`${name}-core`);
    core.scaling.setAll(radius * 1.1);
    for (const m of [halo, core]) {
      m.parent = mesh;
      m.isPickable = false;
    }
    return mesh;
  }

  /** Material emisivo sin luces de ese color. */
  private glowMat(name: string, color: Color3, alpha: number): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = color.clone();
    m.disableLighting = true;
    m.fogEnabled = false;
    m.alpha = alpha;
    this.spellMats.push(m);
    return m;
  }

  /** Esfera modelo (diámetro 1 el proyectil, `ORB_CORE_M` de diámetro la Esfera) del color de la magia de esa naturaleza. */
  private spell(kind: "bolt" | "orb", nature: Nature): Mesh {
    const key = `${kind}-${nature}`;
    let mesh = this.spellTemplates.get(key);
    if (!mesh) {
      mesh = CreateSphere(`spellTemplate-${key}`, { diameter: kind === "bolt" ? 1 : ORB_CORE_M, segments: 10 }, this.scene);
      mesh.material = this.glowMat(`spellShot-${key}`, spellColor(nature), kind === "bolt" ? 0.55 : 0.85);
      mesh.isPickable = false;
      mesh.isVisible = false;
      this.spellTemplates.set(key, mesh);
    }
    return mesh;
  }

  /** Núcleo casi blanco del proyectil del bastón (diámetro 1). */
  private boltCore(): Mesh {
    let mesh = this.spellTemplates.get("boltCore");
    if (!mesh) {
      mesh = CreateSphere("boltCoreTemplate", { diameter: 1, segments: 10 }, this.scene);
      mesh.material = this.glowMat("boltCore", new Color3(1, 0.97, 0.92), 1);
      mesh.isPickable = false;
      mesh.isVisible = false;
      this.spellTemplates.set("boltCore", mesh);
    }
    return mesh;
  }

  /** Aro modelo de radio 1 del Remolino. */
  private gustRing(nature: Nature): Mesh {
    const key = `gust-${nature}`;
    let mesh = this.spellTemplates.get(key);
    if (!mesh) {
      mesh = CreateTorus(`gustTemplate-${nature}`, { diameter: 2, thickness: 0.1, tessellation: 24 }, this.scene);
      mesh.material = this.glowMat(`gustRing-${nature}`, nature === "none" ? GUST_COLOR : NATURE_COLORS[nature], 0.6);
      mesh.isPickable = false;
      mesh.isVisible = false;
      this.spellTemplates.set(key, mesh);
    }
    return mesh;
  }

  /** Aro modelo de radio 1 del alcance de la Esfera. */
  private orbRing(nature: Nature): Mesh {
    const key = `orbRing-${nature}`;
    let mesh = this.spellTemplates.get(key);
    if (!mesh) {
      mesh = CreateTorus(`orbRingTemplate-${nature}`, { diameter: 2, thickness: 0.035, tessellation: 48 }, this.scene);
      mesh.material = this.glowMat(`orbRing-${nature}`, spellColor(nature), 0.5);
      mesh.isPickable = false;
      mesh.isVisible = false;
      this.spellTemplates.set(key, mesh);
    }
    return mesh;
  }

  dispose(): void {
    for (const view of this.views.values()) view.mesh.dispose();
    this.views.clear();
    for (const b of this.locals) b.mesh.dispose();
    this.locals.length = 0;
    for (const mesh of this.spellTemplates.values()) mesh.dispose();
    this.spellTemplates.clear();
    for (const m of this.spellMats) m.dispose();
    this.spellMats.length = 0;
    for (const { template, material } of this.looks.values()) {
      template.dispose();
      material.dispose();
    }
    this.looks.clear();
    for (const blade of this.blades.values()) blade.dispose();
    this.blades.clear();
  }
}
