import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { leanRotation } from "./flinch";
import type { Nature, WeaponId, WeaponTier } from "@roguelike/shared";
import { boneKey, type AnimLibrary } from "./animLibrary";
import type { AnimChoice } from "./animState";
import type { AssetId, Assets } from "./assets";
import { WEAPON_LOOKS, type CharacterLook } from "./looks";
import { buildStaff, type StaffMesh } from "./staffMesh";
import { attachNatureFx, type NatureFx } from "./natureLooks";
import { applyTierGlow } from "./tierGlow";

/**
 * Giro constante del modelo respecto de `facing` (0 = +Z, π/2 = +X). Los personajes de Mixamo, tras
 * la conversión de mano del cargador glTF, ya miran hacia +Z.
 */
const MODEL_YAW_OFFSET = 0;
const CROSSFADE_S = 0.15;
/** constante de tiempo del giro del cuerpo hacia `setBodyYaw` */
const BODY_YAW_TAU_S = 0.08;

let nextInstance = 0;

/** Nombre original de un nodo instanciado (se le quita el sufijo propio de la instancia). */
function baseName(node: { name: string }, suffix: string): string {
  return node.name.endsWith(suffix) ? node.name.slice(0, -suffix.length) : node.name;
}

/** Escala de mundo de `node` (uniforme), con sus ancestros recalculados de arriba abajo. */
function worldScale(node: Node): number {
  const chain: Node[] = [];
  for (let n: Node | null = node; n; n = n.parent) chain.unshift(n);
  for (const n of chain) n.computeWorldMatrix(true);
  const m = node.getWorldMatrix().m;
  return Math.hypot(m[0]!, m[1]!, m[2]!);
}

/**
 * Un personaje animado: esqueleto propio por instancia, escalado a `look.height`, con un cruce de ~0,15 s entre
 * clips. Los de Mixamo usan los clips de `AnimLibrary`, reasignados a sus huesos la primera vez que suenan; los
 * que traen sus animaciones (`look.ownClips`, KayKit) suenan las suyas en lugar de las del juego.
 * `root` lleva posición y orientación; se le pueden colgar más cosas.
 */
export class CharacterView {
  readonly root: TransformNode;
  /** m */
  readonly height: number;
  private readonly suffix: string;
  /** huesos (TransformNodes del esqueleto) por `boneKey` */
  private readonly nodes = new Map<string, TransformNode>();
  private readonly groups = new Map<string, AnimationGroup | null>();
  /** animaciones propias del modelo por nombre (solo con `look.ownClips`) */
  private readonly own = new Map<string, AnimationGroup>();
  /** nodos del modelo (huesos y mallas) por su nombre original, para mostrar u ocultar sus mallas */
  private readonly named = new Map<string, TransformNode>();
  private readonly fadingOut = new Set<AnimationGroup>();
  private current: { clip: string; group: AnimationGroup } | undefined;
  private weapon:
    | {
        id: WeaponId;
        tier: WeaponTier;
        nature: Nature;
        grip: TransformNode;
        glowRoot: TransformNode;
        staff?: StaffMesh;
        fx?: NatureFx;
        /** mallas propias del modelo que se mostraron con esta arma (la primera, el arma, cuelga de `grip`) */
        own?: { meshes: TransformNode[]; parent: Node | null };
      }
    | undefined;
  private paused = false;
  private readonly observer: Observer<Scene>;
  private readonly skeletons: Skeleton[];
  private readonly body: TransformNode;
  private bodyYaw = 0;
  private bodyYawTarget = 0;
  /** escala y altura de los pies del cuerpo medidas al crearlo (sin el factor de `setBodyScale`) */
  private baseScale = 1;
  private baseY = 0;
  private frozen = false;

