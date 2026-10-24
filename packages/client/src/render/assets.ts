import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF/2.0"; // registra el cargador de .glb/.gltf

export type AssetId =
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

/** Rutas dentro de `public/assets/kaykit/` (KayKit, CC0; ver CREDITS.md). */
const PATHS: Record<AssetId, string> = {
  knight: "characters/Knight.glb",
  skeletonWarrior: "skeletons/Skeleton_Warrior.glb",
  skeletonMinion: "skeletons/Skeleton_Minion.glb",
  skeletonMage: "skeletons/Skeleton_Mage.glb",
  axe: "skeletons/weapons/Skeleton_Axe.gltf",
  blade: "skeletons/weapons/Skeleton_Blade.gltf",
  staff: "skeletons/weapons/Skeleton_Staff.gltf",
  wall: "dungeon/wall.glb",
  floor: "dungeon/floor_tile_large.glb",
  pillar: "dungeon/pillar.glb",
};

/** Carga todos los modelos una vez en contenedores de `scene`; se liberan al desechar la escena. */
export async function loadAssets(scene: Scene): Promise<Assets> {
  const base = `${import.meta.env.BASE_URL}assets/kaykit/`;
  const ids = Object.keys(PATHS) as AssetId[];
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
