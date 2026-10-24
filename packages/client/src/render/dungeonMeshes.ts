import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { isWalkableTile, TILE_SIZE, tileCenter, type Dungeon } from "@roguelike/shared";
import type { AssetId, Assets } from "./assets";

export const WALL_HEIGHT = 3; // m
/** Las piezas KayKit usan una grilla de 4 m; la nuestra es de `TILE_SIZE` = 2 m. */
export const DUNGEON_PIECE_SCALE = 0.5;
const KAYKIT_WALL_HEIGHT = 4; // m: muro y pilar miden 4 m de alto en el modelo
const WALL_Y_SCALE = WALL_HEIGHT / KAYKIT_WALL_HEIGHT; // 0.75
const FLOOR_TOP = 0.05; // m: cara superior de floor_tile_large; se baja para que quede en y = 0
const WALL_THICKNESS = 1 * DUNGEON_PIECE_SCALE; // el muro mide 1 m de grosor en el modelo
/** El muro se corre medio grosor hacia la casilla de muro: su cara queda en el límite de colisión. */
const WALL_INSET = WALL_THICKNESS / 2;

const floorScale = new Vector3(DUNGEON_PIECE_SCALE, 1, DUNGEON_PIECE_SCALE);
const pieceScale = new Vector3(DUNGEON_PIECE_SCALE, WALL_Y_SCALE, DUNGEON_PIECE_SCALE);

/**
 * Copia la geometría de un modelo como una sola malla sin padre, con la transformación del glTF
 * (cambio de mano incluido) ya aplicada a los vértices: así las thin instances usan coordenadas
 * de mundo tal cual.
 */
function pieceSource(assets: Assets, id: AssetId): Mesh {
  const entries = assets.container(id).instantiateModelsToScene((n) => `${id}:${n}`, false, {
    doNotInstantiate: true,
  });
  const roots = entries.rootNodes;
  const meshes: Mesh[] = [];
  for (const root of roots) {
    root.computeWorldMatrix(true);
    for (const m of root.getChildMeshes(false)) {
      if (m instanceof Mesh && m.getTotalVertices() > 0) {
        m.computeWorldMatrix(true);
        meshes.push(m);
      }
    }
  }
  let source: Mesh;
  if (meshes.length === 1) {
    source = meshes[0]!;
    source.setParent(null); // conserva la transformación de mundo…
    source.bakeCurrentTransformIntoVertices(); // …y la pasa a los vértices
  } else {
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
    if (!merged) throw new Error(`no se pudo unir la malla de ${id}`);
    source = merged;
  }
  for (const root of roots) root.dispose(); // ya no hay hijos útiles
  source.name = id;
  source.setEnabled(true);
  source.isPickable = false;
  source.doNotSyncBoundingInfo = true;
  return source;
}

function withInstances(source: Mesh, matrices: Matrix[]): Mesh {
  const buffer = new Float32Array(matrices.length * 16);
  matrices.forEach((m, i) => m.copyToArray(buffer, i * 16));
  source.thinInstanceSetBuffer("matrix", buffer, 16, true);
  source.thinInstanceRefreshBoundingInfo(false);
  source.freezeWorldMatrix();
  return source;
}

function placed(scale: Vector3, yaw: number, x: number, y: number, z: number): Matrix {
  return Matrix.Compose(scale, Quaternion.RotationAxis(Vector3.Up(), yaw), new Vector3(x, y, z));
}

/**
 * Suelo por casilla caminable, un muro por cada borde entre casilla caminable y casilla de muro,
 * y un pilar donde dos muros se juntan en ángulo. Cada tipo de pieza es una malla con thin instances.
 */
export function buildDungeonMeshes(scene: Scene, d: Dungeon, assets: Assets): { dispose(): void } {
  const walk = (tx: number, tz: number) => isWalkableTile(d, tx, tz);
  const floors: Matrix[] = [];
  const walls: Matrix[] = [];
  const pillars: Matrix[] = [];

  for (let tz = 0; tz < d.height; tz++) {
    for (let tx = 0; tx < d.width; tx++) {
      if (!walk(tx, tz)) continue;
      const c = tileCenter(tx, tz);
      floors.push(placed(floorScale, 0, c.x, -FLOOR_TOP, c.z));
      // Muros en los bordes hacia vecinos de muro. El modelo es largo en X; con yaw, su +Z mira al suelo.
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (walk(tx + dx, tz + dz)) continue;
        const x = c.x + dx * (TILE_SIZE / 2 + WALL_INSET);
        const z = c.z + dz * (TILE_SIZE / 2 + WALL_INSET);
        walls.push(placed(pieceScale, Math.atan2(-dx, -dz), x, 0, z));
      }
    }
  }

  // Pilares: en cada vértice de la grilla con al menos un muro a lo largo de Z y otro a lo largo de X.
  // Se centran en el cruce de los ejes de esos muros (cada muro está corrido WALL_INSET hacia su
  // casilla de muro), así tapan la junta en esquinas convexas y el hueco en las cóncavas.
  /** Corrimiento de un muro entre casillas a (lado negativo) y b (lado positivo), o null si no hay. */
  const inset = (a: boolean, b: boolean): number | null => (a === b ? null : a ? WALL_INSET : -WALL_INSET);
  for (let j = 0; j <= d.height; j++) {
    for (let i = 0; i <= d.width; i++) {
      // Bordes a lo largo de Z sobre x = i (al norte y al sur del vértice): separan (i-1, ·) de (i, ·).
      const alongZ = [inset(walk(i - 1, j), walk(i, j)), inset(walk(i - 1, j - 1), walk(i, j - 1))];
      // Bordes a lo largo de X sobre z = j (al este y al oeste): separan (·, j-1) de (·, j).
      const alongX = [inset(walk(i, j - 1), walk(i, j)), inset(walk(i - 1, j - 1), walk(i - 1, j))];
      const offX = alongZ.filter((o): o is number => o !== null);
      const offZ = alongX.filter((o): o is number => o !== null);
      if (offX.length === 0 || offZ.length === 0) continue;
      const mean = (v: number[]) => v.reduce((s, o) => s + o, 0) / v.length;
      pillars.push(placed(pieceScale, 0, i * TILE_SIZE + mean(offX), 0, j * TILE_SIZE + mean(offZ)));
    }
  }

  const meshes = [
    withInstances(pieceSource(assets, "floor"), floors),
    withInstances(pieceSource(assets, "wall"), walls),
    withInstances(pieceSource(assets, "pillar"), pillars),
  ];
  return {
    dispose() {
      for (const m of meshes) m.dispose();
    },
  };
}
