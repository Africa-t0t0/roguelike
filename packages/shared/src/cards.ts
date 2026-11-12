import type { ClassId } from "./combat";
import type { Rng } from "./rng";

export type StatCardId = "vitality" | "regen" | "strength" | "fury" | "reach" | "agility" | "ironskin" | "bloodlust" | "magnet" | "learning" | "haste" | "affinity";
export type AbilityId =
  | "whirlwind" | "warcry" | "slam" | "cleave" | "thrust" | "throw" | "hook" | "banner"
  // hechizos del mago
  | "frost" | "nova" | "beam" | "mine" | "gust" | "orb" | "heal" | "meteors";

export const BASE_REGEN = 0.5;
export const CHOICE_TIME_S = 20;
export const MAX_ACTIVE_ABILITIES = 4;
/** El factor de daño recibido nunca baja de aquí. */
export const MIN_DAMAGE_TAKEN_MULT = 0.4;

// Constantes de las habilidades que no dependen del rango.
/** impacto del Torbellino, como fracción de su animación */
export const WHIRLWIND_IMPACT_AT = 0.5;
/** Torbellino de rango 3: segundos entre golpes mientras gira, metros que aparta a cada golpe y velocidad al girar */
export const WHIRL_TICK_S = 0.4;
export const WHIRL_PUSH_M = 0.4;
export const WHIRL_MOVE_MULT = 0.6;
/** segundos desde el inicio del Golpe sísmico hasta que aterriza del salto (el impacto llega ahí o, en rango 3, tras canalizar) */
export const SLAM_IMPACT_S = 0.5;
/** el Golpe sísmico salta hacia donde se apunta, como mucho estos metros */
export const SLAM_LEAP_MAX_M = 8;
/** velocidad (m/s) y vida (s) de la Onda de corte */
export const CLEAVE_SPEED = 14;
export const CLEAVE_LIFE_S = 0.5;
/** Tajo frontal: ancho (m) del corte, segundos que dura la embestida y el rastro que deja (cada cuánto daña, cuánto dura, radio de cada tramo) */
export const THRUST_WIDTH = 1.4;
export const THRUST_DASH_S = 0.3;
export const THRUST_TRAIL_S = 3;
export const THRUST_TRAIL_TICK_S = 0.5;
export const THRUST_TRAIL_RADIUS = 0.9;
/** Lanzar la espada: momento en que sale (fracción de su animación), velocidad (m/s) y radio (m) */
export const THROW_RELEASE_AT = 0.4;
export const THROW_SPEED = 20;
export const THROW_RADIUS = 0.7;
/** Marca de las espadas (rango 3): segundos que dura y su estallido (sobre el marcado y, menos, a su alrededor) */
export const BLADE_MARK_S = 5;
export const BLADE_BLAST_MULT = 3;
export const BLADE_SPLASH_MULT = 1;
export const BLADE_SPLASH_RADIUS = 2.5;
/** Gancho de cadena: impacto (fracción de su animación) y a qué distancia del jugador deja a los enemigos */
export const HOOK_IMPACT_AT = 0.4;
export const HOOK_STOP_M = 1.4;
/** Grito de guerra: alcance (m) desde quien grita */
export const WARCRY_RADIUS = 10;
/** segundos que dura el Estandarte */
export const BANNER_DURATION_S = 8;
/** el factor de enfriamiento de habilidades nunca baja de aquí */
/** Hechizos del mago que se colocan en un punto: hasta dónde (m) y a qué distancia caen si no se apunta. */
export const SPELL_AIM_MAX_M = 12;
export const SPELL_AIM_DEFAULT_M = 6;
/** Instante (s desde el inicio) en que sale cada hechizo; la Nova lo trae por rango (`chargeS`). */
export const SPELL_RELEASE_S = 0.3;
/** Rayo arcano: ancho del haz (m), metros como mucho entre rebotes y fracción del daño en cada rebote. */
export const BEAM_WIDTH = 0.8;
export const BEAM_BOUNCE_M = 6;
export const BEAM_BOUNCE_FRAC = 0.7;
/** Marca del Rayo arcano (rango 3): segundos que dura y la explosión que deja al recibir otro hechizo. */
export const MARK_S = 4;
export const MARK_BLAST_MULT = 1;
export const MARK_BLAST_RADIUS = 2;
/** Mina arcana: radio (m) con el que la pisa un enemigo y separación entre las de la línea del rango 3. */
export const MINE_TRIGGER_M = 0.9;
export const MINE_SPACING_M = 2;
/** Remolino: velocidad (m/s). */
export const GUST_SPEED = 12;
/** Esfera: velocidad (m/s), segundos entre pulsos de daño y, en el rango 3, su rastro y su atracción. */
export const SPELL_ORB_SPEED = 5;
export const ORB_PULSE_S = 0.5;
export const ORB_TRAIL_S = 3;
export const ORB_TRAIL_RADIUS = 1.2;
export const ORB_PULL_RADIUS = 5;
export const ORB_PULL_MPS = 3;
/** Meteoros: segundos entre el aviso de cada uno y su caída, radio de cada impacto y duración de la lluvia. */
export const METEOR_FALL_S = 0.7;
export const METEOR_RADIUS = 1.8;
export const METEOR_RAIN_S = 3;
export const METEOR_BIG_FALL_S = 1.4;
/** Nova con carga larga (rango 3): cuánto se mueve el mago mientras carga. */
export const NOVA_CHARGE_MOVE_MULT = 0.5;

