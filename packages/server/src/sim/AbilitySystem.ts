import {
  ABILITIES,
  ABILITY_BUFFER_S,
  BEAM_BOUNCE_FRAC,
  BLADE_BLAST_MULT,
  BLADE_MARK_S,
  BLADE_SPLASH_MULT,
  BLADE_SPLASH_RADIUS,
  THRUST_DASH_S,
  THRUST_TRAIL_RADIUS,
  THRUST_TRAIL_S,
  THRUST_TRAIL_TICK_S,
  WARCRY_RADIUS,
  WHIRL_PUSH_M,
  WHIRL_TICK_S,
  slamImpactS,
  MAGE_LEGENDARY,
  BEAM_BOUNCE_M,
  BEAM_WIDTH,
  GUST_SPEED,
  MARK_BLAST_MULT,
  MARK_BLAST_RADIUS,
  MARK_S,
  METEOR_BIG_FALL_S,
  METEOR_FALL_S,
  METEOR_RADIUS,
  METEOR_RAIN_S,
  MINE_SPACING_M,
  MINE_TRIGGER_M,
  ORB_PULL_MPS,
  ORB_PULL_RADIUS,
  ORB_PULSE_S,
  ORB_TRAIL_RADIUS,
  ORB_TRAIL_S,
  SPELL_ORB_SPEED,
  SPELL_RELEASE_S,
  abilityAnimS,
  abilityCooldownS,
  spellAimDist,
  strikeOf,
  type AbilityRank,
  type CombatEvent,
  BANNER_DURATION_S,
  CLEAVE_LIFE_S,
  CLEAVE_SPEED,
  ENEMY_DEFS,
  HOOK_IMPACT_AT,
  HOOK_STOP_M,
  PLAYER_RADIUS,
  MAX_ACTIVE_ABILITIES,
  MOVESETS,
  SIM_DT,
  SLAM_IMPACT_S,
  SLAM_LEAP_MAX_M,
  THROW_RADIUS,
  THROW_RELEASE_AT,
  THROW_SPEED,
  THRUST_WIDTH,
  TILE_SIZE,
  WEAPONS,
  WHIRLWIND_IMPACT_AT,
  circlesOverlap,
  hasLineOfSight,
  inArc,
  isWalkableTile,
  leapSpeed,
  leapStep,
  moveCircle,
  strikeDamage,
  type AbilityId,
  type Dungeon,
  type KinematicState,
  type Nature,
  type PlayerInput,
} from "@roguelike/shared";
import { abilityRank, damageMultOf, rewindTick, strikeSource, type AbilityAnim, type CombatState, type CombatSystem, type ImpactResult } from "./CombatSystem";
import type { EnemySystem } from "./EnemySystem";
import type { PositionHistory } from "./PositionHistory";

export interface AbilityResult {
  /** habilidad activa que empezó en este input */
  started?: AbilityId;
  /**
   * Embestida del Tajo frontal, salto del Golpe sísmico o retroceso del Remolino (`gustDash`): dónde queda el jugador
   * tras avanzar contra los muros. AbilitySystem no posee la cinemática (vive en el PlayerRecord): RunRoom la aplica
   * a `record.kinematic` (x, z) tras cada input.
   */
  dash?: { x: number; z: number };
  /** Golpe sísmico que empezó en este input: metros que va a saltar (para que los demás clientes dibujen dónde cae) */
  leapDist?: number;
  /** hechizo apuntado que empezó en este input: a cuántos metros cae */
  aimDist?: number;
  /** rango con el que empezó */
  rank?: number;
  hits: ImpactResult["hits"];
  kills: ImpactResult["kills"];
}

/**
 * Proyectil de un jugador. La Onda de corte (`wave`) atraviesa enemigos, golpea a cada uno una sola vez y muere
 * contra un muro. La espada lanzada (`sword`) hace lo mismo a la ida y, al acabar su alcance o tocar un muro,
 * vuelve hacia su dueño golpeando otra vez a cada uno.
 */
export interface PlayerShot {
  id: string;
  /**
   * Además de la onda y la espada: el proyectil del bastón (`bolt`, se acaba en el primer enemigo), el Remolino
   * (`gust`, atraviesa y empuja) y la Esfera (`orb`, no golpea al tocar: pulsa daño a su alrededor).
   */
  kind: "wave" | "sword" | "bolt" | "gust" | "orb";
  /** hechizo: detona las marcas del Rayo arcano */
  spell?: boolean;
  /** espada de Lanzar la espada de rango 3: marca a quien toca (y no hace estallar marcas) */
  mark?: boolean;
  /** metros que empuja en su dirección a cada golpeado (Remolino) */
  knockback?: number;
  /** Esfera: segundos para el próximo pulso; con `trail`, deja rastro y atrae */
  pulseLeft?: number;
  trail?: boolean;
  /** la espada ya viene de vuelta */
  returning?: boolean;
  ownerKey: string;
  owner: CombatState;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  radius: number;
  /** naturaleza del arma del dueño al lanzarla (el cliente la dibuja de ese color) */
  nature: Nature;
  damage: number;
  life: number;
  hit: Set<string>;
}

/** Golpes de las ondas de un jugador en un tick (el llamador crea los orbes de `kills`). */
export interface ShotResult {
  key: string;
  hits: ImpactResult["hits"];
  kills: ImpactResult["kills"];
}

/**
 * Zona de un jugador mientras dura: las grietas del Golpe sísmico (`cracks`) ralentizan a los enemigos dentro;
 * el Estandarte (`banner`) cura al grupo dentro `heal` de su vida máxima por segundo.
 */
export interface PlayerZone {
  id: string;
  /**
   * Además de las grietas y el Estandarte, las del mago: `frost` congela a quien entra, `mine` estalla al pisarla,
   * `meteors` es la lluvia (va soltando `meteor`, cada uno estalla al acabársele el tiempo, y al final un
   * `meteorBig`) y `trail` es el rastro de la Esfera, que daña a pulsos. Con legendarias: `fire` es el fuego que
   * deja un meteorito (daña a pulsos) e `ice`, el rastro de hielo de quien esprinta (ralentiza). `scar` es el rastro
   * del Tajo frontal: daña a pulsos, como el de la Esfera.
   */
  kind: "cracks" | "banner" | "frost" | "mine" | "meteors" | "meteor" | "meteorBig" | "trail" | "fire" | "ice" | "scar";
  heal?: number;
  /** Estandarte: daño extra para el grupo dentro, si sus ataques llevan las tres naturalezas y si protege (`bannerGuard`) */
  buff?: number;
  allNatures?: boolean;
  guard?: boolean;
  /** naturaleza del bastón de quien la puso al lanzarla (el cliente la dibuja de ese color); sin ella, "none" */
  nature?: Nature;
  /** quién la puso (las del mago hacen daño a su nombre) */
  ownerKey?: string;
  owner?: CombatState;
  /** daño de cada estallido o pulso, fijado al lanzarla */
  damage?: number;
  /** radio del estallido de la mina */
  blast?: number;
  /** Escarcha: segundos congelado, segundos lento al descongelarse y a quiénes ya congeló */
  freezeS?: number;
  slowS?: number;
  hit?: Set<string>;
  /** Meteoros: cuántos faltan, cada cuánto caen, segundos para el próximo y daño del gigante final (0: no hay) */
  pending?: number;
  every?: number;
  next?: number;
  bigDamage?: number;
  x: number;
  z: number;
  radius: number;
  left: number;
  total: number;
}

