import {
  type Nature,
  ABILITIES,
  BASE_REGEN,
  BLOCK_HALF_ARC_DEG,
  ELITE,
  STARTING_WEAPON,
  newComboTimers,
  strikeOf,
  strikeDamage,
  ENEMY_DEFS,
  REWIND_MAX_TICKS,
  RESPAWN_INVULN_S,
  RESPAWN_S,
  SIM_DT,
  advanceCombo,
  cancelImpact,
  inArc,
  newProgress,
  playerMods,
  playerStats,
  tryStartSwing,
  WARCRY_GUARD_MULT,
  blockMoveMult,
  xpToNext,
  type AbilityId,
  type ClassId,
  type CombinedMods,
  type ComboTimers,
  type EnemyLoadout,
  type KinematicState,
  type PlayerInput,
  type PlayerMods,
  type WeaponId,
  type WeaponTier,
} from "@roguelike/shared";
import type { EnemyHit, EnemySystem } from "./EnemySystem";
import type { PositionHistory } from "./PositionHistory";

/** Golpe de enemigo a la espera: `resolveTick` es el tick del servidor en que EnemySystem lo resolvió. */
export interface PendingHit {
  damage: number;
  resolveTick: number;
  /** posición de la fuente al golpear, para el Bloqueo */
  sourceX: number;
  sourceZ: number;
  /** naturaleza del élite que golpea; si el golpe hace daño, deja su estado */
  nature?: Nature;
  /** daño por segundo de la quemadura que deja un golpe de fuego */
  burnDps?: number;
  /** elemento del golpe: la resistencia del jugador a ese elemento reduce su daño y la duración del estado */
  element?: Exclude<Nature, "none">;
  /** enemigo que lo lanzó, para el reflejo del Bloqueo */
  sourceId?: string;
}

/** Animación de una habilidad activa en curso; avanza por input procesado, como el combo. */
export interface AbilityAnim {
  id: AbilityId;
  /** rango al lanzarla; los impactos lo usan aunque suba de rango en una pausa intermedia */
  rank: number;
  /** segundos que le quedan */
  left: number;
  /** segundos que faltan para cada impacto pendiente */
  impacts: number[];
  /** dirección del input que la empezó; los impactos la usan aunque el jugador gire */
  facing: number;
  /** posición del jugador al lanzarla; el Tajo frontal sale de aquí aunque se mueva después */
  originX: number;
  originZ: number;
}

/** Efectos de equipo y reliquia que no son multiplicadores (`CombinedMods` sin `PlayerMods`); `setMods` los copia. */
export type GearEffects = Pick<CombinedMods, "vampire" | "abilityHpCost" | "noRegen" | "legendaries">;

export const NO_GEAR_EFFECTS: GearEffects = { vampire: 0, abilityHpCost: 0, noRegen: false, legendaries: [] };

/** Duración del escudo de Última resistencia, su enfriamiento, el umbral de vida que lo activa y su factor de daño. */
const LAST_STAND_S = 3;
const LAST_STAND_CD_S = 30;
const LAST_STAND_HP_FRAC = 0.3;
const LAST_STAND_DAMAGE_MULT = 0.2;
/** Fracción del daño evitado por el Bloqueo que devuelve `blockReflect`. */
const BLOCK_REFLECT_FRAC = 0.3;