export const MIN_COOLDOWN_MULT = 0.5;

/** Segundos que una tecla de habilidad apretada a destiempo (en mitad de un golpe o de otra habilidad) queda en espera y sale en cuanto se pueda. */
export const ABILITY_BUFFER_S = 0.6;

/** Cartas de stat que solo le sirven a un rol: al otro no le salen. El Alcance es del arma cuerpo a cuerpo. */
export const STAT_CARD_CLASS: Partial<Record<StatCardId, ClassId>> = { reach: "warrior" };

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
  learning: { name: "Aprendizaje", text: "+15% de XP por orbe que recojas" },
  haste: { name: "Celeridad", text: "-10% de enfriamiento de habilidades (máx. -50%)" },
  affinity: { name: "Afinidad", text: "+25% a los efectos de naturaleza" },
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
  /** alcance en metros (Tajo frontal, Lanzar la espada) */
  range?: number;
  /** enemigos que atrae el Gancho de cadena */
  count?: number;
  /** fracción de la vida máxima que el Estandarte cura por segundo */
  healFrac?: number;
  /** velocidad de ataque extra (Grito de guerra de rango 3) */
  speed?: number;
  /** enfriamiento y duración de la animación de este rango, si no son los de la habilidad */
  cooldownS?: number;
  animS?: number;
  /** segundos que dura lo que deja (zona de Escarcha, Mina) */
  durationS?: number;
  /** ralentización al descongelarse (Escarcha) */
  slowS?: number;
  /** carga de la Nova antes de estallar */
  chargeS?: number;
  /** Rayo arcano: deja marca; Esfera: deja rastro y atrae; Meteoros: multiplicador del meteorito final */
  mark?: boolean;
  trail?: boolean;
  bigMult?: number;
}

