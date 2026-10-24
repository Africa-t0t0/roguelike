import { CLASS_DEFS, ENEMY_DEFS, type EnemyKind } from "@roguelike/shared";

/** Qué clip de animación suena, si se repite y a qué velocidad. */
export interface AnimChoice {
  clip: string;
  loop: boolean;
  speed: number;
}

export interface HeroAnimInput {
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

export const HERO_ATTACK_CLIPS = [
  "1H_Melee_Attack_Chop",
  "1H_Melee_Attack_Slice_Diagonal",
  "1H_Melee_Attack_Stab",
] as const;

/** Velocidad para que `clip` dure `durationS`; sin la duración del clip, 1. */
function fitTo(clip: string, durationS: number, clipLengths?: ReadonlyMap<string, number>): number {
  const len = clipLengths?.get(clip);
  return len && len > 0 && durationS > 0 ? len / durationS : 1;
}

const once = (clip: string, speed = 1): AnimChoice => ({ clip, loop: false, speed });
const looped = (clip: string, speed = 1): AnimChoice => ({ clip, loop: true, speed });

/** Reglas por prioridad: muerte, esquiva, ataque, aire, golpe recibido, correr, quieto. */
export function chooseHeroAnim(a: HeroAnimInput, clipLengths?: ReadonlyMap<string, number>): AnimChoice {
  if (a.dead) return once("Death_A");
  if (a.dodging) return once("Dodge_Forward");
  const combo = CLASS_DEFS.warrior.combo;
  if (a.swingTimer > 0 && a.comboStep >= 1 && a.comboStep <= combo.length) {
    const clip = HERO_ATTACK_CLIPS[a.comboStep - 1]!;
    return once(clip, fitTo(clip, combo[a.comboStep - 1]!.duration, clipLengths));
  }
  if (a.airborne) return looped("Jump_Idle");
  if (a.hurtRecently) return once("Hit_A");
  if (a.speed > SPRINT_SPEED) return looped("Running_A", 1.4);
  if (a.speed > MOVING_SPEED) return looped("Running_A");
  return looped("Idle");
}

/** Reglas por prioridad: muerte, telegrafía, golpe recibido, correr, quieto. */
export function chooseEnemyAnim(e: EnemyAnimInput, clipLengths?: ReadonlyMap<string, number>): AnimChoice {
  if (e.ai === "dead") return once("Death_A");
  if (e.ai === "telegraph") {
    const clip = e.kind === "mage" ? "Spellcast_Shoot" : "1H_Melee_Attack_Chop";
    return once(clip, fitTo(clip, ENEMY_DEFS[e.kind].telegraphS, clipLengths));
  }
  if (e.hurtRecently) return once("Hit_A");
  if (e.speed > MOVING_SPEED) return looped("Running_A", e.kind === "minion" ? 1.3 : 1);
  return looped("Idle");
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