/** El combo (ComboTimers) avanza por input procesado; respawnIn, invulnFor y los plazos, por tick. */
export interface CombatState extends ComboTimers {
  cls: ClassId;
  weaponId: WeaponId;
  weaponTier: WeaponTier;
  weaponNature: Nature;
  /** dirección del clic que empezó el swing en curso; el impacto la usa aunque el jugador gire */
  swingFacing: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  respawnIn: number;
  invulnFor: number;
  pendingHits: PendingHit[];
  /** multiplicadores de sus cartas de stat; se recalculan con setMods al aplicar una carta */
  mods: PlayerMods;
  /** vampiro, costo de vida por habilidad, sin regeneración y efectos legendarios (de `combinedMods`) */
  fx: GearEffects;
  /** segundos que le quedan al escudo de Última resistencia y a su enfriamiento; cuentan por tick simulado */
  lastStandLeft: number;
  lastStandCd: number;
  /** daño que el Bloqueo devuelve a quien lo golpeó, a la espera de que RunRoom lo aplique (`flushReflects`) */
  pendingReflects: { sourceId: string; amount: number }[];
  /** habilidades aprendidas con su rango, en orden de aprendizaje (copia de `progress.abilities`) */
  abilities: { id: AbilityId; rank: number }[];
  /** enfriamiento restante (s) de cada habilidad; cuenta por tick simulado */
  abilityCd: Partial<Record<AbilityId, number>>;
  /** cargas que le quedan a cada habilidad con cargas mientras su enfriamiento corre (con el enfriamiento en 0 están todas) */
  abilityCharges: Partial<Record<AbilityId, number>>;
  abilityAnim: AbilityAnim | null;
  /** máscara de teclas de habilidad del último input procesado (para detectar flancos) */
  heldMask: number;
  /** mantiene el Bloqueo en este momento */
  blocking: boolean;
  /** el mayor Grito activo sobre este jugador (0 si ninguno) y los segundos que le quedan */
  buffDamage: number;
  buffLeft: number;
  /** el Grito activo trae `warcryGuard` (de quien lo gritó): ×0,8 al daño recibido mientras dura `buffLeft` */
  buffGuard: boolean;
  /** estados que dejan los élites: segundos que quedan de quemadura (con su daño por segundo), ralentización y aturdimiento */
  burnLeft: number;
  burnDps: number;
  slowLeft: number;
  stunLeft: number;
}

/** Estados que el panel de pruebas aplica a mano; cada uno es el de una naturaleza de élite. */
export type PlayerStatus = "burn" | "slow" | "stun";

/** Rango (1..3) de esa habilidad, o 0 si no la tiene. */
export function abilityRank(c: CombatState, id: AbilityId): number {
  return c.abilities.find((a) => a.id === id)?.rank ?? 0;
}

/**
 * Guardia del Grito (`warcryGuard`): ×0,8 al daño recibido mientras dura el bono. Se multiplica DESPUÉS del piso de
 * `damageTakenMult` (0,4), así que puede bajar de él (0,4 × 0,8 = 0,32 como mínimo).
 */
export function guardMult(c: CombatState): number {
  return c.buffGuard && c.buffLeft > 0 ? WARCRY_GUARD_MULT : 1;
}

/** Efecto de sus estados en la velocidad: 0,7 ralentizado, 0 aturdido. */
export function statusSpeedMult(c: CombatState): number {
  return (c.slowLeft > 0 ? 1 - ELITE.playerSlowFrac : 1) * (c.stunLeft > 0 ? 0 : 1);
}

/** Velocidad de movimiento efectiva: la de sus cartas, a la mitad mientras bloquea, más sus estados. */
export function moveSpeedMult(c: CombatState): number {
  return c.mods.moveSpeedMult * (c.blocking ? blockMoveMult(c.fx.legendaries) : 1) * statusSpeedMult(c);
}

/** Aplica un estado con los números de `ELITE` (la quemadura, con `burnDps` si se da). */
export function applyStatus(c: CombatState, kind: PlayerStatus, burnDps: number = ELITE.playerBurnDps, durationMult = 1): void {
  if (kind === "burn") {
    c.burnLeft = ELITE.playerBurnS * durationMult;
    c.burnDps = burnDps;
  } else if (kind === "slow") c.slowLeft = ELITE.playerSlowS * durationMult;
  else c.stunLeft = ELITE.playerStunS * durationMult;
}

/** Tick al que se rebobina un impacto: el que veía el cliente, acotado a REWIND_MAX_TICKS. */
export function rewindTick(nowTick: number, viewTick: number): number {
  return Math.min(nowTick, Math.max(nowTick - REWIND_MAX_TICKS, Math.round(viewTick)));
}