export interface AbilityDef {
  name: string;
  /** rol que puede aprenderla */
  cls: ClassId;
  kind: "active" | "passive";
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
    cls: "warrior",
    kind: "active",
    cooldownS: 8,
    animS: 0.9,
    clip: "gs_high_spin_attack",
    ranks: [
      { damageMult: 1.2, radius: 3 },
      { damageMult: 1.6, radius: 3, cooldownS: 7 },
      // Gira 4 s: golpea cada WHIRL_TICK_S y aparta un poco.
      { damageMult: 0.7, radius: 3.2, cooldownS: 10, animS: 4 },
    ],
    text: (r) => {
      const k = ABILITIES.whirlwind.ranks[r - 1]!;
      return r === 3
        ? `Giras durante ${secs(k.animS!)}: cada ${secs(WHIRL_TICK_S)} golpeas a todos a ${String(k.radius).replace(".", ",")} m con ${pct(k.damageMult!)} de daño y los apartas`
        : `Giras 360° y golpeas a todos a ${k.radius} m con ${pct(k.damageMult!)} de daño`;
    },
  },
  warcry: {
    name: "Grito de guerra",
    cls: "warrior",
    kind: "active",
    cooldownS: 20,
    animS: 0.8,
    clip: "ss_power_up",
    ranks: [
      { buff: 0.2, durationS: 8 },
      { buff: 0.25, durationS: 10, cooldownS: 17 },
      { buff: 0.3, durationS: 12, cooldownS: 17, speed: 0.2 },
    ],
    text: (r) => {
      const k = ABILITIES.warcry.ranks[r - 1]!;
      return `Los aliados a ${WARCRY_RADIUS} m hacen +${pct(k.buff!)} de daño` + (k.speed ? ` y atacan un ${pct(k.speed)} más rápido` : "") + ` durante ${k.durationS} s`;
    },
  },
  slam: {
    name: "Golpe sísmico",
    cls: "warrior",
    kind: "active",
    cooldownS: 10,
    animS: 0.9,
    clip: "gs_jump_attack",
    ranks: [
      { damageMult: 1.5, radius: 3.5, stunS: 1 },
      { damageMult: 1.8, radius: 3.5, stunS: 1, cooldownS: 8.5 },
      // Aterriza y canaliza: el golpe llega en `chargeS` (desde el inicio).
      { damageMult: 4, radius: 4.5, stunS: 1.5, cooldownS: 8.5, chargeS: 1.1, animS: 1.4 },
    ],
    text: (r) => {
      const k = ABILITIES.slam.ranks[r - 1]!;
      return `Saltas hasta donde apuntas (máx. ${SLAM_LEAP_MAX_M} m), invulnerable, y golpeas el suelo: ${pct(k.damageMult!)} de daño en ${String(k.radius).replace(".", ",")} m y aturde ${secs(k.stunS!)}` +
        (r === 3 ? "; canalizas un momento antes del golpe" : "");
    },
  },
  thrust: {
    name: "Tajo frontal",
    cls: "warrior",
    kind: "active",
    cooldownS: 8,
    animS: 0.45,
    clip: "gs_slide_attack",
    ranks: [
      { damageMult: 1.5, range: 10 },
      { damageMult: 1.8, range: 10, cooldownS: 7 },
      { damageMult: 1.8, range: 10, cooldownS: 7, count: 3 },
    ],
    text: (r) => {
      const k = ABILITIES.thrust.ranks[r - 1]!;
      return `Te lanzas ${k.range} m atravesando enemigos (${pct(k.damageMult!)} de daño) y dejas un rastro que daña ${THRUST_TRAIL_S} s` +
        (k.count && k.count > 1 ? `; ${k.count} cargas` : "");
    },
  },
  throw: {
    name: "Lanzar la espada",
    cls: "warrior",
    kind: "active",
    cooldownS: 6,
    animS: 0.5,
    clip: "ss_attack_4",
    ranks: [
      { damageMult: 1, range: 8, count: 1 },
      { damageMult: 1.3, range: 10, count: 1, cooldownS: 5 },
      { damageMult: 1.3, range: 10, count: 8, cooldownS: 7, mark: true },
    ],
    text: (r) => {
      const k = ABILITIES.throw.ranks[r - 1]!;
      return k.count === 1
        ? `Arrojas la espada ${k.range} m: atraviesa enemigos con ${pct(k.damageMult!)} de daño a la ida y otra vez a la vuelta`
        : `Arrojas ${k.count} espadas en todas las direcciones (${pct(k.damageMult!)} de daño); los alcanzados quedan marcados ${BLADE_MARK_S} s y tu siguiente golpe hace estallar la marca`;
    },
  },
  hook: {
    name: "Gancho de cadena",
    cls: "warrior",
    kind: "active",
    cooldownS: 14,
    animS: 0.6,
    clip: "ss_slash_3",
    ranks: [
      { damageMult: 0.3, count: 5, stunS: 1, range: 12 },
      { damageMult: 0.3, count: 10, stunS: 1, range: 12, cooldownS: 12 },
      { damageMult: 0.3, count: 999, stunS: 2, range: 20, cooldownS: 12, durationS: 2 },
    ],
    text: (r) => {
      const k = ABILITIES.hook.ranks[r - 1]!;
      return r === 3
        ? `Atrae hacia ti a todos los enemigos a ${k.range} m, los aturde ${secs(k.stunS!)} y quedas invulnerable ${secs(k.durationS!)}`
        : `Atrae hacia ti a los ${k.count} enemigos más cercanos (hasta ${k.range} m) y los aturde ${secs(k.stunS!)}`;
    },
  },
  banner: {
    name: "Estandarte",
    cls: "warrior",
    kind: "active",
    cooldownS: 22,
    animS: 0.6,
    clip: "ss_power_up",
    ranks: [
      { healFrac: 0.03, buff: 0.15, radius: 4 },
      { healFrac: 0.04, buff: 0.2, radius: 5, cooldownS: 20 },
      { healFrac: 0.05, buff: 0.5, radius: 6, cooldownS: 20, mark: true },
    ],
    text: (r) => {
      const k = ABILITIES.banner.ranks[r - 1]!;
      return `Clavas un estandarte ${BANNER_DURATION_S} s: dentro de ${k.radius} m el grupo se cura ${pct(k.healFrac!)} de su vida por segundo y hace +${pct(k.buff!)} de daño` +
        (k.mark ? "; sus ataques llevan fuego, hielo y rayo a la vez" : "");
    },
  },
  cleave: {
    name: "Onda de corte",
    cls: "warrior",
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
  frost: {
    name: "Escarcha",
    cls: "mage",
    kind: "active",
    cooldownS: 16,
    animS: 0.6,
    clip: "mg_cast_1h",
    ranks: [
      { radius: 3, stunS: 1.5, durationS: 4 },
      { radius: 4, stunS: 1.5, durationS: 4, cooldownS: 14 },
      { radius: 4.5, stunS: 1.5, durationS: 4, cooldownS: 12, slowS: 5 },
    ],
    text: (r) => {
      const k = ABILITIES.frost.ranks[r - 1]!;
      return `Zona de hielo de ${String(k.radius).replace(".", ",")} m donde apuntas, ${k.durationS} s: congela ${secs(k.stunS!)} a quien entra` +
        (k.slowS ? ` y al descongelarse queda lento ${k.slowS} s` : "");
    },
  },
  nova: {
    name: "Nova",
    cls: "mage",
    kind: "active",
    cooldownS: 10,
    animS: 0.8,
    clip: "mg_area_1",
    ranks: [
      { damageMult: 1.5, radius: 3.5, chargeS: 0.4 },
      { damageMult: 1.5, radius: 4.5, chargeS: 0.4, cooldownS: 8 },
      { damageMult: 4.5, radius: 5.5, chargeS: 1.2, cooldownS: 8, animS: 1.6 },
    ],
    text: (r) => {
      const k = ABILITIES.nova.ranks[r - 1]!;
      return `Explosión a tu alrededor: ${pct(k.damageMult!)} de daño en ${String(k.radius).replace(".", ",")} m` +
        (r === 3 ? `; tarda ${secs(k.chargeS!)} en cargar y te mueves a la mitad mientras tanto` : "");
    },
  },
  beam: {
    name: "Rayo arcano",
    cls: "mage",
    kind: "active",
    cooldownS: 7,
    animS: 0.5,
    clip: "mg_attack_2h_1",
    ranks: [
      { damageMult: 1.8, range: 14, count: 0 },
      { damageMult: 1.8, range: 14, count: 2 },
      { damageMult: 1.8, range: 14, count: 4, cooldownS: 6, mark: true },
    ],
    text: (r) => {
      const k = ABILITIES.beam.ranks[r - 1]!;
      return `Haz que golpea al primer enemigo con ${pct(k.damageMult!)} de daño` +
        (k.count ? ` y rebota a ${k.count} más` : "") +
        (k.mark ? `; los deja marcados ${MARK_S} s: si reciben otro hechizo, la marca explota` : "");
    },
  },
  mine: {
    name: "Mina arcana",
    cls: "mage",
    kind: "active",
    cooldownS: 12,
    animS: 0.5,
    clip: "mg_cast_1h",
    ranks: [
      { damageMult: 2, radius: 2.5, durationS: 60, count: 1 },
      { damageMult: 2, radius: 2.5, durationS: 90, count: 1, cooldownS: 10 },
      { damageMult: 2, radius: 2.5, durationS: 120, count: 5, cooldownS: 8 },
    ],
    text: (r) => {
      const k = ABILITIES.mine.ranks[r - 1]!;
      return `${k.count === 1 ? "Dejas una mina" : `Dejas una línea de ${k.count} minas`} donde apuntas, ${k.durationS} s: ` +
        `al pisarla un enemigo explota con ${pct(k.damageMult!)} de daño en ${String(k.radius).replace(".", ",")} m`;
    },
  },
  gust: {
    name: "Remolino",
    cls: "mage",
    kind: "active",
    cooldownS: 11,
    animS: 0.5,
    clip: "mg_attack_2h_2",
    ranks: [
      { damageMult: 0.8, radius: 1.2, range: 12, knockback: 4, count: 1 },
      { damageMult: 0.8, radius: 1.8, range: 12, knockback: 4, count: 1, cooldownS: 9 },
      { damageMult: 0.8, radius: 1.8, range: 12, knockback: 4, count: 8, cooldownS: 8 },
    ],
    text: (r) => {
      const k = ABILITIES.gust.ranks[r - 1]!;
      return `${k.count === 1 ? "Un remolino avanza en línea recta" : `${k.count} remolinos salen en todas las direcciones`}: ` +
        `${pct(k.damageMult!)} de daño y empuja ${k.knockback} m (radio ${String(k.radius).replace(".", ",")} m)`;
    },
  },
  orb: {
    name: "Esfera",
    cls: "mage",
    kind: "active",
    cooldownS: 14,
    animS: 0.6,
    clip: "mg_attack_2h_3",
    ranks: [
      { damageMult: 0.5, radius: 2.5, range: 14, count: 1 },
      { damageMult: 0.7, radius: 2.5, range: 14, count: 1 },
      { damageMult: 0.7, radius: 2.5, range: 14, count: 8, cooldownS: 12, trail: true },
    ],
    text: (r) => {
      const k = ABILITIES.orb.ranks[r - 1]!;
      return `${k.count === 1 ? "Esfera lenta que no explota" : `${k.count} esferas lentas en todas las direcciones`}: cada ${secs(ORB_PULSE_S)} ` +
        `${k.count === 1 ? "hace" : "hacen"} ${pct(k.damageMult!)} de daño a quien esté a ${String(k.radius).replace(".", ",")} m` +
        (k.trail ? "; dejan un rastro que daña y atraen a los enemigos" : "");
    },
  },
  heal: {
    name: "Sanación",
    cls: "mage",
    kind: "active",
    cooldownS: 20,
    animS: 0.6,
    clip: "mg_cast_2h",
    ranks: [{ healFrac: 0.3 }, { healFrac: 0.5, cooldownS: 19 }, { healFrac: 1, cooldownS: 17 }],
    text: (r) => {
      const k = ABILITIES.heal.ranks[r - 1]!;
      return k.healFrac! >= 1 ? "Cura toda la vida a todo el grupo" : `Cura el ${pct(k.healFrac!)} de la vida a todo el grupo`;
    },
  },
  meteors: {
    name: "Meteoros",
    cls: "mage",
    kind: "active",
    cooldownS: 22,
    animS: 0.8,
    clip: "mg_area_2",
    ranks: [
      { damageMult: 1.2, radius: 4, count: 5 },
      { damageMult: 1.2, radius: 5, count: 8, cooldownS: 20 },
      { damageMult: 1.2, radius: 5, count: 8, cooldownS: 18, bigMult: 5 },
    ],
    text: (r) => {
      const k = ABILITIES.meteors.ranks[r - 1]!;
      return `Caen ${k.count} meteoritos en una zona de ${k.radius} m donde apuntas (${pct(k.damageMult!)} de daño cada uno)` +
        (k.bigMult ? `; al final cae uno gigante con ${pct(k.bigMult)} en toda la zona` : "");
    },
  },
};

