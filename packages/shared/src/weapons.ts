import { natureSuffix, type Nature } from "./natures";
import { CLASS_DEFS, ENEMY_DEFS, type ClassId, type EnemyKind } from "./combat";

export type MovesetId = "one-hand-sword" | "great-sword";
export type WeaponId = "kingslayer-sword" | "guard-sword" | "great-sword";

export interface Strike {
  clip: string;
  duration: number;
  damageMult: number;
  range: number;
  arcDeg: number;
  /** fracción de la duración (0..1) en la que cae el impacto */
  impactAt: number;
}

export interface Moveset {
  id: MovesetId;
  /** `run*`: correr en cada dirección respecto de hacia dónde mira; `sprint` es hacia adelante. */
  locomotion: {
    idle: string;
    run: string;
    runBack: string;
    runLeft: string;
    runRight: string;
    sprint: string;
    jump: string;
    hit: string;
    death: string;
  };
  combo: readonly Strike[];
  comboResetS: number;
}

export interface Weapon {
  id: WeaponId;
  name: string;
  /** género gramatical del nombre, para concordar el sufijo del tier */
  gender: "f" | "m";
  movesetId: MovesetId;
  damage: number;
  rangeMult: number;
  arcMult: number;
  speedMult: number;
}

export const MOVESETS: Record<MovesetId, Moveset> = {
  "one-hand-sword": {
    id: "one-hand-sword",
    locomotion: {
      idle: "ss_idle",
      run: "ss_run",
      runBack: "ss_run_2",
      runLeft: "ss_strafe_3",
      runRight: "ss_strafe_4",
      sprint: "ss_run",
      jump: "ss_jump",
      hit: "ss_impact",
      death: "ss_death",
    },
    combo: [
      { clip: "ss_slash", duration: 0.35, damageMult: 1, range: 2.2, arcDeg: 120, impactAt: 0.45 },
      { clip: "ss_slash_3", duration: 0.35, damageMult: 1, range: 2.2, arcDeg: 120, impactAt: 0.45 },
      { clip: "ss_attack_4", duration: 0.5, damageMult: 1.5, range: 2.6, arcDeg: 160, impactAt: 0.5 },
    ],
    comboResetS: 0.6,
  },
  "great-sword": {
    id: "great-sword",
    locomotion: {
      idle: "gs_idle",
      run: "gs_run_2",
      runBack: "gs_run",
      runLeft: "gs_strafe_3",
      runRight: "gs_strafe_4",
      sprint: "gs_run_2",
      jump: "gs_jump",
      hit: "gs_impact",
      death: "gs_death",
    },
    combo: [
      { clip: "gs_slash", duration: 0.7, damageMult: 1, range: 3.0, arcDeg: 160, impactAt: 0.55 },
      { clip: "gs_high_spin_attack", duration: 0.9, damageMult: 1.6, range: 3.2, arcDeg: 220, impactAt: 0.6 },
    ],
    comboResetS: 0.8,
  },
};

export const WEAPONS: Record<WeaponId, Weapon> = {
  "kingslayer-sword": { id: "kingslayer-sword", name: "Espada del Kingslayer", gender: "f", movesetId: "one-hand-sword", damage: 12, rangeMult: 1, arcMult: 1, speedMult: 1 },
  "guard-sword": { id: "guard-sword", name: "Espada de guardia", gender: "f", movesetId: "one-hand-sword", damage: 10, rangeMult: 0.9, arcMult: 1, speedMult: 1.15 },
  "great-sword": { id: "great-sword", name: "Mandoble", gender: "m", movesetId: "great-sword", damage: 18, rangeMult: 1, arcMult: 1, speedMult: 1 },
};

export const STARTING_WEAPON: WeaponId = "kingslayer-sword";

export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(WEAPONS, v);
}

/** Golpe `step` (1..n) del arma, ya escalado por alcance, arco y velocidad del arma. */
export function strikeOf(weaponId: WeaponId, step: number, attackSpeedMult = 1): Strike {
  const w = WEAPONS[weaponId];
  const s = MOVESETS[w.movesetId].combo[step - 1]!;
  return {
    clip: s.clip,
    duration: s.duration / (w.speedMult * attackSpeedMult),
    damageMult: s.damageMult,
    range: s.range * w.rangeMult,
    arcDeg: s.arcDeg * w.arcMult,
    impactAt: s.impactAt,
  };
}

/** 4 = legendaria: solo sale de cofres, nunca de enemigos. */
export type WeaponTier = 1 | 2 | 3 | 4;

export const TIERS: Record<
  WeaponTier,
  { suffix: { f: string; m: string }; damageMult: number; dropChance: number; glow: [number, number, number] | null }