/** Vida máxima: (la del nivel + bonos de cartas y equipo) × `maxHpMult` (Corazón de cristal). */
export function maxHpFor(cls: ClassId, level: number, mods: PlayerMods): number {
  return Math.round((playerStats(cls, level).maxHp + mods.maxHpBonus) * mods.maxHpMult);
}

export function newCombatState(
  cls: ClassId,
  level: number,
  weaponId: WeaponId = STARTING_WEAPON,
  tier: WeaponTier = 1,
): CombatState {
  const maxHp = playerStats(cls, level).maxHp;
  return {
    cls,
    weaponId,
    weaponTier: tier,
    weaponNature: "none",
    swingFacing: 0,
    hp: maxHp,
    maxHp,
    dead: false,
    respawnIn: 0,
    invulnFor: 0,
    ...newComboTimers(),
    pendingHits: [],
    mods: playerMods(newProgress()),
    fx: NO_GEAR_EFFECTS,
    lastStandLeft: 0,
    lastStandCd: 0,
    pendingReflects: [],
    abilities: [],
    abilityCd: {},
    abilityCharges: {},
    abilityAnim: null,
    heldMask: 0,
    blocking: false,
    buffDamage: 0,
    buffLeft: 0,
    buffGuard: false,
    burnLeft: 0,
    burnDps: 0,
    slowLeft: 0,
    stunLeft: 0,
  };
}

export interface AttackResult {
  swung: boolean;
  step: number;
}

export interface ImpactResult {
  step: number;
  hits: { enemyId: string; amount: number; killed: boolean; x: number; z: number }[];
  /** enemigos muertos por este impacto: dónde cayeron, su xp (para los orbes) y el arma que sueltan */
  kills: { x: number; z: number; xp: number; drop: EnemyLoadout | null; gear: WeaponTier | null; relic: boolean }[];
}

export interface InputResult {
  /** daño de golpes enemigos aplicado en este input */
  damage: number;
  died: boolean;
  /** impacto del swing propio que venció en este input (no da xp: el llamador crea los orbes de `kills`) */
  impact: ImpactResult | null;
}

const EPS = 1e-9;

export class CombatSystem {
  level = 1;
  xp = 0;

  /**
   * Llamar justo después de simular cada input del jugador (`k` ya refleja ese input) y antes de su ataque.
   * 1. Avanza el combo un SIM_DT; si vence el impacto (y no está muerto), lo resuelve rebobinando al
   *    `viewTick` de este input con la dirección guardada del clic.
   * 2. Resuelve los golpes enemigos pendientes: si está invulnerable se descartan; si no, se aplican
   *    los que ya vio (`viewTick >= resolveTick`).
   */
  onInputProcessed(
    c: CombatState,
    k: KinematicState,
    input: PlayerInput,
    nowTick: number,
    enemies: EnemySystem,
    history: PositionHistory,
    key = "",
  ): InputResult {
    const step = c.comboStep;
    const due = advanceCombo(c, SIM_DT);
    const impact = due && !c.dead ? this.resolveImpact(c, k, step, input, nowTick, enemies, history, key) : null;

    if (c.dead || c.pendingHits.length === 0) return { damage: 0, died: false, impact };
    if (c.invulnFor > 0) {
      c.pendingHits = [];
      return { damage: 0, died: false, impact };
    }
    return { ...this.applyDue(c, k, (h) => input.viewTick >= h.resolveTick), impact };
  }

  /**
   * Solo empieza el swing (el daño llega en el impacto, en onInputProcessed) y fija su dirección.
   * Bloqueando o con la animación de una habilidad en curso no se ataca.
   */
  attack(c: CombatState, input: PlayerInput): AttackResult {
    const none: AttackResult = { swung: false, step: 0 };
    if (!input.attack || c.dead || c.blocking || c.abilityAnim || c.stunLeft > 0) return none;
    const step = tryStartSwing(c, c.weaponId, c.mods.attackSpeedMult);
    if (step === 0) return none;
    c.swingFacing = input.facing;
    return { swung: true, step };
  }

