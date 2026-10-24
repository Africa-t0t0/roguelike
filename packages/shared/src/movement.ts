import {
  DODGE_COOLDOWN,
  DODGE_DURATION,
  DODGE_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPEED,
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
}

export interface PlayerInput {
  seq: number;
  moveX: number;
  moveZ: number;
  facing: number;
  dodge: boolean;
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
): number {
  if (delta === 0) return axis === "x" ? x : z;
  const r = PLAYER_RADIUS;
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

export function stepPlayer(
  s: KinematicState,
  input: PlayerInput,
  d: Dungeon,
  dt: number,
): KinematicState {
  let { dodgeTime, dodgeCooldown, dodgeDirX, dodgeDirZ } = s;
  const cooldownReady = dodgeCooldown <= 0;
  dodgeCooldown = Math.max(0, dodgeCooldown - dt);

  if (input.dodge && cooldownReady && dodgeTime <= 0) {
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
    dx = input.moveX * k * PLAYER_SPEED * dt;
    dz = input.moveZ * k * PLAYER_SPEED * dt;
  }

  const x = moveAxis(d, s.x, s.z, dx, "x");
  const z = moveAxis(d, x, s.z, dz, "z");
  return { x, z, facing, dodgeTime, dodgeCooldown, dodgeDirX, dodgeDirZ };
}
