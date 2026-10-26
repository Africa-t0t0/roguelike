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

/** Llama suave: gota vertical (ancha y brillante abajo, punta tenue arriba), blanca para teñirla con la partícula. */
export function flameTexture(scene: Scene, name = "fx-flame"): DynamicTexture {
  return generated(scene, name, 64, (ctx, s) => {
    ctx.globalCompositeOperation = "lighter";
    // Dos elipses de gradiente radial: el cuerpo (abajo, ancho) y la punta (arriba, estrecha y alta).
    for (const [cy, rx, ry, a] of [[0.64, 0.27, 0.3, 1], [0.38, 0.13, 0.36, 0.7]] as const) {
      ctx.save();
      ctx.translate(s / 2, s * cy);
      ctx.scale(rx * 2, ry * 2);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
      g.addColorStop(0, `rgba(255, 255, 255, ${a})`);
      g.addColorStop(0.45, `rgba(255, 255, 255, ${a * 0.45})`);
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
  });
}
