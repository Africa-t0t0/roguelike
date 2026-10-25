import type { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Light } from "@babylonjs/core/Lights/light";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/instancedMesh"; // registra Mesh.createInstance
import type { Scene } from "@babylonjs/core/scene";
import type { Dungeon } from "@roguelike/shared";
import { flicker, nearestTorches, torchSpots } from "./torches";

type RGB = readonly [number, number, number];

/**
 * Ambiente dark fantasy, en un solo lugar para afinarlo. Las luces puntuales usan la caída de glTF
 * (inverso del cuadrado con ventana hasta `range`), así que `intensity` es "a 1 m".
 */
export const LIGHTING = {
  /** fondo y niebla (exponencial al cuadrado) del mismo casi-negro */
  background: [0.015, 0.014, 0.022] as RGB,
  fogDensity: 0.05,
  /** relleno hemisférico frío y bajo */
  ambient: { intensity: 0.18, sky: [0.55, 0.65, 0.95] as RGB, ground: [0.1, 0.09, 0.12] as RGB },
  /** contraluz frío direccional */
  rim: { intensity: 0.6, color: [0.55, 0.68, 1] as RGB, direction: [0.45, -0.55, 0.7] as RGB },
  /** antorcha que lleva el propio jugador (sobre el hombro) */
  playerTorch: { color: [1, 0.55, 0.2] as RGB, intensity: 9, range: 11, height: 2.4, flicker: 0.1 },
  /** antorchas de pared: llamas en todas, luz real solo en las `activeLights` más cercanas */
  wallTorch: { color: [1, 0.5, 0.18] as RGB, intensity: 5, range: 9, height: 2.0, flicker: 0.15, activeLights: 3 },
  /**
   * Luces por material: hemisférica + contraluz + antorcha propia + `activeLights` (Babylon trae 4
   * por defecto; las mallas de la mazmorra son una por tipo de pieza, así que reciben todas).
   */
  maxLightsPerMaterial: 6,
} as const;

const c3 = (c: RGB) => new Color3(c[0], c[1], c[2]);

/** Saca de la niebla un material de UI (barras, aros, nombres, brillos): siempre legible. */
export function noFog<T extends { fogEnabled: boolean }>(m: T): T {
  m.fogEnabled = false;
  return m;
}

/**
 * Sube `maxSimultaneousLights` a `max` en un material y, si es un MultiMaterial (el cargador glTF los
 * crea para mallas con varias primitivas), en cada submaterial. PBRMaterial, StandardMaterial y
 * OpenPBRMaterial tienen la propiedad; los que no la tienen se ignoran.
 */
export function raiseLightBudget(material: Material | null | undefined, max: number): void {
  if (!material) return;
  if (material instanceof MultiMaterial) {
    for (const sub of material.subMaterials) raiseLightBudget(sub, max);
    return;
  }
  const m = material as Material & { maxSimultaneousLights?: number };
  if (typeof m.maxSimultaneousLights === "number" && m.maxSimultaneousLights < max) m.maxSimultaneousLights = max;
}

/**
 * Mantiene el presupuesto de luces en todo material que se dibuje: cada cuadro recorre las mallas y
 * ajusta los materiales que aún no vio (incluye los de contenedores, que no pasan por
 * `scene.materials`, y los que se cambien en mallas existentes).
 */
function keepLightBudget(scene: Scene, max: number): () => void {
  const done = new WeakSet<Material>();
  const obs = scene.onBeforeRenderObservable.add(() => {
    for (const mesh of scene.meshes) {
      const m = mesh.material;
      if (!m || done.has(m)) continue;
      raiseLightBudget(m, max);
      // Un MultiMaterial puede cambiar de submateriales: se revisa siempre (es barato).
      if (!(m instanceof MultiMaterial)) done.add(m);
    }
  });
  return () => scene.onBeforeRenderObservable.remove(obs);
}

function pointLight(name: string, scene: Scene, color: RGB, range: number): PointLight {
  const l = new PointLight(name, Vector3.Zero(), scene);
  l.diffuse = c3(color);
  l.specular = c3(color).scale(0.3);
  l.range = range;
  l.falloffType = Light.FALLOFF_GLTF;
  return l;
}

