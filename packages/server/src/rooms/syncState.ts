import { xpToNext } from "@roguelike/shared";
import { abilitySlots, type PlayerShot } from "../sim/AbilitySystem";
import { abilityRank, type CombatSystem } from "../sim/CombatSystem";
import type { Enemy, Projectile } from "../sim/EnemySystem";
import type { Orb } from "../sim/OrbSystem";
import type { PlayerRecord } from "./PlayerRegistry";
import {
  AbilitySlotState,
  EnemyState,
  OrbState,
  PlayerShotState,
  ProjectileState,
  type PlayerState,
  type RunState,
} from "./RunState";

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
  ps.moveSpeedMult = c.mods.moveSpeedMult;
  ps.attackSpeedMult = c.mods.attackSpeedMult;
  ps.cooldownMult = c.mods.cooldownMult;
  ps.passiveRank = abilityRank(c, "cleave");
  ps.blocking = c.blocking;
  ps.buffDamage = c.buffDamage;

  // Casillas en su sitio: solo se agregan o quitan entradas si cambia la cantidad.
  const slots = abilitySlots(c);
  while (ps.abilities.length > slots.length) ps.abilities.pop();
  while (ps.abilities.length < slots.length) ps.abilities.push(new AbilitySlotState());
  slots.forEach((slot, i) => {
    const s = ps.abilities[i]!;
    s.id = slot.id;
    s.rank = slot.rank;
    s.cooldown = c.abilityCd[slot.id] ?? 0;
  });
}

/** Agrega, actualiza y elimina por id las entradas de `enemies`, `projectiles`, `orbs` y `playerShots`. */
export function syncWorld(
  state: RunState,
  enemies: readonly Enemy[],
  projectiles: readonly Projectile[],
  combat: CombatSystem,
  orbs: readonly Orb[],
  playerShots: readonly PlayerShot[] = [],
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
    es.stunned = e.stunned;
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

  const liveWaves = new Set<string>();
  for (const w of playerShots) {
    liveWaves.add(w.id);
    let ws = state.playerShots.get(w.id);
    if (!ws) {
      ws = new PlayerShotState();
      ws.dirX = w.dirX;
      ws.dirZ = w.dirZ;
      ws.radius = w.radius;
      state.playerShots.set(w.id, ws);
    }
    ws.x = w.x;
    ws.z = w.z;
  }
  for (const id of [...state.playerShots.keys()]) if (!liveWaves.has(id)) state.playerShots.delete(id);

  state.level = combat.level;
  state.xp = combat.xp;
  state.xpToNext = xpToNext(combat.level);
}