const EPS = 1e-9;
/** Grietas del Golpe sísmico (`slamCracks`): duración (s) y ralentización de los enemigos dentro. */
const CRACKS_S = 3;
const CRACKS_SLOW = 0.4;
const WARCRY_LONG_MULT = 1.5;
const WARCRY_HEAL_FRAC = 0.15;
/** Torbellino con `whirlCharges`: cargas máximas. */
const WHIRL_CHARGES = 2;
const FULL_CIRCLE_DEG = 360;
/** La espada lanzada: segundos que como mucho tarda en volver y a qué distancia de su dueño se da por recogida. */
const THROW_RETURN_MAX_S = 3;
const THROW_CATCH_M = 0.9;
/** Ralentización de la Escarcha (a quien no se puede congelar y, en el rango 3, al descongelarse). */
const FROST_SLOW = 0.4;
/** Ángulo áureo: reparte los meteoritos por la zona sin que caigan dos seguidos en el mismo sitio. */
const GOLDEN_ANGLE = 2.399963;
/** La Esfera no arrastra a quien ya tiene encima. */
const ORB_PULL_MIN_M = 0.8;
/** Cada cuánto (s) deja la Esfera un tramo de rastro. */
const ORB_TRAIL_EVERY_S = 0.4;

/** Resta `dt` y deja en 0 lo que quede por debajo de EPS (como el combo). */
const countDown = (v: number, dt: number): number => (v - dt > EPS ? v - dt : 0);

/**
 * ¿El círculo toca el rectángulo que sale de `origin` hacia `facing`, de largo `length` y ancho `width`?
 * Se mide la distancia del centro al punto más cercano del rectángulo, en ejes (adelante, costado).
 */
export function inLine(
  origin: { x: number; z: number; facing: number },
  target: { x: number; z: number; radius: number },
  length: number,
  width: number,
): boolean {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const sin = Math.sin(origin.facing);
  const cos = Math.cos(origin.facing);
  const along = dx * sin + dz * cos;
  const side = dx * cos - dz * sin;
  const ca = Math.min(Math.max(along, 0), length);
  const cs = Math.min(Math.max(side, -width / 2), width / 2);
  return (along - ca) ** 2 + (side - cs) ** 2 <= target.radius ** 2;
}

/** Casillas de habilidad (activas y mantenidas) en orden de aprendizaje: la tecla i+1 usa la i-ésima. */
export function abilitySlots(c: CombatState): { id: AbilityId; rank: number }[] {
  return c.abilities.filter((a) => ABILITIES[a.id].kind !== "passive").slice(0, MAX_ACTIVE_ABILITIES);
}

/**
 * Cargas máximas de la habilidad: las del rango (el Tajo frontal de rango 3 tiene 3), 2 el Torbellino con
 * `whirlCharges`, la espada con `throwCharges` y la Mina con `mineCharges`; 1 las demás.
 */
export function abilityMaxCharges(c: CombatState, id: AbilityId): number {
  if (id === "thrust") return Math.max(1, ABILITIES.thrust.ranks[abilityRank(c, id) - 1]?.count ?? 1);
  if (id === "throw" && c.fx.legendaries.includes("throwCharges")) return 2;
  if (id === "mine" && c.fx.legendaries.includes("mineCharges")) return MAGE_LEGENDARY.mineCharges;
  return id === "whirlwind" && c.fx.legendaries.includes("whirlCharges") ? WHIRL_CHARGES : 1;
}

/** Cargas que tiene ahora: todas si su enfriamiento no corre; si corre, las guardadas. */
export function abilityCharges(c: CombatState, id: AbilityId): number {
  const max = abilityMaxCharges(c, id);
  return (c.abilityCd[id] ?? 0) > 0 ? Math.min(max, c.abilityCharges[id] ?? 0) : max;
}

/** Segundos desde el inicio hasta cada impacto de esa habilidad, según su rango. */
function impactTimes(id: AbilityId, rank: number): number[] {
  const def = ABILITIES[id];
  switch (id) {
    case "whirlwind": {
      // Rango 3: gira toda la animación golpeando cada WHIRL_TICK_S.
      if (rank >= 3) {
        const out: number[] = [];
        for (let t = WHIRL_TICK_S / 2; t < abilityAnimS(id, rank) - 1e-6; t += WHIRL_TICK_S) out.push(t);
        return out;
      }
      return [WHIRLWIND_IMPACT_AT * def.animS];
    }
    case "slam":
      return [slamImpactS(rank)];
    case "thrust":
      return [THRUST_DASH_S];
    case "throw":
      return [THROW_RELEASE_AT * def.animS];
    case "hook":
      return [HOOK_IMPACT_AT * def.animS];
    case "nova":
      return [def.ranks[rank - 1]!.chargeS!];
    case "frost":
    case "beam":
    case "mine":
    case "gust":
    case "orb":
    case "meteors":
      return [SPELL_RELEASE_S];
    default:
      return [];
  }
}

/**
 * Habilidades del caballero y hechizos del mago. La animación y sus impactos avanzan por input procesado (como el combo);
 * los enfriamientos, el Grito y las ondas, por tick simulado en `step` (así se congelan en la pausa).
 */
export class AbilitySystem {
  private shots: PlayerShot[] = [];
  private nextShot = 1;
  private zoneList: PlayerZone[] = [];
  private nextZone = 1;
  /** eventos para los clientes (haz del Rayo, estallidos) desde la última `takeEvents` */
  private events: CombatEvent[] = [];
  /** segundos hasta el próximo tramo del rastro de hielo (`frostTrail`), por jugador */
  private readonly trailCd = new WeakMap<CombatState, number>();

  constructor(
    private readonly dungeon: Dungeon,
    private readonly combat: CombatSystem,
  ) {
    // Los golpes del combo también hacen estallar la marca de las espadas.
    combat.bladeBlast = (c, key, at, enemies, sink) => this.bladeBlast(c, key, at, enemies, sink);
  }

  get playerShots(): readonly PlayerShot[] {
    return this.shots;
  }

  /** Eventos de los hechizos (haz, estallidos) desde la última llamada. */
  takeEvents(): CombatEvent[] {
    return this.events.splice(0);
  }

  /** Zonas del jugador activas (grietas del Golpe sísmico). */
  get playerZones(): readonly PlayerZone[] {
    return this.zoneList;
  }

