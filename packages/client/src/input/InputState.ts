import type { PlayerInput } from "@roguelike/shared";

/** Teclado → `PlayerInput`, relativo a la cámara. Lógica pura, sin DOM. */
export class InputState {
  private readonly held = new Set<string>();
  private dodgeQueued = false;
  private facing = 0;

  keyDown(code: string): void {
    // La autorepetición del teclado no vuelve a disparar el esquive.
    if (code === "Space" && !this.held.has(code)) this.dodgeQueued = true;
    this.held.add(code);
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  /** Suelta todo: la ventana perdió el foco y no vamos a recibir los keyup. */
  blur(): void {
    this.held.clear();
    this.dodgeQueued = false;
  }

  sample(seq: number, cameraYaw: number): PlayerInput {
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
    const dodge = this.dodgeQueued;
    this.dodgeQueued = false;
    return { seq, moveX, moveZ, facing: this.facing, dodge };
  }

  private axis(positive: string, negative: string): number {
    return (this.held.has(positive) ? 1 : 0) - (this.held.has(negative) ? 1 : 0);
  }
}
