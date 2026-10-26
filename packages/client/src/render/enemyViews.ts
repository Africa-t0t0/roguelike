import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { casterTelegraphS, ENEMY_DEFS, enemyAttack, isCaster, TIERS, type CasterKind, type EnemyKind, type WeaponId, type WeaponTier } from "@roguelike/shared";
import type { EnemySnapshot, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";
import type { AnimLibrary } from "./animLibrary";
import { chooseEnemyAnim, SpeedMeter, type ClipLengths } from "./animState";
import type { Assets } from "./assets";
import { applyCasterTint, CASTER_COLORS, chargeScale } from "./casterLooks";
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
/** Aturdido: un anillo de estrellas que gira sobre la cabeza (emisivas, sin luces). */
const STUN_STARS = 5;
const STUN_RADIUS = 0.38; // m
const STUN_ABOVE_HEAD = 0.08; // m: bajo la barra de vida
const STUN_SPIN = 3.2; // rad/s, con el reloj de juego (quieto en la pausa)
/** Hechiceros: aura bajo los pies (alfa fijo), anillo de tier y esfera de carga en la mano. */
const AURA_ALPHA = 0.35;
const AURA_EXTRA_RADIUS = 0.5; // m sobre el radio del enemigo
const AURA_Y = 0.02; // m: bajo el anillo de tier
const AURA_RING_Y = 0.03;
const CHARGE_DIAMETER = 0.35; // m, a carga completa

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
  /** aro rojo de telegrafía; los hechiceros no lo llevan (tienen su esfera de carga) */
  ring?: TransformNode;
  ringFill?: Mesh;
  /** tier del hechizo con el que se creó la vista (0 si no es hechicero) */
  spellTier: number;
  /** esfera de carga en la mano de un hechicero, si el modelo tiene ese hueso */
  charge?: Mesh;
  /** unidades locales de la mano por metro, para escalar la esfera */
  chargePerMeter: number;
  stars: TransformNode;
  /** Instante (reloj de recepción) en que dejó de estar en el estado; se borra al dibujarlo. */
  goneAtMs?: number;
}

