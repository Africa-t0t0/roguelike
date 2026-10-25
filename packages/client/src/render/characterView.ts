import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import type { WeaponId } from "@roguelike/shared";
import { boneKey, type AnimLibrary } from "./animLibrary";
import type { AnimChoice } from "./animState";
import type { AssetId, Assets } from "./assets";
import { WEAPON_LOOKS } from "./looks";

/**
 * Giro constante del modelo respecto de `facing` (0 = +Z, π/2 = +X). Los personajes de Mixamo, tras
 * la conversión de mano del cargador glTF, ya miran hacia +Z.
 */
const MODEL_YAW_OFFSET = 0;
const CROSSFADE_S = 0.15;

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
  private weapon: { id: WeaponId; grip: TransformNode } | undefined;
  private readonly observer: Observer<Scene>;
  private readonly skeletons: Skeleton[];

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

    this.observer = scene.onBeforeRenderObservable.add(() => this.fade(scene.getEngine().getDeltaTime() / 1000));
  }

  setPose(x: number, y: number, z: number, facing: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = facing;
  }

  /** Cuelga el arma de la mano derecha con su agarre de `WEAPON_LOOKS`; con `null` la quita. */
  setWeapon(weaponId: WeaponId | null): void {
    if (this.weapon?.id === weaponId) return;
    this.weapon?.grip.dispose(); // sin materiales: son del contenedor, compartidos
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
    const k = s > 1e-9 ? 1 / s : 1;
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
    this.weapon = { id: weaponId, grip: node };
  }

  /** Cambia de clip con un cruce; si `choice.clip` ya suena solo ajusta la velocidad (salvo `restart`). */
  play(choice: AnimChoice, restart = false): void {
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

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    for (const g of this.groups.values()) g?.dispose();
    this.groups.clear();
    this.fadingOut.clear();
    this.current = undefined;
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
