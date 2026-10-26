import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { ORB } from "@roguelike/shared";
import type { ProjectileSnapshot, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";

const FLIGHT_Y = 1.1; // m: altura a la que vuelan
const RADIUS = ORB.radius;

const lerpProjectile = (a: ProjectileSnapshot, b: ProjectileSnapshot, t: number): ProjectileSnapshot => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

interface ProjectileView {
  buffer: SnapshotBuffer<ProjectileSnapshot>;
  mesh: Mesh;
  goneAtMs?: number;
}

/** Proyectiles de los magos: esferas brillantes interpoladas. */
export class ProjectileViews {
  private readonly views = new Map<string, ProjectileView>();
  private readonly material: StandardMaterial;

  constructor(private readonly scene: Scene) {
    const m = new StandardMaterial("projectile", scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(0.55, 1, 0.45);
    m.disableLighting = true;
    m.fogEnabled = false;
    this.material = m;
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, p] of world.projectiles) {
      let view = this.views.get(id);
      if (!view) {
        const mesh = CreateSphere(`projectile-${id}`, { diameter: RADIUS * 2, segments: 8 }, this.scene);
        mesh.material = this.material;
        mesh.isPickable = false;
        view = { buffer: new SnapshotBuffer(lerpProjectile), mesh };
        this.views.set(id, view);
      }
      view.goneAtMs = undefined;
      view.buffer.push(receivedAtMs, p);
    }
    for (const [id, view] of this.views) {
      if (!world.projectiles.has(id)) view.goneAtMs ??= receivedAtMs;
    }
  }

  render(renderAtMs: number): void {
    for (const [id, view] of this.views) {
      if (view.goneAtMs !== undefined && renderAtMs >= view.goneAtMs) {
        view.mesh.dispose();
        this.views.delete(id);
        continue;
      }
      const p = view.buffer.sample(renderAtMs);
      if (p) view.mesh.position.set(p.x, FLIGHT_Y, p.z);
    }
  }

  dispose(): void {
    for (const view of this.views.values()) view.mesh.dispose();
    this.views.clear();
    this.material.dispose();
  }
}
