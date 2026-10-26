import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import type { Nature, WeaponId, WeaponTier } from "@roguelike/shared";
import { boneKey, type AnimLibrary } from "./animLibrary";
import type { AnimChoice } from "./animState";
import type { AssetId, Assets } from "./assets";
import { WEAPON_LOOKS } from "./looks";
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
 * Un personaje de Mixamo: esqueleto propio por instancia, escalado a `look.height`, con los clips de
 * `AnimLibrary` reasignados a sus huesos la primera vez que suenan y un cruce de ~0,15 s entre clips.
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
  private readonly fadingOut = new Set<AnimationGroup>();
  private current: { clip: string; group: AnimationGroup } | undefined;
  private weapon: { id: WeaponId; tier: WeaponTier; nature: Nature; grip: TransformNode; fx?: NatureFx } | undefined;
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
    look: { asset: AssetId; height: number },
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
    // Los clips del propio archivo (p. ej. una pose T) no se usan: los clips vienen de AnimLibrary.
    for (const g of entries.animationGroups) g.dispose();

    for (const root of entries.rootNodes) {
      for (const n of [root, ...root.getDescendants(false)]) {
        if (!(n instanceof TransformNode) || n instanceof AbstractMesh) continue;
        const key = boneKey(baseName(n, suffix));
        if (!this.nodes.has(key)) this.nodes.set(key, n);
      }
    }

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
        applyTierGlow(this.weapon.grip, tier, nature);
        if (this.weapon.nature !== nature) this.setNatureFx(this.weapon, nature);
        this.weapon.tier = tier;
        this.weapon.nature = nature;
      }
      return;
    }
    if (!this.weapon && weaponId === null) return;
    this.weapon?.fx?.dispose();
    this.weapon?.grip.dispose(); // sin materiales: son del contenedor o clones por tier, compartidos
    this.weapon = undefined;
    if (weaponId === null) return;
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
    const model = this.assets.container(asset).instantiateModelsToScene((n) => n + this.suffix, false, {
      doNotInstantiate: true,
    });
    // Los hijos del __root__ del arma ya están en el espacio glTF, igual que la mano: se cuelgan
    // directamente (con el __root__ se aplicaría dos veces el cambio de mano).
    for (const wroot of model.rootNodes) {
      for (const child of wroot.getChildren()) child.parent = node;
      wroot.dispose();
    }
    if (tier !== 1 || nature !== "none") applyTierGlow(node, tier, nature);
    this.weapon = { id: weaponId, tier, nature, grip: node };
    this.setNatureFx(this.weapon, nature);
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
    const choice = this.frozen ? { ...requested, speed: 0 } : requested;
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
    this.fadingOut.clear();
    this.current = undefined;
    this.weapon?.fx?.dispose();
    this.weapon = undefined;
    this.root.dispose();
    for (const s of this.skeletons) s.dispose();
  }

  /** Grupo del clip para este personaje; se crea la primera vez (null si el clip no le calza). */
  private group(clip: string): AnimationGroup | null {
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
