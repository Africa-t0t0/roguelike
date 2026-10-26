import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";

/** Con `updateSpeed` = 1/60 las vidas y los ritmos de emisión de Babylon quedan en segundos reales. */
export const PARTICLE_SPEED = 1 / 60;

/** Textura cuadrada generada en un canvas, una sola vez. */
export function generated(scene: Scene, name: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  draw(ctx, size);
  tex.update();
  return tex;
}

/** Gradiente radial con estas paradas (posición en [0, 1] → color CSS). */
export function radial(ctx: CanvasRenderingContext2D, s: number, stops: [number, string][]): void {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

/** Punto blanco difuso, la textura de las partículas y las estelas (se tiñe con el color de la partícula). */
export function sparkTexture(scene: Scene, name = "fx-spark"): DynamicTexture {
  return generated(scene, name, 64, (ctx, s) =>
    radial(ctx, s, [
      [0, "rgba(255, 255, 255, 1)"],
      [0.35, "rgba(255, 255, 255, 0.6)"],
      [1, "rgba(255, 255, 255, 0)"],
    ]),
  );
}
