import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF/2.0"; // registra el cargador de .glb/.gltf

export type AssetId =
  | "kingslayer"
  | "brute"
  | "minion"
  | "mage"
  | "kingslayer-sword"
  | "guard-sword"
  | "great-sword"
  // KayKit, solo mientras exista LegacyCharacterView (se van en la Tarea 8)
  | "knight"
  | "skeletonWarrior"
  | "skeletonMinion"
  | "skeletonMage"
  | "axe"
  | "blade"
  | "staff"
  | "wall"
  | "floor"
  | "pillar";

export interface Assets {
  container(id: AssetId): AssetContainer;
}

/** Rutas dentro de `public/assets/` (KayKit y Quaternius CC0, Kingslayer CC BY 4.0, Mixamo; ver CREDITS.md). */
const PATHS: Record<AssetId, string> = {
  kingslayer: "mixamo/characters/kingslayer.glb",
  brute: "mixamo/characters/brute.glb",
  minion: "mixamo/characters/minion.glb",
  mage: "mixamo/characters/mage.glb",
  "kingslayer-sword": "mixamo/weapons/kingslayer-sword.glb",
  "guard-sword": "mixamo/weapons/guard-sword.glb",
  "great-sword": "mixamo/weapons/great-sword.glb",
  knight: "kaykit/characters/Knight.glb",
  skeletonWarrior: "kaykit/skeletons/Skeleton_Warrior.glb",
  skeletonMinion: "kaykit/skeletons/Skeleton_Minion.glb",
  skeletonMage: "kaykit/skeletons/Skeleton_Mage.glb",
  axe: "kaykit/skeletons/weapons/Skeleton_Axe.gltf",
  blade: "kaykit/skeletons/weapons/Skeleton_Blade.gltf",
  staff: "kaykit/skeletons/weapons/Skeleton_Staff.gltf",
  wall: "kaykit/dungeon/wall.glb",
  floor: "kaykit/dungeon/floor_tile_large.glb",
  pillar: "kaykit/dungeon/pillar.glb",
};

/** Carga todos los modelos una vez en contenedores de `scene`; se liberan al desechar la escena. */
export async function loadAssets(scene: Scene, only?: readonly AssetId[]): Promise<Assets> {
  const base = `${import.meta.env.BASE_URL}assets/`;
  const ids = only ? [...only] : (Object.keys(PATHS) as AssetId[]);
  const results = await Promise.allSettled(ids.map((id) => LoadAssetContainerAsync(base + PATHS[id], scene)));
  const failed = results.find((r) => r.status === "rejected");
  if (failed) {
    for (const r of results) if (r.status === "fulfilled") r.value.dispose();
    throw failed.reason;
  }
  const containers = new Map(
    ids.map((id, i) => [id, (results[i] as PromiseFulfilledResult<AssetContainer>).value]),
  );
  scene.onDisposeObservable.addOnce(() => {
    for (const c of containers.values()) c.dispose();
  });
  return {
    container(id) {
      const c = containers.get(id);
      if (!c) throw new Error(`asset desconocido: ${id}`);
      return c;
    },
  };
}
