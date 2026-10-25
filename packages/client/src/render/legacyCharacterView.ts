import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Node } from "@babylonjs/core/node";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { AnimChoice } from "./animState";
import type { AssetId, Assets } from "./assets";

export const CHARACTER_SCALE = 0.8;
/** Alto del modelo KayKit ya escalado (≈ 2,2 m × 0,8); sirve para poner cosas sobre la cabeza. */
export const CHARACTER_HEIGHT = 2.2 * CHARACTER_SCALE;
/**
 * Giro constante del modelo respecto de `facing` (0 = +Z, π/2 = +X). Los personajes KayKit, tras la
 * conversión de mano del cargador glTF, ya miran hacia +Z: no hace falta corregir.
 */
const MODEL_YAW_OFFSET = 0;
const CROSSFADE_S = 0.15;

let nextInstance = 0;

/** Nombre original de un nodo instanciado (se le quita el sufijo propio de la instancia). */
function baseName(node: { name: string }, suffix: string): string {
  return node.name.endsWith(suffix) ? node.name.slice(0, -suffix.length) : node.name;
}

/**
 * (Legado: se borra en la Tarea 8.) Un personaje KayKit animado: esqueleto y grupos de animación propios por instancia, con cruce
 * de ~0,15 s entre clips. `root` lleva posición y orientación; se le pueden colgar más cosas.
 */
export class LegacyCharacterView {
  readonly root: TransformNode;
  /** Duración en segundos de cada clip del modelo. */
  readonly clipLengths = new Map<string, number>();
  private readonly groups = new Map<string, AnimationGroup>();
  private readonly fadingOut = new Set<AnimationGroup>();
  private current: { clip: string; group: AnimationGroup } | undefined;
  private readonly observer: Observer<Scene>;
  private readonly skeletons: Skeleton[];

  constructor(
    private readonly scene: Scene,
    assets: Assets,
    model: AssetId,
    opts: { weapon?: AssetId; showMeshes?: string[]; hideMeshes?: string[] } = {},
  ) {
    const suffix = `#${model}${nextInstance++}`;
    this.root = new TransformNode(`character${suffix}`, scene);
    const body = new TransformNode(`body${suffix}`, scene);
    body.parent = this.root;
    body.scaling.setAll(CHARACTER_SCALE);
    body.rotation.y = MODEL_YAW_OFFSET;

    const entries = assets.container(model).instantiateModelsToScene((n) => n + suffix, false, {
      doNotInstantiate: true,
    });
    for (const node of entries.rootNodes) node.parent = body;
    this.skeletons = entries.skeletons;

    const named = (wanted: string): Node | undefined => {
      for (const root of entries.rootNodes) {
        if (baseName(root, suffix) === wanted) return root;
        const found = root.getDescendants(false, (n) => baseName(n, suffix) === wanted)[0];
        if (found) return found;
      }
      return undefined;
    };
    for (const name of opts.hideMeshes ?? []) named(name)?.setEnabled(false);
    for (const name of opts.showMeshes ?? []) named(name)?.setEnabled(true);

    if (opts.weapon) {
      const hand = named("handslot.r");
      if (!hand) throw new Error(`${model} no tiene handslot.r`);
      const weapon = assets.container(opts.weapon).instantiateModelsToScene((n) => n + suffix, false, {
        doNotInstantiate: true,
      });
      // Los hijos del __root__ del arma ya están en el espacio glTF, igual que la mano: se cuelgan
      // directamente (con el __root__ se aplicaría dos veces el cambio de mano).
      for (const wroot of weapon.rootNodes) {
        for (const child of wroot.getChildren()) child.parent = hand;
        wroot.dispose();
      }
    }

    for (const g of entries.animationGroups) {
      g.stop();
      const clip = baseName(g, suffix);
      this.groups.set(clip, g);
      const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
      this.clipLengths.set(clip, (g.to - g.from) / fps);
    }

    this.observer = scene.onBeforeRenderObservable.add(() => this.fade(scene.getEngine().getDeltaTime() / 1000));
  }

  setPose(x: number, y: number, z: number, facing: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = facing;
  }

  /** Cambia de clip con un cruce; si `choice.clip` ya suena solo ajusta la velocidad (salvo `restart`). */
  play(choice: AnimChoice, restart = false): void {
    const group = this.groups.get(choice.clip);
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
    for (const g of this.groups.values()) g.dispose();
    this.groups.clear();
    this.fadingOut.clear();
    this.current = undefined;
    this.root.dispose();
    for (const s of this.skeletons) s.dispose();
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
