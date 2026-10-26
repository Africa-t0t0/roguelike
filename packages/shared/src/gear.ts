import { MIN_COOLDOWN_MULT, MIN_DAMAGE_TAKEN_MULT, playerMods, type AbilityId, type PlayerMods, type Progress, type StatCardId } from "./cards";
import type { ClassId } from "./combat";
import type { Rng } from "./rng";
import { rollTier } from "./waves";
import { TIERS, type WeaponTier } from "./weapons";

export type GearSlot = "helmet" | "chest" | "gloves" | "boots";
export const GEAR_SLOTS: readonly GearSlot[] = ["helmet", "chest", "gloves", "boots"];

export type GearStat =
  | "maxHp" | "damageTaken" | "attackSpeed" | "moveSpeed"
  | "regen" | "damage" | "reach" | "magnet" | "xp" | "cooldown" | "lifeOnKill"
  | "resFire" | "resIce" | "resLightning";

/** Stat principal de cada ranura (sale siempre, en `stats[0]`). */
export const GEAR_MAIN: Record<GearSlot, GearStat> = {
  helmet: "maxHp",
  chest: "damageTaken",
  gloves: "attackSpeed",
  boots: "moveSpeed",
};

/** Valor de tier 1 de cada stat: fracciones (0,05 = 5 %), salvo vida, regeneración y vida por muerte, que son planos. */
export const GEAR_BASE: Record<GearStat, number> = {
  maxHp: 15,
  damageTaken: 0.05,
  attackSpeed: 0.06,
  moveSpeed: 0.05,
  regen: 1,
  damage: 0.06,
  reach: 0.08,
  magnet: 0.25,
  xp: 0.08,
  cooldown: 0.05,
  lifeOnKill: 1,
  resFire: 0.08,
  resIce: 0.08,
  resLightning: 0.08,
};

export const GEAR_TIER_MULT: Record<WeaponTier, number> = { 1: 1, 2: 1.5, 3: 2, 4: 2.5 };
export const GEAR_SECONDARIES: Record<WeaponTier, number> = { 1: 0, 2: 1, 3: 2, 4: 2 };
/** Resistencia a todos los elementos que trae toda pieza legendaria. */
export const GEAR_LEGENDARY_ALL_RES = 0.1;
/** Tope de resistencia por elemento, sumando todo. */
export const MAX_RESIST = 0.6;
/** Piso del enfriamiento con el Reloj de arena roto (el normal es `MIN_COOLDOWN_MULT`). */
export const MIN_COOLDOWN_MULT_HOURGLASS = 0.4;

/** Secundarias posibles: todo menos las principales de las ranuras. */
const SECONDARY_BAG: readonly GearStat[] = ["regen", "damage", "reach", "magnet", "xp", "cooldown", "lifeOnKill", "resFire", "resIce", "resLightning"];

export type LegendaryId =
  | "warcryLong" | "warcryHeal" | "blockReflect" | "lastStand"
  | "whirlCharges" | "kickStun" | "slamCracks" | "thrustDash";

export const LEGENDARY_POOL: Record<ClassId, Record<GearSlot, LegendaryId[]>> = {
  warrior: {
    helmet: ["warcryLong", "warcryHeal"],
    chest: ["blockReflect", "lastStand"],
    gloves: ["whirlCharges", "kickStun"],
    boots: ["slamCracks", "thrustDash"],
  },
};

export const LEGENDARY_TEXT: Record<LegendaryId, string> = {
  warcryLong: "Grito de guerra dura un 50 % más",
  warcryHeal: "Grito de guerra también cura un 15 % de la vida a los aliados",
  blockReflect: "Bloqueo devuelve el 30 % del daño bloqueado",
  lastStand: "Al bajar del 30 % de vida, te escudas 3 s: −80 % de daño recibido (una vez cada 30 s)",
  whirlCharges: "Torbellino tiene 2 cargas",
  kickStun: "Patada aturde el doble de tiempo",
  slamCracks: "Golpe sísmico deja el suelo agrietado 3 s: ralentiza un 40 %",
  thrustDash: "Tajo frontal te impulsa 3 m hacia adelante",
};

/** Habilidad que hace falta para que el efecto sirva (en gris si falta). `lastStand` no depende de ninguna. */
export const LEGENDARY_ABILITY: Partial<Record<LegendaryId, AbilityId>> = {
  warcryLong: "warcry",
  warcryHeal: "warcry",
  blockReflect: "block",
  whirlCharges: "whirlwind",
  kickStun: "kick",
  slamCracks: "slam",
  thrustDash: "thrust",
};

/**
 * Una entrada de `stats`. La resistencia general de las legendarias va como UNA entrada aparte con la clave
 * `allRes` (suma esa cantidad a las tres resistencias); no es un `GearStat` porque no sale en la bolsa.
 */
export type GearStatKey = GearStat | "allRes";

export interface GearItem {
  slot: GearSlot;
  tier: WeaponTier;
  /** `stats[0]` es la principal, luego las secundarias y, en tier 4, `allRes` al final */
  stats: { stat: GearStatKey; value: number }[];
  legendary: LegendaryId | null;
}