  constructor(
    private readonly scene: Scene,
    private readonly assets: Assets,
    private readonly anims: AnimLibrary,
    private readonly look: CharacterLook,
  ) {
    this.suffix = `#${look.asset}${nextInstance++}`;
    const suffix = this.suffix;
    this.height = look.height;
    this.root = new TransformNode(`character${suffix}`, scene);
    const body = new TransformNode(`body${suffix}`, scene);
    body.parent = this.root;
    body.rotation.y = MODEL_YAW_OFFSET;
    this.body = body;

    const entries = assets.container(look.asset).instantiateModelsToScene((n) => n + suffix, false, {
      doNotInstantiate: true,
    });
    for (const node of entries.rootNodes) node.parent = body;
    this.skeletons = entries.skeletons;
    // Los clips del propio archivo (p. ej. una pose T) no se usan salvo que el look los pida: los clips vienen de AnimLibrary.
    for (const g of entries.animationGroups) {
      if (look.ownClips) {
        g.stop();
        this.own.set(baseName(g, suffix), g);
      } else g.dispose();
    }

    for (const root of entries.rootNodes) {
      for (const n of [root, ...root.getDescendants(false)]) {
        if (!(n instanceof TransformNode)) continue;
        const name = baseName(n, suffix);
        if (!this.named.has(name)) this.named.set(name, n);
        if (n instanceof AbstractMesh) continue;
        const key = boneKey(name);
        if (!this.nodes.has(key)) this.nodes.set(key, n);
      }
    }
    for (const name of look.hideMeshes ?? []) this.named.get(name)?.setEnabled(false);

    // Unidades distintas por modelo: se mide el alto en reposo y se escala a `look.height`, con los
    // pies en y = 0.
    this.root.computeWorldMatrix(true);
    const { min, max } = body.getHierarchyBoundingVectors(true);
    const measured = max.y - min.y;
    const scale = measured > 1e-6 ? look.height / measured : 1;
    body.scaling.setAll(scale);
    body.position.y = -min.y * scale;
    this.baseScale = scale;
    this.baseY = body.position.y;

    this.observer = scene.onBeforeRenderObservable.add(() => {
      // En la pausa (animaciones congeladas) tampoco avanzan los fundidos ni el giro del cuerpo.
      const dtS = scene.animationsEnabled ? scene.getEngine().getDeltaTime() / 1000 : 0;
      this.fade(dtS);
      this.turnBody(dtS);
    });
  }

  setPose(x: number, y: number, z: number, facing: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = facing;
  }

  /** Inclina el cuerpo `angle` rad hacia la dirección de mundo `dir` (0 = +Z), pivotando en los pies; con 0 queda derecho. */
  setLean(dir: number, angle: number): void {
    const r = leanRotation(dir - this.root.rotation.y - this.body.rotation.y, angle);
    this.body.rotation.x = r.x;
    this.body.rotation.z = r.z;
  }

  /** Agranda (o achica) el cuerpo `k` veces respecto de `look.height`, con los pies en el suelo; `root` no cambia. */
  setBodyScale(k: number): void {
    this.body.scaling.setAll(this.baseScale * k);
    this.body.position.y = this.baseY * k;
  }

  /** Congelado: el clip actual se detiene (`speedRatio` 0) y los siguientes arrancan quietos; al soltarlo `play` lo restaura. */
  setFrozen(frozen: boolean): void {
    if (frozen === this.frozen) return;
    this.frozen = frozen;
    if (frozen && this.current) this.current.group.speedRatio = 0;
  }

  /** Gira el cuerpo (no `root`) `yaw` rad respecto de la mirada, de forma suave. */
  setBodyYaw(yaw: number): void {
    this.bodyYawTarget = yaw;
  }

