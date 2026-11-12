import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Nature } from "@roguelike/shared";
import { NATURE_COLORS } from "./natureLooks";
import { ARCANE_COLOR } from "./staffMesh";

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

/** Haz del Rayo arcano: recto, más grueso y un poco más duradero que el arco del rayo. */
const BEAM_LIFE_S = 0.28;
const BEAM_RADIUS = 0.09;
const BEAM_Y = 1.15;

interface Arc {
  mesh: Mesh;
  startMs: number;
  lifeS: number;
}

/** Arcos eléctricos amarillos del rayo encadenado: 0,15 s entre cada par de blancos; con el reloj de juego. */
export class ChainFx {
  private readonly arcs: Arc[] = [];
  private readonly mat: StandardMaterial;
  private readonly beamMat: StandardMaterial;
  private readonly beamCoreMat: StandardMaterial;
  private readonly healMat: StandardMaterial;
  private readonly natureMats = new Map<Nature, StandardMaterial>();
  private n = 0;

  constructor(private readonly scene: Scene) {
    this.mat = new StandardMaterial("chainArc", scene);
    this.mat.diffuseColor = Color3.Black();
    this.mat.specularColor = Color3.Black();
    this.mat.emissiveColor = NATURE_COLORS.lightning;
    this.mat.disableLighting = true;
    this.mat.fogEnabled = false;
    this.mat.backFaceCulling = false;
    this.beamMat = this.mat.clone("arcaneBeam");
    this.beamMat.emissiveColor = ARCANE_COLOR.clone();
    this.beamMat.alpha = 0.75;
    this.healMat = this.beamMat.clone("healBeam");
    this.healMat.emissiveColor = new Color3(0.45, 1, 0.5);
    this.beamCoreMat = this.mat.clone("arcaneBeamCore");
    this.beamCoreMat.emissiveColor = new Color3(0.95, 0.88, 1);
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
      this.arcs.push({ mesh, startMs, lifeS: ARC_LIFE_S });
    }
  }

  /** Haz del Rayo arcano por esos puntos [x, z] (del mago a cada golpeado): un tubo violeta con su núcleo claro. */
  beam(points: readonly [number, number][], startMs: number, kind: "arcane" | "heal" = "arcane", nature: Nature = "none"): void {
    const path = points.map(([x, z]) => new Vector3(x, BEAM_Y, z));
    if (path.length < 2) return;
    // `heal`: el haz verde de un curandero enemigo a quien cura. El del mago, del color de la naturaleza de su bastón.
    for (const [radius, mat] of [[BEAM_RADIUS, kind === "heal" ? this.healMat : this.natureBeam(nature)], [BEAM_RADIUS * 0.4, this.beamCoreMat]] as const) {
      const mesh = CreateTube("arcaneBeam", { path, radius, tessellation: 8 }, this.scene);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.arcs.push({ mesh, startMs, lifeS: BEAM_LIFE_S });
    }
  }

  private natureBeam(nature: Nature): StandardMaterial {
    if (nature === "none") return this.beamMat;
    let mat = this.natureMats.get(nature);
    if (!mat) {
      mat = this.beamMat.clone(`arcaneBeam-${nature}`);
      mat.emissiveColor = NATURE_COLORS[nature].clone();
      this.natureMats.set(nature, mat);
    }
    return mat;
  }

  render(nowMs: number): void {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i]!;
      const age = (nowMs - arc.startMs) / 1000;
      if (age >= arc.lifeS) {
        arc.mesh.dispose();
        this.arcs.splice(i, 1);
      } else if (age >= 0) {
        arc.mesh.setEnabled(true);
        arc.mesh.visibility = 1 - age / arc.lifeS;
      }
    }
  }

  dispose(): void {
    for (const a of this.arcs) a.mesh.dispose();
    this.arcs.length = 0;
    this.mat.dispose();
    this.beamMat.dispose();
    this.beamCoreMat.dispose();
    this.healMat.dispose();
    for (const m of this.natureMats.values()) m.dispose();
    this.natureMats.clear();
  }
}