  private resolveImpact(
    c: CombatState,
    k: KinematicState,
    step: number,
    input: PlayerInput,
    nowTick: number,
    enemies: EnemySystem,
    history: PositionHistory,
    key: string,
  ): ImpactResult {
    const strike = strikeOf(c.weaponId, step, c.mods.attackSpeedMult);
    const range = strike.range * c.mods.reachMult;
    const arcDeg = Math.min(360, strike.arcDeg * c.mods.reachMult);
    const t = rewindTick(nowTick, input.viewTick);
    const amount = Math.round(
      strikeDamage(c.weaponId, c.cls, this.level, step, c.weaponTier) * c.mods.damageMult * (1 + c.buffDamage),
    );
    const origin = { x: k.x, z: k.z, facing: c.swingFacing };
    const result: ImpactResult = { step, hits: [], kills: [] };
    let dealt = 0;

    // Se copia la lista: strike() puede cambiar el estado interno.
    for (const e of [...enemies.enemies]) {
      if (e.ai === "dead" || e.hp <= 0) continue;
      const pos = history.at(t, e.id) ?? { x: e.x, z: e.z };
      if (!inArc(origin, { x: pos.x, z: pos.z, radius: ENEMY_DEFS[e.kind].radius }, range, arcDeg)) continue;
      const src = { key, nature: c.weaponNature, affinity: c.mods.affinity };
      // El primero es el golpeado (posición actual en el golpe); los demás, encadenados por el rayo.
      enemies.strike(e.id, amount, src).forEach((r, i) => {
        result.hits.push({ enemyId: r.enemyId, amount: r.amount, killed: r.killed, x: i === 0 ? e.x : r.x, z: i === 0 ? e.z : r.z });
        if (r.killed) result.kills.push({ x: r.x, z: r.z, xp: r.xp, drop: r.drop, gear: r.gear, relic: r.relic });
        dealt += r.amount;
      });
    }
    // Sed de sangre: cada kill propio cura.
    this.heal(c, c.mods.lifeOnKill * result.kills.length);
    this.vampireHeal(c, dealt);
    return result;
  }

  queueEnemyHits(states: Map<string, CombatState>, hits: readonly EnemyHit[], nowTick: number): void {
    for (const h of hits) {
      const c = states.get(h.targetKey);
      if (!c || c.dead) continue;
      // Piel de hierro: se aplica al encolar, sin redondear (la vida es decimal).
      c.pendingHits.push({
        damage: h.damage * c.mods.damageTakenMult * guardMult(c), resolveTick: nowTick, sourceX: h.sourceX, sourceZ: h.sourceZ,
        nature: h.nature, burnDps: h.burnDps, element: h.element, sourceId: h.sourceId,
      });
    }
  }

  /**
   * Una vez por tick (solo fuera de la pausa): reapariciones, invulnerabilidad, regeneración de los vivos
   * (antes de los golpes del tick) y el plazo máximo de los golpes pendientes. `kin` da la posición y
   * orientación de cada jugador para el Bloqueo; sin su entrada, el golpe no se bloquea.
   */
  step(
    states: Map<string, CombatState>,
    nowTick: number,
    dt: number,
    kin: ReadonlyMap<string, KinematicState> = new Map(),
  ): { damaged: { key: string; amount: number }[]; died: string[]; respawned: string[] } {
    const damaged: { key: string; amount: number }[] = [];
    const died: string[] = [];
    const respawned: string[] = [];

    for (const [key, c] of states) {
      c.invulnFor = Math.max(0, c.invulnFor - dt);
      c.lastStandLeft = Math.max(0, c.lastStandLeft - dt);
      c.lastStandCd = Math.max(0, c.lastStandCd - dt);

      if (c.dead) {
        c.respawnIn -= dt;
        if (c.respawnIn <= EPS) {
          c.respawnIn = 0;
          c.dead = false;
          c.hp = c.maxHp;
          c.invulnFor = RESPAWN_INVULN_S;
          respawned.push(key);
        }
        continue;
      }

      if (!c.fx.noRegen) this.heal(c, (BASE_REGEN + c.mods.regen) * dt);
      const burned = this.tickStatus(c, dt);

      if (c.invulnFor > 0) {
        c.pendingHits = [];
        continue;
      }
      // La quemadura mata con la misma muerte que un golpe.
      if (burned > 0) {
        c.hp = Math.max(0, c.hp - burned * (c.lastStandLeft > 0 ? LAST_STAND_DAMAGE_MULT : 1) * guardMult(c));
        if (c.hp === 0) {
          this.die(c);
          died.push(key);
          continue;
        }
        this.checkLastStand(c);
      }
      // Sin un input que lo resuelva antes (jugador callado o con mucho lag), se aplica al vencer el plazo.
      const r = this.applyDue(c, kin.get(key), (h) => nowTick >= h.resolveTick + REWIND_MAX_TICKS);
      if (r.damage > 0) damaged.push({ key, amount: r.damage });
      if (r.died) died.push(key);
    }
    return { damaged, died, respawned };
  }

