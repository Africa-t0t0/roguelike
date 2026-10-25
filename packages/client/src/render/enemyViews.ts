import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { ENEMY_DEFS, enemyAttack, type EnemyKind, type WeaponId } from "@roguelike/shared";
import type { EnemySnapshot, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";
import type { AnimLibrary } from "./animLibrary";
import { chooseEnemyAnim, SpeedMeter, type ClipLengths } from "./animState";
import type { Assets } from "./assets";
import { CharacterView } from "./characterView";
import { lerpAngle } from "./interpolation";
import { ENEMY_LOOKS } from "./looks";

/** La barra de vida flota a esta altura sobre la cabeza de cada modelo. */
const BAR_ABOVE_HEAD = 0.25; // m
const BAR_W = 1;
const BAR_H = 0.12;
/** El aro marca el alcance del golpe (o un mínimo, para el mago): así se ve fuera de la cabeza. */
const RING_MIN_RADIUS = 1.2; // m
const RING_Y = 0.03; // m: apenas sobre el suelo

function lerpEnemy(a: EnemySnapshot, b: EnemySnapshot, t: number): EnemySnapshot {
  return {
    ...b,
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    facing: lerpAngle(a.facing, b.facing, t),
    aiTime: a.ai === b.ai ? a.aiTime + (b.aiTime - a.aiTime) * t : b.aiTime,
  };
}

function flatMaterial(scene: Scene, name: string, color: Color3, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = color;
  m.disableLighting = true;
  m.fogEnabled = false; // la UI se lee aunque esté lejos
  m.backFaceCulling = false;
  m.alpha = alpha;
  return m;
}

interface EnemyView {
  kind: EnemyKind;
  /** el arma no cambia en la vida del enemigo; si cambiara, la vista se rehace */
  weaponId: WeaponId | null;
  buffer: SnapshotBuffer<EnemySnapshot>;
  character: CharacterView;
  speed: SpeedMeter;
  bar: TransformNode;
  barFill: Mesh;
  ring: TransformNode;
  ringFill: Mesh;
  /** Instante (reloj de recepción) en que dejó de estar en el estado; se borra al dibujarlo. */
  goneAtMs?: number;
}

/** Enemigos de Mixamo interpolados, con su arma (si la llevan), barra de vida y aro de telegrafía. */
export class EnemyViews {
  private readonly views = new Map<string, EnemyView>();
  private readonly mats: Record<"barBack" | "barFill" | "ringEdge" | "ringFill", StandardMaterial>;
  private readonly clipLengths: ClipLengths;

  constructor(
    private readonly scene: Scene,
    private readonly assets: Assets,
    private readonly anims: AnimLibrary,
  ) {
    this.clipLengths = { get: (clip) => anims.length(clip) };
    this.mats = {
      barBack: flatMaterial(scene, "enemyBarBack", new Color3(0.1, 0.05, 0.05), 0.8),
      barFill: flatMaterial(scene, "enemyBarFill", new Color3(0.85, 0.12, 0.1)),
      ringEdge: flatMaterial(scene, "telegraphEdge", new Color3(0.9, 0.1, 0.05), 0.7),
      ringFill: flatMaterial(scene, "telegraphFill", new Color3(0.9, 0.1, 0.05), 0.35),
    };
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, e] of world.enemies) {
      let view = this.views.get(id);
      if (!view || view.kind !== e.kind || view.weaponId !== e.weaponId) {
        view?.character.dispose();
        view = this.create(id, e);
        this.views.set(id, view);
      }
      view.goneAtMs = undefined;
      view.buffer.push(receivedAtMs, e);
    }
    for (const [id, view] of this.views) {
      if (!world.enemies.has(id)) view.goneAtMs ??= receivedAtMs;
    }
  }

  /** Alto (m) del enemigo `id`, si existe su vista. */
  heightOf(id: string): number | undefined {
    const view = this.views.get(id);
    return view ? ENEMY_LOOKS[view.kind].height : undefined;
  }

  /** `renderAtMs`: instante interpolado (ahora − INTERP_DELAY_MS). */
  render(renderAtMs: number, dtS: number, hurt: (id: string) => boolean): void {
    for (const [id, view] of this.views) {
      if (view.goneAtMs !== undefined && renderAtMs >= view.goneAtMs) {
        view.character.dispose();
        this.views.delete(id);
        continue;
      }
      const e = view.buffer.sample(renderAtMs);
      if (!e) continue;
      view.character.setPose(e.x, 0, e.z, e.facing);
      view.character.setWeapon(e.weaponId, { tier: e.weaponTier ?? 1, gripScale: ENEMY_LOOKS[e.kind].gripScale });
      view.character.play(
        chooseEnemyAnim(
          {
            kind: e.kind,
            ai: e.ai,
            speed: view.speed.sample(e.x, e.z, dtS),
            hurtRecently: hurt(id),
            weaponId: e.weaponId,
            stunned: e.stunned,
          },
          this.clipLengths,
        ),
      );

      const hpFrac = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 1;
      view.bar.setEnabled(e.ai !== "dead" && hpFrac < 1);
      view.barFill.scaling.x = Math.max(0.001, hpFrac);
      view.barFill.position.x = (-(1 - hpFrac) * BAR_W) / 2;

      const telegraphS = ENEMY_DEFS[e.kind].telegraphS;
      const fill = e.ai === "telegraph" ? Math.min(1, e.aiTime / telegraphS) : 0;
      view.ring.setEnabled(e.ai === "telegraph");
      view.ringFill.scaling.setAll(Math.max(0.001, fill));
    }
  }

  dispose(): void {
    for (const view of this.views.values()) view.character.dispose();
    this.views.clear();
    for (const m of Object.values(this.mats)) m.dispose();
  }

  private create(id: string, e: EnemySnapshot): EnemyView {
    const { kind, weaponId } = e;
    const scene = this.scene;
    const look = ENEMY_LOOKS[kind];
    const character = new CharacterView(scene, this.assets, this.anims, look);

    // Barra de vida: fondo + relleno, siempre de cara a la cámara.
    const bar = new TransformNode(`enemyBar-${id}`, scene);
    bar.parent = character.root;
    bar.position.y = look.height + BAR_ABOVE_HEAD;
    bar.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    const back = CreatePlane(`enemyBarBack-${id}`, { width: BAR_W + 0.06, height: BAR_H + 0.06 }, scene);
    back.material = this.mats.barBack;
    back.parent = bar;
    const barFill = CreatePlane(`enemyBarFill-${id}`, { width: BAR_W, height: BAR_H }, scene);
    barFill.material = this.mats.barFill;
    barFill.parent = bar;
    barFill.position.z = -0.01; // delante del fondo
    bar.setEnabled(false);

    // Aro de telegrafía en el suelo: borde fijo y disco que crece hasta llenarlo. Armado, el alcance
    // es el de su arma.
    const def = ENEMY_DEFS[kind];
    const { attackRange } = enemyAttack(kind, weaponId ? { weaponId, tier: e.weaponTier ?? 1 } : null);
    const radius = Math.max(RING_MIN_RADIUS, def.radius + attackRange);
    const ring = new TransformNode(`telegraph-${id}`, scene);
    ring.parent = character.root;
    ring.position.y = RING_Y;
    const edge = CreateTorus(`telegraphEdge-${id}`, { diameter: radius * 2, thickness: 0.1, tessellation: 48 }, scene);
    edge.material = this.mats.ringEdge;
    edge.parent = ring;
    const ringFill = CreateDisc(`telegraphFill-${id}`, { radius, tessellation: 48 }, scene);
    ringFill.material = this.mats.ringFill;
    ringFill.parent = ring;
    ringFill.rotation.x = Math.PI / 2; // el disco se crea vertical, mirando a −Z
    ring.setEnabled(false);
    for (const m of [back, barFill, edge, ringFill]) m.isPickable = false;

    return {
      kind,
      weaponId,
      buffer: new SnapshotBuffer(lerpEnemy),
      character,
      speed: new SpeedMeter(),
      bar,
      barFill,
      ring,
      ringFill,
    };
  }
}
