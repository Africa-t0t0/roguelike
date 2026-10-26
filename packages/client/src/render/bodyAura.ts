import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { CasterKind, Nature } from "@roguelike/shared";
import { PARTICLE_SPEED } from "./fxTextures";
import type { BoneSource } from "./gearLooks";
import { NATURE_COLORS } from "./natureLooks";

/** Dorado del élite sin naturaleza. */
const ELITE_GOLD = new Color3(1, 0.8, 0.25);
/** Colores de los hechiceros (los mismos de `CASTER_COLORS`, repetidos aquí para no importar casterLooks y su OutlineRenderer). */
const CASTER_AURA: Record<CasterKind, Color3> = {
  mage: new Color3(0.3, 1, 0.55),
  pyromancer: new Color3(1, 0.45, 0.1),
  stormcaller: new Color3(1, 0.92, 0.4),
};

/** Cómo arde el aura de un enemigo. */
export interface AuraParams {
  color: Color3;
  /** llamas por segundo en un emisor de peso 1 */
  rate: number;
  /** tamaño medio de la llama (m), en un enemigo de 1,8 m */
  size: number;
  /** opacidad máxima del núcleo de la llama */
  alpha: number;
}

/**
 * Aura de cuerpo según quién la lleva: el élite arde fuerte en el color de su naturaleza (dorado si no tiene); los
 * hechiceros, más tenue y en el color de su tipo, y el tier 2 y 3 del hechizo la suben (ritmo, tamaño y opacidad).
 */
export function auraParams(who: "elite" | CasterKind, tier = 1, nature: Nature = "none"): AuraParams {
  if (who === "elite") return { color: nature === "none" ? ELITE_GOLD : NATURE_COLORS[nature], rate: 9, size: 0.38, alpha: 0.6 };
  const t = Math.min(3, Math.max(1, Math.round(tier))) - 1;
  return { color: CASTER_AURA[who], rate: [3.5, 5, 6.5][t]!, size: [0.28, 0.32, 0.37][t]!, alpha: [0.3, 0.38, 0.46][t]! };
}

/** Huesos (claves de `boneKey`) con su peso de ritmo y de tamaño: tronco y cadera más densos, cabeza y brazos más finos. */
export const AURA_BONES: readonly { bone: string; rate: number; size: number }[] = [
  { bone: "spine2", rate: 1.5, size: 1.25 }, // pecho y espalda
  { bone: "hips", rate: 1, size: 1.1 },
  { bone: "head", rate: 0.8, size: 0.8 },
  { bone: "leftarm", rate: 0.8, size: 0.85 }, // hombros / brazos
  { bone: "rightarm", rate: 0.8, size: 0.85 },
  { bone: "leftleg", rate: 0.8, size: 0.9 }, // espinillas
  { bone: "rightleg", rate: 0.8, size: 0.9 },
];

const REF_HEIGHT = 1.8;
const LIFE_MIN = 0.7;
const LIFE_MAX = 1.2;
const RISE = 1.1; // m/s²: la llama sube

/** Un emisor de llamas pegado a un hueso. */
export interface FlameEmitter {
  node: Mesh;
  ps: ParticleSystem;
  /** llamas por segundo con la emisión activa */
  rate: number;
}

/**
 * Un emisor de llamas aditivas sobre un hueso (compartido por el aura de los enemigos y el brillo del equipo):
 * nacen en una esfera pequeña, suben y se estrechan al apagarse. `size` es el tamaño medio de la llama (m) y `k`
 * escala radio de nacimiento y tamaño según la altura del personaje.
 */
export function createFlameEmitter(
  scene: Scene,
  flame: DynamicTexture,
  mount: { node: TransformNode; perMeter: number },
  name: string,
  color: Color3,
  rate: number,
  size: number,
  alpha: number,
  k = 1,
): FlameEmitter {
  const c = color;
  const node = new Mesh(`${name}-emitter`, scene);
  node.parent = mount.node;
  node.scaling.setAll(mount.perMeter); // el hueso está escalado: radios y velocidades quedan en metros
  node.isPickable = false;
  node.metadata = { noTint: true }; // no es cuerpo: ni contorno ni capa de color
  const ps = new ParticleSystem(name, Math.ceil(rate * LIFE_MAX) + 4, scene);
  ps.particleTexture = flame;
  ps.emitter = node;
  ps.createSphereEmitter(0.1 * k, 1);
  ps.addColorGradient(0, new Color4(c.r + (1 - c.r) * 0.55, c.g + (1 - c.g) * 0.55, c.b + (1 - c.b) * 0.55, alpha));
  ps.addColorGradient(0.45, new Color4(c.r, c.g, c.b, alpha * 0.7));
  ps.addColorGradient(1, new Color4(c.r * 0.7, c.g * 0.7, c.b * 0.7, 0));
  ps.addSizeGradient(0, 0.8);
  ps.addSizeGradient(0.4, 1);
  ps.addSizeGradient(1, 0.35); // la llama se estrecha al subir
  ps.minSize = size * 0.7;
  ps.maxSize = size * 1.3;
  ps.minLifeTime = LIFE_MIN;
  ps.maxLifeTime = LIFE_MAX;
  ps.emitRate = rate;
  ps.minEmitPower = 0.05;
  ps.maxEmitPower = 0.25;
  ps.gravity = new Vector3(0, RISE, 0);
  ps.minAngularSpeed = -0.5;
  ps.maxAngularSpeed = 0.5;
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.updateSpeed = PARTICLE_SPEED;
  ps.start();
  return { node, ps, rate };
}

/** Libera el sistema y su nodo (la textura es compartida). */
export function disposeFlameEmitter(e: FlameEmitter): void {
  e.ps.dispose(false);
  e.node.dispose();
}

/**
 * Llamas suaves pegadas a varios huesos del personaje (tronco, cadera, cabeza, brazos, piernas; hasta 7 emisores):
 * suben y se apagan envolviendo la silueta. Textura compartida (la libera quien la creó); se congela en la pausa
 * (`setPaused`) y `setActive(false)` deja de emitir y las llamas vivas se apagan solas.
 */
export class BodyAura {
  private readonly emitters: FlameEmitter[] = [];
  private paused = false;
  private active = true;

  constructor(scene: Scene, flame: DynamicTexture, character: BoneSource, params: AuraParams, height = REF_HEIGHT) {
    const k = Math.min(1.5, Math.max(0.8, height / REF_HEIGHT));
    for (const spec of AURA_BONES) {
      const mount = character.boneMount(spec.bone);
      if (!mount) continue;
      this.emitters.push(
        createFlameEmitter(scene, flame, mount, `aura-${spec.bone}`, params.color, params.rate * spec.rate, params.size * spec.size * k, params.alpha, k),
      );
    }
  }

  get emitterCount(): number {
    return this.emitters.length;
  }

  /** Sigue emitiendo o no; las llamas ya nacidas terminan su vida. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    for (const e of this.emitters) e.ps.emitRate = active ? e.rate : 0;
  }

  /** Las partículas avanzan con los cuadros: se congelan en la pausa del grupo. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const e of this.emitters) e.ps.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Sin textura: es compartida. */
  dispose(): void {
    for (const e of this.emitters) disposeFlameEmitter(e);
    this.emitters.length = 0;
  }
}