/** Evita restos de coma flotante (0,05 × 1,5 = 0,07500000000000001). */
const round = (v: number): number => Math.round(v * 10000) / 10000;

/** Vida máxima y vida por muerte salen enteras; la regeneración, a un decimal (como la muestra `gearStatText`); el resto, fracciones. */
function rollValue(stat: GearStat, base: number, mult: number): number {
  const v = base * mult;
  if (stat === "maxHp" || stat === "lifeOnKill") return Math.round(v);
  if (stat === "regen") return Math.round(v * 10) / 10;
  return round(v);
}

export function rollGear(rng: Rng, slot: GearSlot, tier: WeaponTier, cls: ClassId): GearItem {
  const mult = GEAR_TIER_MULT[tier];
  const main = GEAR_MAIN[slot];
  const stats: GearItem["stats"] = [{ stat: main, value: rollValue(main, GEAR_BASE[main], mult) }];
  const bag = [...SECONDARY_BAG];
  for (let i = 0; i < GEAR_SECONDARIES[tier]; i++) {
    const s = bag.splice(rng.int(0, bag.length - 1), 1)[0]!;
    stats.push({ stat: s, value: rollValue(s, GEAR_BASE[s], mult) });
  }
  let legendary: LegendaryId | null = null;
  if (tier === 4) {
    stats.push({ stat: "allRes", value: GEAR_LEGENDARY_ALL_RES });
    legendary = rng.pick(LEGENDARY_POOL[cls][slot]);
  }
  return { slot, tier, stats, legendary };
}

const GEAR_NAMES: Record<GearSlot, { name: string; gender: "f" | "m"; plural: boolean }> = {
  helmet: { name: "Yelmo", gender: "m", plural: false },
  chest: { name: "Pechera", gender: "f", plural: false },
  gloves: { name: "Guanteletes", gender: "m", plural: true },
  boots: { name: "Botas", gender: "f", plural: true },
};

export function gearName(item: GearItem): string {
  const g = GEAR_NAMES[item.slot];
  return `${g.name} ${TIERS[item.tier].suffix[g.gender]}${g.plural ? "s" : ""}`;
}

const STAT_TEXT: Record<GearStatKey, { kind: "flat" | "pct"; sign: "+" | "-"; label: string }> = {
  maxHp: { kind: "flat", sign: "+", label: "vida máxima" },
  damageTaken: { kind: "pct", sign: "-", label: "daño recibido" },
  attackSpeed: { kind: "pct", sign: "+", label: "velocidad de ataque" },
  moveSpeed: { kind: "pct", sign: "+", label: "velocidad de movimiento" },
  regen: { kind: "flat", sign: "+", label: "de regeneración por segundo" },
  damage: { kind: "pct", sign: "+", label: "daño" },
  reach: { kind: "pct", sign: "+", label: "alcance" },
  magnet: { kind: "pct", sign: "+", label: "radio de imán" },
  xp: { kind: "pct", sign: "+", label: "XP" },
  cooldown: { kind: "pct", sign: "-", label: "enfriamiento" },
  lifeOnKill: { kind: "flat", sign: "+", label: "vida por muerte" },
  resFire: { kind: "pct", sign: "+", label: "resistencia al fuego" },
  resIce: { kind: "pct", sign: "+", label: "resistencia al hielo" },
  resLightning: { kind: "pct", sign: "+", label: "resistencia al rayo" },
  allRes: { kind: "pct", sign: "+", label: "resistencia a todos los elementos" },
};

/** Número con coma decimal y a lo más un decimal (7,5; 12). */
const num = (v: number): string => String(Math.round(v * 10) / 10).replace(".", ",");

/** Formato: "+7,5 % velocidad de movimiento", "-5 % enfriamiento", "+15 vida máxima". */
export function gearStatText(stat: GearStatKey, value: number): string {
  const t = STAT_TEXT[stat];
  return t.kind === "pct" ? `${t.sign}${num(value * 100)} % ${t.label}` : `${t.sign}${num(value)} ${t.label}`;
}

export type RelicId =
  | "oakHeart" | "hawkFeather" | "scholarEye" | "sentinelAmulet" | "beastClaw" | "threeKingsStone"
  | "glassHeart" | "brokenHourglass" | "vampireFang";

export const RELICS: Record<RelicId, { name: string; text: string; tradeoff: boolean }> = {
  oakHeart: { name: "Corazón de roble", text: "+40 de vida máxima y +1 de regeneración por segundo", tradeoff: false },
  hawkFeather: { name: "Pluma del halcón", text: "+12 % de velocidad de movimiento y +50 % de radio de imán", tradeoff: false },
  scholarEye: { name: "Ojo del erudito", text: "+25 % de XP", tradeoff: false },
  sentinelAmulet: { name: "Amuleto del centinela", text: "-15 % de daño recibido", tradeoff: false },
  beastClaw: { name: "Garra de bestia", text: "+15 % de daño y +10 % de velocidad de ataque", tradeoff: false },
  threeKingsStone: { name: "Piedra de los tres reyes", text: "+15 % de resistencia a todos los elementos", tradeoff: false },
  glassHeart: { name: "Corazón de cristal", text: "+60 % de daño; -25 % de vida máxima", tradeoff: true },
  brokenHourglass: { name: "Reloj de arena roto", text: "-40 % de enfriamiento; cada habilidad cuesta 4 de vida (sin bajar de 1)", tradeoff: true },
  vampireFang: { name: "Colmillo del vampiro", text: "recuperas el 5 % del daño que haces; sin regeneración pasiva", tradeoff: true },
};