  /** Avanza los estados un tick y devuelve el daño de la quemadura de ese tick (sin tocar la vida). */
  private tickStatus(c: CombatState, dt: number): number {
    // La quemadura por tick usa la resistencia al fuego.
    const burn = c.burnLeft > 0 ? c.burnDps * (1 - c.mods.resist.fire) * Math.min(dt, c.burnLeft) : 0;
    c.burnLeft = c.burnLeft - dt > EPS ? c.burnLeft - dt : 0;
    c.slowLeft = c.slowLeft - dt > EPS ? c.slowLeft - dt : 0;
    c.stunLeft = c.stunLeft - dt > EPS ? c.stunLeft - dt : 0;
    return burn;
  }

  /**
   * Cambia los multiplicadores de sus cartas y equipo. La vida máxima pasa a ser `maxHpFor`;
   * la vida no sube con ella (la cura de Vitalidad la da `heal`) y se recorta si la máxima baja.
   */
  setMods(c: CombatState, mods: PlayerMods & Partial<GearEffects>): void {
    c.mods = mods;
    c.fx = {
      vampire: mods.vampire ?? 0, abilityHpCost: mods.abilityHpCost ?? 0, noRegen: mods.noRegen ?? false,
      legendaries: mods.legendaries ?? [],
    };
    c.maxHp = maxHpFor(c.cls, this.level, mods);
    c.hp = Math.min(c.hp, c.maxHp);
  }

  /** Colmillo del vampiro: cura la fracción `fx.vampire` del daño que hizo el jugador. */
  vampireHeal(c: CombatState, dealt: number): void {
    if (c.fx.vampire > 0) this.heal(c, dealt * c.fx.vampire);
  }

  /**
   * Última resistencia: al bajar de 30 % de vida (viva) y sin enfriamiento, escuda `LAST_STAND_S` s y entra en
   * enfriamiento `LAST_STAND_CD_S` s.
   */
  private checkLastStand(c: CombatState): void {
    if (c.dead || c.lastStandCd > 0 || !c.fx.legendaries.includes("lastStand")) return;
    if (c.hp >= c.maxHp * LAST_STAND_HP_FRAC) return;
    c.lastStandLeft = LAST_STAND_S;
    c.lastStandCd = LAST_STAND_CD_S;
  }

  /**
   * Aplica el reflejo del Bloqueo pendiente: cada enemigo vivo que golpeó contra el escudo recibe el daño como
   * golpe del jugador `key` (sin naturaleza). RunRoom la llama tras `onInputProcessed` y `step` y reparte
   * con `impact(key, …)` los números de daño y las muertes (orbes).
   */
  flushReflects(c: CombatState, enemies: EnemySystem, key: string): Pick<ImpactResult, "hits" | "kills"> {
    const out: Pick<ImpactResult, "hits" | "kills"> = { hits: [], kills: [] };
    const pending = c.pendingReflects.splice(0);
    let dealt = 0;
    for (const p of pending) {
      const e = enemies.enemies.find((x) => x.id === p.sourceId);
      if (!e || e.ai === "dead" || e.hp <= 0) continue;
      const amount = Math.max(1, Math.round(p.amount));
      const [r] = enemies.strike(e.id, amount, { key, nature: "none", affinity: 0 });
      out.hits.push({ enemyId: r!.enemyId, amount: r!.amount, killed: r!.killed, x: e.x, z: e.z });
      if (r!.killed) out.kills.push({ x: r!.x, z: r!.z, xp: r!.xp, drop: r!.drop, gear: r!.gear, relic: r!.relic });
      dealt += r!.amount;
    }
    this.heal(c, c.mods.lifeOnKill * out.kills.length);
    this.vampireHeal(c, dealt);
    return out;
  }

