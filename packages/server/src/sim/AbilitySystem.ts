import {
  ABILITIES,
  CLEAVE_LIFE_S,
  CLEAVE_SPEED,
  ENEMY_DEFS,
  KICK_ARC_DEG,
  KICK_IMPACT_AT,
  PLAYER_RADIUS,
  MAX_ACTIVE_ABILITIES,
  MOVESETS,
  SIM_DT,
  SLAM_IMPACT_S,
  THRUST_IMPACT_FRAC,
  THRUST_WIDTH,
  TILE_SIZE,
  WARCRY_DURATION_S,
  WEAPONS,
  WHIRLWIND_IMPACT_AT,
  circlesOverlap,
  hasLineOfSight,
  inArc,
  isWalkableTile,
  moveCircle,
  strikeDamage,
  type AbilityId,
  type Dungeon,
  type KinematicState,
  type Nature,
  type PlayerInput,
} from "@roguelike/shared";
import { abilityRank, rewindTick, type AbilityAnim, type CombatState, type CombatSystem, type ImpactResult } from "./CombatSystem";
import type { EnemySystem } from "./EnemySystem";
import type { PositionHistory } from "./PositionHistory";

export interface AbilityResult {
  /** habilidad activa que empezó en este input */
  started?: AbilityId;
  /**
   * Impulso del Tajo frontal (`thrustDash`): dónde queda el jugador tras avanzar contra los muros. AbilitySystem no
   * posee la cinemática (vive en el PlayerRecord): RunRoom la aplica a `record.kinematic` (x, z) tras cada input.
   */
  dash?: { x: number; z: number };
  hits: ImpactResult["hits"];
  kills: ImpactResult["kills"];
}

/** Onda de corte: atraviesa enemigos, golpea a cada uno una sola vez y muere contra un muro. */
export interface PlayerShot {
  id: string;
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

/** Zona del jugador (grietas del Golpe sísmico): ralentiza a los enemigos dentro mientras dura. */
export interface PlayerZone {
  id: string;
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
/** Impulso del Tajo frontal (`thrustDash`) en metros. */
const DASH_M = 3;
const WARCRY_LONG_MULT = 1.5;
const WARCRY_HEAL_FRAC = 0.15;
/** Torbellino con `whirlCharges`: cargas máximas. */
const WHIRL_CHARGES = 2;
const FULL_CIRCLE_DEG = 360;

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

/** Cargas máximas de la habilidad: 2 el Torbellino con `whirlCharges`, 1 las demás. */
export function abilityMaxCharges(c: CombatState, id: AbilityId): number {
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
      const first = WHIRLWIND_IMPACT_AT * def.animS;
      const second = def.ranks[rank - 1]!.secondSpin;
      return second === undefined ? [first] : [first, first + second];
    }
    case "kick":
      return [KICK_IMPACT_AT * def.animS];
    case "slam":
      return [SLAM_IMPACT_S];
    case "thrust":
      return [THRUST_IMPACT_FRAC * def.animS];
    default:
      return [];
  }
}

/**
 * Habilidades del guerrero. La animación y sus impactos avanzan por input procesado (como el combo);
 * los enfriamientos, el Grito y las ondas, por tick simulado en `step` (así se congelan en la pausa).
 */
export class AbilitySystem {
  private shots: PlayerShot[] = [];
  private nextShot = 1;
  private zoneList: PlayerZone[] = [];
  private nextZone = 1;

  constructor(
    private readonly dungeon: Dungeon,
    private readonly combat: CombatSystem,
  ) {}

