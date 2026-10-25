import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { OrbSnapshot } from "../net/connection";

const SMOOTH_TAU_S = 0.05; // suavizado hacia la posición del estado
const HOVER_Y = 0.35; // m sobre el piso
const BOB_M = 0.06;
const BOB_RAD_PER_S = 3;
const PULSE_RAD_PER_S = 5;
const BASE_DIAMETER_M = 0.18;
const DIAMETER_PER_XP_M = 0.03; // los orbes de más XP se ven algo más grandes
const WARM: readonly [number, number, number] = [1, 0.72, 0.25];

/** Lerp exponencial de `cur` hacia `target` tras `dt` s, con constante de tiempo `tau`. */
export function smoothToward(cur: number, target: number, dt: number, tau: number): number {
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

interface OrbView {
  mesh: Mesh;
  x: number;
  z: number;
  target: OrbSnapshot;
  phase: number; // para que no suban y bajen todos a la vez
}

/**
 * Orbes de XP: esferas pequeñas, cálidas y emisivas, con un solo material compartido cuyo brillo pulsa. Sin luz
 * propia (presupuesto de luces). Se suavizan hacia la posición del estado (el imán los mueve a 8 m/s).
 */
export class OrbViews {
  private readonly views = new Map<string, OrbView>();
  private readonly material: StandardMaterial;
  private serial = 0;

  constructor(private readonly scene: Scene) {
    const m = new StandardMaterial("xp-orb", scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(...WARM);
    m.disableLighting = true;
    m.fogEnabled = false;
    this.material = m;
  }

  /** Crea los orbes nuevos (ya en su sitio), actualiza el destino de los demás y libera los que no están. */
  sync(orbs: ReadonlyMap<string, OrbSnapshot>): void {
    for (const [id, o] of orbs) {
      const view = this.views.get(id);
      if (view) {
        view.target = { ...o };
        continue;
      }
      const diameter = BASE_DIAMETER_M + DIAMETER_PER_XP_M * Math.max(0, o.value - 1);
      const mesh = CreateSphere(`xp-orb-${id}`, { diameter, segments: 6 }, this.scene);
      mesh.material = this.material;
      mesh.isPickable = false;
      mesh.position.set(o.x, HOVER_Y, o.z);
      this.views.set(id, { mesh, x: o.x, z: o.z, target: { ...o }, phase: this.serial++ * 1.7 });
    }
    for (const [id, view] of this.views) {
      if (orbs.has(id)) continue;
      view.mesh.dispose();
      this.views.delete(id);
    }
  }

  render(dt: number, nowMs: number): void {
    const t = nowMs / 1000;
    const pulse = 0.75 + 0.25 * Math.sin(t * PULSE_RAD_PER_S);
    this.material.emissiveColor.set(WARM[0] * pulse, WARM[1] * pulse, WARM[2] * pulse);
    for (const view of this.views.values()) {
      view.x = smoothToward(view.x, view.target.x, dt, SMOOTH_TAU_S);
      view.z = smoothToward(view.z, view.target.z, dt, SMOOTH_TAU_S);
      view.mesh.position.set(view.x, HOVER_Y + BOB_M * Math.sin(t * BOB_RAD_PER_S + view.phase), view.z);
    }
  }

  ids(): string[] {
    return [...this.views.keys()];
  }

  positionOf(id: string): { x: number; z: number } | undefined {
    const view = this.views.get(id);
    return view && { x: view.x, z: view.z };
  }

  dispose(): void {
    for (const view of this.views.values()) view.mesh.dispose();
    this.views.clear();
    this.material.dispose();
  }
}
