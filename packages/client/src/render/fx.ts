import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { PLAYER_LOOK } from "./looks";

const NUMBER_LIFE_MS = 800;
const NUMBER_RISE_M = 0.8;
/** m sobre la cabeza: encima de la barra de vida del enemigo, o del nombre del jugador. */
const NUMBER_ABOVE_HEAD = { enemy: 0.4, player: 0.75 } as const;
/** Un golpe de peso 1 se ve así de grande respecto de uno de peso 0; desde este peso, además, dorado. */
const HEAVY_SCALE = 1.9;
const HEAVY_FROM = 0.6;
/** Rebote al aparecer: nace `POP_SCALE` veces más grande y se asienta en `POP_MS`. */
const POP_SCALE = 1.7;
const POP_MS = 140;
/** Los números de un mismo blanco se abren a los lados para no taparse. */
const SPREAD_M = 0.35;

interface FloatingNumber {
  el: HTMLDivElement;
  x: number;
  z: number;
  y: number;
  startMs: number;
  scale: number;
}

/**
 * Números de daño flotantes: elementos DOM (textContent) proyectados desde la posición 3D, que suben
 * y se desvanecen en ~0,8 s. Blancos sobre enemigos, rojos sobre jugadores.
 */
export class DamageNumbers {
  private readonly layer = document.createElement("div");
  private readonly items: FloatingNumber[] = [];
  private readonly world = new Vector3();
  private count = 0;

  constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    parent: HTMLElement = document.body,
  ) {
    this.layer.className = "fx-layer";
    parent.append(this.layer);
  }

  /**
   * `startMs`: desde cuándo se ve (mismo reloj que `render`), para que coincida con lo que se dibuja.
   * `headHeight`: alto del blanco en m (por defecto, el del jugador). `weight`: peso del golpe, de 0 a 1.
   */
  spawn(
    amount: number,
    x: number,
    z: number,
    target: "enemy" | "player",
    startMs: number,
    headHeight = PLAYER_LOOK.height,
    weight = 0,
  ): void {
    const el = document.createElement("div");
    el.className = `fx-number fx-${target}${target === "enemy" && weight >= HEAVY_FROM ? " fx-heavy" : ""}`;
    el.textContent = String(Math.round(amount));
    el.hidden = true;
    this.layer.append(el);
    const side = ((this.count++ % 3) - 1) * SPREAD_M;
    this.items.push({ el, x: x + side, z, y: headHeight + NUMBER_ABOVE_HEAD[target], startMs, scale: 1 + (HEAVY_SCALE - 1) * Math.min(1, Math.max(0, weight)) });
  }

  render(nowMs: number): void {
    const camera = this.scene.activeCamera;
    if (!camera) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const viewport = camera.viewport.toGlobal(w, h);
    const transform = this.scene.getTransformMatrix();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const n = this.items[i]!;
      const age = nowMs - n.startMs;
      if (age >= NUMBER_LIFE_MS) {
        n.el.remove();
        this.items.splice(i, 1);
        continue;
      }
      if (age < 0) continue;
      const t = age / NUMBER_LIFE_MS;
      this.world.set(n.x, n.y + NUMBER_RISE_M * t, n.z);
      const p = Vector3.Project(this.world, Matrix.IdentityReadOnly, transform, viewport);
      // Fuera del volumen de visión (p. ej. detrás de la cámara): no se muestra.
      const visible = p.z >= 0 && p.z <= 1;
      n.el.hidden = !visible;
      if (!visible) continue;
      const pop = age < POP_MS ? POP_SCALE - (POP_SCALE - 1) * (age / POP_MS) : 1;
      n.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${(n.scale * pop).toFixed(3)})`;
      n.el.style.opacity = String(t < 0.5 ? 1 : 1 - (t - 0.5) * 2);
    }
  }

  dispose(): void {
    this.items.length = 0;
    this.layer.remove();
  }
}

/** Destello rojo en los bordes de la pantalla al recibir daño el propio jugador. */
export class HurtFlash {
  private readonly el = document.createElement("div");

  constructor(parent: HTMLElement = document.body) {
    this.el.className = "fx-hurt";
    parent.append(this.el);
  }

  flash(): void {
    const el = this.el;
    el.style.transition = "none";
    el.style.opacity = "1";
    void el.offsetWidth; // aplica la opacidad sin transición antes de empezar a desvanecer
    el.style.transition = "opacity 0.5s ease-out";
    el.style.opacity = "0";
  }

  dispose(): void {
    this.el.remove();
  }
}
