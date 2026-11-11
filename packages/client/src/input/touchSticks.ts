import type { InputState } from "./InputState";
import { stickVector, type StickVector } from "./sticks";

const STICK_RADIUS_PX = 56;
/** Con el stick derecho empujado más que esto, además de apuntar se ataca. */
const ATTACK_FROM = 0.55;

const CSS = `
.touch { position: fixed; inset: 0; z-index: 60; pointer-events: none; user-select: none; -webkit-user-select: none; }
.touch[hidden] { display: none; }
.touch-zone { position: absolute; bottom: 0; width: 46%; height: 58%; pointer-events: auto; touch-action: none; }
.touch-zone.left { left: 0; }
.touch-zone.right { right: 0; }
.touch-base { position: absolute; width: ${STICK_RADIUS_PX * 2}px; height: ${STICK_RADIUS_PX * 2}px; margin: -${STICK_RADIUS_PX}px 0 0 -${STICK_RADIUS_PX}px;
  border-radius: 50%; border: 2px solid rgba(255, 230, 180, 0.45); background: rgba(20, 16, 12, 0.3); }
.touch-knob { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
  background: rgba(255, 230, 180, 0.55); }
.touch-buttons { position: absolute; right: 0.8rem; bottom: 60%; display: flex; gap: 0.6rem; pointer-events: auto; touch-action: none; }
.touch-buttons.left { right: auto; left: 0.8rem; }
.touch-btn { width: 3.2rem; height: 3.2rem; border-radius: 50%; border: 2px solid rgba(255, 230, 180, 0.5); background: rgba(20, 16, 12, 0.55);
  color: #f3e6c8; font: 700 1.05rem Georgia, serif; touch-action: none; }
.touch-btn.on { background: rgba(255, 230, 180, 0.4); }
`;

interface Stick {
  zone: HTMLDivElement;
  base: HTMLDivElement;
  knob: HTMLDivElement;
  pointer: number | undefined;
  originX: number;
  originY: number;
  value: StickVector | undefined;
}

/**
 * Controles táctiles: dos sticks que aparecen donde se apoya el dedo (izquierdo mueve; derecho apunta y, a
 * fondo, ataca) y botones para saltar, tomar el arma y las habilidades. Sin pantalla táctil no se ven.
 */
export class TouchControls {
  private readonly root = document.createElement("div");
  private readonly style = document.createElement("style");
  private readonly left: Stick;
  private readonly right: Stick;
  private attacking = false;
  /** se tocó un control desde la última vez que se consultó */
  private touched = false;
  private seenTouch = false;
  private enabled = true;
  private readonly onFirstTouch = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    this.seenTouch = true;
    this.root.hidden = !this.enabled;
  };

  constructor(
    private readonly input: InputState,
    parent: HTMLElement = document.body,
  ) {
    this.style.textContent = CSS;
    this.root.className = "touch";
    // En un dispositivo táctil están desde el principio; en los demás aparecen con el primer toque.
    this.seenTouch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    this.root.hidden = !this.seenTouch;
    this.left = this.stick("left", () => undefined);
    this.right = this.stick("right", (v) => this.setAttacking(v !== undefined && Math.hypot(v.x, v.y) >= ATTACK_FROM));
    this.buttons("left", [["Salto", "Space"], ["E", "KeyE"]]);
    this.buttons("right", [["1", "Digit1"], ["2", "Digit2"], ["3", "Digit3"], ["4", "Digit4"]]);
    parent.append(this.style, this.root);
    window.addEventListener("pointerdown", this.onFirstTouch, true);
  }

  /** Vector del stick izquierdo (moverse) y del derecho (apuntar); undefined con el dedo levantado. */
  get move(): StickVector | undefined {
    return this.left.value;
  }

  get aim(): StickVector | undefined {
    return this.right.value;
  }

  /** Con un panel encima (cartas) los controles se quitan: van por encima del HUD y taparían sus botones. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.root.hidden = !(on && this.seenTouch);
    if (on) return;
    for (const s of [this.left, this.right]) {
      s.pointer = undefined;
      s.value = undefined;
      s.base.hidden = true;
    }
    this.setAttacking(false);
  }

  /** true si se usó algún control táctil desde la última consulta. */
  takeUsed(): boolean {
    const used = this.touched || this.left.value !== undefined || this.right.value !== undefined;
    this.touched = false;
    return used;
  }

  dispose(): void {
    window.removeEventListener("pointerdown", this.onFirstTouch, true);
    this.setAttacking(false);
    this.root.remove();
    this.style.remove();
  }

  private setAttacking(on: boolean): void {
    if (on === this.attacking) return;
    this.attacking = on;
    if (on) this.input.keyDown("Mouse0");
    else this.input.keyUp("Mouse0");
  }

  private stick(side: "left" | "right", onChange: (v: StickVector | undefined) => void): Stick {
    const zone = document.createElement("div");
    zone.className = `touch-zone ${side}`;
    const base = document.createElement("div");
    base.className = "touch-base";
    base.hidden = true;
    const knob = document.createElement("div");
    knob.className = "touch-knob";
    base.append(knob);
    zone.append(base);
    this.root.append(zone);
    const s: Stick = { zone, base, knob, pointer: undefined, originX: 0, originY: 0, value: undefined };
    const set = (e: PointerEvent) => {
      const dx = (e.clientX - s.originX) / STICK_RADIUS_PX;
      const dy = (e.clientY - s.originY) / STICK_RADIUS_PX;
      const len = Math.max(1, Math.hypot(dx, dy));
      knob.style.transform = `translate(${(dx / len) * STICK_RADIUS_PX}px, ${(dy / len) * STICK_RADIUS_PX}px)`;
      s.value = stickVector(dx / len, -dy / len); // en pantalla, y crece hacia abajo
      onChange(s.value);
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== s.pointer) return;
      s.pointer = undefined;
      s.value = undefined;
      base.hidden = true;
      onChange(undefined);
    };
    zone.addEventListener("pointerdown", (e) => {
      if (s.pointer !== undefined) return;
      e.preventDefault();
      this.touched = true;
      s.pointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      s.originX = e.clientX;
      s.originY = e.clientY;
      base.style.left = `${e.clientX - r.left}px`;
      base.style.top = `${e.clientY - r.top}px`;
      base.hidden = false;
      set(e);
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId === s.pointer) set(e);
    });
    zone.addEventListener("pointerup", release);
    zone.addEventListener("pointercancel", release);
    return s;
  }

  private buttons(side: "left" | "right", defs: [label: string, code: string][]): void {
    const row = document.createElement("div");
    row.className = `touch-buttons ${side}`;
    for (const [label, code] of defs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "touch-btn";
      b.textContent = label;
      const up = () => {
        b.classList.remove("on");
        this.input.keyUp(code);
      };
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.touched = true;
        b.classList.add("on");
        this.input.keyDown(code);
      });
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("pointerleave", up);
      row.append(b);
    }
    this.root.append(row);
  }
}
