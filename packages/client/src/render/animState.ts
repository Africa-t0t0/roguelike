import { ENEMY_DEFS, MOVESETS, WEAPONS, strikeOf, type EnemyKind, type WeaponId } from "@roguelike/shared";
import { ENEMY_LOOKS } from "./looks";

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
}

const MOVING_SPEED = 0.2; // m/s
const SPRINT_SPEED = 6; // m/s
/** La esquiva no tiene clip propio: corre con el clip del estilo a esta velocidad. */
const DODGE_RUN_SPEED = 2;

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
  if (a.speed > SPRINT_SPEED) return looped(locomotion.sprint);
  if (a.speed > MOVING_SPEED) return looped(locomotion.run);
  return looped(locomotion.idle);
}

/** Clips de `ENEMY_LOOKS`. Reglas por prioridad: muerte, telegrafía, golpe recibido, correr, quieto. */
export function chooseEnemyAnim(e: EnemyAnimInput, clipLengths?: ClipLengths): AnimChoice {
  const look = ENEMY_LOOKS[e.kind];
  const { clips } = look;
  if (e.ai === "dead") return once(clips.death);
  if (e.ai === "telegraph") return once(clips.attack, fitTo(clips.attack, ENEMY_DEFS[e.kind].telegraphS, clipLengths));
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

  sample(x: number, z: number, dtS: number): number {
    const last = this.last;
    this.last = { x, z };
    if (!last || dtS <= 0) return this.value;
    const raw = Math.hypot(x - last.x, z - last.z) / dtS;
    if (raw > MAX_PLAUSIBLE_SPEED) return this.value;
    this.value += (raw - this.value) * (1 - Math.exp(-dtS / SPEED_TAU_S));
    return this.value;
  }
}
