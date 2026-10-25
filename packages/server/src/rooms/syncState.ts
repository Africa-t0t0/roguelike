import { xpToNext } from "@roguelike/shared";
import type { CombatSystem } from "../sim/CombatSystem";
import type { Enemy, Projectile } from "../sim/EnemySystem";
import type { Orb } from "../sim/OrbSystem";
import type { PlayerRecord } from "./PlayerRegistry";
import { EnemyState, OrbState, ProjectileState, type PlayerState, type RunState } from "./RunState";

export function syncPlayer(ps: PlayerState, record: PlayerRecord, choosing: boolean): void {
  const k = record.kinematic;
  ps.x = k.x;
  ps.z = k.z;
  ps.facing = k.facing;
  ps.y = k.y;
  ps.vy = k.vy;
  ps.lastSeq = record.lastSeq;
  const c = record.combat;
  ps.hp = c.hp;
  ps.maxHp = c.maxHp;
  ps.dead = c.dead;
  ps.respawnIn = c.respawnIn;
  ps.comboStep = c.comboStep;
  ps.swingTimer = c.swingTimer;
  ps.weaponId = c.weaponId;
  ps.weaponTier = c.weaponTier;
  ps.choosing = choosing;
}

/** Agrega, actualiza y elimina por id las entradas de `enemies`, `projectiles` y `orbs`. */
export function syncWorld(
  state: RunState,
  enemies: readonly Enemy[],
  projectiles: readonly Projectile[],
  combat: CombatSystem,
  orbs: readonly Orb[],
): void {
  const liveEnemies = new Set<string>();
  for (const e of enemies) {
    liveEnemies.add(e.id);
    let es = state.enemies.get(e.id);
    if (!es) {
      es = new EnemyState();
      es.kind = e.kind;
      // El arma de un enemigo no cambia en su vida.
      es.weaponId = e.loadout?.weaponId ?? "";
      es.weaponTier = e.loadout?.tier ?? 0;
      state.enemies.set(e.id, es);
    }
    es.x = e.x;
    es.z = e.z;
    es.facing = e.facing;
    es.hp = e.hp;
    es.maxHp = e.maxHp;
    es.ai = e.ai;
    es.aiTime = e.aiTime;
  }
  for (const id of [...state.enemies.keys()]) if (!liveEnemies.has(id)) state.enemies.delete(id);

  const liveShots = new Set<string>();
  for (const p of projectiles) {
    liveShots.add(p.id);
    let ps = state.projectiles.get(p.id);
    if (!ps) {
      ps = new ProjectileState();
      state.projectiles.set(p.id, ps);
    }
    ps.x = p.x;
    ps.z = p.z;
  }
  for (const id of [...state.projectiles.keys()]) if (!liveShots.has(id)) state.projectiles.delete(id);

  const liveOrbs = new Set<string>();
  for (const o of orbs) {
    liveOrbs.add(o.id);
    let os = state.orbs.get(o.id);
    if (!os) {
      os = new OrbState();
      state.orbs.set(o.id, os);
    }
    os.x = o.x;
    os.z = o.z;
    os.value = o.value;
  }
  for (const id of [...state.orbs.keys()]) if (!liveOrbs.has(id)) state.orbs.delete(id);

  state.level = combat.level;
  state.xp = combat.xp;
  state.xpToNext = xpToNext(combat.level);
}
