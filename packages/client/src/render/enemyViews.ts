import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import { casterTelegraphS, ELITE, ENEMY_DEFS, enemyAttack, isCaster, TIERS, type CasterKind, type EnemyKind, type Nature, type WeaponId, type WeaponTier } from "@roguelike/shared";
import type { EnemySnapshot, WorldSnapshot } from "../net/connection";
import { SnapshotBuffer } from "../net/SnapshotBuffer";
import type { AnimLibrary } from "./animLibrary";
import { chooseEnemyAnim, SpeedMeter, type ClipLengths } from "./animState";
import type { Assets } from "./assets";
import { applyCasterTint, applyTint, CASTER_COLORS, chargeScale, markNoTint } from "./casterLooks";
import { PARTICLE_SPEED, sparkTexture } from "./fxTextures";
import { eliteName, NATURE_COLORS } from "./natureLooks";
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

/** Élite: aura dorada, rótulo sobre la barra de vida y contorno emisivo del color de su naturaleza. */
const ELITE_GOLD = new Color3(1, 0.8, 0.25);
const ELITE_AURA_EXTRA = 0.8; // m sobre el radio del enemigo ya escalado
const ELITE_LABEL_ABOVE_BAR = 0.3; // m
const ELITE_LABEL_W = 4;
const ELITE_LABEL_H = 0.5; // letras de ~0,25 m: se leen a la distancia de juego
/** Brillo suave: el cuerpo conserva su color oscuro y su detalle; el emisivo solo lo "calienta". */
const ELITE_TINT = 0.2;
/** Estados: tinte cian suave al ralentizar y fuerte al congelar; brasas al arder. */
const SLOW_TINT = 0.3;
const FROZEN_TINT = 0.85;
const BURN_RATE = 24;
const BURN_EMITTER_FRAC = 0.5; // altura del emisor, fracción del alto del enemigo

type TintState = "base" | "slowed" | "frozen";

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
  elite: boolean;
  nature: Nature;
  /** alto dibujado (m): el del modelo × la escala de élite */
  height: number;
  label?: Mesh;
  tint: TintState;
  /** brasas del estado quemado; solo mientras arde */
  burn?: ParticleSystem;
  burnEmitter: Mesh;
  /** Instante (reloj de recepción) en que dejó de estar en el estado; se borra al dibujarlo. */
  goneAtMs?: number;
}

/** Enemigos de Mixamo interpolados, con su arma (si la llevan), barra de vida y aro de telegrafía. */
export class EnemyViews {
  private readonly views = new Map<string, EnemyView>();
  private readonly mats: Record<"barBack" | "barFill" | "ringEdge" | "ringFill" | "star", StandardMaterial>;
  /** Materiales de los hechiceros, uno por tipo o tier (nunca por instancia). */
  private readonly casterMats = new Map<string, StandardMaterial>();
  /** Rótulos de élite compartidos por (tipo, naturaleza): material y textura. */
  private readonly labelMats = new Map<string, StandardMaterial>();
  private ember?: DynamicTexture;
  private paused = false;
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

