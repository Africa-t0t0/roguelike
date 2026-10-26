import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import { natureSuffix, type EnemyKind, type Nature } from "@roguelike/shared";
import { PARTICLE_SPEED, sparkTexture } from "./fxTextures";

/** Color de cada naturaleza: brillo de las armas, efectos de las habilidades y ondas de corte. */
export const NATURE_COLORS: Record<Exclude<Nature, "none">, Color3> = {
  fire: new Color3(1, 0.45, 0.1),
  ice: new Color3(0.55, 0.95, 1),
  lightning: new Color3(1, 0.92, 0.4),
};

/** `base` si no hay naturaleza; si la hay, el color de la naturaleza. */
export function natureTint(base: Color3, nature: Nature): Color3 {
  return nature === "none" ? base : NATURE_COLORS[nature];
}

const KIND_NAMES: Record<EnemyKind, string> = {
  minion: "Esbirro",
  brute: "Bruto",
  mage: "Hechicero arcano",
  pyromancer: "Piromante",
  stormcaller: "Invocador del rayo",
};

/** Nombre del élite: "Bruto de hielo", "Piromante del rayo"… */
export function eliteName(kind: EnemyKind, nature: Nature): string {
  const suffix = natureSuffix(nature);
  return suffix ? `${KIND_NAMES[kind]} ${suffix}` : KIND_NAMES[kind];
}

/** Partículas suaves de un arma con naturaleza: brasas que suben, copos que caen o chispas cortas. */
const EMBERS = { rate: 14, size: [0.04, 0.09], life: [0.5, 0.9], power: [0.1, 0.3], gravity: 1.5 } as const;
const FLAKES = { rate: 10, size: [0.03, 0.07], life: [0.8, 1.3], power: [0.05, 0.2], gravity: -0.8 } as const;
const SPARKS = { rate: 12, size: [0.03, 0.06], life: [0.12, 0.25], power: [0.5, 1.2], gravity: 0 } as const;
const PARTICLES = { fire: EMBERS, ice: FLAKES, lightning: SPARKS } as const;

/** Radio de la esfera de emisión cuando no hay mallas que medir (m). */
const DEFAULT_RADIUS_M = 0.15;

/** Textura de punto compartida por todas las armas de la escena (se libera con ella). */
const textures = new WeakMap<Scene, DynamicTexture>();
function weaponSpark(scene: Scene): DynamicTexture {
  let tex = textures.get(scene);
  if (!tex) textures.set(scene, (tex = sparkTexture(scene, "fx-weapon-spark")));
  return tex;
}

/** Un emisor de partículas colgado de un arma. */
export interface NatureFx {
  /** Las partículas avanzan con los cuadros: se congelan en la pausa del grupo. */
  setPaused(paused: boolean): void;
  /** Libera el sistema y su nodo emisor (la textura es compartida). */
  dispose(): void;
}

/**
 * Cuelga de `parent` (el arma ya instanciada) un emisor suave del color de `nature`: una esfera centrada
 * en la caja que ocupan sus mallas. El nodo emisor compensa la escala de mundo de `parent`, así tamaños
 * y velocidades quedan en metros; las partículas viven en el mundo (las brasas suben aunque el arma gire).
 */
export function attachNatureFx(scene: Scene, nature: Exclude<Nature, "none">, parent: TransformNode, paused: boolean): NatureFx {
  parent.computeWorldMatrix(true);
  const emitter = new Mesh(`nature-emitter-${nature}`, scene);
  emitter.parent = parent;
  emitter.isPickable = false;
  const m = parent.getWorldMatrix().m;
  const k = Math.hypot(m[0]!, m[1]!, m[2]!);
  if (k > 1e-9) emitter.scaling.setAll(1 / k);
  let radius = DEFAULT_RADIUS_M;
  const { min, max } = parent.getHierarchyBoundingVectors(true);
  if (Number.isFinite(min.x) && Number.isFinite(max.x) && max.x >= min.x) {
    const centre = Vector3.TransformCoordinates(min.add(max).scale(0.5), Matrix.Invert(parent.getWorldMatrix()));
    emitter.position.copyFrom(centre);
    const extent = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
    radius = Math.min(0.6, Math.max(DEFAULT_RADIUS_M, extent * 0.3));
  }

  const look = PARTICLES[nature];
  const color = NATURE_COLORS[nature];
  const ps = new ParticleSystem(`nature-${nature}`, 60, scene);
  ps.particleTexture = weaponSpark(scene);
  ps.emitter = emitter;
  ps.createSphereEmitter(radius, 0.5);
  ps.color1 = new Color4(color.r, color.g, color.b, 0.9);
  ps.color2 = new Color4(Math.min(1, color.r + 0.3), Math.min(1, color.g + 0.3), Math.min(1, color.b + 0.3), 0.7);
  ps.colorDead = new Color4(color.r, color.g, color.b, 0);
  ps.minSize = look.size[0];
  ps.maxSize = look.size[1];
  ps.minLifeTime = look.life[0];
  ps.maxLifeTime = look.life[1];
  ps.emitRate = look.rate;
  ps.minEmitPower = look.power[0];
  ps.maxEmitPower = look.power[1];
  ps.gravity = new Vector3(0, look.gravity, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  ps.start();
  return {
    setPaused: (p) => {
      ps.updateSpeed = p ? 0 : PARTICLE_SPEED;
    },
    dispose: () => {
      ps.dispose(false);
      emitter.dispose();
    },
  };
}
