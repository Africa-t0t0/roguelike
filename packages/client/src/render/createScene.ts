import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { LIGHTING } from "./lighting";

/** Escena con el ambiente dark fantasy: casi negro, niebla, relleno frío y contraluz azulado. */
export function createScene(engine: AbstractEngine): Scene {
  const L = LIGHTING;
  const scene = new Scene(engine);
  const [r, g, b] = L.background;
  scene.clearColor = new Color4(r, g, b, 1);
  scene.ambientColor = Color3.Black();
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = L.fogDensity;
  scene.fogColor = new Color3(r, g, b);

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = L.ambient.intensity;
  hemi.diffuse = new Color3(...L.ambient.sky);
  hemi.groundColor = new Color3(...L.ambient.ground);
  hemi.specular = Color3.Black();

  const rim = new DirectionalLight("rim", new Vector3(...L.rim.direction), scene);
  rim.intensity = L.rim.intensity;
  rim.diffuse = new Color3(...L.rim.color);
  return scene;
}
