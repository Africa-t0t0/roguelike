import type { PlayerInput } from "@roguelike/shared";

/** Teclado y clic izquierdo ("Mouse0") → `PlayerInput`, relativo a la cámara. Lógica pura, sin DOM. */
export class InputState {
  private readonly held = new Set<string>();
  private dodgeQueued = false;
  private jumpQueued = false;
  private attackQueued = false;
  private facing = 0;

  keyDown(code: string): void {
    // La autorepetición del teclado no vuelve a disparar el esquive ni el salto.
    if (!this.held.has(code)) {
      if (code === "KeyC") this.dodgeQueued = true;
      if (code === "Space") this.jumpQueued = true;
      if (code === "Mouse0") this.attackQueued = true;
    }
    this.held.add(code);
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  /** Suelta todo: la ventana perdió el foco y no vamos a recibir los keyup. */
  blur(): void {
    this.held.clear();
    this.dodgeQueued = false;
    this.jumpQueued = false;
    this.attackQueued = false;
  }

  /**
   * Un clic corto ataca una vez (aunque se suelte antes del sample); mantenerlo ataca en cada sample:
   * el servidor solo acepta un golpe cuando terminó el anterior, así que repetir no hace daño.
   * `viewTick`: tick del servidor que se está viendo (para el rebobinado de los golpes).
   */
  sample(seq: number, cameraYaw: number, viewTick = 0): PlayerInput {
    const forward = this.axis("KeyW", "KeyS");
    const right = this.axis("KeyD", "KeyA");
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    let moveX = forward * sin + right * cos;
    let moveZ = forward * cos - right * sin;
    const len = Math.hypot(moveX, moveZ);
    if (len > 0) {
      moveX /= len;
      moveZ /= len;
      this.facing = cameraYaw;
    } else {
      moveX = 0;
      moveZ = 0;
    }
    const attack = this.attackQueued || this.held.has("Mouse0");
    this.attackQueued = false;
    if (attack) this.facing = cameraYaw; // se golpea hacia donde mira la cámara
    const dodge = this.dodgeQueued;
    const jump = this.jumpQueued;
    this.dodgeQueued = false;
    this.jumpQueued = false;
    const sprint = this.held.has("ShiftLeft") || this.held.has("ShiftRight");
    return { seq, moveX, moveZ, facing: this.facing, dodge, sprint, jump, attack, interact: false, viewTick };
  }

  private axis(positive: string, negative: string): number {
    return (this.held.has(positive) ? 1 : 0) - (this.held.has(negative) ? 1 : 0);
  }
}

/** El mismo input sin acciones (p. ej. muerto): sin moverse, saltar, esquivar, correr ni atacar. */
export function withoutActions(input: PlayerInput): PlayerInput {
  return { ...input, moveX: 0, moveZ: 0, dodge: false, sprint: false, jump: false, attack: false, interact: false };
}