/** Enemigos de Mixamo interpolados, con su arma (si la llevan), barra de vida y aro de telegrafía. */
export class EnemyViews {
  private readonly views = new Map<string, EnemyView>();
  private readonly mats: Record<"barBack" | "barFill" | "ringEdge" | "ringFill" | "star", StandardMaterial>;
  /** Materiales de los hechiceros, uno por tipo o tier (nunca por instancia). */
  private readonly casterMats = new Map<string, StandardMaterial>();
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
      star: flatMaterial(scene, "stunStar", new Color3(1, 0.86, 0.45)),
    };
  }

  private casterMat(key: string, color: Color3, alpha = 1): StandardMaterial {
    let m = this.casterMats.get(key);
    if (!m) this.casterMats.set(key, (m = flatMaterial(this.scene, `caster-${key}`, color, alpha)));
    return m;
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, e] of world.enemies) {
      let view = this.views.get(id);
      if (!view || view.kind !== e.kind || view.weaponId !== e.weaponId || (isCaster(e.kind) && view.spellTier !== e.spellTier)) {
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

      if (view.ring && view.ringFill) {
        const telegraphS = ENEMY_DEFS[e.kind].telegraphS;
        const fill = e.ai === "telegraph" ? Math.min(1, e.aiTime / telegraphS) : 0;
        view.ring.setEnabled(e.ai === "telegraph");
        view.ringFill.scaling.setAll(Math.max(0.001, fill));
      }
      if (view.charge && isCaster(e.kind)) {
        const charging = e.ai === "telegraph";
        view.charge.setEnabled(charging);
        if (charging) view.charge.scaling.setAll(view.chargePerMeter * CHARGE_DIAMETER * chargeScale(e.aiTime, casterTelegraphS(e.kind, e.spellTier)));
      }

      const stunned = e.stunned > 0 && e.ai !== "dead";
      view.stars.setEnabled(stunned);
      if (stunned) view.stars.rotation.y = ((renderAtMs / 1000) * STUN_SPIN) % (Math.PI * 2);
    }
  }

  dispose(): void {
    for (const view of this.views.values()) view.character.dispose();
    this.views.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const m of this.casterMats.values()) m.dispose();
    this.casterMats.clear();
  }

  /** Tinte del cuerpo y aura bajo los pies (disco del color del tipo y, en tier 2 y 3, un anillo del brillo del tier). */
  private decorateCaster(id: string, kind: CasterKind, spellTier: number, character: CharacterView): void {
    const scene = this.scene;
    applyCasterTint(character.root, kind);
    const radius = ENEMY_DEFS[kind].radius + AURA_EXTRA_RADIUS;
    const aura = CreateDisc(`casterAura-${id}`, { radius, tessellation: 32 }, scene);
    aura.material = this.casterMat(`aura-${kind}`, CASTER_COLORS[kind], AURA_ALPHA);
    aura.parent = character.root;
    aura.position.y = AURA_Y;
    aura.rotation.x = Math.PI / 2;
    aura.isPickable = false;
    const glow = spellTier >= 2 ? TIERS[Math.min(3, spellTier) as WeaponTier].glow : null;
    if (glow) {
      const edge = CreateTorus(`casterAuraRing-${id}`, { diameter: radius * 2, thickness: 0.05, tessellation: 32 }, scene);
      edge.material = this.casterMat(`ring-t${Math.min(3, spellTier)}`, new Color3(glow[0], glow[1], glow[2]));
      edge.parent = character.root;
      edge.position.y = AURA_RING_Y;
      edge.isPickable = false;
    }
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

    let ring: TransformNode | undefined;
    let ringFill: Mesh | undefined;
    if (!isCaster(kind)) {
      // Aro de telegrafía en el suelo: borde fijo y disco que crece hasta llenarlo. Armado, el alcance
      // es el de su arma.
      const def = ENEMY_DEFS[kind];
      const { attackRange } = enemyAttack(kind, weaponId ? { weaponId, tier: e.weaponTier ?? 1 } : null);
      const radius = Math.max(RING_MIN_RADIUS, def.radius + attackRange);
      ring = new TransformNode(`telegraph-${id}`, scene);
      ring.parent = character.root;
      ring.position.y = RING_Y;
      const edge = CreateTorus(`telegraphEdge-${id}`, { diameter: radius * 2, thickness: 0.1, tessellation: 48 }, scene);
      edge.material = this.mats.ringEdge;
      edge.parent = ring;
      ringFill = CreateDisc(`telegraphFill-${id}`, { radius, tessellation: 48 }, scene);
      ringFill.material = this.mats.ringFill;
      ringFill.parent = ring;
      ringFill.rotation.x = Math.PI / 2; // el disco se crea vertical, mirando a −Z
      ring.setEnabled(false);
      edge.isPickable = false;
      ringFill.isPickable = false;
    }
    for (const m of [back, barFill]) m.isPickable = false;

    // Hechiceros: tinte del cuerpo, aura bajo los pies y esfera de carga en la mano.
    let charge: Mesh | undefined;
    let chargePerMeter = 1;
    if (isCaster(kind)) {
      this.decorateCaster(id, kind, e.spellTier, character);
      const hand = character.handMount();
      if (hand) {
        charge = CreateSphere(`casterCharge-${id}`, { diameter: 1, segments: 8 }, scene);
        charge.material = this.casterMat(`charge-${kind}`, CASTER_COLORS[kind]);
        charge.parent = hand.node;
        charge.isPickable = false;
        charge.setEnabled(false);
        chargePerMeter = hand.perMeter;
      }
    }

    // Estrellas del aturdido: octaedros pequeños en círculo; el nodo gira.
    const stars = new TransformNode(`stunStars-${id}`, scene);
    stars.parent = character.root;
    stars.position.y = look.height + STUN_ABOVE_HEAD;
    for (let i = 0; i < STUN_STARS; i++) {
      const a = (i / STUN_STARS) * Math.PI * 2;
      const star = CreatePolyhedron(`stunStar-${id}-${i}`, { type: 1, size: 0.06 }, scene);
      star.material = this.mats.star;
      star.parent = stars;
      star.position.set(Math.cos(a) * STUN_RADIUS, (i % 2) * 0.05, Math.sin(a) * STUN_RADIUS);
      star.isPickable = false;
    }
    stars.setEnabled(false);

    return {
      kind,
      weaponId,
      spellTier: e.spellTier,
      charge,
      chargePerMeter,
      buffer: new SnapshotBuffer(lerpEnemy),
      character,
      speed: new SpeedMeter(),
      bar,
      barFill,
      ring,
      ringFill,
      stars,
    };
  }
}
