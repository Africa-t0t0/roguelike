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

/** Secuencia pseudoaleatoria fija en [0, 1): las texturas salen siempre iguales. */
function seeded(seed: number): () => number {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/** Trazo de una grieta: puntos en fracciones del lado, cada uno con su grosor (también en fracción del lado). */
type CrackPath = { x: number; y: number; w: number }[];

/** Grietas que salen del centro, se afinan hacia la punta y se ramifican. Siempre las mismas. */
function crackPaths(): CrackPath[] {
  const rnd = seeded(23);
  const paths: CrackPath[] = [];
  const STEP = 0.03;
  const grow = (x: number, y: number, angle: number, len: number, width: number, depth: number) => {
    const path: CrackPath = [{ x, y, w: width }];
    for (let d = STEP; d < len; d += STEP) {
      angle += (rnd() - 0.5) * 0.7;
      x += Math.cos(angle) * STEP;
      y += Math.sin(angle) * STEP;
      path.push({ x, y, w: width * (1 - d / len) ** 0.8 + 0.002 });
      if (depth < 2 && rnd() < 0.2) {
        const side = rnd() < 0.5 ? -1 : 1;
        grow(x, y, angle + side * (0.5 + rnd() * 0.6), len * (0.25 + rnd() * 0.25), width * (1 - d / len) * 0.6, depth + 1);
      }
    }
    paths.push(path);
  };
  const BRANCHES = 8;
  for (let i = 0; i < BRANCHES; i++) {
    const angle = (i / BRANCHES) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    grow(0.5 + Math.cos(angle) * 0.02, 0.5 + Math.sin(angle) * 0.02, angle, 0.3 + rnd() * 0.16, 0.009 + rnd() * 0.006, 0);
  }
  return paths;
}

function strokeCracks(ctx: CanvasRenderingContext2D, s: number, color: string, widthScale: number): void {
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (const path of crackPaths()) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      ctx.lineWidth = Math.max(0.6, a.w * s * widthScale);
      ctx.beginPath();
      ctx.moveTo(a.x * s, a.y * s);
      ctx.lineTo(b.x * s, b.y * s);
      ctx.stroke();
    }
  }
}

/** Marca del Golpe sísmico en el suelo: mancha quemada y grietas oscuras con el borde levantado. */
export function scorchTexture(scene: Scene, name = "fx-scorch"): DynamicTexture {
  return generated(scene, name, 512, (ctx, s) => {
    radial(ctx, s, [
      [0, "rgba(8, 5, 3, 0.8)"],
      [0.22, "rgba(14, 9, 5, 0.5)"],
      [0.55, "rgba(20, 12, 6, 0.18)"],
      [0.85, "rgba(20, 12, 6, 0)"],
    ]);
    strokeCracks(ctx, s, "rgba(28, 17, 10, 0.5)", 1.9);
    strokeCracks(ctx, s, "rgba(5, 3, 2, 0.96)", 1);
  });
}

/** El interior al rojo de esas mismas grietas, en blanco (se tiñe con el material): núcleo fino y halo. */
export function moltenTexture(scene: Scene, name = "fx-molten"): DynamicTexture {
  return generated(scene, name, 512, (ctx, s) => {
    ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
    ctx.shadowBlur = s * 0.02;
    strokeCracks(ctx, s, "rgba(255, 255, 255, 0.4)", 1.5);
    ctx.shadowBlur = 0;
    strokeCracks(ctx, s, "rgba(255, 255, 255, 1)", 0.5);
    radial(ctx, s, [
      [0, "rgba(255, 255, 255, 0.9)"],
      [0.07, "rgba(255, 255, 255, 0.35)"],
      [0.16, "rgba(255, 255, 255, 0)"],
    ]);
  });
}

/** Onda de choque: aro con el frente nítido e irregular y la cola difuminada hacia dentro. */
export function shockTexture(scene: Scene, name = "fx-shock"): DynamicTexture {
  return generated(scene, name, 256, (ctx, s) => {
    const rnd = seeded(11);
    const KNOTS = 28;
    const knots = Array.from({ length: KNOTS }, () => rnd());
    const noise = (u: number) => {
      const f = u * KNOTS;
      const i = Math.floor(f) % KNOTS;
      const k = f - Math.floor(f);
      const e = k * k * (3 - 2 * k);
      return knots[i]! * (1 - e) + knots[(i + 1) % KNOTS]! * e;
    };
    const N = 540;
    const c = s / 2;
    ctx.lineWidth = ((Math.PI * s) / N) * 1.8;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const n = noise(i / N);
      const rOut = c * (0.8 + 0.18 * n);
      const rIn = rOut - c * (0.2 + 0.14 * noise((i / N + 0.37) % 1));
      const g = ctx.createLinearGradient(c + Math.cos(a) * rIn, c + Math.sin(a) * rIn, c + Math.cos(a) * rOut, c + Math.sin(a) * rOut);
      g.addColorStop(0, "rgba(255, 255, 255, 0)");
      g.addColorStop(0.65, "rgba(255, 255, 255, 0.35)");
      g.addColorStop(0.93, "rgba(255, 255, 255, 1)");
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * rIn, c + Math.sin(a) * rIn);
      ctx.lineTo(c + Math.cos(a) * rOut, c + Math.sin(a) * rOut);
      ctx.stroke();
    }
  });
}