  /**
   * Llamar por input procesado, después de `CombatSystem.onInputProcessed` y antes del ataque.
   * 1. Avanza la animación en curso y resuelve sus impactos vencidos (rebobinando al `viewTick`).
   * 2. Con un flanco de subida de la tecla i+1 empieza la i-ésima habilidad activa, si no está en
   *    enfriamiento ni hay un swing u otra animación en curso.
   */
  onInput(
    c: CombatState,
    k: KinematicState,
    input: PlayerInput,
    nowTick: number,
    enemies: EnemySystem,
    history: PositionHistory,
    party: CombatState[],
    key = "",
    partyAt: ReadonlyMap<CombatState, { x: number; z: number }> = new Map(),
  ): AbilityResult {
    const res: AbilityResult = { hits: [], kills: [] };
    const pressed = input.abilities & ~c.heldMask;
    c.heldMask = input.abilities;
    if (c.dead) {
      c.abilityAnim = null;
      c.queuedMask = 0;
      return res;
    }
    // Una tecla apretada en mitad de un golpe o de otra habilidad no se pierde: queda en espera un momento y
    // sale en cuanto se pueda. La última apretada manda.
    c.queuedLeft = countDown(c.queuedLeft, SIM_DT);
    if (c.queuedLeft === 0) c.queuedMask = 0;
    if (pressed !== 0) {
      c.queuedMask = pressed;
      c.queuedLeft = ABILITY_BUFFER_S;
    }

    const anim = c.abilityAnim;
    if (anim) {
      // Salto del Golpe sísmico y embestida del Tajo frontal: avanzan un paso por input mientras duran; el
      // impacto se resuelve ya donde cayó.
      if ((anim.leapLeft ?? 0) > 0 && (anim.leapSpeed ?? 0) > 0) {
        res.dash = leapStep(this.dungeon, k.x, k.z, anim.facing, anim.leapSpeed!);
        k = { ...k, x: res.dash.x, z: res.dash.z };
        anim.leapLeft = countDown(anim.leapLeft!, SIM_DT);
      }
      anim.left = countDown(anim.left, SIM_DT);
      const keep: number[] = [];
      for (const t of anim.impacts) {
        const left = countDown(t, SIM_DT);
        if (left > 0) keep.push(left);
        else this.resolveImpact(c, k, anim, input, nowTick, enemies, history, res, key);
      }
      anim.impacts = keep;
      if (anim.left === 0 && keep.length === 0) c.abilityAnim = null;
    }

    const slots = abilitySlots(c);
    for (let i = 0; i < slots.length; i++) {
      if ((c.queuedMask & (1 << i)) === 0) continue;
      const { id, rank } = slots[i]!;
      const def = ABILITIES[id];
      // Sin cargas o aturdido no espera: se descarta. Con un golpe u otra habilidad en curso, sigue en la cola.
      if (def.kind !== "active" || abilityCharges(c, id) < 1 || c.stunLeft > 0) {
        c.queuedMask &= ~(1 << i);
        continue;
      }
      if (c.swingTimer > 0 || c.abilityAnim) continue;
      c.queuedMask = 0;
      // Celeridad: el enfriamiento se fija al lanzarla. Gasta 1 carga; si el enfriamiento no corría, empieza a recargar.
      if ((c.abilityCd[id] ?? 0) > 0) c.abilityCharges[id] = abilityCharges(c, id) - 1;
      else {
        c.abilityCharges[id] = abilityMaxCharges(c, id) - 1;
        c.abilityCd[id] = abilityCooldownS(id, rank) * c.mods.cooldownMult;
      }
      // Reloj de arena roto: cada habilidad cuesta vida, sin bajar de 1 (ni curar a quien ya tiene menos).
      if (c.fx.abilityHpCost > 0) c.hp = Math.min(c.hp, Math.max(1, c.hp - c.fx.abilityHpCost));
      c.abilityAnim = {
        id, rank, left: abilityAnimS(id, rank), impacts: impactTimes(id, rank), facing: input.facing, originX: k.x, originZ: k.z,
      };
      const r = def.ranks[rank - 1]!;
      res.rank = rank;
      if (def.cls === "mage") {
        const aim = this.aimPoint(k, input.facing, input.aimDist);
        c.abilityAnim.aimX = aim.x;
        c.abilityAnim.aimZ = aim.z;
        res.aimDist = Math.hypot(aim.x - k.x, aim.z - k.z);
      }
      if (id === "heal") {
        for (const p of new Set([c, ...party])) {
          if (p.dead) continue;
          this.combat.heal(p, p.maxHp * r.healFrac!);
          if (c.fx.legendaries.includes("healShield")) {
            p.shield = Math.max(p.shield, p.maxHp * MAGE_LEGENDARY.healShieldFrac);
            p.shieldLeft = MAGE_LEGENDARY.healShieldS;
          }
        }
      }
      if (id === "slam") {
        c.abilityAnim.leapSpeed = leapSpeed(input.aimDist);
        c.abilityAnim.leapLeft = SLAM_IMPACT_S;
        res.leapDist = Math.min(SLAM_LEAP_MAX_M, Math.max(0, input.aimDist ?? 0));
        // Invulnerable toda la animación (también lo que canaliza en rango 3).
        c.invulnFor = Math.max(c.invulnFor, abilityAnimS(id, rank));
      }
      if (id === "thrust") {
        c.abilityAnim.leapSpeed = r.range! / THRUST_DASH_S;
        c.abilityAnim.leapLeft = THRUST_DASH_S;
      }
      if (id === "warcry") this.warcry(c, k, party, partyAt, r);
      if (id === "banner") {
        this.zoneList.push({
          id: `z${this.nextZone++}`, kind: "banner", heal: r.healFrac!, buff: r.buff!, allNatures: r.mark === true,
          guard: c.fx.legendaries.includes("bannerGuard"), x: k.x, z: k.z, radius: r.radius!, left: BANNER_DURATION_S, total: BANNER_DURATION_S,
        });
      }
      res.started = id;
      break;
    }

    // `frostTrail`: esprintando deja tramos de hielo que ralentizan a los enemigos.
    if (c.fx.legendaries.includes("frostTrail")) {
      const left = (this.trailCd.get(c) ?? 0) - SIM_DT;
      if (left > EPS) this.trailCd.set(c, left);
      else if (input.sprint && (input.moveX !== 0 || input.moveZ !== 0)) {
        this.trailCd.set(c, MAGE_LEGENDARY.frostTrailEveryS);
        this.zoneList.push({
          id: `z${this.nextZone++}`, kind: "ice", x: k.x, z: k.z, radius: MAGE_LEGENDARY.frostTrailRadius,
          left: MAGE_LEGENDARY.frostTrailS, total: MAGE_LEGENDARY.frostTrailS,
        });
      }
    }

    return res;
  }

  /** Al resolver el impacto de un golpe del combo: si fue el último y tiene la pasiva, lanza la onda. */
  onComboImpact(c: CombatState, k: KinematicState, step: number, ownerKey: string): void {
    const rank = abilityRank(c, "cleave");
    if (rank === 0 || c.dead) return;
    if (step !== MOVESETS[WEAPONS[c.weaponId].movesetId].combo.length) return;
    const r = ABILITIES.cleave.ranks[rank - 1]!;
    this.shots.push({
      id: `w${this.nextShot++}`,
      kind: "wave",
      ownerKey,
      owner: c,
      x: k.x,
      z: k.z,
      dirX: Math.sin(c.swingFacing),
      dirZ: Math.cos(c.swingFacing),
      speed: CLEAVE_SPEED,
      radius: r.radius!,
      nature: c.weaponNature,
      damage: this.abilityDamage(c, r.damageMult!),
      life: CLEAVE_LIFE_S,
      hit: new Set(),
    });
  }