export type CombinedMods = PlayerMods & {
  /** fracción del daño hecho que se recupera como vida (Colmillo del vampiro) */
  vampire: number;
  /** vida que cuesta cada habilidad (Reloj de arena roto); el servidor no baja de 1 */
  abilityHpCost: number;
  /** sin regeneración pasiva (Colmillo del vampiro); `regen` conserva la suma por si se quita la reliquia */
  noRegen: boolean;
  /** efectos legendarios de las piezas puestas */
  legendaries: LegendaryId[];
};

/**
 * Suma cartas, equipo y reliquia. Los bonos son aditivos (como las cartas entre sí) y comparten los topes:
 * daño recibido ≥ 0,4; enfriamiento ≥ 0,5 (0,4 con el Reloj de arena roto); resistencia ≤ 0,6 por elemento.
 * `maxHpMult` (Corazón de cristal) lo aplica quien calcula la vida máxima: (base + `maxHpBonus`) × `maxHpMult`.
 */
export function combinedMods(p: Progress, gear: Partial<Record<GearSlot, GearItem>>, relic: RelicId | null): CombinedMods {
  const base = playerMods(p);
  const n = (id: StatCardId): number => p.stats[id] ?? 0;
  const sum: Record<GearStatKey, number> = {
    maxHp: 0, damageTaken: 0, attackSpeed: 0, moveSpeed: 0, regen: 0, damage: 0, reach: 0, magnet: 0, xp: 0,
    cooldown: 0, lifeOnKill: 0, resFire: 0, resIce: 0, resLightning: 0, allRes: 0,
  };
  const legendaries: LegendaryId[] = [];
  for (const item of Object.values(gear)) {
    if (!item) continue;
    for (const e of item.stats) sum[e.stat] += e.value;
    if (item.legendary) legendaries.push(item.legendary);
  }
  const r = relic;
  // el tope de la carta ya está en `base`; aquí hace falta el valor sin tope para sumar y topar una sola vez
  const takenRaw = 1 - 0.08 * n("ironskin") - sum.damageTaken - (r === "sentinelAmulet" ? 0.15 : 0);
  const cdRaw = 0.9 ** n("haste") * (1 - sum.cooldown) * (r === "brokenHourglass" ? 0.6 : 1);
  const allRes = sum.allRes + (r === "threeKingsStone" ? 0.15 : 0);
  const res = (v: number): number => Math.min(MAX_RESIST, v + allRes);
  return {
    ...base,
    maxHpBonus: base.maxHpBonus + sum.maxHp + (r === "oakHeart" ? 40 : 0),
    regen: base.regen + sum.regen + (r === "oakHeart" ? 1 : 0),
    damageMult: base.damageMult + sum.damage + (r === "glassHeart" ? 0.6 : 0) + (r === "beastClaw" ? 0.15 : 0),
    attackSpeedMult: base.attackSpeedMult + sum.attackSpeed + (r === "beastClaw" ? 0.1 : 0),
    reachMult: base.reachMult + sum.reach,
    moveSpeedMult: base.moveSpeedMult + sum.moveSpeed + (r === "hawkFeather" ? 0.12 : 0),
    damageTakenMult: Math.max(MIN_DAMAGE_TAKEN_MULT, takenRaw),
    lifeOnKill: base.lifeOnKill + sum.lifeOnKill,
    magnetMult: base.magnetMult + sum.magnet + (r === "hawkFeather" ? 0.5 : 0),
    xpMult: base.xpMult + sum.xp + (r === "scholarEye" ? 0.25 : 0),
    cooldownMult: Math.max(r === "brokenHourglass" ? MIN_COOLDOWN_MULT_HOURGLASS : MIN_COOLDOWN_MULT, cdRaw),
    resist: { fire: res(sum.resFire), ice: res(sum.resIce), lightning: res(sum.resLightning) },
    maxHpMult: r === "glassHeart" ? 0.75 : 1,
    vampire: r === "vampireFang" ? 0.05 : 0,
    abilityHpCost: r === "brokenHourglass" ? 4 : 0,
    noRegen: r === "vampireFang",
    legendaries,
  };
}

/** `rollTier` acotado: las piezas sueltas no pasan del tier `cap` (3 por defecto; el 4 es solo por comando o cofre especial). */
export function rollGearTier(rng: Rng, floorTime: number, floor: number, cap: WeaponTier = 3): WeaponTier {
  return Math.min(rollTier(rng, floorTime, floor), cap) as WeaponTier;
}
