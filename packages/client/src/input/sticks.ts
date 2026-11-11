/** Vector de un stick: x a la derecha, y hacia arriba, módulo en (0, 1]. */
export interface StickVector {
  x: number;
  y: number;
}

/** Por debajo de este módulo el stick cuenta como suelto (los mandos nunca vuelven exactamente a 0). */
export const DEADZONE = 0.22;

/**
 * Lectura de un stick con zona muerta: dentro de ella, undefined; fuera, el vector reescalado para que
 * salga de 0 justo en el borde de la zona muerta y llegue a 1 con el stick a fondo.
 */
export function stickVector(x: number, y: number, deadzone = DEADZONE): StickVector | undefined {
  const len = Math.hypot(x, y);
  if (!(len > deadzone)) return undefined;
  const k = Math.min(1, (len - deadzone) / (1 - deadzone)) / len;
  return { x: x * k, y: y * k };
}

/** Hacia dónde apunta un vector de stick, como `facing` (0 = +Z, arriba en pantalla; π/2 = +X, derecha). */
export function stickAngle(v: StickVector): number {
  return Math.atan2(v.x, v.y);
}

/**
 * Hacia dónde mira el jugador. Con ratón, al cursor. Con sticks (mando o pantalla táctil), hacia donde
 * empuja el stick derecho; con él suelto, hacia donde camina; y quieto, donde ya miraba (`last`).
 */
export function chooseAim(o: {
  device: "mouse" | "stick";
  mouseAim: number | undefined;
  aim: StickVector | undefined;
  move: StickVector | undefined;
  last: number;
}): number {
  if (o.device === "mouse") return o.mouseAim ?? o.last;
  if (o.aim) return stickAngle(o.aim);
  if (o.move) return stickAngle(o.move);
  return o.last;
}
