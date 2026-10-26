export type ClassId = "warrior";

export interface ClassDef {
  baseHp: number;
  hpPerLevel: number;
  damagePerLevel: number;
}

export type EnemyKind = "minion" | "brute" | "mage" | "pyromancer" | "stormcaller";

export interface EnemyDef {
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  attackRange: number;
  telegraphS: number;
  cooldownS: number;
  xp: number;
  /** inmune al aturdimiento (patada) */
  stunImmune?: boolean;
  ranged?: {
    preferredMin: number;
    preferredMax: number;
    /** radio con el que se comprueba la línea de vista al jugador */
    losRadius: number;
  };
}

export const CLASS_DEFS: Record<ClassId, ClassDef> = {
  warrior: {
    baseHp: 120,
    hpPerLevel: 12,
    damagePerLevel: 2,
  },
};

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  minion: { hp: 20, speed: 6, radius: 0.4, damage: 6, attackRange: 1.2, telegraphS: 0.4, cooldownS: 1.2, xp: 4 },
  brute: { hp: 45, speed: 3.5, radius: 0.6, damage: 12, attackRange: 1.6, telegraphS: 0.6, cooldownS: 1.6, xp: 8 },
  mage: {
    hp: 30,
    speed: 3,
    radius: 0.5,
    damage: 10,
    attackRange: 0,
    telegraphS: 0.7,
    cooldownS: 2.2,
    xp: 8,
    ranged: { preferredMin: 6, preferredMax: 10, losRadius: 0.3 },
  },
  pyromancer: {
    hp: 30,
    speed: 3,
    radius: 0.5,
    damage: 14,
    attackRange: 0,
    telegraphS: 0.6,
    cooldownS: 3,
    xp: 8,
    ranged: { preferredMin: 7, preferredMax: 12, losRadius: 0.3 },
  },
  stormcaller: {
    hp: 26,
    speed: 3,
    radius: 0.5,
    damage: 12,
    attackRange: 0,
    telegraphS: 1.1,
    cooldownS: 3.5,
    xp: 8,
    ranged: { preferredMin: 8, preferredMax: 13, losRadius: 0.3 },
  },
};

export function xpToNext(level: number): number {
  return 60 + 40 * level;
}

export function playerStats(cls: ClassId, level: number): { maxHp: number } {
  const c = CLASS_DEFS[cls];
  return {
    maxHp: c.baseHp + c.hpPerLevel * (level - 1),
  };
}

export function enemiesForRoom(floor: number, players: number): number {
  return 3 + floor + (players - 1);
}

interface Circle {
  x: number;
  z: number;
  radius: number;
}

export function circlesOverlap(a: Circle, b: Circle): boolean {
  const r = a.radius + b.radius;
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < r * r;
}

/** facing 0 = +Z, π/2 = +X. */
export function inArc(
  origin: { x: number; z: number; facing: number },
  target: Circle,
  range: number,
  arcDeg: number,
): boolean {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= target.radius) return true;
  if (dist - target.radius > range) return false;
  const dot = (Math.sin(origin.facing) * dx + Math.cos(origin.facing) * dz) / dist;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return angle <= (arcDeg / 2) * (Math.PI / 180);
}
