import { ENEMY_DEFS, MOVESETS, WEAPONS, strikeOf, type EnemyKind, type WeaponId } from "@roguelike/shared";
import { ENEMY_LOOKS, HERO_STRIDE_MPS } from "./looks";

/** Qué clip de animación suena, si se repite y a qué velocidad. */
export interface AnimChoice {
  clip: string;
  loop: boolean;
  speed: number;
}

/** Duración en segundos de cada clip (sin el clip, `undefined` o 0). Un `Map` sirve. */
export interface ClipLengths {
  get(clip: string): number | undefined;
}

export interface HeroAnimInput {
  /** arma equipada: de su estilo salen la locomoción y el combo */
  weaponId: WeaponId;
  /** m/s en el plano */
  speed: number;
  /** dirección del movimiento respecto de hacia dónde mira, en rad: 0 adelante, π/2 derecha, −π/2 izquierda */
  moveAngle: number;
  airborne: boolean;
  dodging: boolean;
  comboStep: number;
  swingTimer: number;
  dead: boolean;
  hurtRecently: boolean;
}

export interface EnemyAnimInput {
  kind: EnemyKind;
  ai: string;
  speed: number;
  hurtRecently: boolean;
  /** arma en la mano (`null` si va desarmado): armado, ataca con el primer golpe de su arma */
  weaponId: WeaponId | null;
}

const MOVING_SPEED = 0.2; // m/s
const SPRINT_SPEED = 6; // m/s
/** La esquiva no tiene clip propio: corre con el clip del estilo a esta velocidad. */
const DODGE_RUN_SPEED = 2;

/** Límites de la velocidad de reproducción al ajustar el paso: fuera de ellos el clip se ve mal. */
const MIN_STRIDE_RATE = 0.6;
const MAX_STRIDE_RATE = 2.2;

type RunDir = "run" | "runBack" | "runLeft" | "runRight";

/**
 * Cuatro sectores: adelante y atrás de ±67,5°, los lados de ±22,5° (las diagonales del teclado, a 45°,
 * caen en adelante o atrás). `yaw` es cuánto girar el cuerpo para que el clip apunte a donde va.
 */
export function moveSector(angle: number): { dir: RunDir; yaw: number } {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle)); // a (−π, π]
  const abs = Math.abs(a);
  if (abs <= (3 * Math.PI) / 8) return { dir: "run", yaw: a };
  if (abs >= (5 * Math.PI) / 8) return { dir: "runBack", yaw: a - Math.sign(a) * Math.PI };
  return a > 0 ? { dir: "runRight", yaw: a - Math.PI / 2 } : { dir: "runLeft", yaw: a + Math.PI / 2 };
}

/** Velocidad de reproducción para que los pies acompañen a `speedMps`. */
function strideRate(clip: string, speedMps: number): number {
  const stride = HERO_STRIDE_MPS[clip];
  if (!stride) return 1;
  return Math.min(MAX_STRIDE_RATE, Math.max(MIN_STRIDE_RATE, speedMps / stride));
}

/** Velocidad para que `clip` dure `durationS`; sin la duración del clip, 1. */
function fitTo(clip: string, durationS: number, clipLengths?: ClipLengths): number {
  const len = clipLengths?.get(clip);
  return len && len > 0 && durationS > 0 ? len / durationS : 1;
}

const once = (clip: string, speed = 1): AnimChoice => ({ clip, loop: false, speed });
const looped = (clip: string, speed = 1): AnimChoice => ({ clip, loop: true, speed });

/**
 * Clips del estilo del arma. Reglas por prioridad: muerte, esquiva, ataque, aire, golpe recibido,
 * correr, quieto.
 */