const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];

/** Enfriamiento base (s) de la habilidad en ese rango. */
export function abilityCooldownS(id: AbilityId, rank: number): number {
  return ABILITIES[id].ranks[rank - 1]?.cooldownS ?? ABILITIES[id].cooldownS;
}

/** Duración (s) de la animación de la habilidad en ese rango. */
export function abilityAnimS(id: AbilityId, rank: number): number {
  return ABILITIES[id].ranks[rank - 1]?.animS ?? ABILITIES[id].animS;
}

/** Segundos desde el inicio del Golpe sísmico hasta su golpe: al aterrizar o, si canaliza (rango 3), después. */
export function slamImpactS(rank: number): number {
  return ABILITIES.slam.ranks[rank - 1]?.chargeS ?? SLAM_IMPACT_S;
}

/** Metros a los que cae un hechizo apuntado: lo que marque la puntería, con tope; sin puntería, a media distancia. */
export function spellAimDist(aimDist: number | undefined): number {
  return aimDist === undefined ? SPELL_AIM_DEFAULT_M : Math.min(SPELL_AIM_MAX_M, Math.max(0, aimDist));
}
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

/** Casillas ocupadas: las activas; la pasiva no cuenta. */
export function activeAbilityCount(p: Progress): number {
  return p.abilities.filter((a) => ABILITIES[a.id].kind !== "passive").length;
}