> = {
  1: { suffix: { f: "oxidada", m: "oxidado" }, damageMult: 1, dropChance: 0.1, glow: null },
  2: { suffix: { f: "templada", m: "templado" }, damageMult: 1.3, dropChance: 0.14, glow: [0.35, 0.55, 1.0] },
  3: { suffix: { f: "rúnica", m: "rúnico" }, damageMult: 1.7, dropChance: 0.18, glow: [0.65, 0.3, 1.0] },
  4: { suffix: { f: "legendaria", m: "legendario" }, damageMult: 2.2, dropChance: 0, glow: [1, 0.78, 0.25] },
};

export function isWeaponTier(v: unknown): v is WeaponTier {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

/** Nombre visible: "Mandoble templado" o, con naturaleza, "Mandoble templado de fuego". */
export function weaponDisplayName(id: WeaponId, tier: WeaponTier, nature: Nature = "none"): string {
  const w = WEAPONS[id];
  const base = `${w.name} ${TIERS[tier].suffix[w.gender]}`;
  return nature === "none" ? base : `${base} ${natureSuffix(nature)}`;
}

export function strikeDamage(weaponId: WeaponId, cls: ClassId, level: number, step: number, tier: WeaponTier = 1): number {
  const w = WEAPONS[weaponId];
  const base = w.damage + CLASS_DEFS[cls].damagePerLevel * (level - 1);
  return Math.round(base * MOVESETS[w.movesetId].combo[step - 1]!.damageMult * TIERS[tier].damageMult);
}

export type EnemyLoadout = { weaponId: WeaponId; tier: WeaponTier; nature: Nature };

/** Probabilidad de que un enemigo nazca armado y con qué arma; los hechiceros nunca. */
export const ARMED_CHANCE: Record<EnemyKind, { chance: number; weaponId: WeaponId } | null> = {
  minion: { chance: 0.6, weaponId: "guard-sword" },
  brute: { chance: 0.6, weaponId: "great-sword" },
  mage: null,
  pyromancer: null,
  stormcaller: null,
};

/** Daño y alcance del ataque de un enemigo, con o sin arma. */
export function enemyAttack(kind: EnemyKind, loadout: EnemyLoadout | null): { damage: number; attackRange: number } {
  const def = ENEMY_DEFS[kind];
  if (!loadout) return { damage: def.damage, attackRange: def.attackRange };
  const w = WEAPONS[loadout.weaponId];
  return {
    damage: Math.round(def.damage * (w.damage / 12) * TIERS[loadout.tier].damageMult),
    attackRange: Math.max(def.attackRange, 0.75 * strikeOf(loadout.weaponId, 1).range),
  };
}

/** Temporizadores del combo; los usan igual el servidor y el `LocalCombo` del cliente. */
export interface ComboTimers {
  /** paso del último golpe aceptado: 0 = ninguno, 1..n */
  comboStep: number;
  swingTimer: number;
  comboTimer: number;
  /** segundos que faltan para el impacto del swing en curso */
  impactTimer: number;
  impactPending: boolean;
}

export function newComboTimers(): ComboTimers {
  return { comboStep: 0, swingTimer: 0, comboTimer: 0, impactTimer: 0, impactPending: false };
}

const COMBO_EPS = 1e-9;

/**
 * Avanza el combo un input (`dt` = SIM_DT). Lo que queda por debajo de COMBO_EPS cuenta como 0, así un
 * golpe de `duration` s libera el siguiente tras exactamente ceil(duration / dt) avances.
 * Devuelve true en el avance en que se cumple el impacto pendiente (una sola vez).
 */
export function advanceCombo(c: ComboTimers, dt: number): boolean {
  c.swingTimer = c.swingTimer - dt > COMBO_EPS ? c.swingTimer - dt : 0;
  c.comboTimer = c.comboTimer - dt > COMBO_EPS ? c.comboTimer - dt : 0;
  if (c.comboTimer === 0) c.comboStep = 0;
  let impact = false;
  if (c.impactPending) {
    c.impactTimer = c.impactTimer - dt > COMBO_EPS ? c.impactTimer - dt : 0;
    if (c.impactTimer === 0) {
      c.impactPending = false;
      impact = true;
    }
  }
  return impact;
}

/** Arranca el siguiente golpe del combo si no hay uno en curso. Devuelve el paso (1..n) o 0. */
export function tryStartSwing(c: ComboTimers, weaponId: WeaponId, attackSpeedMult = 1): number {
  if (c.swingTimer > 0) return 0;
  const moveset = MOVESETS[WEAPONS[weaponId].movesetId];
  const step = c.comboTimer > 0 ? (c.comboStep % moveset.combo.length) + 1 : 1;
  const strike = strikeOf(weaponId, step, attackSpeedMult);
  c.comboStep = step;
  c.swingTimer = strike.duration;
  c.comboTimer = strike.duration + moveset.comboResetS;
  c.impactTimer = strike.impactAt * strike.duration;
  c.impactPending = true;
  return step;
}

/** Anula el impacto pendiente; el swing y el combo siguen. */
export function cancelImpact(c: ComboTimers): void {
  c.impactPending = false;
}
