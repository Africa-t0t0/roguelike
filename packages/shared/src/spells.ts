import { ENEMY_DEFS, type EnemyKind } from "./combat";
import type { WeaponTier } from "./weapons";

export type CasterKind = "mage" | "pyromancer" | "stormcaller";

export function isCaster(kind: EnemyKind): kind is CasterKind {
  return kind === "mage" || kind === "pyromancer" || kind === "stormcaller";
}

/** Orbe del mago: radio y vida (la velocidad depende del tier, en `SPELLS.mage`). */
export const ORB = { radius: 0.3, lifetimeS: 3 };

/** Hechizos de cada hechicero según su tier. */
export const SPELLS = {
  mage: {
    kind: "orb",
    tiers: {
      1: { count: 1, speed: 9, spreadDeg: 0 },
      2: { count: 1, speed: 12, spreadDeg: 0 },
      3: { count: 3, speed: 12, spreadDeg: 15 },
    } as Record<WeaponTier, { count: number; speed: number; spreadDeg: number }>,
  },
  pyromancer: {
    kind: "zone",
    fuseS: 1.2,
    sideOffsetM: 3,
    tiers: {
      1: { count: 1, radius: 2.5 },
      2: { count: 1, radius: 3.2 },
      3: { count: 3, radius: 2.5 },
    } as Record<WeaponTier, { count: 1 | 3; radius: number }>,
  },
  stormcaller: {
    kind: "beam",
    length: 14,
    trackFrac: 0.6,
    fireS: 0.15,
    tiers: {
      1: { telegraphS: 1.1, width: 0.8 },
      2: { telegraphS: 0.9, width: 0.8 },
      3: { telegraphS: 0.9, width: 1.3 },
    } as Record<WeaponTier, { telegraphS: number; width: number }>,
  },
} as const;

/** Segundos de telegrafiado: el de `ENEMY_DEFS`, salvo el tormentoso, que depende del tier (acotado a 1..3). */
export function casterTelegraphS(kind: EnemyKind, tier: number): number {
  if (kind !== "stormcaller") return ENEMY_DEFS[kind].telegraphS;
  const t = Math.min(3, Math.max(1, Math.round(tier))) as WeaponTier;
  return SPELLS.stormcaller.tiers[t].telegraphS;
}
