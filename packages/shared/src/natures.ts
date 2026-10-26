/** Naturaleza elemental de un arma; "none" = sin elemento. */
export type Nature = "none" | "fire" | "ice" | "lightning";

export const ELEMENTS: readonly Exclude<Nature, "none">[] = ["fire", "ice", "lightning"];

/** Números de los efectos de naturaleza (sobre enemigos) y de la Afinidad. */
export const NATURE = {
  /** fuego: segundos de quemadura y fracción del golpe que se aplica como daño en ese lapso */
  burnS: 3,
  burnFrac: 0.2,
  /** hielo: ralentización (fracción, segundos y tope) y congelación tras `freezeHits` golpes en `freezeWindowS` */
  slowFrac: 0.3,
  slowS: 2,
  slowMax: 0.6,
  freezeHits: 3,
  freezeWindowS: 3,
  freezeS: 0.8,
  freezeImmuneS: 4,
  /** rayo: probabilidad base, extra por Afinidad, blancos, alcance (m) y fracción del daño que salta */
  chainChance: 0.25,
  chainPerAffinity: 0.06,
  chainTargets: 2,
  chainRangeM: 4,
  chainFrac: 0.5,
  /** cada carta de Afinidad suma este porcentaje a los efectos */
  affinityStep: 0.25,
} as const;

/** Élites: enemigos reforzados que castigan al jugador con un efecto extra. */
export const ELITE = {
  hpMult: 3,
  damageMult: 1.5,
  scale: 1.2,
  xpMult: 4,
  dropChance: 0.5,
  playerBurnDps: 4,
  playerBurnS: 3,
  playerSlowFrac: 0.3,
  playerSlowS: 2,
  playerStunS: 0.3,
} as const;

/** Sufijo del nombre del arma: "de fuego", "de hielo", "del rayo". */
export function natureSuffix(n: Nature): string {
  switch (n) {
    case "fire":
      return "de fuego";
    case "ice":
      return "de hielo";
    case "lightning":
      return "del rayo";
    default:
      return "";
  }
}

/** Efectos de la naturaleza con `affinity` cartas de Afinidad (+25% cada una; la ralentización topa en `slowMax`). */
export function natureEffects(n: Nature, affinity: number): { burnFrac: number; slowFrac: number; chainChance: number } {
  const mult = 1 + NATURE.affinityStep * affinity;
  return {
    burnFrac: n === "fire" ? NATURE.burnFrac * mult : 0,
    slowFrac: n === "ice" ? Math.min(NATURE.slowMax, NATURE.slowFrac * mult) : 0,
    chainChance: n === "lightning" ? NATURE.chainChance + NATURE.chainPerAffinity * affinity : 0,
  };
}