/**
 * Sortea 3 cartas: 1 de habilidad (si hay alguna posible) y el resto de stat, distintas entre sí.
 * La Afinidad solo entra en la bolsa si el arma equipada tiene naturaleza (`opts.natureWeapon`).
 * Las habilidades son las del rol (`opts.cls`; sin él, el caballero).
 */
export function rollOffer(rng: Rng, p: Progress, opts: { natureWeapon?: boolean; cls?: ClassId } = {}): CardOffer[] {
  const full = activeAbilityCount(p) >= MAX_ACTIVE_ABILITIES;
  const cls = opts.cls ?? "warrior";
  const options: CardOffer[] = [];
  for (const id of ABILITY_IDS) {
    if (ABILITIES[id].cls !== cls) continue;
    const owned = p.abilities.find((a) => a.id === id);
    if (owned) {
      if (owned.rank < 3) options.push({ kind: "ability", id, rank: (owned.rank + 1) as 2 | 3 });
    } else if (ABILITIES[id].kind === "passive" || !full) {
      options.push({ kind: "ability", id, rank: 1 });
    }
  }
  const offer: CardOffer[] = [];
  if (options.length > 0) offer.push(rng.pick(options));
  const pool = STAT_IDS.filter(
    (id) => (id !== "affinity" || opts.natureWeapon) && (STAT_CARD_CLASS[id] === undefined || STAT_CARD_CLASS[id] === cls),
  );
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
  xpMult: number;
  cooldownMult: number;
  /** cartas de Afinidad; multiplica los efectos de naturaleza en `natureEffects` */
  affinity: number;
  /** resistencia elemental (0..0,6); las cartas no dan: `combinedMods` suma equipo y reliquia */
  resist: { fire: number; ice: number; lightning: number };
  /** multiplicador final de la vida máxima (1; el Corazón de cristal lo baja a 0,75); lo aplica quien calcula la vida */
  maxHpMult: number;
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
    xpMult: 1 + 0.15 * n("learning"),
    cooldownMult: Math.max(MIN_COOLDOWN_MULT, 0.9 ** n("haste")),
    affinity: n("affinity"),
    resist: { fire: 0, ice: 0, lightning: 0 },
    maxHpMult: 1,
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
