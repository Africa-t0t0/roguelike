import {
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
  isInvulnerable,
  playerStats,
  tryStartSwing,
  xpToNext,
  type ClassId,
  type ComboTimers,
  type KinematicState,
  type PlayerInput,
  type WeaponId,
} from "@roguelike/shared";
import type { EnemyHit, EnemySystem } from "./EnemySystem";
import type { PositionHistory } from "./PositionHistory";

/** Golpe de enemigo a la espera: `resolveTick` es el tick del servidor en que EnemySystem lo resolvió. */
export interface PendingHit {
  damage: number;
  resolveTick: number;
}

/** El combo (ComboTimers) avanza por input procesado; respawnIn, invulnFor y los plazos, por tick. */
export interface CombatState extends ComboTimers {
  cls: ClassId;
  weaponId: WeaponId;
  /** dirección del clic que empezó el swing en curso; el impacto la usa aunque el jugador gire */
  swingFacing: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  respawnIn: number;
  invulnFor: number;
  pendingHits: PendingHit[];
}

export function newCombatState(cls: ClassId, level: number, weaponId: WeaponId = STARTING_WEAPON): CombatState {
  const maxHp = playerStats(cls, level).maxHp;
  return {
    cls,
    weaponId,
    swingFacing: 0,
    hp: maxHp,
    maxHp,
    dead: false,
    respawnIn: 0,
    invulnFor: 0,
    ...newComboTimers(),
    pendingHits: [],
  };
}

export interface AttackResult {
  swung: boolean;
  step: number;
}

export interface ImpactResult {
  step: number;
  hits: { enemyId: string; amount: number; killed: boolean; x: number; z: number }[];
  xpGained: number;
}

export interface InputResult {
  /** daño de golpes enemigos aplicado en este input */
  damage: number;
  died: boolean;
  /** impacto del swing propio que venció en este input (no llama a grantXp: el llamador aplica `xpGained`) */
  impact: ImpactResult | null;
}

const EPS = 1e-9;

export class CombatSystem {
  level = 1;
  xp = 0;

  /**
   * Llamar justo después de simular cada input del jugador (`k` ya refleja ese input) y antes de su ataque.
   * 1. Si el input lo deja esquivando con un impacto pendiente, el impacto se anula.
   * 2. Avanza el combo un SIM_DT; si vence el impacto (y no está muerto), lo resuelve rebobinando al
   *    `viewTick` de este input con la dirección guardada del clic.
   * 3. Resuelve los golpes enemigos pendientes: si el input lo deja esquivando (o está invulnerable) se
   *    descartan; si no, se aplican los que ya vio (`viewTick >= resolveTick`).
   */
  onInputProcessed(
    c: CombatState,
    k: KinematicState,
    input: PlayerInput,
    nowTick: number,
    enemies: EnemySystem,
    history: PositionHistory,
  ): InputResult {
    if (c.impactPending && isInvulnerable(k)) cancelImpact(c);
    const step = c.comboStep;
    const due = advanceCombo(c, SIM_DT);
    const impact = due && !c.dead ? this.resolveImpact(c, k, step, input, nowTick, enemies, history) : null;

    if (c.dead || c.pendingHits.length === 0) return { damage: 0, died: false, impact };
    if (c.invulnFor > 0 || isInvulnerable(k)) {
      c.pendingHits = [];
      return { damage: 0, died: false, impact };
    }
    return { ...this.applyDue(c, (h) => input.viewTick >= h.resolveTick), impact };
  }

  /** Solo empieza el swing (el daño llega en el impacto, en onInputProcessed) y fija su dirección. */
  attack(c: CombatState, k: KinematicState, input: PlayerInput): AttackResult {
    const none: AttackResult = { swung: false, step: 0 };
    if (!input.attack || c.dead || isInvulnerable(k)) return none;
    const step = tryStartSwing(c, c.weaponId);
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
    const strike = strikeOf(c.weaponId, step);
    const t = Math.min(nowTick, Math.max(nowTick - REWIND_MAX_TICKS, Math.round(input.viewTick)));
    const amount = strikeDamage(c.weaponId, c.cls, this.level, step);
    const origin = { x: k.x, z: k.z, facing: c.swingFacing };
    const result: ImpactResult = { step, hits: [], xpGained: 0 };

    // Se copia la lista: damage() puede cambiar el estado interno.
    for (const e of [...enemies.enemies]) {
      if (e.ai === "dead" || e.hp <= 0) continue;
      const pos = history.at(t, e.id) ?? { x: e.x, z: e.z };
      if (!inArc(origin, { x: pos.x, z: pos.z, radius: ENEMY_DEFS[e.kind].radius }, strike.range, strike.arcDeg)) continue;
      const r = enemies.damage(e.id, amount);
      result.hits.push({ enemyId: e.id, amount, killed: r.killed, x: e.x, z: e.z });
      result.xpGained += r.xp;
    }
    return result;
  }

  queueEnemyHits(states: Map<string, CombatState>, hits: readonly EnemyHit[], nowTick: number): void {
    for (const h of hits) {
      const c = states.get(h.targetKey);
      if (!c || c.dead) continue;
      c.pendingHits.push({ damage: h.damage, resolveTick: nowTick });
    }
  }

  /** Una vez por tick: reapariciones, invulnerabilidad y el plazo máximo de los golpes pendientes. */
  step(
    states: Map<string, CombatState>,
    kin: Map<string, KinematicState>,
    nowTick: number,
    dt: number,
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

      const k = kin.get(key);
      if (c.invulnFor > 0 || (k !== undefined && isInvulnerable(k))) {
        c.pendingHits = [];
        continue;
      }
      // Sin un input que lo resuelva antes (jugador callado o con mucho lag), se aplica al vencer el plazo.
      const r = this.applyDue(c, (h) => nowTick >= h.resolveTick + REWIND_MAX_TICKS);
      if (r.damage > 0) damaged.push({ key, amount: r.damage });
      if (r.died) died.push(key);
    }
    return { damaged, died, respawned };
  }

  /** Aplica (y quita de la lista) los golpes pendientes que cumplen `due`. */
  private applyDue(c: CombatState, due: (h: PendingHit) => boolean): { damage: number; died: boolean } {
    let damage = 0;
    const keep: PendingHit[] = [];
    for (const h of c.pendingHits) {
      if (due(h)) damage += h.damage;
      else keep.push(h);
    }
    c.pendingHits = keep;
    if (damage === 0) return { damage: 0, died: false };
    c.hp = Math.max(0, c.hp - damage);
    if (c.hp > 0) return { damage, died: false };
    c.dead = true;
    c.respawnIn = RESPAWN_S;
    c.pendingHits = [];
    cancelImpact(c);
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
        const maxHp = playerStats(c.cls, this.level).maxHp;
        const diff = maxHp - c.maxHp;
        c.maxHp = maxHp;
        if (!c.dead) c.hp += diff;
      }
    }
    return reached;
  }
}