  /**
   * Una vez por tick (solo fuera de la pausa): enfriamientos y cargas, Grito, Frenesí, zonas y proyectiles.
   * `positions`: dónde está cada jugador (por clave), para el Estandarte y la vuelta de la espada.
   */
  step(
    states: ReadonlyMap<string, CombatState>,
    enemies: EnemySystem,
    dt: number,
    positions: ReadonlyMap<string, { x: number; z: number }> = new Map(),
  ): ShotResult[] {
    for (const c of states.values()) {
      for (const id of Object.keys(c.abilityCd) as AbilityId[]) {
        const before = c.abilityCd[id]!;
        c.abilityCd[id] = countDown(before, dt);
        if (before <= 0 || c.abilityCd[id]! > 0) continue;
        // Terminó un ciclo: vuelve 1 carga y, si faltan más, empieza otro ciclo.
        const charges = Math.min(abilityMaxCharges(c, id), (c.abilityCharges[id] ?? 0) + 1);
        c.abilityCharges[id] = charges;
        if (charges < abilityMaxCharges(c, id)) c.abilityCd[id] = abilityCooldownS(id, abilityRank(c, id)) * c.mods.cooldownMult;
      }
      if (c.buffLeft > 0) {
        c.buffLeft = countDown(c.buffLeft, dt);
        if (c.buffLeft === 0) {
          c.buffDamage = 0;
          c.buffSpeed = 0;
          c.buffGuard = false;
        }
      }
      c.bannerLeft = countDown(c.bannerLeft, dt);
    }
    const out = new Map<string, ShotResult>();
    this.stepZones(enemies, dt, states, positions, out);
    this.stepShots(enemies, dt, positions, out);
    return [...out.values()];
  }

  /** Dónde se anotan los golpes de `ownerKey` en este tick. */
  private sink(out: Map<string, ShotResult>, ownerKey: string): ShotResult {
    let r = out.get(ownerKey);
    if (!r) {
      r = { key: ownerKey, hits: [], kills: [] };
      out.set(ownerKey, r);
    }
    return r;
  }

  /**
   * Golpe de un hechizo o proyectil de `owner` a `e`: daño con la naturaleza de su arma (un bastón de fuego hace
   * que sus hechizos quemen; uno de hielo, que ralenticen y congelen; uno de rayo, que encadenen), Sed de sangre
   * y vampiro. Si es un hechizo (`spell`) y el enemigo llevaba la marca del Rayo arcano, la consume y
   * estalla alrededor. Devuelve si el golpeado murió.
   */
  private hitEnemy(
    owner: CombatState,
    ownerKey: string,
    e: { id: string; x: number; z: number },
    amount: number,
    enemies: EnemySystem,
    sink: Pick<ImpactResult, "hits" | "kills">,
    opts: { spell?: boolean; noBlade?: boolean } = {},
  ): boolean {
    const marked = opts.spell === true && enemies.takeMark(e.id);
    // Cualquier golpe de un caballero hace estallar la marca de las espadas, salvo las propias espadas que la ponen.
    const blade = owner.cls === "warrior" && opts.noBlade !== true && enemies.takeBladeMark(e.id);
    const src = strikeSource(owner, ownerKey);
    const at = { x: e.x, z: e.z };
    const results = enemies.strike(e.id, amount, src);
    results.forEach((d, i) => {
      sink.hits.push({ enemyId: d.enemyId, amount: d.amount, killed: d.killed, x: i === 0 ? at.x : d.x, z: i === 0 ? at.z : d.z });
      if (d.killed) {
        sink.kills.push({ x: d.x, z: d.z, xp: d.xp, drop: d.drop, gear: d.gear, relic: d.relic });
        this.combat.heal(owner, owner.mods.lifeOnKill);
      }
      this.combat.vampireHeal(owner, d.amount);
    });
    if (marked) {
      this.events.push({ type: "blast", kind: "mark", x: at.x, z: at.z, radius: MARK_BLAST_RADIUS, nature: owner.weaponNature });
      // El estallido de la marca no detona otras marcas.
      this.blast(owner, ownerKey, at.x, at.z, MARK_BLAST_RADIUS, this.abilityDamage(owner, MARK_BLAST_MULT), enemies, sink, false);
    }
    if (blade) this.bladeBlast(owner, ownerKey, { ...at, id: e.id }, enemies, sink);
    return results[0]!.killed;
  }

  /**
   * Estalla la marca de las espadas sobre el enemigo `at.id`: daño masivo a él (aunque el golpe que la hizo saltar
   * ya lo haya matado, no se repite) y menos a los de alrededor. Los golpes del estallido no hacen saltar otras marcas.
   */
  private bladeBlast(
    owner: CombatState,
    ownerKey: string,
    at: { x: number; z: number; id: string },
    enemies: EnemySystem,
    sink: Pick<ImpactResult, "hits" | "kills">,
  ): void {
    this.events.push({ type: "blast", kind: "blade", x: at.x, z: at.z, radius: BLADE_SPLASH_RADIUS, nature: owner.weaponNature });
    const target = enemies.enemies.find((x) => x.id === at.id && x.ai !== "dead" && x.hp > 0);
    if (target) this.hitEnemy(owner, ownerKey, target, this.abilityDamage(owner, BLADE_BLAST_MULT), enemies, sink, { noBlade: true });
    for (const e of [...enemies.enemies]) {
      if (e.id === at.id || e.ai === "dead" || e.hp <= 0) continue;
      if (!circlesOverlap({ x: at.x, z: at.z, radius: BLADE_SPLASH_RADIUS }, { x: e.x, z: e.z, radius: ENEMY_DEFS[e.kind].radius })) continue;
      this.hitEnemy(owner, ownerKey, e, this.abilityDamage(owner, BLADE_SPLASH_MULT), enemies, sink, { noBlade: true });
    }
  }

  /** Daño de hechizo a todos los enemigos vivos que toquen el círculo; devuelve a cuáles alcanzó. */
  private blast(
    owner: CombatState,
    ownerKey: string,
    x: number,
    z: number,
    radius: number,
    amount: number,
    enemies: EnemySystem,
    sink: Pick<ImpactResult, "hits" | "kills">,
    spell = true,
  ): string[] {
    const reached: string[] = [];
    for (const e of [...enemies.enemies]) {
      if (e.ai === "dead" || e.hp <= 0) continue;
      if (!circlesOverlap({ x, z, radius }, { x: e.x, z: e.z, radius: ENEMY_DEFS[e.kind].radius })) continue;
      reached.push(e.id);
      this.hitEnemy(owner, ownerKey, e, amount, enemies, sink, { spell });
    }
    return reached;
  }