/**
 * Antorcha del jugador, antorchas de pared (llama emisiva en cada una; luz real en un grupo fijo de
 * `activeLights` que se mueve a las más cercanas al jugador cada cuadro, sin prender ni apagar luces
 * para no recompilar shaders) y el presupuesto de luces por material.
 */
export function createTorches(scene: Scene, dungeon: Dungeon) {
  const L = LIGHTING;
  const spots = torchSpots(dungeon);
  const stopBudget = keepLightBudget(scene, L.maxLightsPerMaterial);

  const player = pointLight("playerTorch", scene, L.playerTorch.color, L.playerTorch.range);
  player.intensity = 0; // hasta saber dónde está el jugador
  const pool = Array.from({ length: L.wallTorch.activeLights }, (_, i) =>
    pointLight(`wallTorch${i}`, scene, L.wallTorch.color, L.wallTorch.range),
  );
  for (const l of pool) l.intensity = 0;

  const flameMat = noFog(new StandardMaterial("torchFlame", scene));
  flameMat.disableLighting = true;
  flameMat.emissiveColor = new Color3(1, 0.62, 0.22);
  const bracketMat = new StandardMaterial("torchBracket", scene);
  bracketMat.diffuseColor = new Color3(0.12, 0.1, 0.08);
  bracketMat.specularColor = Color3.Black();

  const flame: Mesh = CreateSphere("torchFlame", { diameter: 0.22, segments: 6 }, scene);
  flame.material = flameMat;
  flame.isPickable = false;
  flame.setEnabled(false);
  const bracket: Mesh = CreateCylinder("torchBracket", { height: 0.45, diameterTop: 0.16, diameterBottom: 0.06, tessellation: 6 }, scene);
  bracket.material = bracketMat;
  bracket.isPickable = false;
  bracket.setEnabled(false);

  const OUT_FROM_WALL = 0.16; // m: llama
  const LIGHT_OUT = 0.7; // m: la luz va más afuera para no quemar el muro de al lado
  const flames: InstancedMesh[] = spots.map((s, i) => {
    const dz = Math.cos(s.yaw) * OUT_FROM_WALL;
    const dx = Math.sin(s.yaw) * OUT_FROM_WALL;
    const b = bracket.createInstance(`torchBracket${i}`);
    b.position.set(s.x + dx * 0.6, L.wallTorch.height - 0.2, s.z + dz * 0.6);
    b.rotation.x = s.yaw === 0 ? 0.35 : -0.35;
    b.isPickable = false;
    const f = flame.createInstance(`torchFlame${i}`);
    f.position.set(s.x + dx, L.wallTorch.height, s.z + dz);
    f.isPickable = false;
    return f;
  });

  return {
    /** (x, z): posición dibujada del jugador propio; `nowMs` en el reloj de juego (quieto en la pausa). */
    update(x: number, z: number, nowMs: number): void {
      const t = nowMs / 1000;
      player.position.set(x, L.playerTorch.height, z);
      player.intensity = L.playerTorch.intensity * flicker(t, 0, L.playerTorch.flicker);
      flames.forEach((f, i) => {
        const k = flicker(t, i + 1, L.wallTorch.flicker);
        f.scaling.set(k, 1.6 * k * k, k);
      });
      const near = nearestTorches(spots, x, z, pool.length);
      pool.forEach((l, j) => {
        const i = near[j];
        if (i === undefined) {
          l.intensity = 0;
          return;
        }
        const s = spots[i]!;
        l.position.set(s.x + Math.sin(s.yaw) * LIGHT_OUT, L.wallTorch.height, s.z + Math.cos(s.yaw) * LIGHT_OUT);
        l.intensity = L.wallTorch.intensity * flicker(t, i + 1, L.wallTorch.flicker);
      });
    },
    dispose(): void {
      stopBudget();
      for (const l of [player, ...pool]) l.dispose();
      flame.dispose(); // también sus instancias
      bracket.dispose();
      flameMat.dispose();
      bracketMat.dispose();
    },
  };
}
