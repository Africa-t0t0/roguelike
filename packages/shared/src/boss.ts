import { enemyScale } from "./waves";

/** Ataques del dragón: zarpazo, lanzallamas, pasada en llamas y pisotón. */
export type DragonMove = "claw" | "flame" | "flyby" | "stomp";

export const DRAGON_MOVES: readonly DragonMove[] = ["claw", "flame", "flyby", "stomp"];

/**
 * El dragón, jefe de cada piso. Daños base (antes del escalado del piso); tiempos en segundos y distancias en
 * metros. Con furia (vida ≤ `enrageFrac`) los avisos y las esperas se acortan a `enrageTimeMult`.
 */
export const DRAGON = {
  /** vida base por jugador; `dragonHp` la escala */
  hp: 1000,
  /** cada jugador más suma esta fracción de la vida base */
  hpPerExtraPlayer: 0.75,
  enrageFrac: 0.5,
  enrageTimeMult: 0.75,
  /** espera entre ataques */
  restS: 0.6,
  /** no ataca durante este rato tras aparecer (la entrada) */
  introS: 1.6,
  claw: { range: 4.5, arcDeg: 120, warnS: 0.55, damage: 20, triggerM: 4 },
  flame: { range: 10, arcDeg: 60, warnS: 0.6, fireS: 2, tickS: 0.3, damage: 7, burnDps: 4, triggerM: 10 },
  /** despega (`takeoffS`), vuela recto a `speed` y deja la franja `width` m de ancho, que quema `burnS` a pulsos */
  flyby: { takeoffS: 0.8, speed: 13, maxLength: 26, width: 2.6, burnS: 6, tickS: 0.5, damage: 8, landS: 0.4, enragedOffsetM: 2.2, everyNth: 3 },
  stomp: { radius: 4.5, warnS: 0.7, damage: 16, pushM: 3, triggerM: 3.5, minPlayers: 2 },
} as const;

/**
 * Cuánto más duro es el dragón en el piso `floor` (el 1 es la base): vida y daño crecen en proporción por piso;
 * `tempo` acelera sus avisos, esperas, pasos y animaciones (los tiempos se dividen por él) y `armor` es la
 * fracción del daño recibido que ignora. Los dos últimos con tope.
 */
export function dragonFloorScale(floor: number): { hp: number; damage: number; tempo: number; armor: number } {
  const k = Math.max(1, floor) - 1;
  return { hp: 1.6 ** k, damage: 1.3 ** k, tempo: Math.min(1.8, 1 + 0.15 * k), armor: Math.min(0.6, 0.1 * k) };
}

/** Vida del dragón: base × jugadores × piso × el escalado de los enemigos (nivel del grupo y reloj de la partida). */
export function dragonHp(players: number, floor: number, floorTime: number, partyLevel: number): number {
  const n = Math.max(1, players);
  const scale = enemyScale(floorTime, partyLevel).hpMult;
  return Math.round(DRAGON.hp * (1 + DRAGON.hpPerExtraPlayer * (n - 1)) * dragonFloorScale(floor).hp * scale);
}

/** Multiplicador de daño del dragón: el de los enemigos por el del piso. */
export function dragonDamageMult(floor: number, floorTime: number, partyLevel: number): number {
  return enemyScale(floorTime, partyLevel).damageMult * dragonFloorScale(floor).damage;
}

/** Tótem de la sala del jefe: dormido, con el jefe vivo, o abierto (lleva al piso siguiente). */
export type TotemPhase = "idle" | "fight" | "open";

/** Distancia (m) desde la que se activa el tótem. */
export const TOTEM_RANGE = 2.5;