  /**
   * Punto donde cae un hechizo apuntado: a `aimDist` metros (con tope) hacia `facing`; si ahí hay muro, se acerca
   * al mago de medio metro en medio metro hasta un punto caminable.
   */
  private aimPoint(k: { x: number; z: number }, facing: number, aimDist: number | undefined): { x: number; z: number } {
    for (let d = spellAimDist(aimDist); d > 0; d -= 0.5) {
      const x = k.x + Math.sin(facing) * d;
      const z = k.z + Math.cos(facing) * d;
      if (isWalkableTile(this.dungeon, Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE))) return { x, z };
    }
    return { x: k.x, z: k.z };
  }

  /**
   * Proyectil del bastón: sale en el impacto del golpe `step` del combo, hacia `facing`: a donde se apunta en ese
   * momento (no al empezar el golpe), para poder corregir el tiro moviendo el cursor.
   * Lleva la naturaleza del bastón y el Alcance alarga su recorrido.
   */
  staffShot(c: CombatState, k: KinematicState, step: number, ownerKey: string, facing: number = c.swingFacing): void {
    const ranged = MOVESETS[WEAPONS[c.weaponId].movesetId].ranged;
    if (!ranged || c.dead) return;
    const strike = strikeOf(c.weaponId, step);
    const damage = Math.round(
      strikeDamage(c.weaponId, c.cls, this.combat.level, step, c.weaponTier) * c.mods.damageMult * (1 + c.buffDamage),
    );
    // `tripleShot`: el último golpe del combo sale en abanico de tres.
    const fan = step === MOVESETS[WEAPONS[c.weaponId].movesetId].combo.length && c.fx.legendaries.includes("tripleShot");
    for (const off of fan ? [-MAGE_LEGENDARY.tripleShotSpreadRad, 0, MAGE_LEGENDARY.tripleShotSpreadRad] : [0]) {
      this.shots.push({
        id: `w${this.nextShot++}`,
        kind: "bolt",
        ownerKey,
        owner: c,
        x: k.x,
        z: k.z,
        dirX: Math.sin(facing + off),
        dirZ: Math.cos(facing + off),
        speed: ranged.speed,
        radius: ranged.radius,
        nature: c.weaponNature,
        damage,
        life: (strike.range * c.mods.reachMult) / ranged.speed,
        hit: new Set(),
      });
    }
  }

  /**
   * Las grietas ralentizan cada tick a los enemigos dentro (la ralentización se renueva); el Estandarte cura
   * cada tick a los jugadores vivos dentro. Las del mago: la Escarcha congela una vez a cada enemigo que entra,
   * la mina estalla cuando un enemigo la pisa, la lluvia de meteoros va soltando meteoritos (cada uno estalla al
   * caer) y el rastro de la Esfera daña a pulsos. Cada zona se acaba cuando se le termina el tiempo.
   */
  private stepZones(
    enemies: EnemySystem,
    dt: number,
    states: ReadonlyMap<string, CombatState>,
    positions: ReadonlyMap<string, { x: number; z: number }>,
    out: Map<string, ShotResult>,
  ): void {
    const added: PlayerZone[] = [];
    const inside = (z: { x: number; z: number; radius: number }) =>
      enemies.enemies.filter(
        (e) => e.ai !== "dead" && e.hp > 0 && circlesOverlap(z, { x: e.x, z: e.z, radius: ENEMY_DEFS[e.kind].radius }),
      );
    for (const z of this.zoneList) {
      const sink = z.ownerKey !== undefined ? this.sink(out, z.ownerKey) : undefined;
      switch (z.kind) {
        case "banner":
          // Cura y refuerza a quien siga dentro; el refuerzo dura 2 ticks (se renueva cada uno), así se va al salir.
          for (const [key, c] of states) {
            const p = positions.get(key);
            if (c.dead || !p || !circlesOverlap(z, { x: p.x, z: p.z, radius: 0 })) continue;
            this.combat.heal(c, c.maxHp * (z.heal ?? 0) * dt);
            if (c.bannerLeft <= 0 || (z.buff ?? 0) >= c.bannerDamage) {
              c.bannerDamage = z.buff ?? 0;
              c.bannerAll = z.allNatures === true;
              c.bannerGuard = z.guard === true;
            }
            c.bannerLeft = dt * 2;
          }
          break;
        case "cracks":
          // 2 ticks de margen: el enemigo resta `dt` a su ralentización antes de moverse en el siguiente tick.
          for (const e of inside(z)) enemies.slow(e.id, CRACKS_SLOW, dt * 2);
          break;
        case "ice":
          for (const e of inside(z)) enemies.slow(e.id, MAGE_LEGENDARY.frostTrailSlow, dt * 2);
          break;
        case "frost":
          for (const e of inside(z)) {
            if (z.hit!.has(e.id)) continue;
            z.hit!.add(e.id);
            const frozen = enemies.freezeFor(e.id, z.freezeS!);
            // A quien no se puede congelar, lo frena ese rato; en el rango 3 todos siguen lentos al descongelarse.
            if (!frozen || z.slowS) enemies.slow(e.id, FROST_SLOW, z.freezeS! + (z.slowS ?? 0));
          }
          break;
        case "mine":
          if (inside({ x: z.x, z: z.z, radius: MINE_TRIGGER_M }).length > 0) {
            this.events.push({ type: "blast", kind: "mine", x: z.x, z: z.z, radius: z.blast!, nature: z.owner!.weaponNature });
            this.blast(z.owner!, z.ownerKey!, z.x, z.z, z.blast!, z.damage!, enemies, sink!);
            z.left = 0;
          }
          break;
        case "meteors": {
          z.next = (z.next ?? 0) - dt;
          while ((z.pending ?? 0) > 0 && z.next! <= EPS) {
            const total = Math.round(METEOR_RAIN_S / z.every!);
            const i = total - z.pending!;
            // Reparto en espiral: ninguno fuera de la zona y ninguno dos veces en el mismo sitio.
            const r = (z.radius - METEOR_RADIUS * 0.5) * Math.sqrt((i + 0.5) / total);
            added.push({
              id: `z${this.nextZone++}`, kind: "meteor", ownerKey: z.ownerKey, owner: z.owner, nature: z.nature, damage: z.damage,
              x: z.x + Math.sin(i * GOLDEN_ANGLE) * r, z: z.z + Math.cos(i * GOLDEN_ANGLE) * r,
              radius: METEOR_RADIUS, left: METEOR_FALL_S, total: METEOR_FALL_S,
            });
            z.pending!--;
            z.next! += z.every!;
            if (z.pending === 0 && z.bigDamage) {
              added.push({
                id: `z${this.nextZone++}`, kind: "meteorBig", ownerKey: z.ownerKey, owner: z.owner, nature: z.nature, damage: z.bigDamage,
                x: z.x, z: z.z, radius: z.radius, left: METEOR_BIG_FALL_S, total: METEOR_BIG_FALL_S,
              });
            }
          }
          break;
        }
        case "meteor":
        case "meteorBig":
          if (countDown(z.left, dt) === 0) {
            this.events.push({ type: "blast", kind: z.kind, x: z.x, z: z.z, radius: z.radius, nature: z.owner!.weaponNature });
            this.blast(z.owner!, z.ownerKey!, z.x, z.z, z.radius, z.damage!, enemies, sink!);
            // `meteorBurn`: cada meteorito (no el gigante) deja fuego donde cayó.
            if (z.kind === "meteor" && z.owner!.fx.legendaries.includes("meteorBurn")) {
              added.push({
                id: `z${this.nextZone++}`, kind: "fire", ownerKey: z.ownerKey, owner: z.owner, nature: z.nature,
                damage: Math.max(1, Math.round(z.damage! * MAGE_LEGENDARY.meteorBurnMult)),
                x: z.x, z: z.z, radius: z.radius, left: MAGE_LEGENDARY.meteorBurnS, total: MAGE_LEGENDARY.meteorBurnS,
              });
            }
          }
          break;
        case "fire":
        case "scar":
        case "trail":
          z.next = (z.next ?? ORB_PULSE_S) - dt;
          if (z.next <= EPS) {
            z.next += ORB_PULSE_S;
            this.blast(z.owner!, z.ownerKey!, z.x, z.z, z.radius, z.damage!, enemies, sink!);
          }
          break;
      }
      z.left = countDown(z.left, dt);
    }
    this.zoneList = [...this.zoneList, ...added].filter((z) => z.left > 0);
  }

  private stepShots(
    enemies: EnemySystem,
    dt: number,
    positions: ReadonlyMap<string, { x: number; z: number }>,
    out: Map<string, ShotResult>,
  ): void {
    const keep: PlayerShot[] = [];
    for (const s of this.shots) {
      if (s.returning) {
        // De vuelta: persigue a su dueño por encima de los muros y se acaba al llegarle (o si ya no está).
        const home = positions.get(s.ownerKey);
        if (!home) continue;
        const dx = home.x - s.x;
        const dz = home.z - s.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= THROW_CATCH_M + s.speed * dt) continue;
        s.dirX = dx / dist;
        s.dirZ = dz / dist;
      }
      const fromX = s.x;
      const fromZ = s.z;
      s.x += s.dirX * s.speed * dt;
      s.z += s.dirZ * s.speed * dt;
      s.life -= dt;
      const blocked = !s.returning && !isWalkableTile(this.dungeon, Math.floor(s.x / TILE_SIZE), Math.floor(s.z / TILE_SIZE));
      if (blocked && s.kind !== "sword") continue;
      if (s.kind === "sword" && !s.returning && (blocked || s.life <= EPS)) {
        // Fin de la ida: da la vuelta desde el último punto libre y puede golpear otra vez a cada enemigo.
        if (blocked) {
          s.x = fromX;
          s.z = fromZ;
        }
        s.returning = true;
        s.life = THROW_RETURN_MAX_S;
        s.hit.clear();
      }
      const sink = this.sink(out, s.ownerKey);
      if (s.kind === "orb") {
        this.stepOrb(s, enemies, dt, sink);
        if (s.life > EPS) keep.push(s);
        continue;
      }
      let spent = false;
      for (const e of [...enemies.enemies]) {
        if (e.ai === "dead" || e.hp <= 0 || s.hit.has(e.id)) continue;
        if (!circlesOverlap(s, { x: e.x, z: e.z, radius: ENEMY_DEFS[e.kind].radius })) continue;
        s.hit.add(e.id);
        const killed = this.hitEnemy(s.owner, s.ownerKey, e, s.damage, enemies, sink, { spell: s.spell, noBlade: s.mark });
        if (!killed && s.mark) enemies.bladeMarkOn(e.id, BLADE_MARK_S);
        if (!killed && s.knockback) enemies.knockback(e.id, s.dirX, s.dirZ, s.knockback);
        // El proyectil del bastón se acaba en el primer enemigo que toca.
        if (s.kind === "bolt") {
          spent = true;
          break;
        }
      }
      if (s.life > EPS && !spent) keep.push(s);
    }
    this.shots = keep;
  }

  /**
   * La Esfera no golpea al tocar: cada `ORB_PULSE_S` daña a los enemigos a `radius` de ella. Con `trail` (rango
   * 3) va dejando tramos de rastro que dañan y arrastra hacia sí a los enemigos cercanos.
   */
  private stepOrb(s: PlayerShot, enemies: EnemySystem, dt: number, sink: ShotResult): void {
    if (s.trail) {
      for (const e of enemies.enemies) {
        if (e.ai === "dead" || e.hp <= 0) continue;
        const dist = Math.hypot(s.x - e.x, s.z - e.z);
        if (dist > ORB_PULL_RADIUS || dist < ORB_PULL_MIN_M) continue;
        enemies.knockback(e.id, s.x - e.x, s.z - e.z, Math.min(ORB_PULL_MPS * dt, dist - ORB_PULL_MIN_M));
      }
    }
    s.pulseLeft = (s.pulseLeft ?? ORB_PULSE_S) - dt;
    if (s.pulseLeft > EPS) return;
    s.pulseLeft += ORB_PULSE_S;
    this.events.push({ type: "blast", kind: "orb", x: s.x, z: s.z, radius: s.radius, nature: s.owner.weaponNature });
    this.blast(s.owner, s.ownerKey, s.x, s.z, s.radius, s.damage, enemies, sink);
    if (s.trail) {
      this.zoneList.push({
        id: `z${this.nextZone++}`, kind: "trail", ownerKey: s.ownerKey, owner: s.owner, nature: s.nature, damage: s.damage,
        x: s.x, z: s.z, radius: ORB_TRAIL_RADIUS, left: ORB_TRAIL_S, total: ORB_TRAIL_S,
      });
    }
  }

  /** Daño de habilidad: el del primer golpe del arma × mult × Fuerza, Grito y Estandarte. */
  private abilityDamage(c: CombatState, mult: number): number {
    const base = strikeDamage(c.weaponId, c.cls, this.combat.level, 1, c.weaponTier);
    return Math.round(base * mult * damageMultOf(c));
  }

  /**
   * El Grito llega al que grita y a los compañeros vivos a WARCRY_RADIUS m (sin posición conocida, cuenta como
   * cerca); si ya tienen uno mayor, se queda ese. `warcryLong` alarga el bono ×1,5, `warcryHeal` cura el 15 % de la
   * vida máxima a cada alcanzado y `warcryGuard` (de quien grita) da -20 % de daño recibido mientras dura su bono.
   */
  private warcry(
    c: CombatState,
    k: { x: number; z: number },
    party: CombatState[],
    partyAt: ReadonlyMap<CombatState, { x: number; z: number }>,
    r: AbilityRank,
  ): void {
    const duration = r.durationS! * (c.fx.legendaries.includes("warcryLong") ? WARCRY_LONG_MULT : 1);
    const heals = c.fx.legendaries.includes("warcryHeal");
    const guard = c.fx.legendaries.includes("warcryGuard");
    for (const p of new Set([c, ...party])) {
      if (p.dead) continue;
      const at = p === c ? k : partyAt.get(p);
      if (at && Math.hypot(at.x - k.x, at.z - k.z) > WARCRY_RADIUS) continue;
      if (heals) this.combat.heal(p, p.maxHp * WARCRY_HEAL_FRAC);
      if (r.buff! < p.buffDamage && p.buffLeft > 0) continue;
      p.buffDamage = r.buff!;
      p.buffSpeed = r.speed ?? 0;
      p.buffLeft = duration;
      p.buffGuard = guard;
    }
  }

  /**
   * Gancho de cadena: los `count` enemigos vivos más cercanos a la vista y a `range` m reciben un golpe leve, se
   * arrastran hasta quedar a `HOOK_STOP_M` del jugador (contra los muros, como un empujón) y quedan aturdidos
   * (1 s más con `hookStun`). En rango 3 (`durationS`) el caballero queda además invulnerable.
   */
  private hook(c: CombatState, k: KinematicState, r: AbilityRank, enemies: EnemySystem, res: AbilityResult, key: string): void {
    const near = enemies.enemies
      .filter((e) => e.ai !== "dead" && e.hp > 0)
      .map((e) => ({ e, dist: Math.hypot(e.x - k.x, e.z - k.z) }))
      .filter(({ e, dist }) => dist <= r.range! && hasLineOfSight(this.dungeon, k.x, k.z, e.x, e.z, 0))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, r.count ?? 0);
    const amount = this.abilityDamage(c, r.damageMult ?? 0);
    const stun = (r.stunS ?? 0) + (c.fx.legendaries.includes("hookStun") ? 1 : 0);
    for (const { e, dist } of near) {
      if (this.hitEnemy(c, key, e, amount, enemies, res)) continue;
      const pull = dist - HOOK_STOP_M - ENEMY_DEFS[e.kind].radius;
      if (pull > 0) enemies.knockback(e.id, k.x - e.x, k.z - e.z, pull);
      enemies.stun(e.id, stun);
    }
    if (r.durationS) c.invulnFor = Math.max(c.invulnFor, r.durationS);
  }

  /** Sale el hechizo del mago cuya animación llegó a su instante: en `anim` van la dirección y el punto apuntados. */
  private castSpell(
    c: CombatState,
    k: KinematicState,
    anim: AbilityAnim,
    r: AbilityRank,
    enemies: EnemySystem,
    res: AbilityResult,
    key: string,
  ): void {
    const { id, facing } = anim;
    const aim = { x: anim.aimX ?? k.x, z: anim.aimZ ?? k.z };
    const zone = (z: Omit<PlayerZone, "id" | "ownerKey" | "owner" | "total">): void => {
      this.zoneList.push({ id: `z${this.nextZone++}`, ownerKey: key, owner: c, nature: c.weaponNature, total: z.left, ...z });
    };
    const shot = (s: Pick<PlayerShot, "kind" | "dirX" | "dirZ" | "speed" | "radius" | "damage" | "life"> & Partial<PlayerShot>): void => {
      this.shots.push({ id: `w${this.nextShot++}`, ownerKey: key, owner: c, x: k.x, z: k.z, nature: c.weaponNature, hit: new Set(), spell: true, ...s });
    };
    switch (id) {
      case "frost":
        zone({ kind: "frost", x: aim.x, z: aim.z, radius: r.radius!, left: r.durationS!, freezeS: r.stunS!, slowS: r.slowS, hit: new Set() });
        break;
      case "nova":
        this.blast(c, key, k.x, k.z, r.radius!, this.abilityDamage(c, r.damageMult!), enemies, res);
        break;
      case "beam":
        this.beam(c, k, facing, r, enemies, res, key);
        break;
      case "mine": {
        // Una sola en el punto; varias, en una línea perpendicular a donde se apunta, centrada en él.
        const n = r.count ?? 1;
        const damage = this.abilityDamage(c, r.damageMult!);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * MINE_SPACING_M;
          const x = aim.x + Math.cos(facing) * off;
          const z = aim.z - Math.sin(facing) * off;
          if (!isWalkableTile(this.dungeon, Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE))) continue;
          zone({ kind: "mine", x, z, radius: MINE_TRIGGER_M, left: r.durationS!, damage, blast: r.radius! });
        }
        break;
      }
      case "gust": {
        const n = r.count ?? 1;
        const damage = this.abilityDamage(c, r.damageMult!);
        for (let i = 0; i < n; i++) {
          const a = facing + (i * 2 * Math.PI) / n;
          shot({ kind: "gust", dirX: Math.sin(a), dirZ: Math.cos(a), speed: GUST_SPEED, radius: r.radius!, damage, life: r.range! / GUST_SPEED, knockback: r.knockback! });
        }
        // `gustDash`: el retroceso lo aplica RunRoom, como el impulso del Tajo frontal.
        if (c.fx.legendaries.includes("gustDash")) {
          const m = MAGE_LEGENDARY.gustDashM;
          res.dash = moveCircle(this.dungeon, k.x, k.z, -Math.sin(facing) * m, -Math.cos(facing) * m, PLAYER_RADIUS);
        }
        break;
      }
      case "orb": {
        // Repartidas en círculo desde donde se apunta. `orbTwin`: con una, otra hacia atrás; con varias, 4 más.
        const base = r.count ?? 1;
        const n = base + (c.fx.legendaries.includes("orbTwin") ? (base === 1 ? 1 : 4) : 0);
        for (let i = 0; i < n; i++) {
          const a = facing + (i * 2 * Math.PI) / n;
          shot({
            kind: "orb", dirX: Math.sin(a), dirZ: Math.cos(a), speed: SPELL_ORB_SPEED, radius: r.radius!,
            damage: this.abilityDamage(c, r.damageMult!), life: r.range! / SPELL_ORB_SPEED, pulseLeft: ORB_PULSE_S, trail: r.trail === true,
          });
        }
        break;
      }
      case "meteors": {
        const every = METEOR_RAIN_S / r.count!;
        const tail = r.bigMult ? METEOR_BIG_FALL_S : METEOR_FALL_S;
        zone({
          kind: "meteors", x: aim.x, z: aim.z, radius: r.radius!, left: METEOR_RAIN_S + tail,
          damage: this.abilityDamage(c, r.damageMult!), pending: r.count!, every, next: 0,
          bigDamage: r.bigMult ? this.abilityDamage(c, r.bigMult) : 0,
        });
        break;
      }
      default:
        break;
    }
  }

  /**
   * Rayo arcano: golpea al primer enemigo a la vista dentro del haz (el más cercano a lo largo de él) y rebota
   * `count` veces al enemigo vivo más cercano al último golpeado que aún no recibió el rayo. Con `mark` deja a
   * cada golpeado marcado (después del golpe: el propio rayo no detona su marca).
   */
  private beam(c: CombatState, k: KinematicState, facing: number, r: AbilityRank, enemies: EnemySystem, res: AbilityResult, key: string): void {
    const origin = { x: k.x, z: k.z, facing };
    const along = (e: { x: number; z: number }) => (e.x - k.x) * Math.sin(facing) + (e.z - k.z) * Math.cos(facing);
    const alive = () => enemies.enemies.filter((e) => e.ai !== "dead" && e.hp > 0);
    const inBeam = alive()
      .filter(
        (e) =>
          inLine(origin, { x: e.x, z: e.z, radius: ENEMY_DEFS[e.kind].radius }, r.range!, BEAM_WIDTH) &&
          hasLineOfSight(this.dungeon, k.x, k.z, e.x, e.z, 0),
      )
      .sort((a, b) => along(a) - along(b));
    const first = inBeam[0];
    const points: [number, number][] = [[k.x, k.z]];
    if (!first) {
      // Sin blanco: el haz se dibuja hasta su alcance o el primer muro.
      let d = 0;
      while (d + 0.5 <= r.range! && isWalkableTile(this.dungeon, Math.floor((k.x + Math.sin(facing) * (d + 0.5)) / TILE_SIZE), Math.floor((k.z + Math.cos(facing) * (d + 0.5)) / TILE_SIZE))) d += 0.5;
      points.push([k.x + Math.sin(facing) * d, k.z + Math.cos(facing) * d]);
      this.events.push({ type: "beam", key, points, nature: c.weaponNature });
      return;
    }
    const struck = new Set<string>();
    let target: { id: string; x: number; z: number } | undefined = first;
    let amount = this.abilityDamage(c, r.damageMult!);
    // `beamPierce`: el haz atraviesa a todos los de la línea con el daño entero y rebota desde el último.
    if (c.fx.legendaries.includes("beamPierce")) {
      for (const e of inBeam.slice(0, -1)) {
        const at = { id: e.id, x: e.x, z: e.z };
        struck.add(at.id);
        points.push([at.x, at.z]);
        if (!this.hitEnemy(c, key, at, amount, enemies, res, { spell: true }) && r.mark) enemies.mark(at.id, MARK_S);
      }
      target = inBeam.at(-1);
    }
    for (let bounce = 0; target && bounce <= (r.count ?? 0); bounce++) {
      const at: { id: string; x: number; z: number } = { id: target.id, x: target.x, z: target.z };
      struck.add(at.id);
      points.push([at.x, at.z]);
      const killed = this.hitEnemy(c, key, at, amount, enemies, res, { spell: true });
      if (!killed && r.mark) enemies.mark(at.id, MARK_S);
      amount = Math.round(amount * BEAM_BOUNCE_FRAC);
      target = alive()
        .filter((e) => !struck.has(e.id) && Math.hypot(e.x - at.x, e.z - at.z) <= BEAM_BOUNCE_M)
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    }
    this.events.push({ type: "beam", key, points, nature: c.weaponNature });
  }

  private resolveImpact(
    c: CombatState,
    k: KinematicState,
    anim: AbilityAnim,
    input: PlayerInput,
    nowTick: number,
    enemies: EnemySystem,
    history: PositionHistory,
    res: AbilityResult,
    key: string,
  ): void {
    const { id, facing } = anim;
    const r = ABILITIES[id].ranks[anim.rank - 1];
    if (!r) return;
    if (id === "throw") {
      // Una espada hacia donde apunta; en rango 3, `count` repartidas en círculo, que marcan a quien tocan.
      const n = r.count ?? 1;
      for (let i = 0; i < n; i++) {
        const a = facing + (i * 2 * Math.PI) / n;
        this.shots.push({
          id: `w${this.nextShot++}`,
          kind: "sword",
          ownerKey: key,
          owner: c,
          x: k.x,
          z: k.z,
          dirX: Math.sin(a),
          dirZ: Math.cos(a),
          speed: THROW_SPEED,
          radius: THROW_RADIUS,
          nature: c.weaponNature,
          damage: this.abilityDamage(c, r.damageMult!),
          life: r.range! / THROW_SPEED,
          hit: new Set(),
          ...(r.mark ? { mark: true } : {}),
        });
      }
      return;
    }
    if (id === "hook") {
      this.hook(c, k, r, enemies, res, key);
      return;
    }
    if (ABILITIES[id].cls === "mage") {
      this.castSpell(c, k, anim, r, enemies, res, key);
      return;
    }
    const t = rewindTick(nowTick, input.viewTick);
    // El Tajo frontal corta toda la línea que recorrió, de donde se lanzó a donde quedó; las demás, alrededor del jugador.
    const travelled = Math.hypot(k.x - anim.originX, k.z - anim.originZ);
    const origin = id === "thrust" ? { x: anim.originX, z: anim.originZ, facing } : { x: k.x, z: k.z, facing };
    const amount = this.abilityDamage(c, r.damageMult ?? 0);

    // Se copia la lista: los golpes pueden cambiar el estado interno.
    for (const e of [...enemies.enemies]) {
      if (e.ai === "dead" || e.hp <= 0) continue;
      // La embestida pasa por encima de ellos: se miran donde están ahora, no donde los veía el cliente.
      const pos = id === "thrust" ? { x: e.x, z: e.z } : (history.at(t, e.id) ?? { x: e.x, z: e.z });
      const target = { x: pos.x, z: pos.z, radius: ENEMY_DEFS[e.kind].radius };
      const inside = id === "thrust" ? inLine(origin, target, travelled, THRUST_WIDTH) : inArc(origin, target, r.radius!, FULL_CIRCLE_DEG);
      if (!inside) continue;
      if (this.hitEnemy(c, key, e, amount, enemies, res)) continue;
      if (id === "whirlwind" && anim.rank >= 3) {
        // Girando aparta un poco a los que alcanza.
        const dx = e.x - k.x;
        const dz = e.z - k.z;
        if (Math.hypot(dx, dz) > EPS) enemies.knockback(e.id, dx, dz, WHIRL_PUSH_M);
      }
      if (id === "slam") enemies.stun(e.id, r.stunS ?? 0);
    }

    if (id === "slam" && c.fx.legendaries.includes("slamCracks")) {
      this.zoneList.push({ id: `z${this.nextZone++}`, kind: "cracks", x: k.x, z: k.z, radius: r.radius!, left: CRACKS_S, total: CRACKS_S });
    }
    if (id === "thrust") {
      // Rastro a lo largo de la embestida: tramos que dañan a pulsos (`thrustScar`: el doble de tiempo y +50 %).
      const scar = c.fx.legendaries.includes("thrustScar");
      const life = THRUST_TRAIL_S * (scar ? 2 : 1);
      const damage = this.abilityDamage(c, 0.3 * (scar ? 1.5 : 1));
      const n = Math.max(1, Math.round(travelled / (THRUST_TRAIL_RADIUS * 1.4)));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        this.zoneList.push({
          id: `z${this.nextZone++}`, kind: "scar", ownerKey: key, owner: c, nature: c.weaponNature, damage,
          x: anim.originX + (k.x - anim.originX) * f, z: anim.originZ + (k.z - anim.originZ) * f,
          radius: THRUST_TRAIL_RADIUS, left: life, total: life, next: THRUST_TRAIL_TICK_S,
        });
      }
    }
  }
}