  get playerShots(): readonly PlayerShot[] {
    return this.shots;
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
   * 3. Actualiza el Bloqueo: la tecla mantenida, sin swing ni animación.
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
  ): AbilityResult {
    const res: AbilityResult = { hits: [], kills: [] };
    const pressed = input.abilities & ~c.heldMask;
    c.heldMask = input.abilities;
    if (c.dead) {
      c.abilityAnim = null;
      c.blocking = false;
      return res;
    }

    const anim = c.abilityAnim;
    if (anim) {
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
      if ((pressed & (1 << i)) === 0) continue;
      const { id, rank } = slots[i]!;
      const def = ABILITIES[id];
      if (def.kind !== "active" || abilityCharges(c, id) < 1 || c.swingTimer > 0 || c.abilityAnim || c.stunLeft > 0) continue;
      // Celeridad: el enfriamiento se fija al lanzarla. Gasta 1 carga; si el enfriamiento no corría, empieza a recargar.
      if ((c.abilityCd[id] ?? 0) > 0) c.abilityCharges[id] = abilityCharges(c, id) - 1;
      else {
        c.abilityCharges[id] = abilityMaxCharges(c, id) - 1;
        c.abilityCd[id] = def.cooldownS * c.mods.cooldownMult;
      }
      // Reloj de arena roto: cada habilidad cuesta vida, sin bajar de 1 (ni curar a quien ya tiene menos).
      if (c.fx.abilityHpCost > 0) c.hp = Math.min(c.hp, Math.max(1, c.hp - c.fx.abilityHpCost));
      c.abilityAnim = {
        id, rank, left: def.animS, impacts: impactTimes(id, rank), facing: input.facing, originX: k.x, originZ: k.z,
      };
      if (id === "warcry") this.warcry(c, party, def.ranks[rank - 1]!.buff!);
      res.started = id;
      break;
    }

    const block = slots.findIndex((s) => s.id === "block");
    c.blocking = block >= 0 && (input.abilities & (1 << block)) !== 0 && c.swingTimer === 0 && !c.abilityAnim && c.stunLeft === 0;
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

  /** Una vez por tick (solo fuera de la pausa): enfriamientos y cargas, Grito, grietas y ondas. */
  step(states: ReadonlyMap<string, CombatState>, enemies: EnemySystem, dt: number): ShotResult[] {
    for (const c of states.values()) {
      for (const id of Object.keys(c.abilityCd) as AbilityId[]) {
        const before = c.abilityCd[id]!;
        c.abilityCd[id] = countDown(before, dt);
        if (before <= 0 || c.abilityCd[id]! > 0) continue;
        // Terminó un ciclo: vuelve 1 carga y, si faltan más, empieza otro ciclo.
        const charges = Math.min(abilityMaxCharges(c, id), (c.abilityCharges[id] ?? 0) + 1);
        c.abilityCharges[id] = charges;
        if (charges < abilityMaxCharges(c, id)) c.abilityCd[id] = ABILITIES[id].cooldownS * c.mods.cooldownMult;
      }
      if (c.buffLeft > 0) {
        c.buffLeft = countDown(c.buffLeft, dt);
        if (c.buffLeft === 0) c.buffDamage = 0;
      }
    }
    this.stepZones(enemies, dt);
    return this.stepShots(enemies, dt);
  }

  /** Las grietas ralentizan cada tick a los enemigos dentro (la ralentización se renueva) y se acaban a los 3 s. */
  private stepZones(enemies: EnemySystem, dt: number): void {
    for (const z of this.zoneList) {
      for (const e of enemies.enemies) {
        if (e.ai === "dead" || e.hp <= 0) continue;
        if (!circlesOverlap(z, { x: e.x, z: e.z, radius: ENEMY_DEFS[e.kind].radius })) continue;
        // 2 ticks de margen: el enemigo resta `dt` a su ralentización antes de moverse en el siguiente tick.
        enemies.slow(e.id, CRACKS_SLOW, dt * 2);
      }
      z.left = countDown(z.left, dt);
    }
    this.zoneList = this.zoneList.filter((z) => z.left > 0);
  }

  private stepShots(enemies: EnemySystem, dt: number): ShotResult[] {
    const out = new Map<string, ShotResult>();
    const keep: PlayerShot[] = [];
    for (const s of this.shots) {
      s.x += s.dirX * s.speed * dt;
      s.z += s.dirZ * s.speed * dt;
      s.life -= dt;
      if (!isWalkableTile(this.dungeon, Math.floor(s.x / TILE_SIZE), Math.floor(s.z / TILE_SIZE))) continue;
      for (const e of [...enemies.enemies]) {
        if (e.ai === "dead" || e.hp <= 0 || s.hit.has(e.id)) continue;
        if (!circlesOverlap(s, { x: e.x, z: e.z, radius: ENEMY_DEFS[e.kind].radius })) continue;
        s.hit.add(e.id);
        let r = out.get(s.ownerKey);
        if (!r) {
          r = { key: s.ownerKey, hits: [], kills: [] };
          out.set(s.ownerKey, r);
        }
        const src = { key: s.ownerKey, nature: s.owner.weaponNature, affinity: s.owner.mods.affinity };
        enemies.strike(e.id, s.damage, src).forEach((d, i) => {
          r.hits.push({ enemyId: d.enemyId, amount: d.amount, killed: d.killed, x: i === 0 ? e.x : d.x, z: i === 0 ? e.z : d.z });
          if (d.killed) {
            r.kills.push({ x: d.x, z: d.z, xp: d.xp, drop: d.drop, gear: d.gear, relic: d.relic });
            // Sed de sangre también con las kills de la onda.
            this.combat.heal(s.owner, s.owner.mods.lifeOnKill);
          }
          this.combat.vampireHeal(s.owner, d.amount);
        });
      }
      if (s.life > EPS) keep.push(s);
    }
    this.shots = keep;
    return [...out.values()];
  }

  /** Daño de habilidad: el del primer golpe del arma × mult × Fuerza × Grito. */
  private abilityDamage(c: CombatState, mult: number): number {
    const base = strikeDamage(c.weaponId, c.cls, this.combat.level, 1, c.weaponTier);
    return Math.round(base * mult * c.mods.damageMult * (1 + c.buffDamage));
  }

  /**
   * El Grito llega al que grita y a los compañeros vivos del grupo; si ya tienen uno, se queda el mayor.
   * `warcryLong` alarga el bono ×1,5 y `warcryHeal` cura el 15 % de la vida máxima a cada alcanzado.
   */
  private warcry(c: CombatState, party: CombatState[], buff: number): void {
    const duration = WARCRY_DURATION_S * (c.fx.legendaries.includes("warcryLong") ? WARCRY_LONG_MULT : 1);
    const heals = c.fx.legendaries.includes("warcryHeal");
    for (const p of new Set([c, ...party])) {
      if (p.dead) continue;
      if (heals) this.combat.heal(p, p.maxHp * WARCRY_HEAL_FRAC);
      if (buff < p.buffDamage) continue;
      p.buffDamage = buff;
      p.buffLeft = duration;
    }
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
    const t = rewindTick(nowTick, input.viewTick);
    // El Tajo frontal sale de donde se lanzó; las demás, de donde está el jugador en el impacto.
    const origin = id === "thrust" ? { x: anim.originX, z: anim.originZ, facing } : { x: k.x, z: k.z, facing };
    const arcDeg = id === "kick" ? KICK_ARC_DEG : FULL_CIRCLE_DEG;
    const amount = this.abilityDamage(c, r.damageMult ?? 0);
    let kills = 0;
    let dealt = 0;

    // Se copia la lista: damage() puede cambiar el estado interno.
    for (const e of [...enemies.enemies]) {
      if (e.ai === "dead" || e.hp <= 0) continue;
      const pos = history.at(t, e.id) ?? { x: e.x, z: e.z };
      const target = { x: pos.x, z: pos.z, radius: ENEMY_DEFS[e.kind].radius };
      const inside =
        id === "thrust"
          ? inLine(origin, target, r.range!, THRUST_WIDTH) &&
            hasLineOfSight(this.dungeon, origin.x, origin.z, pos.x, pos.z, 0)
          : inArc(origin, target, r.radius!, arcDeg);
      if (!inside) continue;
      const src = { key, nature: c.weaponNature, affinity: c.mods.affinity };
      const results = enemies.strike(e.id, amount, src);
      results.forEach((d, i) => {
        dealt += d.amount;
        res.hits.push({ enemyId: d.enemyId, amount: d.amount, killed: d.killed, x: i === 0 ? e.x : d.x, z: i === 0 ? e.z : d.z });
        if (d.killed) {
          res.kills.push({ x: d.x, z: d.z, xp: d.xp, drop: d.drop, gear: d.gear, relic: d.relic });
          kills++;
        }
      });
      if (results[0]!.killed) continue;
      if (id === "kick") {
        // Lejos del jugador, desde la posición rebobinada con la que se decidió el cono; encima de él, hacia
        // donde mira.
        const dx = pos.x - k.x;
        const dz = pos.z - k.z;
        const far = Math.hypot(dx, dz) > EPS;
        enemies.knockback(e.id, far ? dx : Math.sin(facing), far ? dz : Math.cos(facing), r.knockback!);
        enemies.stun(e.id, r.stunS! * (c.fx.legendaries.includes("kickStun") ? 2 : 1));
      }
    }
    // Sed de sangre: cada kill propio cura.
    this.combat.heal(c, c.mods.lifeOnKill * kills);
    this.combat.vampireHeal(c, dealt);

    if (id === "slam" && c.fx.legendaries.includes("slamCracks")) {
      this.zoneList.push({ id: `z${this.nextZone++}`, x: k.x, z: k.z, radius: r.radius!, left: CRACKS_S, total: CRACKS_S });
    }
    if (id === "thrust" && c.fx.legendaries.includes("thrustDash")) {
      res.dash = moveCircle(this.dungeon, k.x, k.z, Math.sin(facing) * DASH_M, Math.cos(facing) * DASH_M, PLAYER_RADIUS);
    }
  }
}