  private labelMat(kind: EnemyKind, nature: Nature): StandardMaterial {
    const key = `${kind}-${nature}`;
    let m = this.labelMats.get(key);
    if (!m) {
      const text = eliteName(kind, nature);
      const tex = new DynamicTexture(`eliteLabel-${key}`, { width: 1024, height: 128 }, this.scene, false);
      tex.hasAlpha = true;
      const c = nature === "none" ? ELITE_GOLD : NATURE_COLORS[nature];
      const css = `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
      // Texto con contorno oscuro sobre fondo transparente (legible contra el suelo y las paredes).
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, 1024, 128);
      ctx.font = "700 76px Cinzel, Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 12;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.strokeText(text, 512, 66);
      ctx.fillStyle = css;
      ctx.fillText(text, 512, 66);
      tex.update();
      m = flatMaterial(this.scene, `eliteLabelMat-${key}`, Color3.White());
      m.diffuseTexture = tex;
      m.useAlphaFromDiffuseTexture = true;
      this.labelMats.set(key, m);
    }
    return m;
  }

  /** Tinte del cuerpo según el estado; "base" es el del élite o el del hechicero, y si no hay, el material original. */
  private applyBodyTint(view: EnemyView, state: TintState): void {
    view.tint = state;
    const ice = NATURE_COLORS.ice;
    if (state === "frozen") applyTint(view.character.root, { key: "frozen", color: ice, strength: FROZEN_TINT });
    else if (state === "slowed") applyTint(view.character.root, { key: "slowed", color: ice, strength: SLOW_TINT });
    else if (view.elite && view.nature !== "none") applyTint(view.character.root, { key: `elite-${view.nature}`, color: NATURE_COLORS[view.nature], strength: ELITE_TINT });
    else if (isCaster(view.kind)) applyCasterTint(view.character.root, view.kind);
    else applyTint(view.character.root, null);
  }

  private setBurning(view: EnemyView, burning: boolean): void {
    if (!burning) {
      view.burn?.dispose(false); // la textura es compartida
      view.burn = undefined;
      return;
    }
    if (view.burn) return;
    this.ember ??= sparkTexture(this.scene, "enemy-ember");
    const c = NATURE_COLORS.fire;
    const ps = new ParticleSystem("enemyBurn", 60, this.scene);
    ps.particleTexture = this.ember;
    ps.emitter = view.burnEmitter;
    ps.createSphereEmitter(Math.max(0.25, view.height * 0.18), 0.6);
    ps.color1 = new Color4(c.r, c.g, c.b, 0.9);
    ps.color2 = new Color4(1, 0.8, 0.3, 0.7);
    ps.colorDead = new Color4(c.r, c.g, c.b, 0);
    ps.minSize = 0.06;
    ps.maxSize = 0.14;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 0.8;
    ps.emitRate = BURN_RATE;
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.5;
    ps.gravity = new Vector3(0, 1.5, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
    ps.start();
    view.burn = ps;
  }

  private disposeView(view: EnemyView): void {
    view.burn?.dispose(false);
    view.character.dispose();
  }

  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, e] of world.enemies) {
      let view = this.views.get(id);
      if (!view || view.kind !== e.kind || view.weaponId !== e.weaponId || (isCaster(e.kind) && view.spellTier !== e.spellTier) || view.elite !== e.elite || view.nature !== e.nature) {
        if (view) this.disposeView(view);
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
    return view?.height;
  }

  /** `renderAtMs`: instante interpolado (ahora − INTERP_DELAY_MS). */
  render(renderAtMs: number, dtS: number, hurt: (id: string) => boolean): void {
    for (const [id, view] of this.views) {
      if (view.goneAtMs !== undefined && renderAtMs >= view.goneAtMs) {
        this.disposeView(view);
        this.views.delete(id);
        continue;
      }
      const e = view.buffer.sample(renderAtMs);
      if (!e) continue;
      view.character.setPose(e.x, 0, e.z, e.facing);
      view.character.setWeapon(e.weaponId, { tier: e.weaponTier ?? 1, nature: e.weaponNature, gripScale: ENEMY_LOOKS[e.kind].gripScale });
      view.character.setFrozen(e.frozen && e.ai !== "dead");
      view.character.play(
        chooseEnemyAnim(
          {
            kind: e.kind,
            ai: e.ai,
            speed: view.speed.sample(e.x, e.z, dtS),
            hurtRecently: hurt(id),
            weaponId: e.weaponId,
            stunned: e.stunned,
            spellTier: e.spellTier,
          },
          this.clipLengths,
        ),
      );

      const tintState: TintState = e.frozen && e.ai !== "dead" ? "frozen" : e.slowed ? "slowed" : "base";
      if (tintState !== view.tint) this.applyBodyTint(view, tintState);
      this.setBurning(view, e.burning && e.ai !== "dead");
      view.label?.setEnabled(e.ai !== "dead");

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

  /** Congela (o reanuda) las partículas de las armas con naturaleza en la pausa del grupo. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const view of this.views.values()) {
      view.character.setPaused(paused);
      if (view.burn) view.burn.updateSpeed = paused ? 0 : PARTICLE_SPEED;
    }
  }

  dispose(): void {
    for (const view of this.views.values()) this.disposeView(view);
    this.views.clear();
    for (const m of this.labelMats.values()) m.dispose(false, true); // con su textura
    this.labelMats.clear();
    this.ember?.dispose();
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
    const k = e.elite ? ELITE.scale : 1;
    const height = look.height * k;
    if (e.elite) character.setBodyScale(k);
    const bodyMeshes = new Set(character.root.getChildMeshes(false));

    // Barra de vida: fondo + relleno, siempre de cara a la cámara.
    const bar = new TransformNode(`enemyBar-${id}`, scene);
    bar.parent = character.root;
    bar.position.y = height + BAR_ABOVE_HEAD;
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
      const { attackRange } = enemyAttack(kind, weaponId ? { weaponId, tier: e.weaponTier ?? 1, nature: "none" } : null);
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
    stars.position.y = height + STUN_ABOVE_HEAD;
    for (let i = 0; i < STUN_STARS; i++) {
      const a = (i / STUN_STARS) * Math.PI * 2;
      const star = CreatePolyhedron(`stunStar-${id}-${i}`, { type: 1, size: 0.06 }, scene);
      star.material = this.mats.star;
      star.parent = stars;
      star.position.set(Math.cos(a) * STUN_RADIUS, (i % 2) * 0.05, Math.sin(a) * STUN_RADIUS);
      star.isPickable = false;
    }
    stars.setEnabled(false);

    // Élite: aura dorada grande bajo los pies, rótulo con el nombre y contorno del color de su naturaleza.
    let label: Mesh | undefined;
    if (e.elite) {
      const radius = (ENEMY_DEFS[kind].radius + AURA_EXTRA_RADIUS) * k + ELITE_AURA_EXTRA - AURA_EXTRA_RADIUS;
      const aura = CreateDisc(`eliteAura-${id}`, { radius, tessellation: 40 }, scene);
      aura.material = this.casterMat("elite-aura", ELITE_GOLD, AURA_ALPHA);
      aura.parent = character.root;
      aura.position.y = AURA_Y - 0.005;
      aura.rotation.x = Math.PI / 2;
      const edge = CreateTorus(`eliteAuraRing-${id}`, { diameter: radius * 2, thickness: 0.07, tessellation: 40 }, scene);
      edge.material = this.casterMat("elite-ring", ELITE_GOLD);
      edge.parent = character.root;
      edge.position.y = AURA_RING_Y + 0.005;
      for (const m of [aura, edge]) m.isPickable = false;
      label = CreatePlane(`eliteLabel-${id}`, { width: ELITE_LABEL_W, height: ELITE_LABEL_H }, scene);
      label.material = this.labelMat(kind, e.nature);
      label.billboardMode = Mesh.BILLBOARDMODE_ALL;
      label.parent = character.root;
      label.position.y = height + BAR_ABOVE_HEAD + ELITE_LABEL_ABOVE_BAR;
      label.isPickable = false;
    }
    const burnEmitter = new Mesh(`burnEmitter-${id}`, scene);
    burnEmitter.isPickable = false;
    burnEmitter.parent = character.root;
    burnEmitter.position.y = height * BURN_EMITTER_FRAC;

    const view: EnemyView = {
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
      elite: e.elite,
      nature: e.nature,
      height,
      label,
      tint: "base",
      burnEmitter,
    };
    // Todo lo creado tras el cuerpo (barra, aros, estrellas, aura, rótulo…) no se tiñe con él.
    for (const m of character.root.getChildMeshes(false)) if (!bodyMeshes.has(m)) markNoTint(m);
    if (e.elite && e.nature !== "none") this.applyBodyTint(view, "base");
    return view;
  }
}
