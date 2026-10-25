import {
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SPRINT_SPEED,
  TILE_SIZE,
} from "./constants";
import { isWalkableTile, type Dungeon } from "./dungeon";

export interface KinematicState {
  x: number;
  z: number;
  facing: number;
  /** altura sobre el suelo (m); 0 = en el suelo */
  y: number;
  /** velocidad vertical (m/s) */
  vy: number;
}

export interface PlayerInput {
  seq: number;
  moveX: number;
  moveZ: number;
  facing: number;
  sprint: boolean;
  jump: boolean;
  attack: boolean;
  interact: boolean;
  /** máscara de 4 bits: bit i = tecla de habilidad i+1 mantenida */
  abilities: number;
  /** tick del servidor que el cliente estaba viendo al atacar (para rebobinar) */
  viewTick: number;
}

/** Modificadores de movimiento (mejoras, Bloqueo); el servidor y la predicción usan los mismos. */
export interface MoveMods {
  speedMult: number;
}

export const NO_MOVE_MODS: MoveMods = { speedMult: 1 };

const EPS = 1e-6;
const ABILITIES_MASK_MAX = 15;

function finiteOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function sanitizeInput(raw: unknown): PlayerInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.seq !== "number" || !Number.isInteger(r.seq) || r.seq < 0) return null;
  let moveX = finiteOrZero(r.moveX);
  let moveZ = finiteOrZero(r.moveZ);
  const len = Math.hypot(moveX, moveZ);
  if (len > 1) {
    moveX /= len;
    moveZ /= len;
  }
  return {
    seq: r.seq,
    moveX,
    moveZ,
    facing: finiteOrZero(r.facing),
    sprint: r.sprint === true,
    jump: r.jump === true,
    attack: r.attack === true,
    interact: r.interact === true,
    abilities: sanitizeAbilities(r.abilities),
    viewTick: typeof r.viewTick === "number" && Number.isFinite(r.viewTick) && r.viewTick >= 0 ? r.viewTick : 0,
  };
}

/** La máscara de habilidades como entero de 0 a 15; cualquier otra cosa da 0. */
function sanitizeAbilities(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(ABILITIES_MASK_MAX, Math.max(0, Math.floor(v)));
}

/** Mueve el círculo en un eje contra las casillas de muro; el otro eje queda fijo. */
function moveAxis(
  d: Dungeon,
  x: number,
  z: number,
  delta: number,
  axis: "x" | "z",
  r: number,
): number {
  if (delta === 0) return axis === "x" ? x : z;
  const start = axis === "x" ? x : z;
  const other = axis === "x" ? z : x;
  let pos = start + delta;
  const lo = Math.min(start, pos) - r;
  const hi = Math.max(start, pos) + r;
  const t0 = Math.floor(lo / TILE_SIZE);
  const t1 = Math.floor(hi / TILE_SIZE);
  const o0 = Math.floor((other - r) / TILE_SIZE);
  const o1 = Math.floor((other + r) / TILE_SIZE);
  for (let t = t0; t <= t1; t++) {
    for (let o = o0; o <= o1; o++) {
      const tx = axis === "x" ? t : o;
      const tz = axis === "x" ? o : t;
      if (isWalkableTile(d, tx, tz)) continue;
      const minA = t * TILE_SIZE;
      const maxA = minA + TILE_SIZE;
      const minO = o * TILE_SIZE;
      const maxO = minO + TILE_SIZE;
      const dOther = Math.max(minO - other, 0, other - maxO);
      if (dOther >= r - EPS) continue; // rozar no es chocar (tolera error de coma flotante)
      const reach = Math.sqrt(r * r - dOther * dOther);
      if (delta > 0 && minA >= start - reach) pos = Math.min(pos, minA - reach);
      else if (delta < 0 && maxA <= start + reach) pos = Math.max(pos, maxA + reach);
    }
  }
  return pos;
}

/** Mueve un círculo de radio `radius` por (dx, dz) contra los muros: primero X y después Z. */
export function moveCircle(
  d: Dungeon,
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
): { x: number; z: number } {
  const nx = moveAxis(d, x, z, dx, "x", radius);
  const nz = moveAxis(d, nx, z, dz, "z", radius);
  return { x: nx, z: nz };
}

export function stepPlayer(
  s: KinematicState,
  input: PlayerInput,
  d: Dungeon,
  dt: number,
  mods: MoveMods = NO_MOVE_MODS,
): KinematicState {
  let { y, vy } = s;

  // Salto: solo desde el suelo.
  if (input.jump && y <= 0) vy = JUMP_VELOCITY;

  const len = Math.hypot(input.moveX, input.moveZ);
  const k = len > 1 ? 1 / len : 1;
  const speed = (input.sprint ? SPRINT_SPEED : PLAYER_SPEED) * mods.speedMult;
  const dx = input.moveX * k * speed * dt;
  const dz = input.moveZ * k * speed * dt;

  // Euler semi-implícito; el suelo es plano (y = 0) y los muros se resuelven solo en XZ.
  if (vy !== 0 || y > 0) {
    vy -= GRAVITY * dt;
    y += vy * dt;
    if (y <= 0) {
      y = 0;
      vy = 0;
    }
  }

  const { x, z } = moveCircle(d, s.x, s.z, dx, dz, PLAYER_RADIUS);
  return { x, z, facing: input.facing, y, vy };
}
