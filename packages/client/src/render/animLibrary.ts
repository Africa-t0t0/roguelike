import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF/2.0"; // registra el cargador de .glb/.gltf

/** Clave de hueso sin el prefijo de Mixamo (`mixamorig:`, `mixamorig1:`…) y en minúsculas. */
export function boneKey(name: string): string {
  return name.replace(/^mixamorig\d*:/i, "").toLowerCase();
}

/**
 * Si la altura de la cadera del clip y la del personaje difieren más que esto (en cualquier sentido),
 * el clip está en otras unidades (cm vs m, o un esqueleto con otra escala) y su traslación se reescala.
 * Por debajo se respeta tal cual: una pose agachada no es un cambio de unidades.
 */
const UNIT_MISMATCH = 2;

/**
 * Clips de Mixamo cargados una vez por escena (`anims/<clipId>.glb`), que se reasignan a los huesos de
 * cada personaje por nombre (`boneKey`).
 */
export class AnimLibrary {
  private readonly clips = new Map<string, AnimationGroup>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly containers: AssetContainer[] = [];
  /** Posición de reposo de cada nodo, tomada la primera vez que se le asigna un clip. */
  private readonly rest = new WeakMap<TransformNode, number>();
  /** Traslaciones de cadera ya adaptadas, por animación original y factor de escala. */
  private readonly adapted = new WeakMap<Animation, Map<number, Animation>>();

  constructor(private readonly scene: Scene) {
    scene.onDisposeObservable.addOnce(() => {
      for (const c of this.containers) c.dispose();
      this.containers.length = 0;
      this.clips.clear();
    });
  }

  /** Carga los clips que falten (los ya cargados o en curso no se repiten). */
  async load(clipIds: readonly string[]): Promise<void> {
    const base = `${import.meta.env.BASE_URL}assets/mixamo/anims/`;
    await Promise.all(
      clipIds.map((id) => {
        let p = this.pending.get(id);
        if (!p) {
          p = LoadAssetContainerAsync(`${base}${id}.glb`, this.scene).then((c) => {
            this.containers.push(c);
            const group = c.animationGroups.find((g) => g.name === id) ?? c.animationGroups[0];
            if (!group) throw new Error(`el clip ${id} no trae animación`);
            this.add(group, id);
          });
          p.catch(() => this.pending.delete(id));
          this.pending.set(id, p);
        }
        return p;
      }),
    );
  }

  /** Registra un grupo ya creado como clip `clipId` (por defecto, su nombre). */
  add(group: AnimationGroup, clipId = group.name): void {
    group.stop();
    this.clips.set(clipId, group);
  }

  /**
   * Grupo nuevo `name` con las animaciones de `clipId` dirigidas a `nodes` (clave: `boneKey`). Los
   * huesos que el personaje no tenga se ignoran; si no calza ninguno, o el clip no está, `null`.
   */
  bind(clipId: string, nodes: ReadonlyMap<string, TransformNode>, name: string): AnimationGroup | null {
    const src = this.clips.get(clipId);
    if (!src) return null;
    const group = new AnimationGroup(name, this.scene);
    for (const ta of src.targetedAnimations) {
      const targetName = (ta.target as { name?: unknown } | null)?.name;
      if (typeof targetName !== "string") continue;
      const node = nodes.get(boneKey(targetName));
      if (!node) continue;
      group.addTargetedAnimation(this.adapt(ta.animation, node), node);
    }
    if (group.targetedAnimations.length === 0) {
      group.dispose();
      return null;
    }
    group.normalize(src.from, src.to);
    return group;
  }

  /** Duración del clip en segundos; 0 si no está cargado. */
  length(clipId: string): number {
    const src = this.clips.get(clipId);
    if (!src) return 0;
    const fps = src.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    return (src.to - src.from) / fps;
  }

  /**
   * Traslación de la cadera (el único hueso con traslación en Mixamo), adaptada al personaje:
   * - **En el sitio:** varios clips traen avance (correr, saltar, morir, el giro del mandoble); la
   *   posición la manda la simulación, así que se quita la deriva lineal en X/Z entre el primer y el
   *   último cuadro y se conserva el vaivén y la altura.
   * - **Unidades:** si la altura de cadera del clip difiere de la del personaje en más de
   *   `UNIT_MISMATCH` veces, el clip está en otras unidades y se reescala.
   */
  private adapt(anim: Animation, node: TransformNode): Animation {
    if (anim.targetProperty !== "position" || anim.dataType !== Animation.ANIMATIONTYPE_VECTOR3) return anim;
    const keys = anim.getKeys();
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (!first || !last) return anim;
    let restY = this.rest.get(node);
    if (restY === undefined) {
      restY = node.position.y;
      this.rest.set(node, restY);
    }
    const v0 = first.value as Vector3;
    const ratio = Math.abs(v0.y) > 1e-9 && Math.abs(restY) > 1e-9 ? restY / v0.y : 1;
    const factor = ratio > 0 && ratio <= UNIT_MISMATCH && ratio >= 1 / UNIT_MISMATCH ? 1 : Math.abs(ratio);
    const key = Math.round(factor * 1e4) / 1e4;
    let byFactor = this.adapted.get(anim);
    if (!byFactor) this.adapted.set(anim, (byFactor = new Map()));
    let out = byFactor.get(key);
    if (!out) {
      const v1 = last.value as Vector3;
      const span = last.frame - first.frame;
      const dx = v1.x - v0.x;
      const dz = v1.z - v0.z;
      const scaleTangent = (t: unknown) => (t ? (t as Vector3).scale(key) : t);
      out = anim.clone();
      out.setKeys(
        keys.map((k) => {
          const f = span > 0 ? (k.frame - first.frame) / span : 0;
          const v = k.value as Vector3;
          return {
            ...k,
            value: new Vector3(v.x - dx * f, v.y, v.z - dz * f).scaleInPlace(key),
            inTangent: scaleTangent(k.inTangent),
            outTangent: scaleTangent(k.outTangent),
          };
        }),
      );
      byFactor.set(key, out);
    }
    return out;
  }
}