  /**
   * Cuelga el arma de la mano derecha con su agarre de `WEAPON_LOOKS` (posición y escala por
   * `opts.gripScale`, por defecto 1), el brillo de `opts.tier` (por defecto 1) y el de `opts.nature` (por
   * defecto ninguna, con sus partículas); con `null` la quita.
   * Con la misma arma solo vuelve a teñir si cambió el tier o la naturaleza (`gripScale` se fija al colgarla).
   */
  setWeapon(weaponId: WeaponId | null, opts: { tier?: WeaponTier; gripScale?: number; nature?: Nature } = {}): void {
    const tier = opts.tier ?? 1;
    const nature = opts.nature ?? "none";
    if (this.weapon && this.weapon.id === weaponId) {
      if (this.weapon.tier !== tier || this.weapon.nature !== nature) {
        applyTierGlow(this.weapon.glowRoot, tier, nature);
        if (this.weapon.nature !== nature) {
          this.setNatureFx(this.weapon, nature);
          this.weapon.staff?.setNature(nature);
        }
        this.weapon.tier = tier;
        this.weapon.nature = nature;
      }
      return;
    }
    if (!this.weapon && weaponId === null) return;
    this.weapon?.fx?.dispose();
    const own = this.weapon?.own;
    if (own) {
      // Las mallas propias vuelven a su sitio, ocultas (son del modelo: no se desechan con el agarre).
      own.meshes[0]!.parent = own.parent;
      for (const m of own.meshes) m.setEnabled(false);
    }
    this.weapon?.grip.dispose(); // sin materiales: son del contenedor o clones por tier, compartidos
    this.weapon = undefined;
    if (weaponId === null) return;
    const ownWeapon = this.look.ownWeapons?.[weaponId];
    if (ownWeapon) {
      this.setOwnWeapon(weaponId, ownWeapon, tier, nature);
      return;
    }
    const hand = this.nodes.get("righthand");
    if (!hand) return;
    const { asset, grip } = WEAPON_LOOKS[weaponId];
    const node = new TransformNode(`grip${this.suffix}`, this.scene);
    node.parent = hand;
    // El agarre está en metros: se compensa la escala de mundo del esqueleto (constante; los huesos
    // de Mixamo no se escalan al animar).
    const s = worldScale(hand);
    const k = (s > 1e-9 ? 1 / s : 1) * (opts.gripScale ?? 1);
    node.position.set(grip.position[0] * k, grip.position[1] * k, grip.position[2] * k);
    node.rotation.set(grip.rotation[0], grip.rotation[1], grip.rotation[2]);
    node.scaling.setAll(grip.scale * k);
    // Sin modelo (el bastón) se construye por código; su orbe lleva el color de la naturaleza y no se tiñe con el tier.
    let staff: StaffMesh | undefined;
    if (asset === null) {
      staff = buildStaff(this.scene, this.suffix, nature);
      staff.root.parent = node;
    } else {
      this.attachModel(asset, node);
    }
    const glowRoot = staff?.shaft ?? node;
    if (tier !== 1 || nature !== "none") applyTierGlow(glowRoot, tier, nature);
    this.weapon = { id: weaponId, tier, nature, grip: node, glowRoot, staff };
    this.setNatureFx(this.weapon, nature);
  }

  /** Instancia el modelo `asset` colgado de `parent`. */
  private attachModel(asset: AssetId, parent: TransformNode): void {
    const model = this.assets.container(asset).instantiateModelsToScene((n) => n + this.suffix, false, {
      doNotInstantiate: true,
    });
    // Los hijos del __root__ del arma ya están en el espacio glTF, igual que la mano: se cuelgan
    // directamente (con el __root__ se aplicaría dos veces el cambio de mano).
    for (const wroot of model.rootNodes) {
      for (const child of wroot.getChildren()) child.parent = parent;
      wroot.dispose();
    }
  }

  /**
   * Arma propia del modelo: muestra sus mallas (la primera es el arma, el resto accesorios como el escudo) y cuelga
   * el arma de un agarre en su sitio, para que brille con el tier y lleve las partículas de la naturaleza.
   */
  private setOwnWeapon(weaponId: WeaponId, names: readonly string[], tier: WeaponTier, nature: Nature): void {
    const meshes = names.map((n) => this.named.get(n)).filter((m): m is TransformNode => m !== undefined);
    const blade = meshes[0];
    if (!blade) return;
    const parent = blade.parent;
    const node = new TransformNode(`grip${this.suffix}`, this.scene);
    node.parent = parent;
    blade.parent = node;
    for (const m of meshes) m.setEnabled(true);
    if (tier !== 1 || nature !== "none") applyTierGlow(node, tier, nature);
    this.weapon = { id: weaponId, tier, nature, grip: node, glowRoot: node, own: { meshes, parent } };
    this.setNatureFx(this.weapon, nature);
  }

  /** Duración (s) con la que suena `clip` a velocidad 1 en este personaje; 0 si no la tiene. */
  clipLength(clip: string): number {
    if (!this.look.ownClips) return this.anims.length(clip);
    const own = this.look.ownClips[clip];
    const g = own && this.own.get(own.clip);
    if (!own || !g) return 0;
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    return (g.to - g.from) / fps / (own.rate ?? 1);
  }

  /** Unidades locales del modelo por metro del mundo (inversa de la escala del cuerpo): para grosores en espacio de malla. */
  unitsPerMeter(): number {
    const s = this.body.scaling.x;
    return s > 1e-9 ? 1 / s : 1;
  }

