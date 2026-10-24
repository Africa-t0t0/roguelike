import {
  CLASS_DEFS,
  DODGE_GRACE_S,
  ENEMY_DEFS,
  REWIND_MAX_TICKS,
  RESPAWN_INVULN_S,
  RESPAWN_S,
  inArc,
  isInvulnerable,
  playerStats,
  xpToNext,
  type ClassId,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";
import type { EnemyHit, EnemySystem } from "./EnemySystem";
import type { PositionHistory } from "./PositionHistory";

export interface CombatState {
  cls: ClassId;
  hp: number;
  maxHp: number;
  dead: boolean;
  respawnIn: number;
  invulnFor: number;
  /** paso del último swing aceptado: 0 = ninguno, 1..3 */
  comboStep: number;
  swingTimer: number;
  comboTimer: number;
  pendingHits: { damage: number; deadline: number }[];
}

export function newCombatState(cls: ClassId, level: number): CombatState {
  const maxHp = playerStats(cls, level).maxHp;
  return {
    cls,
    hp: maxHp,
    maxHp,
    dead: false,
    respawnIn: 0,
    invulnFor: 0,
    comboStep: 0,
    swingTimer: 0,
    comboTimer: 0,
    pendingHits: [],
  };
}

export interface AttackResult {
  swung: boolean;
  step: number;
  hits: { enemyId: string; amount: number; killed: boolean; x: number; z: number }[];
  xpGained: number;
}

const EPS = 1e-9;

export class CombatSystem {
  level = 1;
  xp = 0;

  /** No llama a grantXp: el llamador aplica `xpGained`. */
  attack(
    c: CombatState,
    k: KinematicState,
    input: PlayerInput,
    nowTick: number,
    enemies: EnemySystem,
    history: PositionHistory,
  ): AttackResult {
    const none: AttackResult = { swung: false, step: 0, hits: [], xpGained: 0 };
    if (!input.attack || c.dead || isInvulnerable(k) || c.swingTimer > 0) return none;

    const def = CLASS_DEFS[c.cls];
    const step = c.comboTimer > 0 ? (c.comboStep % def.combo.length) + 1 : 1;
    const cs = def.combo[step - 1]!;
    c.comboStep = step;
    c.swingTimer = cs.duration;
    c.comboTimer = cs.duration + def.comboResetS;

    const t = Math.min(nowTick, Math.max(nowTick - REWIND_MAX_TICKS, Math.round(input.viewTick)));
    const amount = Math.round(playerStats(c.cls, this.level).damage * cs.damageMult);
    const origin = { x: k.x, z: k.z, facing: input.facing };
    const result: AttackResult = { swung: true, step, hits: [], xpGained: 0 };

    // Se copia la lista: damage() puede cambiar el estado interno.
    for (const e of [...enemies.enemies]) {
      if (e.ai === "dead" || e.hp <= 0) continue;
      const pos = history.at(t, e.id) ?? { x: e.x, z: e.z };
      if (!inArc(origin, { x: pos.x, z: pos.z, radius: ENEMY_DEFS[e.kind].radius }, cs.range, cs.arcDeg)) continue;
      const r = enemies.damage(e.id, amount);
      result.hits.push({ enemyId: e.id, amount, killed: r.killed, x: e.x, z: e.z });
      result.xpGained += r.xp;
    }
    return result;
  }

  queueEnemyHits(states: Map<string, CombatState>, hits: readonly EnemyHit[], nowS: number): void {
    for (const h of hits) {
      const c = states.get(h.targetKey);
      if (!c || c.dead) continue;
      c.pendingHits.push({ damage: h.damage, deadline: nowS + DODGE_GRACE_S });
    }
  }

  step(
    states: Map<string, CombatState>,
    kin: Map<string, KinematicState>,
    nowS: number,
    dt: number,
  ): { damaged: { key: string; amount: number }[]; died: string[]; respawned: string[] } {
    const damaged: { key: string; amount: number }[] = [];
    const died: string[] = [];
    const respawned: string[] = [];

    for (const [key, c] of states) {
      c.swingTimer = Math.max(0, c.swingTimer - dt);
      c.comboTimer = Math.max(0, c.comboTimer - dt);
      if (c.comboTimer <= EPS) {
        c.comboTimer = 0;
        c.comboStep = 0;
      }
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
      const protectedNow = c.invulnFor > 0 || (k !== undefined && isInvulnerable(k));
      if (protectedNow) {
        c.pendingHits = [];
        continue;
      }
      let total = 0;
      const keep: CombatState["pendingHits"] = [];
      for (const h of c.pendingHits) {
        if (h.deadline <= nowS + EPS) total += h.damage;
        else keep.push(h);
      }
      c.pendingHits = keep;
      if (total > 0) {
        c.hp = Math.max(0, c.hp - total);
        damaged.push({ key, amount: total });
        if (c.hp <= 0) {
          c.dead = true;
          c.respawnIn = RESPAWN_S;
          c.pendingHits = [];
          died.push(key);
        }
      }
    }
    return { damaged, died, respawned };
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