  /** Cura `amount` hasta la vida máxima; a los muertos no. */
  heal(c: CombatState, amount: number): void {
    if (c.dead || amount <= 0) return;
    c.hp = Math.min(c.maxHp, c.hp + amount);
  }

  /**
   * Aplica (y quita de la lista) los golpes pendientes que cumplen `due`. Si bloquea, los que llegan
   * desde ±BLOCK_HALF_ARC_DEG de hacia dónde mira (`k`) se reducen según el rango del Bloqueo.
   */
  private applyDue(
    c: CombatState,
    k: KinematicState | undefined,
    due: (h: PendingHit) => boolean,
  ): { damage: number; died: boolean } {
    const reduction = c.blocking && k ? (ABILITIES.block.ranks[abilityRank(c, "block") - 1]?.reduction ?? 0) : 0;
    let damage = 0;
    const keep: PendingHit[] = [];
    for (const h of c.pendingHits) {
      if (!due(h)) {
        keep.push(h);
        continue;
      }
      const front =
        reduction > 0 &&
        inArc({ x: k!.x, z: k!.z, facing: k!.facing }, { x: h.sourceX, z: h.sourceZ, radius: 0 }, Infinity, 2 * BLOCK_HALF_ARC_DEG);
      // Resistencia al elemento del golpe; después el Bloqueo y la Última resistencia.
      const resisted = h.damage * (h.element ? 1 - c.mods.resist[h.element] : 1);
      const blocked = front ? resisted * (1 - reduction) : resisted;
      if (front && h.sourceId && c.fx.legendaries.includes("blockReflect")) {
        c.pendingReflects.push({ sourceId: h.sourceId, amount: (resisted - blocked) * BLOCK_REFLECT_FRAC });
      }
      const dealt = c.lastStandLeft > 0 ? blocked * LAST_STAND_DAMAGE_MULT : blocked;
      damage += dealt;
      // El estado de un élite solo queda si el golpe hizo daño (con Invulnerable o god no hay); la resistencia acorta su duración.
      if (dealt > 0 && h.nature && h.nature !== "none") {
        const durationMult = h.element ? 1 - c.mods.resist[h.element] : 1;
        applyStatus(c, h.nature === "fire" ? "burn" : h.nature === "ice" ? "slow" : "stun", h.burnDps, durationMult);
        // Piel de hierro también atenúa la quemadura.
        if (h.nature === "fire") c.burnDps *= c.mods.damageTakenMult;
      }
    }
    c.pendingHits = keep;
    if (damage === 0) return { damage: 0, died: false };
    c.hp = Math.max(0, c.hp - damage);
    if (c.hp > 0) {
      this.checkLastStand(c);
      return { damage, died: false };
    }
    this.die(c);
    return { damage, died: true };
  }

  private die(c: CombatState): void {
    c.dead = true;
    c.respawnIn = RESPAWN_S;
    c.pendingHits = [];
    cancelImpact(c);
    c.abilityAnim = null;
    c.blocking = false;
    c.burnLeft = c.slowLeft = c.stunLeft = 0;
    c.lastStandLeft = 0;
    c.pendingReflects = [];
  }

  grantXp(states: Map<string, CombatState>, xp: number): number[] {
    this.xp += xp;
    const reached: number[] = [];
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      reached.push(this.level);
    }
    if (reached.length > 0) {
      for (const c of states.values()) {
        const maxHp = maxHpFor(c.cls, this.level, c.mods);
        const diff = maxHp - c.maxHp;
        c.maxHp = maxHp;
        if (!c.dead) c.hp += diff;
      }
    }
    return reached;
  }
}
