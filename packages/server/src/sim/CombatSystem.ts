import {
  ABILITIES,
  BASE_REGEN,
  BLOCK_HALF_ARC_DEG,
  BLOCK_MOVE_MULT,
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
  xpToNext,
  type AbilityId,
  type ClassId,
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
}

/** El combo (ComboTimers) avanza por input procesado; respawnIn, invulnFor y los plazos, por tick. */
export interface CombatState extends ComboTimers {
  cls: ClassId;
  weaponId: WeaponId;
  weaponTier: WeaponTier;
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
  /** habilidades aprendidas con su rango, en orden de aprendizaje (copia de `progress.abilities`) */
  abilities: { id: AbilityId; rank: number }[];
  /** enfriamiento restante (s) de cada habilidad; cuenta por tick simulado */
  abilityCd: Partial<Record<AbilityId, number>>;
  abilityAnim: AbilityAnim | null;
  /** máscara de teclas de habilidad del último input procesado (para detectar flancos) */
  heldMask: number;
  /** mantiene el Bloqueo en este momento */
  blocking: boolean;
  /** el mayor Grito activo sobre este jugador (0 si ninguno) y los segundos que le quedan */
  buffDamage: number;
  buffLeft: number;
}

/** Rango (1..3) de esa habilidad, o 0 si no la tiene. */
export function abilityRank(c: CombatState, id: AbilityId): number {
  return c.abilities.find((a) => a.id === id)?.rank ?? 0;
}

/** Velocidad de movimiento efectiva: la de sus cartas, a la mitad mientras bloquea. */
export function moveSpeedMult(c: CombatState): number {
  return c.mods.moveSpeedMult * (c.blocking ? BLOCK_MOVE_MULT : 1);
}

/** Tick al que se rebobina un impacto: el que veía el cliente, acotado a REWIND_MAX_TICKS. */
export function rewindTick(nowTick: number, viewTick: number): number {
  return Math.min(nowTick, Math.max(nowTick - REWIND_MAX_TICKS, Math.round(viewTick)));
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
    swingFacing: 0,
    hp: maxHp,
    maxHp,
    dead: false,
    respawnIn: 0,
    invulnFor: 0,
    ...newComboTimers(),
    pendingHits: [],
    mods: playerMods(newProgress()),
    abilities: [],
    abilityCd: {},
    abilityAnim: null,
    heldMask: 0,
    blocking: false,
    buffDamage: 0,
    buffLeft: 0,
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
  kills: { x: number; z: number; xp: number; drop: EnemyLoadout | null }[];
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
  ): InputResult {
    const step = c.comboStep;
    const due = advanceCombo(c, SIM_DT);
    const impact = due && !c.dead ? this.resolveImpact(c, k, step, input, nowTick, enemies, history) : null;

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
    if (!input.attack || c.dead || c.blocking || c.abilityAnim) return none;
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

    // Se copia la lista: damage() puede cambiar el estado interno.
    for (const e of [...enemies.enemies]) {
      if (e.ai === "dead" || e.hp <= 0) continue;
      const pos = history.at(t, e.id) ?? { x: e.x, z: e.z };
      if (!inArc(origin, { x: pos.x, z: pos.z, radius: ENEMY_DEFS[e.kind].radius }, range, arcDeg)) continue;
      const r = enemies.damage(e.id, amount);
      result.hits.push({ enemyId: e.id, amount, killed: r.killed, x: e.x, z: e.z });
      if (r.killed) result.kills.push({ x: r.x, z: r.z, xp: r.xp, drop: r.drop });
    }
    // Sed de sangre: cada kill propio cura.
    this.heal(c, c.mods.lifeOnKill * result.kills.length);
    return result;
  }

  queueEnemyHits(states: Map<string, CombatState>, hits: readonly EnemyHit[], nowTick: number): void {
    for (const h of hits) {
      const c = states.get(h.targetKey);
      if (!c || c.dead) continue;
      // Piel de hierro: se aplica al encolar, sin redondear (la vida es decimal).
      c.pendingHits.push({
        damage: h.damage * c.mods.damageTakenMult, resolveTick: nowTick, sourceX: h.sourceX, sourceZ: h.sourceZ,
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

      this.heal(c, (BASE_REGEN + c.mods.regen) * dt);

      if (c.invulnFor > 0) {
        c.pendingHits = [];
        continue;
      }
      // Sin un input que lo resuelva antes (jugador callado o con mucho lag), se aplica al vencer el plazo.
      const r = this.applyDue(c, kin.get(key), (h) => nowTick >= h.resolveTick + REWIND_MAX_TICKS);
      if (r.damage > 0) damaged.push({ key, amount: r.damage });
      if (r.died) died.push(key);
    }
    return { damaged, died, respawned };
  }

  /**
   * Cambia los multiplicadores de sus cartas. La vida máxima pasa a ser la del nivel más `maxHpBonus`;
   * la vida no sube con ella (la cura de Vitalidad la da `heal`) y se recorta si la máxima baja.
   */
  setMods(c: CombatState, mods: PlayerMods): void {
    c.mods = mods;
    c.maxHp = playerStats(c.cls, this.level).maxHp + mods.maxHpBonus;
    c.hp = Math.min(c.hp, c.maxHp);
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
      damage += front ? h.damage * (1 - reduction) : h.damage;
    }
    c.pendingHits = keep;
    if (damage === 0) return { damage: 0, died: false };
    c.hp = Math.max(0, c.hp - damage);
    if (c.hp > 0) return { damage, died: false };
    c.dead = true;
    c.respawnIn = RESPAWN_S;
    c.pendingHits = [];
    cancelImpact(c);
    c.abilityAnim = null;
    c.blocking = false;
    return { damage, died: true };
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
        const maxHp = playerStats(c.cls, this.level).maxHp + c.mods.maxHpBonus;
        const diff = maxHp - c.maxHp;
        c.maxHp = maxHp;
        if (!c.dead) c.hp += diff;
      }
    }
    return reached;
  }
}
