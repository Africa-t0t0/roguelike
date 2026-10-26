import { GEAR_SLOTS, xpToNext, type GearItem } from "@roguelike/shared";
import { abilitySlots, type PlayerShot } from "../sim/AbilitySystem";
import { abilityRank, statusSpeedMult, type CombatSystem } from "../sim/CombatSystem";
import type { Enemy, Projectile } from "../sim/EnemySystem";
import type { Hazard } from "../sim/hazards";
import type { Orb } from "../sim/OrbSystem";
import type { PlayerRecord } from "./PlayerRegistry";
import {
  AbilitySlotState,
  EnemyState,
  GearState,
  HazardState,
  OrbState,
  PlayerShotState,
  ProjectileState,
  type PlayerState,
  type RunState,
} from "./RunState";

/** Resistencia más alta de la pieza (sus propias entradas, sin `allRes`, que es igual para las tres); a igual, fuego, hielo, rayo. */
function gearGlow(item: GearItem): string {
  const res = { fire: 0, ice: 0, lightning: 0 };
  for (const e of item.stats) {
    if (e.stat === "resFire") res.fire += e.value;
    else if (e.stat === "resIce") res.ice += e.value;
    else if (e.stat === "resLightning") res.lightning += e.value;
  }
  let best = "none";
  let bestV = 0;
  for (const [k, v] of Object.entries(res)) if (v > bestV) [best, bestV] = [k, v];
  return best;
}

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
  ps.weaponNature = c.weaponNature;
  ps.choosing = choosing;
  ps.moveSpeedMult = c.mods.moveSpeedMult;
  ps.attackSpeedMult = c.mods.attackSpeedMult;
  ps.cooldownMult = c.mods.cooldownMult;
  ps.passiveRank = abilityRank(c, "cleave");
  ps.blocking = c.blocking;
  ps.buffDamage = c.buffDamage;
  ps.statusSpeedMult = statusSpeedMult(c);
  ps.burnLeft = c.burnLeft;
  ps.slowLeft = c.slowLeft;
  ps.stunLeft = c.stunLeft;
  ps.relic = record.relic ?? "";
  for (const slot of GEAR_SLOTS) {
    const item = record.gear[slot];
    if (!item) {
      if (ps.gear.has(slot)) ps.gear.delete(slot);
      continue;
    }
    const data = JSON.stringify(item);
    let gs = ps.gear.get(slot);
    if (gs?.data === data) continue;
    if (!gs) {
      gs = new GearState();
      ps.gear.set(slot, gs);
    }
    gs.slot = slot;
    gs.tier = item.tier;
    gs.legendary = item.legendary !== null;
    gs.glow = gearGlow(item);
    gs.data = data;
  }

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

/** Agrega, actualiza y elimina por id las entradas de `enemies`, `projectiles`, `orbs`, `playerShots` y `hazards`. */
export function syncWorld(
  state: RunState,
  enemies: readonly Enemy[],
  projectiles: readonly Projectile[],
  combat: CombatSystem,
  orbs: readonly Orb[],
  playerShots: readonly PlayerShot[] = [],
  hazards: readonly Hazard[] = [],
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
      es.weaponNature = e.loadout?.nature ?? "none";
      es.elite = e.elite;
      es.nature = e.nature;
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
    es.burning = e.burn !== null;
    es.slowed = e.slow !== null;
    es.frozen = e.frozen > 0;
    es.spellTier = e.spellTier;
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
    ps.nature = p.nature ?? "none";
    ps.dirX = p.dirX;
    ps.dirZ = p.dirZ;
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
      ws.nature = w.nature;
      state.playerShots.set(w.id, ws);
    }
    ws.x = w.x;
    ws.z = w.z;
  }
  for (const id of [...state.playerShots.keys()]) if (!liveWaves.has(id)) state.playerShots.delete(id);

  const liveHazards = new Set<string>();
  for (const h of hazards) {
    liveHazards.add(h.id);
    let hs = state.hazards.get(h.id);
    if (!hs) {
      hs = new HazardState();
      hs.kind = h.kind;
      state.hazards.set(h.id, hs);
    }
    // El rayo se re-apunta cada tick durante el aviso: la geometría se escribe siempre (Colyseus solo envía lo que cambia).
    hs.x = h.x;
    hs.z = h.z;
    hs.dirX = h.dirX;
    hs.dirZ = h.dirZ;
    hs.length = h.length;
    hs.size = h.size;
    hs.left = h.left;
    hs.total = h.total;
    hs.phase = h.phase;
  }
  for (const id of [...state.hazards.keys()]) if (!liveHazards.has(id)) state.hazards.delete(id);

  syncLevel(state, combat);
}

/** Nivel y xp del grupo; también en la pausa (los niveles del panel de pruebas llegan entre ticks). */
export function syncLevel(state: RunState, combat: CombatSystem): void {
  state.level = combat.level;
  state.xp = combat.xp;
  state.xpToNext = xpToNext(combat.level);
}