  /** Congela (o reanuda) las partículas del arma: avanzan con los cuadros, no con el reloj de juego. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.weapon?.fx?.setPaused(paused);
  }

  /** Cambia el emisor de partículas del arma a la naturaleza dada (ninguno si es `"none"`). */
  private setNatureFx(weapon: { grip: TransformNode; fx?: NatureFx }, nature: Nature): void {
    weapon.fx?.dispose();
    weapon.fx = nature === "none" ? undefined : attachNatureFx(this.scene, nature, weapon.grip, this.paused);
  }

  /** Cambia de clip con un cruce; si `choice.clip` ya suena solo ajusta la velocidad (salvo `restart`). */
  play(requested: AnimChoice, restart = false): void {
    const rate = this.look.ownClips?.[requested.clip]?.rate ?? 1;
    const choice = this.frozen ? { ...requested, speed: 0 } : { ...requested, speed: requested.speed * rate };
    const group = this.group(choice.clip);
    if (!group) return;
    const cur = this.current;
    if (cur?.group === group && !restart) {
      group.speedRatio = choice.speed;
      return;
    }
    if (cur && cur.group !== group) {
      if (cur.group.isPlaying) this.fadingOut.add(cur.group);
    }
    this.fadingOut.delete(group);
    group.stop();
    group.start(choice.loop, choice.speed, group.from, group.to);
    // Si no queda nada sonando (p. ej. el clip anterior era de una vez y terminó), sin cruce:
    // con peso < 1 se mezclaría con la pose de reposo.
    group.weight = this.fadingOut.size > 0 ? 0 : 1;
    this.current = { clip: choice.clip, group };
  }

  /**
   * Hueso de la mano derecha y cuánto vale 1 m en su espacio local (el esqueleto está escalado): para
   * colgarle cosas de tamaño en metros con `scaling = perMeter × metros`.
   */
  handMount(): { node: TransformNode; perMeter: number } | undefined {
    return this.boneMount("righthand");
  }

  /**
   * Hueso por su `boneKey` (head, spine2, lefthand, righthand, leftfoot, rightfoot…) y cuánto vale 1 m en su
   * espacio local; undefined si el modelo no lo tiene.
   */
  boneMount(key: string): { node: TransformNode; perMeter: number } | undefined {
    const node = this.nodes.get(key);
    if (!node) return undefined;
    const s = worldScale(node);
    return { node, perMeter: s > 1e-9 ? 1 / s : 1 };
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    for (const g of this.groups.values()) g?.dispose();
    this.groups.clear();
    for (const g of this.own.values()) g.dispose();
    this.own.clear();
    this.fadingOut.clear();
    this.current = undefined;
    this.weapon?.fx?.dispose();
    this.weapon = undefined;
    this.root.dispose();
    for (const s of this.skeletons) s.dispose();
  }

  /** Grupo del clip para este personaje; se crea la primera vez (null si el clip no le calza). */
  private group(clip: string): AnimationGroup | null {
    // Con animaciones propias, los clips del juego sin equivalente no suenan (los de Mixamo no le calzan).
    if (this.look.ownClips) {
      const own = this.look.ownClips[clip];
      return (own && this.own.get(own.clip)) ?? null;
    }
    let g = this.groups.get(clip);
    if (g === undefined) {
      g = this.anims.bind(clip, this.nodes, clip + this.suffix);
      this.groups.set(clip, g);
    }
    return g;
  }

  private turnBody(dtS: number): void {
    if (this.bodyYaw === this.bodyYawTarget) return;
    const diff = this.bodyYawTarget - this.bodyYaw;
    this.bodyYaw = Math.abs(diff) < 1e-3 ? this.bodyYawTarget : this.bodyYaw + diff * (1 - Math.exp(-dtS / BODY_YAW_TAU_S));
    this.body.rotation.y = MODEL_YAW_OFFSET + this.bodyYaw;
  }

  private fade(dtS: number): void {
    if (this.fadingOut.size === 0) return;
    const step = Math.min(1, dtS / CROSSFADE_S);
    const cur = this.current?.group;
    if (cur) cur.weight = Math.min(1, cur.weight + step);
    for (const g of this.fadingOut) {
      const w = Math.max(0, g.weight - step);
      if (w === 0 || !g.isPlaying) {
        g.stop();
        this.fadingOut.delete(g);
      } else {
        g.weight = w;
      }
    }
    if (cur && this.fadingOut.size === 0) cur.weight = 1;
  }
}
