import type { PlayerInput } from "@roguelike/shared";

/** Teclas de las casillas de habilidad, en orden: el bit i de `PlayerInput.abilities` es `ABILITY_KEYS[i]`. */
export const ABILITY_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4"] as const;

/** Teclado y clic izquierdo ("Mouse0") → `PlayerInput`, relativo a la cámara. Lógica pura, sin DOM. */
export class InputState {
  private readonly held = new Set<string>();
  private jumpQueued = false;
  private attackQueued = false;
  private interactQueued = false;
  /** teclas de habilidad apretadas desde el último sample (aunque ya se hayan soltado) */
  private abilitiesQueued = 0;
  private facing = 0;
  /** movimiento analógico de un stick (x derecha, y arriba, módulo ≤ 1); sin él manda el teclado */
  private stick: { x: number; y: number } | undefined;

  keyDown(code: string): void {
    // La autorepetición del teclado no vuelve a disparar el salto.
    if (!this.held.has(code)) {
      if (code === "Space") this.jumpQueued = true;
      if (code === "Mouse0") this.attackQueued = true;
      // Una vez por pulsación: el servidor cambia de arma con cada input que traiga `interact`.
      if (code === "KeyE") this.interactQueued = true;
      const slot = (ABILITY_KEYS as readonly string[]).indexOf(code);
      if (slot >= 0) this.abilitiesQueued |= 1 << slot;
    }
    this.held.add(code);
  }

  /** Movimiento de un stick (mando o pantalla táctil): x derecha, y arriba, módulo ≤ 1. Con undefined vuelve al teclado. */
  setMove(v: { x: number; y: number } | undefined): void {
    this.stick = v;
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  /** Suelta todo: la ventana perdió el foco y no vamos a recibir los keyup. */
  blur(): void {
    this.held.clear();
    this.jumpQueued = false;
    this.attackQueued = false;
    this.interactQueued = false;
    this.abilitiesQueued = 0;
  }

  /**
   * Las teclas 1-4 van como máscara mantenida (`abilities`): el servidor lanza con el flanco de subida y
   * el Bloqueo dura mientras se mantenga.
   * Un clic corto ataca una vez (aunque se suelte antes del sample); mantenerlo ataca en cada sample:
   * el servidor solo acepta un golpe cuando terminó el anterior, así que repetir no hace daño.
   * `viewTick`: tick del servidor que se está viendo (para el rebobinado de los golpes).
   * `aimFacing` y `aimDist`: hacia dónde y a cuántos metros se apunta (el cursor o el stick derecho).
   */
  sample(seq: number, cameraYaw: number, viewTick = 0, aimFacing?: number, aimDist?: number): PlayerInput {
    const forward = this.stick ? this.stick.y : Math.sign(this.axis("KeyW", "KeyS") + this.axis("ArrowUp", "ArrowDown"));
    const right = this.stick ? this.stick.x : Math.sign(this.axis("KeyD", "KeyA") + this.axis("ArrowRight", "ArrowLeft"));
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    let moveX = forward * sin + right * cos;
    let moveZ = forward * cos - right * sin;
    const len = Math.hypot(moveX, moveZ);
    if (len > 0) {
      // El teclado siempre va a fondo; un stick conserva cuánto se empuja (caminar despacio).
      const k = this.stick ? Math.max(1, len) : len;
      moveX /= k;
      moveZ /= k;
      this.facing = cameraYaw;
    } else {
      moveX = 0;
      moveZ = 0;
    }
    const attack = this.attackQueued || this.held.has("Mouse0");
    this.attackQueued = false;
    // Máscara mantenida; una pulsación corta entre dos samples cuenta en este (el servidor lanza con el flanco).
    let abilities = this.abilitiesQueued;
    this.abilitiesQueued = 0;
    ABILITY_KEYS.forEach((code, i) => {
      if (this.held.has(code)) abilities |= 1 << i;
    });
    // Se golpea, se lanza la habilidad y se bloquea hacia donde mira la cámara.
    if (attack || abilities) this.facing = cameraYaw;
    // Con un punto al que apuntar (el cursor, el stick derecho), se mira siempre hacia él.
    if (aimFacing !== undefined) this.facing = aimFacing;
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    const interact = this.interactQueued;
    this.interactQueued = false;
    const sprint = this.held.has("ShiftLeft") || this.held.has("ShiftRight");
    return { seq, moveX, moveZ, facing: this.facing, sprint, jump, attack, interact, abilities, viewTick, ...(aimDist === undefined ? {} : { aimDist }) };
  }

  private axis(positive: string, negative: string): number {
    return (this.held.has(positive) ? 1 : 0) - (this.held.has(negative) ? 1 : 0);
  }
}
