import type { InputState } from "./InputState";
import { stickVector, type StickVector } from "./sticks";

/**
 * Botones del mando (disposición estándar) → las teclas que ya entiende `InputState`.
 * A salta, X o RT atacan, B toma el arma, L3 corre; LB, RB, Y y LT lanzan las habilidades 1 a 4.
 */
const BUTTONS: readonly (readonly [index: number, code: string])[] = [
  [0, "Space"],
  [2, "Mouse0"],
  [7, "Mouse0"],
  [1, "KeyE"],
  [10, "ShiftLeft"],
  [4, "Digit1"],
  [5, "Digit2"],
  [3, "Digit3"],
  [6, "Digit4"],
];

/** Lo que se lee del mando en un cuadro. */
export interface PadReading {
  move: StickVector | undefined;
  aim: StickVector | undefined;
  /** se tocó algo en este cuadro (stick fuera de la zona muerta o botón apretado) */
  used: boolean;
}

/** Lee el primer mando conectado en cada cuadro: los sticks se devuelven y los botones van a `InputState`. */
export class PadInput {
  private readonly held = new Set<string>();

  constructor(private readonly input: InputState) {}

  poll(): PadReading {
    const pad = typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p?.connected) : undefined;
    const down = new Set<string>();
    if (pad) for (const [index, code] of BUTTONS) if (pad.buttons[index]?.pressed) down.add(code);
    for (const code of down) if (!this.held.has(code)) this.input.keyDown(code);
    for (const code of this.held) if (!down.has(code)) this.input.keyUp(code);
    this.held.clear();
    for (const code of down) this.held.add(code);
    if (!pad) return { move: undefined, aim: undefined, used: false };
    // El eje vertical del mando crece hacia abajo.
    const move = stickVector(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0));
    const aim = stickVector(pad.axes[2] ?? 0, -(pad.axes[3] ?? 0));
    return { move, aim, used: move !== undefined || aim !== undefined || down.size > 0 };
  }
}
