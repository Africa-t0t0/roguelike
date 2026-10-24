import {
  DODGE_COOLDOWN,
  DODGE_DURATION,
  DODGE_SPEED,
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
  /** segundos restantes de esquive */
  dodgeTime: number;
  dodgeCooldown: number;
  dodgeDirX: number;
  dodgeDirZ: number;
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
  dodge: boolean;
  sprint: boolean;
  jump: boolean;
  attack: boolean;
  interact: boolean;
  /** tick del servidor que el cliente estaba viendo al atacar (para rebobinar) */
  viewTick: number;
}

const EPS = 1e-6;

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
    dodge: r.dodge === true,
    sprint: r.sprint === true,
    jump: r.jump === true,
    attack: r.attack === true,
    interact: r.interact === true,
    viewTick: typeof r.viewTick === "number" && Number.isFinite(r.viewTick) && r.viewTick >= 0 ? r.viewTick : 0,
  };
}

export function isInvulnerable(s: KinematicState): boolean {
  return s.dodgeTime > 0;
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
): KinematicState {
  let { dodgeTime, dodgeCooldown, dodgeDirX, dodgeDirZ, y, vy } = s;
  const grounded = y <= 0;
  const cooldownReady = dodgeCooldown <= 0;
  dodgeCooldown = Math.max(0, dodgeCooldown - dt);

  // Salto: solo desde el suelo y fuera de un esquive. Esquive: solo en el suelo.
  if (input.jump && grounded && dodgeTime <= 0) vy = JUMP_VELOCITY;
  if (input.dodge && grounded && vy === 0 && cooldownReady && dodgeTime <= 0) {
    const len = Math.hypot(input.moveX, input.moveZ);
    if (len > 0) {
      dodgeDirX = input.moveX / len;
      dodgeDirZ = input.moveZ / len;
      dodgeTime = DODGE_DURATION;
      dodgeCooldown = DODGE_COOLDOWN;
    }
  }

  let dx: number;
  let dz: number;
  let facing = input.facing;
  if (dodgeTime > 0) {
    const t = Math.min(dt, dodgeTime);
    dx = dodgeDirX * DODGE_SPEED * t;
    dz = dodgeDirZ * DODGE_SPEED * t;
    dodgeTime = Math.max(0, dodgeTime - dt);
    facing = s.facing;
  } else {
    const len = Math.hypot(input.moveX, input.moveZ);
    const k = len > 1 ? 1 / len : 1;
    const speed = input.sprint ? SPRINT_SPEED : PLAYER_SPEED;
    dx = input.moveX * k * speed * dt;
    dz = input.moveZ * k * speed * dt;
  }

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
  return { x, z, facing, dodgeTime, dodgeCooldown, dodgeDirX, dodgeDirZ, y, vy };
}
