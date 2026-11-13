import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import type { TotemPhase } from "@roguelike/shared";
import { PARTICLE_SPEED, sparkTexture } from "./fxTextures";

const STONE = new Color3(0.22, 0.2, 0.22);
/** Color de las runas por fase: brasa dormida, rojo de pelea, violeta del portal abierto. */
export const TOTEM_COLORS: Record<TotemPhase, Color3> = {
  idle: new Color3(1, 0.55, 0.15),
  fight: new Color3(1, 0.12, 0.05),
  open: new Color3(0.6, 0.35, 1),
};
const HEIGHT = 3;
const RUNE_HEIGHTS = [0.8, 1.6, 2.4];

/** Brillo de las runas: late despacio dormido, rápido en pelea y fuerte abierto. */
export function totemPulse(phase: TotemPhase, tS: number): number {
  if (phase === "idle") return 0.45 + 0.25 * Math.sin(tS * 1.6);
  if (phase === "fight") return 0.6 + 0.4 * Math.sin(tS * 9);
  return 0.85 + 0.15 * Math.sin(tS * 3);
}

/**
 * El tótem de la sala del jefe: un obelisco de piedra con aros de runas. Dormido brilla como brasa, con el jefe
 * vivo late en rojo y, abierto, gira un portal violeta a sus pies con chispas que suben.
 */
export class TotemView {
  private readonly root: TransformNode;
  private readonly runes: Mesh[] = [];
  private readonly runeMat: StandardMaterial;
  private readonly portal: Mesh;
  private readonly portalMat: StandardMaterial;
  private readonly motes: ParticleSystem;
  private readonly meshes: Mesh[] = [];
  private phase: TotemPhase = "idle";

  constructor(private readonly scene: Scene, x: number, z: number) {
    this.root = new TransformNode("totem", scene);
    this.root.position.set(x, 0, z);
    const stone = new StandardMaterial("totemStone", scene);
    stone.diffuseColor = STONE;
    stone.specularColor = new Color3(0.05, 0.05, 0.05);
    const base = CreateCylinder("totemBase", { height: 0.35, diameterTop: 1.6, diameterBottom: 1.9, tessellation: 8 }, scene);
    base.position.y = 0.17;
    const pillar = CreateCylinder("totemPillar", { height: HEIGHT, diameterTop: 0.5, diameterBottom: 0.95, tessellation: 4 }, scene);
    pillar.position.y = 0.35 + HEIGHT / 2;
    pillar.rotation.y = Math.PI / 4;
    for (const m of [base, pillar]) {
      m.material = stone;
      m.parent = this.root;
      m.isPickable = false;
      this.meshes.push(m);
    }
    this.runeMat = new StandardMaterial("totemRunes", scene);
    this.runeMat.diffuseColor = Color3.Black();
    this.runeMat.specularColor = Color3.Black();
    this.runeMat.disableLighting = true;
    for (const [i, y] of RUNE_HEIGHTS.entries()) {
      const r = CreateTorus(`totemRune${i}`, { diameter: 1.25 - i * 0.2, thickness: 0.05, tessellation: 32 }, scene);
      r.position.y = y;
      r.material = this.runeMat;
      r.parent = this.root;
      r.isPickable = false;
      this.runes.push(r);
      this.meshes.push(r);
    }
    this.portalMat = new StandardMaterial("totemPortal", scene);
    this.portalMat.diffuseColor = Color3.Black();
    this.portalMat.specularColor = Color3.Black();
    this.portalMat.emissiveColor = TOTEM_COLORS.open;
    this.portalMat.disableLighting = true;
    this.portalMat.alpha = 0.5;
    this.portal = CreateDisc("totemPortal", { radius: 2.2, tessellation: 40 }, scene);
    this.portal.rotation.x = Math.PI / 2;
    this.portal.position.y = 0.05;
    this.portal.material = this.portalMat;
    this.portal.parent = this.root;
    this.portal.isPickable = false;
    this.meshes.push(this.portal);
    this.motes = new ParticleSystem("totemMotes", 200, scene);
    this.motes.particleTexture = sparkTexture(scene, "totem-spark");
    this.motes.emitter = new Vector3(x, 0.3, z);
    this.motes.minEmitBox = new Vector3(-1.6, 0, -1.6);
    this.motes.maxEmitBox = new Vector3(1.6, 0, 1.6);
    this.motes.minSize = 0.06;
    this.motes.maxSize = 0.16;
    this.motes.minLifeTime = 0.8;
    this.motes.maxLifeTime = 1.6;
    this.motes.minEmitPower = 0.5;
    this.motes.maxEmitPower = 1.4;
    this.motes.direction1 = new Vector3(-0.1, 1, -0.1);
    this.motes.direction2 = new Vector3(0.1, 1.5, 0.1);
    this.motes.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.motes.updateSpeed = PARTICLE_SPEED;
    this.motes.start();
    this.setPhase("idle");
  }

  setPhase(phase: TotemPhase): void {
    this.phase = phase;
    const c = TOTEM_COLORS[phase];
    this.motes.color1 = new Color4(c.r, c.g, c.b, 1);
    this.motes.color2 = new Color4(1, 1, 1, 0.8);
    this.motes.colorDead = new Color4(c.r, c.g, c.b, 0);
    this.motes.emitRate = phase === "open" ? 60 : phase === "fight" ? 25 : 6;
    this.portal.setEnabled(phase === "open");
  }

  /** `nowMs`: reloj de juego. */
  render(nowMs: number): void {
    const t = nowMs / 1000;
    this.runeMat.emissiveColor = TOTEM_COLORS[this.phase].scale(totemPulse(this.phase, t));
    for (const [i, r] of this.runes.entries()) r.rotation.y = t * (0.4 + i * 0.25) * (i % 2 ? -1 : 1);
    if (this.phase === "open") {
      this.portal.rotation.y = t * 0.8;
      this.portal.scaling.setAll(0.92 + 0.08 * Math.sin(t * 3));
    }
  }

  setPaused(paused: boolean): void {
    this.motes.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  }

  dispose(): void {
    this.motes.dispose();
    for (const m of this.meshes) m.dispose();
    this.runeMat.dispose();
    this.portalMat.dispose();
    this.root.dispose();
  }
}