/** Aviso de zona en el suelo: borde fino y nítido con un relleno tenue que crece hacia él. */
export function telegraphTexture(scene: Scene, name = "fx-telegraph"): DynamicTexture {
  return generated(scene, name, 256, (ctx, s) =>
    radial(ctx, s, [
      [0, "rgba(255, 255, 255, 0)"],
      [0.6, "rgba(255, 255, 255, 0.05)"],
      [0.92, "rgba(255, 255, 255, 0.22)"],
      [0.945, "rgba(255, 255, 255, 1)"],
      [0.975, "rgba(255, 255, 255, 1)"],
      [1, "rgba(255, 255, 255, 0)"],
    ]),
  );
}

/** Esquirla de roca: polígono irregular claro con un lado en sombra (se tiñe con la partícula). */
export function rockTexture(scene: Scene, name = "fx-rock"): DynamicTexture {
  return generated(scene, name, 32, (ctx, s) => {
    const rnd = seeded(5);
    const SIDES = 7;
    ctx.beginPath();
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2;
      const r = (s / 2) * (0.6 + rnd() * 0.36);
      const x = s / 2 + Math.cos(a) * r;
      const y = s / 2 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "rgba(255, 255, 255, 1)");
    g.addColorStop(1, "rgba(120, 120, 120, 1)");
    ctx.fillStyle = g;
    ctx.fill();
  });
}

/** Voluta de polvo: varios borrones blandos encimados, sin borde. */
export function smokeTexture(scene: Scene, name = "fx-smoke"): DynamicTexture {
  return generated(scene, name, 64, (ctx, s) => {
    const rnd = seeded(3);
    for (let i = 0; i < 7; i++) {
      const r = s * (0.2 + rnd() * 0.12);
      const x = s / 2 + (rnd() - 0.5) * s * 0.36;
      const y = s / 2 + (rnd() - 0.5) * s * 0.36;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255, 255, 255, 0.5)");
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
}

/** Haz de luz: opaco abajo y desvanecido hacia arriba (para la opacidad de un cilindro, cuya V sube con la altura). */
export function beamTexture(scene: Scene, name = "fx-beam"): DynamicTexture {
  return generated(scene, name, 64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, s, 0, 0);
    g.addColorStop(0, "rgba(255, 255, 255, 1)");
    g.addColorStop(0.35, "rgba(255, 255, 255, 0.45)");
    g.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Remolino: tres tajos curvos que se afinan y se apagan hacia la cola (la cabeza, en el sentido del ángulo creciente). */
export function swirlTexture(scene: Scene, name = "fx-swirl"): DynamicTexture {
  return generated(scene, name, 256, (ctx, s) => {
    const c = s / 2;
    const ARCS = 3;
    const STEPS = 90;
    const SPAN = 1.7; // rad de cada tajo
    ctx.lineCap = "butt";
    for (let k = 0; k < ARCS; k++) {
      const a0 = (k / ARCS) * Math.PI * 2;
      for (let j = 0; j < STEPS; j++) {
        const f = j / STEPS; // 0 cola → 1 cabeza
        const a = a0 + f * SPAN;
        ctx.strokeStyle = `rgba(255, 255, 255, ${(f ** 1.6).toFixed(3)})`;
        ctx.lineWidth = s * (0.006 + 0.034 * f);
        ctx.beginPath();
        ctx.arc(c, c, c * (0.9 - 0.017 * f), a, a + SPAN / STEPS + 0.01);
        ctx.stroke();
      }
    }
  });
}

/** Tajo: banda en arco con el filo exterior nítido y el interior difuminado (se recorta con la cuña de la malla). */
export function slashTexture(scene: Scene, name = "fx-slash"): DynamicTexture {
  return generated(scene, name, 128, (ctx, s) =>
    radial(ctx, s, [
      [0, "rgba(255, 255, 255, 0)"],
      [0.5, "rgba(255, 255, 255, 0)"],
      [0.8, "rgba(255, 255, 255, 0.3)"],
      [0.93, "rgba(255, 255, 255, 1)"],
      [0.97, "rgba(255, 255, 255, 0.9)"],
      [1, "rgba(255, 255, 255, 0)"],
    ]),
  );
}

/** Estocada: franja con el centro al blanco y los bordes difusos, que se apaga hacia la cola (abajo). */
export function streakTexture(scene: Scene, name = "fx-streak"): DynamicTexture {
  return generated(scene, name, 128, (ctx, s) => {
    const across = ctx.createLinearGradient(0, 0, s, 0);
    across.addColorStop(0, "rgba(255, 255, 255, 0)");
    across.addColorStop(0.38, "rgba(255, 255, 255, 0.45)");
    across.addColorStop(0.5, "rgba(255, 255, 255, 1)");
    across.addColorStop(0.62, "rgba(255, 255, 255, 0.45)");
    across.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, s, s);
    // A lo largo: se multiplica por un degradado (la cabeza, arriba, entera; la cola, abajo, nada).
    ctx.globalCompositeOperation = "destination-in";
    const along = ctx.createLinearGradient(0, 0, 0, s);
    along.addColorStop(0, "rgba(255, 255, 255, 0)");
    along.addColorStop(0.06, "rgba(255, 255, 255, 1)");
    along.addColorStop(0.5, "rgba(255, 255, 255, 0.6)");
    along.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = "source-over";
  });
}
