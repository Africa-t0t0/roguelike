import { formatFloorTime } from "./hud";

/** Rumbo en rad: 0 = norte (+Z), π/2 = este (+X), igual que el `yaw` de la cámara. */
const CARDINALS: readonly { label: string; angle: number }[] = [
  { label: "N", angle: 0 },
  { label: "E", angle: Math.PI / 2 },
  { label: "S", angle: Math.PI },
  { label: "O", angle: -Math.PI / 2 },
];
const TICK_STEP = Math.PI / 12; // una marca cada 15°
/** Media apertura de la brújula: lo que está a más de 90° del rumbo no se ve. */
export const COMPASS_HALF_SPAN = Math.PI / 2;

/** Ángulo en (−π, π]. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Posición en la tira (−1 = borde izquierdo, 0 = centro, 1 = borde derecho) de un rumbo `angle` mirando hacia
 * `yaw`; `undefined` si queda fuera de la apertura. Girar la cámara a la derecha corre las marcas a la izquierda.
 */
export function compassOffset(angle: number, yaw: number, halfSpan = COMPASS_HALF_SPAN): number | undefined {
  const d = wrap(angle - yaw);
  return Math.abs(d) <= halfSpan ? d / halfSpan : undefined;
}

interface Mark {
  el: HTMLDivElement;
  angle: number;
}

/**
 * Brújula arriba al centro (DOM): una tira con los puntos cardinales y marcas cada 15° que se corre con el rumbo
 * de la cámara, un rombo dorado en el centro y, debajo, el reloj del piso.
 */
export class Compass {
  private readonly root = document.createElement("div");
  private readonly strip = document.createElement("div");
  private readonly clock = document.createElement("div");
  private readonly marks: Mark[] = [];
  private lastYaw = NaN;

  constructor(parent: HTMLElement = document.body) {
    this.root.className = "compass";
    this.strip.className = "compass-strip";
    this.root.append(this.strip);
    for (let i = 0; i < 24; i++) {
      const angle = wrap(i * TICK_STEP);
      const cardinal = CARDINALS.find((c) => Math.abs(wrap(c.angle - angle)) < 1e-6);
      const el = document.createElement("div");
      el.className = cardinal ? "compass-mark compass-cardinal" : "compass-mark";
      if (cardinal) el.textContent = cardinal.label;
      this.strip.append(el);
      this.marks.push({ el, angle });
    }
    const pin = document.createElement("div");
    pin.className = "compass-pin";
    this.strip.append(pin);
    this.clock.className = "compass-clock";
    this.root.append(this.clock);
    parent.append(this.root);
  }

  render(yaw: number): void {
    if (yaw === this.lastYaw) return;
    this.lastYaw = yaw;
    for (const m of this.marks) {
      const o = compassOffset(m.angle, yaw);
      m.el.hidden = o === undefined;
      if (o === undefined) continue;
      m.el.style.left = `${50 + o * 50}%`;
      // Las marcas se desvanecen hacia los bordes.
      m.el.style.opacity = String(1 - Math.abs(o) ** 2 * 0.85);
    }
  }

  setFloorTime(s: number): void {
    const text = `⧗ ${formatFloorTime(s)}`;
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }

  dispose(): void {
    this.root.remove();
  }
}
