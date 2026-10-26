import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/instancedMesh"; // registra Mesh.createInstance
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Nature } from "@roguelike/shared";
import type { PlayerShotSnapshot, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";
import { NATURE_COLORS } from "./natureLooks";

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

interface ShotView {
  buffer: SnapshotBuffer<PlayerShotSnapshot>;
  mesh: InstancedMesh;
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

  /** `receivedAtMs`: instante de recepción en el reloj de juego. La naturaleza (color) viene en cada onda. */
  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, s] of world.playerShots) {
      let view = this.views.get(id);
      if (!view) {
        const mesh = this.look(s.nature).template.createInstance(`cleaveWave-${id}`);
        mesh.isPickable = false;
        mesh.scaling.set(s.radius, 1, s.radius);
        mesh.rotation.y = Math.atan2(s.dirX, s.dirZ);
        view = { buffer: new SnapshotBuffer(lerpShot), mesh };
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
      if (s) view.mesh.position.set(s.x, WAVE_Y, s.z);
    }
  }

  dispose(): void {
    for (const view of this.views.values()) view.mesh.dispose();
    this.views.clear();
    for (const { template, material } of this.looks.values()) {
      template.dispose();
      material.dispose();
    }
    this.looks.clear();
  }
}
