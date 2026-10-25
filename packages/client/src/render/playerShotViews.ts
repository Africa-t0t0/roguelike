import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/instancedMesh"; // registra Mesh.createInstance
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { PlayerShotSnapshot, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";

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
  private readonly material: StandardMaterial;
  private readonly template: Mesh;

  constructor(private readonly scene: Scene) {
    const m = new StandardMaterial("cleaveWave", scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(1, 0.85, 0.5);
    m.disableLighting = true;
    m.fogEnabled = false;
    m.alpha = 0.85;
    this.material = m;

    // Arco en el plano XZ, centrado en el origen y combado hacia +Z (la dirección de avance).
    const path: Vector3[] = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const a = -ARC / 2 + (ARC * i) / n;
      path.push(new Vector3(Math.sin(a), 0, Math.cos(a) - 1));
    }
    const template = CreateTube(
      "cleaveWaveTemplate",
      { path, radiusFunction: (i) => THICKNESS * Math.sin((Math.PI * i) / n) + 0.005, tessellation: 6, cap: 0 },
      scene,
    );
    template.material = m;
    template.isPickable = false;
    template.isVisible = false;
    this.template = template;
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, s] of world.playerShots) {
      let view = this.views.get(id);
      if (!view) {
        const mesh = this.template.createInstance(`cleaveWave-${id}`);
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
    this.template.dispose();
    this.material.dispose();
  }
}