export function chooseHeroAnim(a: HeroAnimInput, clipLengths?: ClipLengths): AnimChoice {
  const { locomotion, combo } = MOVESETS[WEAPONS[a.weaponId].movesetId];
  if (a.dead) return once(locomotion.death);
  if (a.dodging) return looped(locomotion.run, DODGE_RUN_SPEED);
  if (a.swingTimer > 0 && a.comboStep >= 1 && a.comboStep <= combo.length) {
    const strike = strikeOf(a.weaponId, a.comboStep);
    return once(strike.clip, fitTo(strike.clip, strike.duration, clipLengths));
  }
  if (a.airborne) return once(locomotion.jump);
  if (a.hurtRecently) return once(locomotion.hit);
  if (a.speed <= MOVING_SPEED) return looped(locomotion.idle);
  const { dir } = moveSector(a.moveAngle);
  const clip = dir === "run" && a.speed > SPRINT_SPEED ? locomotion.sprint : locomotion[dir];
  return looped(clip, strideRate(clip, a.speed));
}

/** Giro del cuerpo (rad) respecto de la mirada: solo al correr, para que el clip apunte a donde va. */
export function heroBodyYaw(a: HeroAnimInput): number {
  const running = !a.dead && !a.dodging && !a.airborne && !(a.swingTimer > 0 && a.comboStep >= 1);
  return running && a.speed > MOVING_SPEED ? moveSector(a.moveAngle).yaw : 0;
}

/**
 * Clips de `ENEMY_LOOKS`. Reglas por prioridad: muerte, telegrafía, golpe recibido, correr, quieto. Si va
 * armado, la telegrafía usa el primer golpe de su arma; el resto de los clips no cambia.
 */
export function chooseEnemyAnim(e: EnemyAnimInput, clipLengths?: ClipLengths): AnimChoice {
  const look = ENEMY_LOOKS[e.kind];
  const { clips } = look;
  if (e.ai === "dead") return once(clips.death);
  if (e.ai === "telegraph") {
    const attack = e.weaponId ? strikeOf(e.weaponId, 1).clip : clips.attack;
    return once(attack, fitTo(attack, ENEMY_DEFS[e.kind].telegraphS, clipLengths));
  }
  if (e.hurtRecently) return once(clips.hit);
  if (e.speed > MOVING_SPEED) return looped(clips.run, look.runSpeed ?? 1);
  return looped(clips.idle);
}

const HURT_WINDOW_MS = 300;

/** Quién recibió daño y cuándo; "herido" dura 0,3 s desde el golpe. */
export class RecentHits {
  private readonly at = new Map<string, number>();

  hit(id: string, atMs: number): void {
    // Sin crecer para siempre: lo que ya expiró se olvida (los ids de enemigos no se reusan).
    for (const [k, t] of this.at) if (t + HURT_WINDOW_MS * 10 < atMs) this.at.delete(k);
    this.at.set(id, atMs);
  }

  recently(id: string, nowMs: number): boolean {
    const t = this.at.get(id);
    return t !== undefined && nowMs >= t && nowMs < t + HURT_WINDOW_MS;
  }

  forget(id: string): void {
    this.at.delete(id);
  }
}

const SPEED_TAU_S = 0.08; // suavizado de la velocidad medida
const MAX_PLAUSIBLE_SPEED = 30; // m/s: más que esto es un salto (reaparición, corrección), no movimiento

/** Velocidad en el plano a partir de posiciones dibujadas en frames sucesivos, suavizada. */
export class SpeedMeter {
  private last: { x: number; z: number } | undefined;
  private value = 0;
  /** velocidad suavizada en el plano, m/s */
  vx = 0;
  vz = 0;

  sample(x: number, z: number, dtS: number): number {
    const last = this.last;
    this.last = { x, z };
    if (!last || dtS <= 0) return this.value;
    const rx = (x - last.x) / dtS;
    const rz = (z - last.z) / dtS;
    const raw = Math.hypot(rx, rz);
    if (raw > MAX_PLAUSIBLE_SPEED) return this.value;
    const k = 1 - Math.exp(-dtS / SPEED_TAU_S);
    this.value += (raw - this.value) * k;
    this.vx += (rx - this.vx) * k;
    this.vz += (rz - this.vz) * k;
    return this.value;
  }

  /** Dirección de la velocidad respecto de `facing` (0 = +Z, π/2 = +X): 0 adelante, π/2 derecha. */
  angleFrom(facing: number): number {
    const forward = this.vx * Math.sin(facing) + this.vz * Math.cos(facing);
    const right = this.vx * Math.cos(facing) - this.vz * Math.sin(facing);
    return Math.atan2(right, forward);
  }
}
