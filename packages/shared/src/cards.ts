import type { Rng } from "./rng";

export type StatCardId = "vitality" | "regen" | "strength" | "fury" | "reach" | "agility" | "ironskin" | "bloodlust" | "magnet";
export type AbilityId = "whirlwind" | "kick" | "warcry" | "slam" | "block" | "cleave";

export const BASE_REGEN = 0.5;
export const CHOICE_TIME_S = 20;
export const MAX_ACTIVE_ABILITIES = 4;
/** El factor de daño recibido nunca baja de aquí. */
export const MIN_DAMAGE_TAKEN_MULT = 0.4;

// Constantes de las habilidades que no dependen del rango.
/** impacto del Torbellino, como fracción de su animación */
export const WHIRLWIND_IMPACT_AT = 0.5;
/** impacto de la Patada, como fracción de su animación */
export const KICK_IMPACT_AT = 0.4;
/** segundos desde el inicio del Golpe sísmico hasta su impacto */
export const SLAM_IMPACT_S = 0.5;
/** apertura total del cono de la Patada, en grados */
export const KICK_ARC_DEG = 90;
/** segundos que dura el Grito de guerra */
export const WARCRY_DURATION_S = 8;
/** el Bloqueo cubre ± estos grados alrededor de hacia dónde mira el jugador */
export const BLOCK_HALF_ARC_DEG = 60;
/** multiplicador de la velocidad de movimiento mientras bloquea */
export const BLOCK_MOVE_MULT = 0.5;
/** velocidad (m/s) y vida (s) de la Onda de corte */
export const CLEAVE_SPEED = 14;
export const CLEAVE_LIFE_S = 0.5;

export const STAT_CARDS: Record<StatCardId, { name: string; text: string }> = {
  vitality: { name: "Vitalidad", text: "+20 de vida máxima y te cura 20" },
  regen: { name: "Regeneración", text: "+1 de vida por segundo" },
  strength: { name: "Fuerza", text: "+10% de daño" },
  fury: { name: "Furia", text: "+10% de velocidad de ataque" },
  reach: { name: "Alcance", text: "+15% de alcance y arco" },
  agility: { name: "Agilidad", text: "+8% de velocidad de movimiento" },
  ironskin: { name: "Piel de hierro", text: "-8% de daño recibido (máx. -60%)" },
  bloodlust: { name: "Sed de sangre", text: "+2 de vida por enemigo que mates" },
  magnet: { name: "Imán", text: "+50% de radio para recoger orbes" },
};

export interface AbilityRank {
  damageMult?: number;
  radius?: number;
  /** segundo giro del torbellino, en segundos tras el primero */
  secondSpin?: number;
  knockback?: number;
  stunS?: number;
  buff?: number;
  reduction?: number;
}

export interface AbilityDef {
  name: string;
  kind: "active" | "held" | "passive";
  cooldownS: number;
  animS: number;
  clip?: string;
  ranks: [AbilityRank, AbilityRank, AbilityRank];
  text(rank: 1 | 2 | 3): string;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const secs = (v: number): string => `${String(v).replace(".", ",")} s`;

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  whirlwind: {
    name: "Torbellino",
    kind: "active",
    cooldownS: 8,
    animS: 0.9,
    clip: "gs_high_spin_attack",
    ranks: [
      { damageMult: 1.2, radius: 3 },
      { damageMult: 1.6, radius: 3 },
      { damageMult: 1.6, radius: 3, secondSpin: 0.4 },
    ],
    text: (r) =>
      `Giras 360° y golpeas a todos a 3 m con ${pct(ABILITIES.whirlwind.ranks[r - 1]!.damageMult!)} de daño` +
      (r === 3 ? "; un segundo giro llega 0,4 s después" : ""),
  },
  kick: {
    name: "Patada",
    kind: "active",
    cooldownS: 6,
    animS: 0.6,
    clip: "ss_kick",
    ranks: [
      { damageMult: 0.5, radius: 2.2, knockback: 3, stunS: 1 },
      { damageMult: 0.5, radius: 2.2, knockback: 3, stunS: 1.5 },
      { damageMult: 0.5, radius: 2.2, knockback: 4, stunS: 2 },
    ],
    text: (r) => {
      const k = ABILITIES.kick.ranks[r - 1]!;
      return `Empuja ${k.knockback} m a los enemigos de frente y los aturde ${secs(k.stunS!)}`;
    },
  },
  warcry: {
    name: "Grito de guerra",
    kind: "active",
    cooldownS: 20,
    animS: 0.8,
    clip: "ss_power_up",
    ranks: [{ buff: 0.25 }, { buff: 0.35 }, { buff: 0.45 }],
    text: (r) => `Todo el grupo hace +${pct(ABILITIES.warcry.ranks[r - 1]!.buff!)} de daño durante ${WARCRY_DURATION_S} s`,
  },
  slam: {
    name: "Golpe sísmico",
    kind: "active",
    cooldownS: 10,
    animS: 0.9,
    clip: "ss_jump_2",
    ranks: [
      { damageMult: 1.5, radius: 3.5 },
      { damageMult: 2, radius: 3.5 },
      { damageMult: 2, radius: 4.5 },
    ],
    text: (r) => {
      const k = ABILITIES.slam.ranks[r - 1]!;
      return `Saltas y golpeas el suelo: ${pct(k.damageMult!)} de daño en ${k.radius} m`;
    },
  },
  block: {
    name: "Bloqueo",
    kind: "held",
    cooldownS: 0,
    animS: 0,
    clip: "ss_block_idle",
    ranks: [{ reduction: 0.7 }, { reduction: 0.8 }, { reduction: 0.9 }],
    text: (r) => `Mantén la tecla: -${pct(ABILITIES.block.ranks[r - 1]!.reduction!)} de daño de frente (±${BLOCK_HALF_ARC_DEG}°); te mueves a la mitad y no atacas`,
  },
  cleave: {
    name: "Onda de corte",
    kind: "passive",
    cooldownS: 0,
    animS: 0,
    ranks: [
      { damageMult: 0.6, radius: 0.8 },
      { damageMult: 0.9, radius: 0.8 },
      { damageMult: 0.9, radius: 1.2 },
    ],
    text: (r) => {
      const k = ABILITIES.cleave.ranks[r - 1]!;
      return `Pasiva: el último golpe del combo lanza una onda que atraviesa enemigos con ${pct(k.damageMult!)} de daño (radio ${k.radius} m)`;
    },
  },
};

