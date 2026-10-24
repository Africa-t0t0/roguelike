import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { isWalkableTile, TILE_SIZE, tileCenter, type Dungeon } from "@roguelike/shared";

export const WALL_HEIGHT = 3; // m
const FLOOR_THICKNESS = 0.1;

function touchesFloor(d: Dungeon, tx: number, tz: number): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (isWalkableTile(d, tx + dx, tz + dz)) return true;
    }
  }
  return false;
}

function material(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = Color3.Black();
  return m;
}

/** Instancias de una caja (centrada en el origen) en las posiciones dadas. */
function instanced(base: Mesh, centers: { x: number; y: number; z: number }[]): Mesh {
  const matrices = new Float32Array(centers.length * 16);
  centers.forEach((c, i) => Matrix.Translation(c.x, c.y, c.z).copyToArray(matrices, i * 16));
  base.thinInstanceSetBuffer("matrix", matrices, 16, true);
  return base;
}

/** Suelo por casilla caminable y una caja de muro por cada casilla de muro que toca suelo. */
export function buildDungeonMeshes(scene: Scene, d: Dungeon): Mesh[] {
  const floors: { x: number; y: number; z: number }[] = [];
  const walls: { x: number; y: number; z: number }[] = [];
  for (let tz = 0; tz < d.height; tz++) {
    for (let tx = 0; tx < d.width; tx++) {
      const c = tileCenter(tx, tz);
      if (isWalkableTile(d, tx, tz)) floors.push({ x: c.x, y: -FLOOR_THICKNESS / 2, z: c.z });
      else if (touchesFloor(d, tx, tz)) walls.push({ x: c.x, y: WALL_HEIGHT / 2, z: c.z });
    }
  }

  const floor = CreateBox("floor", { width: TILE_SIZE, height: FLOOR_THICKNESS, depth: TILE_SIZE }, scene);
  floor.material = material(scene, "floorMat", new Color3(0.35, 0.33, 0.3));
  const wall = CreateBox("wall", { width: TILE_SIZE, height: WALL_HEIGHT, depth: TILE_SIZE }, scene);
  wall.material = material(scene, "wallMat", new Color3(0.45, 0.4, 0.5));
  return [instanced(floor, floors), instanced(wall, walls)];
}
