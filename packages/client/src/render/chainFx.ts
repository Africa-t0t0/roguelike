import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { NATURE_COLORS } from "./natureLooks";

const ARC_Y = 1; // m: altura del arco
const ARC_LIFE_S = 0.15;
const ARC_SEGMENTS = 6;
const ARC_RADIUS = 0.04; // m
const ARC_WOBBLE = 0.25; // m: desvío máximo de un punto intermedio

/** Desvío (m, perpendicular al arco) determinista del punto `i`; `salt` distingue unos arcos de otros. */
export function chainJitter(salt: number): (i: number) => number {
  return (i) => Math.sin(i * 12.9898 + salt * 78.233) * ARC_WOBBLE;
}

/**
 * Línea quebrada entre `a` y `b` (x, z en m) a 1 m de altura, en `segments` tramos. Los puntos intermedios se
 * desvían `jitter(i)` m en perpendicular; los extremos no.
 */
export function chainArcPoints(a: [number, number], b: [number, number], segments: number, jitter: (i: number) => number): Vector3[] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const px = -dz / len;
  const pz = dx / len;
  const out: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const off = i === 0 || i === segments ? 0 : jitter(i);
    out.push(new Vector3(a[0] + dx * t + px * off, ARC_Y, a[1] + dz * t + pz * off));
  }
  return out;
}

interface Arc {
  mesh: Mesh;
  startMs: number;
}

/** Arcos eléctricos amarillos del rayo encadenado: 0,15 s entre cada par de blancos; con el reloj de juego. */
export class ChainFx {
  private readonly arcs: Arc[] = [];
  private readonly mat: StandardMaterial;
  private n = 0;

  constructor(private readonly scene: Scene) {
    this.mat = new StandardMaterial("chainArc", scene);
    this.mat.diffuseColor = Color3.Black();
    this.mat.specularColor = Color3.Black();
    this.mat.emissiveColor = NATURE_COLORS.lightning;
    this.mat.disableLighting = true;
    this.mat.fogEnabled = false;
    this.mat.backFaceCulling = false;
  }

  /** Un arco por cada par de puntos [x, z] seguidos; se ven desde `startMs`. */
  play(points: readonly [number, number][], startMs: number): void {
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) continue;
      const path = chainArcPoints(a, b, ARC_SEGMENTS, chainJitter(this.n++));
      const mesh = CreateTube("chainArc", { path, radius: ARC_RADIUS, tessellation: 5 }, this.scene);
      mesh.material = this.mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.arcs.push({ mesh, startMs });
    }
  }

  render(nowMs: number): void {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i]!;
      const age = (nowMs - arc.startMs) / 1000;
      if (age >= ARC_LIFE_S) {
        arc.mesh.dispose();
        this.arcs.splice(i, 1);
      } else if (age >= 0) {
        arc.mesh.setEnabled(true);
        arc.mesh.visibility = 1 - age / ARC_LIFE_S;
      }
    }
  }

  dispose(): void {
    for (const a of this.arcs) a.mesh.dispose();
    this.arcs.length = 0;
    this.mat.dispose();
  }
}