const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];
const STAT_IDS = Object.keys(STAT_CARDS) as StatCardId[];

export type CardOffer = { kind: "stat"; id: StatCardId } | { kind: "ability"; id: AbilityId; rank: 1 | 2 | 3 };

export interface Progress {
  stats: Partial<Record<StatCardId, number>>;
  /** en orden de aprendizaje; incluye la pasiva si la tiene */
  abilities: { id: AbilityId; rank: number }[];
}

export function newProgress(): Progress {
  return { stats: {}, abilities: [] };
}

/** Casillas ocupadas: activas y mantenidas; la pasiva no cuenta. */
export function activeAbilityCount(p: Progress): number {
  return p.abilities.filter((a) => ABILITIES[a.id].kind !== "passive").length;
}

/** Sortea 3 cartas: 1 de habilidad (si hay alguna posible) y el resto de stat, distintas entre sí. */
export function rollOffer(rng: Rng, p: Progress): CardOffer[] {
  const full = activeAbilityCount(p) >= MAX_ACTIVE_ABILITIES;
  const options: CardOffer[] = [];
  for (const id of ABILITY_IDS) {
    const owned = p.abilities.find((a) => a.id === id);
    if (owned) {
      if (owned.rank < 3) options.push({ kind: "ability", id, rank: (owned.rank + 1) as 2 | 3 });
    } else if (ABILITIES[id].kind === "passive" || !full) {
      options.push({ kind: "ability", id, rank: 1 });
    }
  }
  const offer: CardOffer[] = [];
  if (options.length > 0) offer.push(rng.pick(options));
  const pool = [...STAT_IDS];
  while (offer.length < 3) {
    const i = rng.int(0, pool.length - 1);
    offer.push({ kind: "stat", id: pool.splice(i, 1)[0]! });
  }
  return offer;
}

export function applyCard(p: Progress, card: CardOffer): void {
  if (card.kind === "stat") {
    p.stats[card.id] = (p.stats[card.id] ?? 0) + 1;
    return;
  }
  const owned = p.abilities.find((a) => a.id === card.id);
  if (owned) owned.rank = Math.min(3, Math.max(owned.rank, card.rank));
  else p.abilities.push({ id: card.id, rank: card.rank });
}

export interface PlayerMods {
  maxHpBonus: number;
  regen: number;
  damageMult: number;
  attackSpeedMult: number;
  reachMult: number;
  moveSpeedMult: number;
  damageTakenMult: number;
  lifeOnKill: number;
  magnetMult: number;
}

/** Multiplicadores de las cartas de stat; el Grito y el Bloqueo los aplica el servidor encima. */
export function playerMods(p: Progress): PlayerMods {
  const n = (id: StatCardId): number => p.stats[id] ?? 0;
  return {
    maxHpBonus: 20 * n("vitality"),
    regen: n("regen"),
    damageMult: 1 + 0.1 * n("strength"),
    attackSpeedMult: 1 + 0.1 * n("fury"),
    reachMult: 1 + 0.15 * n("reach"),
    moveSpeedMult: 1 + 0.08 * n("agility"),
    damageTakenMult: Math.max(MIN_DAMAGE_TAKEN_MULT, 1 - 0.08 * n("ironskin")),
    lifeOnKill: 2 * n("bloodlust"),
    magnetMult: 1 + 0.5 * n("magnet"),
  };
}

export function cardTitle(card: CardOffer): string {
  if (card.kind === "stat") return STAT_CARDS[card.id].name;
  const name = ABILITIES[card.id].name;
  return card.rank === 1 ? name : `${name} ${"I".repeat(card.rank)}`;
}

export function cardText(card: CardOffer): string {
  return card.kind === "stat" ? STAT_CARDS[card.id].text : ABILITIES[card.id].text(card.rank);
}
