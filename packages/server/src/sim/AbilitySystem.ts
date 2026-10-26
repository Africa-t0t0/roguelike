import {
  ABILITIES,
  CLEAVE_LIFE_S,
  CLEAVE_SPEED,
  ENEMY_DEFS,
  KICK_ARC_DEG,
  KICK_IMPACT_AT,
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

const EPS = 1e-9;
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

  constructor(
    private readonly dungeon: Dungeon,
    private readonly combat: CombatSystem,
  ) {}

  get playerShots(): readonly PlayerShot[] {
    return this.shots;
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
      if (def.kind !== "active" || (c.abilityCd[id] ?? 0) > 0 || c.swingTimer > 0 || c.abilityAnim || c.stunLeft > 0) continue;
      // Celeridad: el enfriamiento se fija al lanzarla.
      c.abilityCd[id] = def.cooldownS * c.mods.cooldownMult;
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

  /** Una vez por tick (solo fuera de la pausa): enfriamientos, Grito y ondas. */
  step(states: ReadonlyMap<string, CombatState>, enemies: EnemySystem, dt: number): ShotResult[] {
    for (const c of states.values()) {
      for (const id of Object.keys(c.abilityCd) as AbilityId[]) c.abilityCd[id] = countDown(c.abilityCd[id]!, dt);
      if (c.buffLeft > 0) {
        c.buffLeft = countDown(c.buffLeft, dt);
        if (c.buffLeft === 0) c.buffDamage = 0;
      }
    }
    return this.stepShots(enemies, dt);
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
            r.kills.push({ x: d.x, z: d.z, xp: d.xp, drop: d.drop });
            // Sed de sangre también con las kills de la onda.
            this.combat.heal(s.owner, s.owner.mods.lifeOnKill);
          }
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

  /** El Grito llega al que grita y a los compañeros vivos del grupo; si ya tienen uno, se queda el mayor. */
  private warcry(c: CombatState, party: CombatState[], buff: number): void {
    for (const p of new Set([c, ...party])) {
      if (p.dead || buff < p.buffDamage) continue;
      p.buffDamage = buff;
      p.buffLeft = WARCRY_DURATION_S;
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
        res.hits.push({ enemyId: d.enemyId, amount: d.amount, killed: d.killed, x: i === 0 ? e.x : d.x, z: i === 0 ? e.z : d.z });
        if (d.killed) {
          res.kills.push({ x: d.x, z: d.z, xp: d.xp, drop: d.drop });
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
        enemies.stun(e.id, r.stunS!);
      }
    }
    // Sed de sangre: cada kill propio cura.
    this.combat.heal(c, c.mods.lifeOnKill * kills);
  }
}
