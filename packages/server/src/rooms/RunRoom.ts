import { randomInt } from "node:crypto";
import { matchMaker, Room, ServerError, type Client } from "colyseus";
import {
  activeAbilityCount,
  ABILITIES,
  applyCard,
  CHEST_LOOT,
  combinedMods,
  chestSpots,
  createRng,
  ELEMENTS,
  EMPTY_ROOM_TTL_MS,
  FLOOR_WEAPON_TTL_S,
  GEAR_SLOTS,
  generateDungeon,
  isWalkableTile,
  JOIN_ERROR_STATUS,
  MAX_INPUTS_PER_TICK,
  MAX_PLAYERS,
  MAX_ACTIVE_ABILITIES,
  MAX_QUEUED_INPUTS,
  MSG,
  newComboTimers,
  normalizeName,
  outsideStartRoom,
  parseDevCommand,
  PATCH_RATE_MS,
  PICKUP_RANGE,
  PROTOCOL_VERSION,
  RELICS,
  rollGear,
  rollGearTier,
  rollTier,
  roomSpawnPoints,
  SANDBOX_COOLDOWN_MULT,
  sanitizeInput,
  SIM_DT,
  SIM_HZ,
  stepPlayer,
  TAKEOVER_CLOSE_CODE,
  TILE_SIZE,
  tileCenter,
  WEAPONS,
  xpToNext,
  type CombatEvent,
  type DevCommand,
  type Dungeon,
  deadInput,
  type KinematicState,
  type PlayerInput,
  type RelicId,
  type Rng,
  type WeaponId,
  type WeaponTier,
} from "@roguelike/shared";
import { AbilitySystem } from "../sim/AbilitySystem";
import { applyStatus, CombatSystem, moveSpeedMult, newCombatState, type CombatState, type ImpactResult } from "../sim/CombatSystem";
import { EnemySystem, type SimPlayer } from "../sim/EnemySystem";
import { LevelUpSystem, type ChoiceEvent } from "../sim/LevelUpSystem";
import { OrbSystem } from "../sim/OrbSystem";
import { PositionHistory } from "../sim/PositionHistory";
import { WaveDirector } from "../sim/WaveDirector";
import { resolveCreateOptions, type RunRoomCreateOptions } from "./createOptions";
import { PlayerRegistry, pruneFloorWeapons, type FloorItem, type PlayerRecord } from "./PlayerRegistry";
import { createRoomCode } from "./roomCode";
import { SANDBOX_CHEST_AHEAD_M, SANDBOX_CHEST_MIN_M, sandboxSpawnSpots } from "./sandbox";
import { ChestState, PlayerState, RunState } from "./RunState";
import { syncLevel, syncPlayer, syncWorld } from "./syncState";

const ROOM_CODE_ATTEMPTS = 5;
const ALLY_SPAWN_RADIUS = 2;

const ENEMY_RNG_SALT = 0x5eed;
const WAVE_RNG_SALT = 0x7a3e;
const ORB_RNG_SALT = 0x0b5e;
const CARD_RNG_SALT = 0xca7d;
const CHEST_RNG_SALT = 0xc4e5;
const LOOT_RNG_SALT = 0x10a7;
/** distancia delante del jugador a la que el sandbox deja una pieza (`gear drop`) */
const SANDBOX_GEAR_DROP_M = 2.5;
/** lo que cura la carta Vitalidad al aplicarse */
const VITALITY_HEAL = 20;
/** ticks entre números de daño de la quemadura de un mismo enemigo (1 s) */
const BURN_EVENT_TICKS = SIM_HZ;

export type ChestLoot = "weapon" | "gear" | "relic" | "orbs" | "heal";

/** Sortea el botín de un cofre según CHEST_LOOT. */
export function rollChestLoot(rng: Rng): ChestLoot {
  const r = rng.next();
  let acc = CHEST_LOOT.weapon;
  if (r < acc) return "weapon";
  acc += CHEST_LOOT.gear;
  if (r < acc) return "gear";
  acc += CHEST_LOOT.relic;
  if (r < acc) return "relic";
  return r < acc + CHEST_LOOT.orbs ? "orbs" : "heal";
}

const RELIC_IDS = Object.keys(RELICS) as RelicId[];

const tileOf = (v: number): number => Math.floor(v / TILE_SIZE);

/** `Omit` que reparte sobre cada miembro de la unión. */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export class RunRoom extends Room<{ state: RunState }> {
  private readonly registry = new PlayerRegistry();
  private dungeon!: Dungeon;
  private emptyRoomTtlMs = EMPTY_ROOM_TTL_MS;
  private emptyTimer: { clear(): void } | undefined;
  private enemySystem!: EnemySystem;
  private director!: WaveDirector;
  private orbs!: OrbSystem;
  private levelUp!: LevelUpSystem;
  /** Botín de los cofres. */
  private chestRng!: Rng;
  /** Piezas y reliquias que sueltan los enemigos: ranura, stats y reliquia de cada jugador. */
  private lootRng!: Rng;
  private nextChest = 1;
  private floorTime = 0;
  private readonly history = new PositionHistory();
  private readonly combat = new CombatSystem();
  private abilities!: AbilitySystem;
  /** Sala de pruebas (`?sandbox=1`): atiende `MSG.dev`. */
  private sandbox = false;
  /** daño de quemadura aún sin avisar, por enemigo */
  private readonly burnAcc = new Map<string, { key: string; amount: number; since: number; x: number; z: number }>();
  /** Oleadas y llenado de salas; en el sandbox empiezan apagados. */
  private wavesOn = true;
  /** Interruptores del panel de pruebas por jugador. */
  private readonly devFlags = new Map<string, { god: boolean; noCooldown: boolean }>();

  async onCreate(options: RunRoomCreateOptions = {}): Promise<void> {
    const rng = createRng(randomInt(2 ** 32));
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt++) {
      this.roomId = createRoomCode(rng);
      if ((await matchMaker.query({ roomId: this.roomId })).length === 0) break;
    }

    const { seed, emptyRoomTtlMs, floorTimeStart, sandbox } = resolveCreateOptions(options, process.env.NODE_ENV);
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.sandbox = sandbox;
    this.wavesOn = !sandbox;
    this.dungeon = generateDungeon(seed, 1);
    this.enemySystem = new EnemySystem(this.dungeon, createRng(seed ^ ENEMY_RNG_SALT));
    this.director = new WaveDirector(this.dungeon, createRng(seed ^ WAVE_RNG_SALT));
    this.orbs = new OrbSystem(createRng(seed ^ ORB_RNG_SALT));
    this.levelUp = new LevelUpSystem(createRng(seed ^ CARD_RNG_SALT));
    this.chestRng = createRng(seed ^ CHEST_RNG_SALT);
    this.lootRng = createRng(seed ^ LOOT_RNG_SALT);
    this.abilities = new AbilitySystem(this.dungeon, this.combat);
    this.floorTime = floorTimeStart;
    this.state = new RunState({
      seed, floor: 1, tick: 0, level: 1, xp: 0, xpToNext: 0, floorTime: floorTimeStart, paused: false, pauseLeft: 0,
      // El sandbox empieza ya abierto; una sala normal espera a que alguien cruce los sellos.
      started: sandbox,
    });
    syncWorld(this.state, [], [], this.combat, []);
    for (const spot of chestSpots(this.dungeon)) this.addChest(spot.x, spot.z);

    this.autoDispose = false;
    this.setPatchRate(PATCH_RATE_MS);
    this.setTimestep(() => this.tick(), 1000 / SIM_HZ);
    this.onMessage(MSG.input, (client, raw) => this.enqueueInput(client, raw));
    this.onMessage(MSG.chooseCard, (client, raw) => this.chooseCard(client, raw));
    if (sandbox) this.onMessage(MSG.dev, (client, raw) => this.devCommand(client, raw));
    // Una sala creada a la que nadie llega a entrar (reserva vencida) no pasa por onLeave.
    this.armEmptyTimer();
  }

  onJoin(client: Client, options: { name?: unknown; token?: unknown; version?: unknown } = {}): void {
    // Una pestaña con código viejo se rechaza antes de tocar el registro.
    if (options.version !== PROTOCOL_VERSION) {
      throw new ServerError(JOIN_ERROR_STATUS["version-mismatch"], "version-mismatch");
    }
    const key = normalizeName(options.name)?.key;
    const result = this.registry.join(
      { name: options.name, token: options.token, sessionId: client.sessionId },
      () => this.spawnFor(key),
      () => newCombatState("warrior", this.combat.level),
      (equipped) => this.initialFloorWeapons(equipped),
    );
    if (!result.ok) throw new ServerError(JOIN_ERROR_STATUS[result.code], result.code);

    if (result.replacedSessionId !== undefined) {
      const old = this.clients.find((c) => c.sessionId === result.replacedSessionId);
      old?.leave(TAKEOVER_CLOSE_CODE, "takeover");
    }

    const { record } = result;
    // El combate lee las habilidades (y sus rangos) del mismo arreglo que `progress`: applyCard lo cambia en
    // su sitio, así que nunca se desincronizan.
    record.combat.abilities = record.progress.abilities;
    // Quien entra a mitad de run elige las cartas de los niveles que ya subió el grupo.
    if (result.kind === "new") record.pendingChoices = this.combat.level - 1;
    let ps = this.state.players.get(record.key);
    if (!ps) {
      ps = new PlayerState();
      this.state.players.set(record.key, ps);
    }
    ps.name = record.displayName;
    client.send(MSG.welcome, { key: record.key, sandbox: this.sandbox });
    // Nuevo, reconexión o toma de control: sus armas del suelo, solo a él.
    this.sendFloorWeapons(client, record);
    // Sus elecciones pendientes, sin pausa; en una pausa entra en la siguiente elección del grupo o al final.
    // Si ya tenía una abierta (takeover), se le reenvía.
    if (this.levelUp.isChoosing(record.key)) this.handleChoices(this.levelUp.openOffer(record.key));
    else if (!this.levelUp.paused) this.handleChoices(this.levelUp.offerSolo(record));
    syncPlayer(ps, record, this.levelUp.isChoosing(record.key));

    this.emptyTimer?.clear();
    this.emptyTimer = undefined;
  }

  // Sin onDrop: en 0.18 un cierre sin consentimiento cae aquí directamente. No hay allowReconnection,
  // porque la reconexión es por nombre. También llega aquí un cliente cuyo onJoin falló.
  onLeave(client: Client): void {
    const record = this.registry.leave(client.sessionId);
    // Si fue reemplazado por takeover, el registro ya apunta a la sesión nueva y no se toca.
    if (record) this.state.players.delete(record.key);

    if (this.registry.connected().length === 0) this.armEmptyTimer();
  }

  private armEmptyTimer(): void {
    this.emptyTimer?.clear();
    this.emptyTimer = this.clock.setTimeout(() => void this.disconnect(), this.emptyRoomTtlMs);
  }

  private enqueueInput(client: Client, raw: unknown): void {
    const record = this.registry.bySession(client.sessionId);
    const input = sanitizeInput(raw);
    if (!record || !input) return;
    // Los mensajes llegan en orden; cualquier seq que no sea mayor que el último visto es repetido o viejo.
    const newest = record.inputQueue.at(-1)?.seq ?? record.lastSeq;
    if (input.seq <= Math.max(newest, record.lastSeq)) return;
    record.inputQueue.push(input);
    if (record.inputQueue.length > MAX_QUEUED_INPUTS) {
      record.inputQueue.splice(0, record.inputQueue.length - MAX_QUEUED_INPUTS);
    }
  }

  private chooseCard(client: Client, raw: unknown): void {
    const record = this.registry.bySession(client.sessionId);
    const msg = raw as { offerId?: unknown; index?: unknown } | null;
    const offerId = msg?.offerId;
    const index = msg?.index;
    if (!record || typeof offerId !== "number" || typeof index !== "number") return;
    this.handleChoices(this.levelUp.choose(record, offerId, index));
  }

  /**
   * Único lugar donde se atienden los eventos de elección: la oferta va solo a ese cliente y "applied"
   * llega con la carta ya registrada en `progress`: se recalculan sus multiplicadores (y su vida máxima) y
   * Vitalidad cura 20.
   */
  private handleChoices(events: ChoiceEvent[]): void {
    for (const e of events) {
      const record = this.registry.all().find((r) => r.key === e.key);
      if (!record) continue;
      if (e.type === "offer") {
        const client = this.clients.find((c) => c.sessionId === record.sessionId);
        client?.send(MSG.levelChoice, {
          offerId: e.offerId, cards: e.cards, index: e.index, total: e.total, deadlineS: e.deadlineS,
        });
      } else {
        this.refreshMods(record);
        if (e.card.kind === "stat" && e.card.id === "vitality") this.combat.heal(record.combat, VITALITY_HEAL);
      }
    }
  }

  /**
   * Multiplicadores de sus cartas, equipo y reliquia, con los interruptores del panel de pruebas encima.
   * Recalcula la vida máxima (y recorta la actual).
   */
  private refreshMods(record: PlayerRecord): void {
    const mods = combinedMods(record.progress, record.gear, record.relic);
    const flags = this.devFlags.get(record.key);
    if (flags?.god) mods.damageTakenMult = 0;
    if (flags?.noCooldown) mods.cooldownMult = SANDBOX_COOLDOWN_MULT;
    this.combat.setMods(record.combat, mods);
  }

  /**
   * Panel de pruebas: solo se registra en una sala sandbox. Se ignora en la pausa de elección (salvo los
   * interruptores, que no tocan la simulación compartida) y si el comando no es válido.
   */
  private devCommand(client: Client, raw: unknown): void {
    const record = this.registry.bySession(client.sessionId);
    const cmd = parseDevCommand(raw);
    if (!record || !cmd) return;
    if (this.levelUp.paused && cmd.cmd !== "god" && cmd.cmd !== "noCooldown") return;
    this.applyDev(record, cmd);
  }

  private applyDev(record: PlayerRecord, cmd: DevCommand): void {
    const c = record.combat;
    const flags = this.devFlags.get(record.key) ?? { god: false, noCooldown: false };
    this.devFlags.set(record.key, flags);
    switch (cmd.cmd) {
      case "levelUp": {
        const all = new Map(this.registry.all().map((r) => [r.key, r.combat] as const));
        const levels: number[] = [];
        for (let i = 0; i < cmd.count; i++) {
          levels.push(...this.combat.grantXp(all, xpToNext(this.combat.level) - this.combat.xp));
        }
        for (const level of levels) this.emit({ type: "levelUp", level });
        // Sin `choose` los niveles llegan sin cartas: solo suben la vida y el escalado de enemigos.
        if (cmd.choose) this.levelUp.onLevelsGained(levels.length, this.registry.connected(), this.registry.all());
        break;
      }
      case "card": {
        const { card } = cmd;
        const p = record.progress;
        const newActive =
          card.kind === "ability" && ABILITIES[card.id].kind !== "passive" && !p.abilities.some((a) => a.id === card.id);
        if (newActive && activeAbilityCount(p) >= MAX_ACTIVE_ABILITIES) return;
        applyCard(p, card);
        this.handleChoices([{ type: "applied", key: record.key, card }]);
        break;
      }
      case "clearCards":
        record.progress.stats = {};
        // En su sitio: el combate lee las habilidades del mismo arreglo.
        record.progress.abilities.length = 0;
        c.abilityCd = {};
        c.abilityAnim = null;
        c.blocking = false;
        this.refreshMods(record);
        break;
      case "god":
        flags.god = cmd.on;
        if (cmd.on) c.pendingHits = [];
        this.refreshMods(record);
        break;
      case "noCooldown":
        flags.noCooldown = cmd.on;
        if (cmd.on) c.abilityCd = {};
        this.refreshMods(record);
        break;
      case "waves":
        this.wavesOn = cmd.on;
        break;
      case "heal":
        this.combat.heal(c, c.maxHp);
        c.abilityCd = {};
        break;
      case "spawn": {
        const elite = cmd.elite ? { nature: cmd.nature } : undefined;
        for (const spot of sandboxSpawnSpots(this.dungeon, record.kinematic, cmd.count)) {
          this.enemySystem.spawnAt(cmd.kind, spot.x, spot.z, cmd.tier, elite);
        }
        break;
      }
      case "status":
        applyStatus(c, cmd.kind);
        break;
      case "killAll":
        this.enemySystem.killAll();
        break;
      case "clock":
        this.floorTime += cmd.seconds;
        break;
      case "freeze":
        this.enemySystem.frozen = cmd.on;
        break;
      case "castNow":
        this.enemySystem.castNow(this.simPlayers());
        break;
      case "chest": {
        const [spot] = sandboxSpawnSpots(this.dungeon, record.kinematic, 1, SANDBOX_CHEST_AHEAD_M, SANDBOX_CHEST_MIN_M);
        if (spot) this.addChest(spot.x, spot.z);
        break;
      }
      case "gear": {
        const item = rollGear(this.lootRng, cmd.slot, cmd.tier, c.cls);
        if (cmd.action === "equip") {
          record.gear[cmd.slot] = item;
          this.refreshMods(record);
        } else {
          // 2,5 m hacia donde mira; si ese punto es muro, a sus pies.
          const k = record.kinematic;
          const at = { x: k.x + Math.sin(k.facing) * SANDBOX_GEAR_DROP_M, z: k.z + Math.cos(k.facing) * SANDBOX_GEAR_DROP_M };
          if (!isWalkableTile(this.dungeon, tileOf(at.x), tileOf(at.z))) [at.x, at.z] = [k.x, k.z];
          this.giveFloorItem(record, { kind: "gear", item, x: at.x, z: at.z });
        }
        break;
      }
      case "relic":
        record.relic = cmd.id;
        this.refreshMods(record);
        break;
      case "weapon":
        c.weaponId = cmd.weaponId;
        c.weaponTier = cmd.tier;
        c.weaponNature = cmd.nature;
        Object.assign(c, newComboTimers());
        break;
    }
  }

  /** Los jugadores conectados y vivos, como los ve la simulación de enemigos. */
  private simPlayers(connected: readonly PlayerRecord[] = this.registry.connected()): SimPlayer[] {
    return connected
      .filter((r) => !r.combat.dead)
      .map((r) => {
        const { magnetMult, xpMult } = r.combat.mods;
        return { key: r.key, x: r.kinematic.x, z: r.kinematic.z, alive: true, magnetMult, xpMult };
      });
  }

  private emit(event: CombatEvent): void {
    this.broadcast(MSG.combat, event);
  }

  private emitPlayerDamage(key: string, amount: number, k: KinematicState): void {
    this.emit({ type: "damage", targetKind: "player", targetId: key, amount, x: k.x, z: k.z });
  }

  private tick(): void {
    const connected = this.registry.connected();
    const allStates = new Map(this.registry.all().map((r) => [r.key, r.combat] as const));

    // Elecciones de cartas: corre en la pausa y fuera de ella (las sin pausa vencen igual).
    this.handleChoices(this.levelUp.step(SIM_DT, connected));
    if (this.levelUp.paused) {
      this.pausedTick(connected);
      return;
    }

    // 1. Inputs (habilidades y ataques) de cada jugador conectado.
    const party = connected.map((r) => r.combat);
    for (const record of connected) {
      for (const raw of record.inputQueue.splice(0, MAX_INPUTS_PER_TICK)) {
        const c = record.combat;
        const input = c.dead ? deadInput(raw, record.kinematic) : raw;
        // Bloqueando (según el input anterior) se mueve a la mitad.
        record.kinematic = stepPlayer(record.kinematic, input, this.dungeon, SIM_DT, { speedMult: moveSpeedMult(c) });
        record.lastSeq = input.seq;
        // Combo, impacto y golpes pendientes avanzan por input, antes de empezar el swing de ese input.
        const res = this.combat.onInputProcessed(c, record.kinematic, input, this.state.tick, this.enemySystem, this.history, record.key);
        if (res.impact) {
          this.impact(record.key, res.impact);
          this.abilities.onComboImpact(c, record.kinematic, res.impact.step, record.key);
        }
        if (res.damage > 0) this.emitPlayerDamage(record.key, res.damage, record.kinematic);
        this.impact(record.key, this.combat.flushReflects(c, this.enemySystem, record.key));
        // Habilidades después del combo y antes del ataque (que no se puede durante su animación).
        const ab = this.abilities.onInput(
          c, record.kinematic, input, this.state.tick, this.enemySystem, this.history, party, record.key,
        );
        if (ab.started) this.emit({ type: "ability", key: record.key, id: ab.started });
        // Impulso del Tajo frontal: el servidor mueve al jugador; el cliente se corrige con la reconciliación.
        if (ab.dash) record.kinematic = { ...record.kinematic, x: ab.dash.x, z: ab.dash.z };
        this.impact(record.key, ab);
        // Antes del ataque de este input: con un swing o una habilidad en curso no se cambia de arma.
        if (input.interact && !c.dead && c.swingTimer === 0 && !c.abilityAnim) {
          if (!this.tryOpenChest(record)) this.tryPickup(record);
        }
        if (input.attack) {
          const swing = this.combat.attack(record.combat, input);
          if (swing.swung) this.emit({ type: "swing", key: record.key, step: swing.step });
        }
      }
    }

    // 2.
    this.state.tick++;

    // 3-4. Enemigos (solo ven a los conectados vivos).
    const alive = this.simPlayers(connected);
    // El reloj avanza solo con jugadores conectados; el sorteo de tiers y el escalado de lo que se cree usan
    // el reloj actual y el nivel del grupo.
    // Antes de empezar (nadie ha cruzado los sellos) el reloj, las oleadas y el llenado de salas están quietos.
    if (!this.state.started && alive.some((p) => outsideStartRoom(this.dungeon, p.x, p.z))) this.state.started = true;
    const started = this.state.started;
    if (connected.length > 0 && started) this.floorTime += SIM_DT;
    this.enemySystem.setFloorClock(this.floorTime, this.dungeon.floor, this.combat.level);
    this.pruneFloorWeapons();
    if (started && this.wavesOn) this.enemySystem.activateRooms(alive, this.registry.size());
    if (connected.length > 0 && started && this.wavesOn) this.director.step(this.floorTime, alive, this.registry.size(), this.enemySystem);
    const states = new Map<string, CombatState>(connected.map((r) => [r.key, r.combat]));
    this.combat.queueEnemyHits(states, this.enemySystem.step(alive, SIM_DT), this.state.tick);
    this.burnTick();
    // Enfriamientos, Grito y ondas (por tick: se congelan en la pausa).
    for (const r of this.abilities.step(states, this.enemySystem, SIM_DT)) this.impact(r.key, r);
    // Orbes: los atraen y recogen los vivos; la xp es del grupo y sube la vida máxima de todos los registros.
    // Si se sube de nivel, la pausa empieza al final de este tick.
    const levels = this.combat.grantXp(allStates, this.orbs.step(alive, SIM_DT));
    for (const level of levels) this.emit({ type: "levelUp", level });
    if (levels.length > 0) this.levelUp.onLevelsGained(levels.length, connected, this.registry.all());

    // 5. Golpes vencidos, muertes y reapariciones (los desconectados quedan congelados).
    const kin = new Map(connected.map((r) => [r.key, r.kinematic]));
    const { damaged, respawned } = this.combat.step(states, this.state.tick, SIM_DT, kin);
    for (const d of damaged) this.emitPlayerDamage(d.key, d.amount, kin.get(d.key)!);
    for (const r of connected) this.impact(r.key, this.combat.flushReflects(r.combat, this.enemySystem, r.key));
    for (const key of respawned) {
      const r = connected.find((x) => x.key === key)!;
      r.kinematic = this.spawnFor(key);
    }

    // 6.
    this.history.record(this.state.tick, this.enemySystem.enemies);

    // 7. Schema.
    this.syncPlayers(connected);
    this.state.floorTime = this.floorTime;
    syncWorld(
      this.state, this.enemySystem.enemies, this.enemySystem.projectiles, this.combat, this.orbs.orbs,
      this.abilities.playerShots, this.enemySystem.hazards, this.abilities.playerZones,
    );
  }

  /**
   * Tick en pausa: no avanza nada (ni state.tick, ni el reloj, ni enemigos, orbes o combate). Los inputs se
   * descartan, pero su seq se confirma para que el cliente no los reenvíe al reanudar.
   */
  private pausedTick(connected: PlayerRecord[]): void {
    for (const record of connected) {
      const last = record.inputQueue.at(-1);
      record.inputQueue = [];
      if (last) record.lastSeq = last.seq;
    }
    this.syncPlayers(connected);
    syncLevel(this.state, this.combat);
  }

  private syncPlayers(connected: PlayerRecord[]): void {
    for (const record of connected) {
      const ps = this.state.players.get(record.key);
      if (ps) syncPlayer(ps, record, this.levelUp.isChoosing(record.key));
    }
    this.state.paused = this.levelUp.paused;
    this.state.pauseLeft = this.levelUp.pauseLeft;
  }

  /**
   * Daño contra enemigos, orbes y armas soltadas: llegan en el impacto del swing o de una habilidad (no en el
   * clic) o cuando una onda toca a un enemigo.
   * Matar no da xp: deja orbes que hay que recoger.
   */
  private impact(key: string, res: Pick<ImpactResult, "hits" | "kills">): void {
    for (const h of res.hits) {
      this.emit({
        type: "damage",
        targetKind: "enemy",
        targetId: h.enemyId,
        amount: h.amount,
        x: h.x,
        z: h.z,
        sourceKey: key,
      });
    }
    this.spawnKills(res.kills);
    for (const c of this.enemySystem.takeChains()) this.emit({ type: "chain", points: c.points });
  }

  private spawnKills(kills: Pick<ImpactResult, "kills">["kills"]): void {
    for (const k of kills) {
      this.orbs.spawn(k.x, k.z, k.xp, this.state.tick);
      if (k.drop) this.dropItem({ kind: "weapon", ...k.drop, x: k.x, z: k.z });
      const rng = this.lootRng;
      // Cada jugador conectado recibe su propia pieza (ranura y stats) y su propia reliquia.
      for (const r of this.registry.connected()) {
        if (k.gear) {
          const item = rollGear(rng, rng.pick(GEAR_SLOTS), k.gear, r.combat.cls);
          this.giveFloorItem(r, { kind: "gear", item, x: k.x, z: k.z });
        }
        if (k.relic) this.giveFloorItem(r, { kind: "relic", id: rng.pick(RELIC_IDS), x: k.x, z: k.z });
      }
    }
  }

  /**
   * Daño de quemadura del tick: las muertes dejan orbes y armas ya; los números de daño se agrupan en un
   * evento por enemigo y segundo (o al morir), con el acumulado. Sin curación por Sed de sangre.
   */
  private burnTick(): void {
    const kills: ImpactResult["kills"] = [];
    for (const { key, result: r } of this.enemySystem.takeStatusDamage()) {
      // Colmillo del vampiro: la quemadura cura a quien la puso.
      const burner = this.registry.all().find((x) => x.key === key);
      if (burner) this.combat.vampireHeal(burner.combat, r.amount);
      const acc = this.burnAcc.get(r.enemyId) ?? { key, amount: 0, since: this.state.tick, x: r.x, z: r.z };
      acc.amount += r.amount;
      acc.key = key;
      acc.x = r.x;
      acc.z = r.z;
      this.burnAcc.set(r.enemyId, acc);
      if (r.killed) {
        kills.push({ x: r.x, z: r.z, xp: r.xp, drop: r.drop, gear: r.gear, relic: r.relic });
        this.flushBurn(r.enemyId);
      }
    }
    for (const [id, acc] of [...this.burnAcc]) if (this.state.tick - acc.since >= BURN_EVENT_TICKS) this.flushBurn(id);
    this.spawnKills(kills);
  }

  private flushBurn(enemyId: string): void {
    const acc = this.burnAcc.get(enemyId);
    if (!acc) return;
    this.burnAcc.delete(enemyId);
    this.emit({
      type: "damage", targetKind: "enemy", targetId: enemyId, amount: Math.max(1, Math.round(acc.amount)),
      x: acc.x, z: acc.z, sourceKey: acc.key,
    });
  }

  /**
   * Solo en ticks simulados (el reloj no corre en la pausa): quita de cada registro las armas del suelo
   * vencidas y reenvía la lista a su dueño, si está conectado y cambió.
   */
  private pruneFloorWeapons(): void {
    for (const r of this.registry.all()) {
      if (!pruneFloorWeapons(r, this.floorTime)) continue;
      const client = this.clients.find((c) => c.sessionId === r.sessionId);
      if (client) this.sendFloorWeapons(client, r);
    }
  }

  /** `floorTime` en que vence un arma del suelo creada ahora. */
  private floorWeaponExpiry(): number {
    return this.floorTime + FLOOR_WEAPON_TTL_S;
  }

  /** Cada jugador conectado recibe su propia copia del objeto soltado y se le reenvía su lista. */
  private dropItem(item: DistributiveOmit<FloorItem, "expiresAt">): void {
    for (const r of this.registry.connected()) this.giveFloorItem(r, item);
  }

  /** Agrega un objeto a la lista del suelo de un jugador y se la reenvía si está conectado. */
  private giveFloorItem(r: PlayerRecord, item: DistributiveOmit<FloorItem, "expiresAt">): void {
    r.floorWeapons.push({ ...item, expiresAt: this.floorWeaponExpiry() } as FloorItem);
    const client = this.clients.find((c) => c.sessionId === r.sessionId);
    if (client) this.sendFloorWeapons(client, r);
  }

  private addChest(x: number, z: number): void {
    const cs = new ChestState();
    cs.x = x;
    cs.z = z;
    cs.open = false;
    this.state.chests.set(`c${this.nextChest++}`, cs);
  }

  /**
   * Abre el cofre cerrado más cercano a ≤ PICKUP_RANGE, si lo hay, y reparte su botín. Devuelve si abrió uno
   * (ese `interact` ya no recoge armas).
   */
  private tryOpenChest(record: PlayerRecord): boolean {
    const { x, z } = record.kinematic;
    let best: ChestState | null = null;
    let bestD2 = Infinity;
    for (const cs of this.state.chests.values()) {
      const d2 = (cs.x - x) ** 2 + (cs.z - z) ** 2;
      if (!cs.open && d2 <= PICKUP_RANGE ** 2 && d2 < bestD2) [best, bestD2] = [cs, d2];
    }
    if (!best) return false;
    best.open = true;
    const loot = rollChestLoot(this.chestRng);
    if (loot === "orbs") {
      this.orbs.spawn(best.x, best.z, CHEST_LOOT.orbXp, this.state.tick);
    } else if (loot === "heal") {
      for (const r of this.registry.connected()) if (!r.combat.dead) this.combat.heal(r.combat, r.combat.maxHp);
    } else {
      // 1 m hacia quien lo abre; si ese punto es muro, sobre el cofre.
      const d = Math.sqrt(bestD2);
      const at = { x: best.x + (d > 0 ? (x - best.x) / d : 0), z: best.z + (d > 0 ? (z - best.z) / d : 0) };
      if (!isWalkableTile(this.dungeon, tileOf(at.x), tileOf(at.z))) [at.x, at.z] = [best.x, best.z];
      const rng = this.chestRng;
      // Arma, pieza o reliquia: cada jugador conectado recibe la suya (el tier de armas y piezas sale igual).
      for (const r of this.registry.connected()) {
        if (loot === "relic") {
          this.giveFloorItem(r, { kind: "relic", id: rng.pick(RELIC_IDS), x: at.x, z: at.z });
          continue;
        }
        const weaponId = loot === "weapon" ? rng.pick(Object.keys(WEAPONS) as WeaponId[]) : null;
        const nature = loot === "weapon" ? rng.pick(ELEMENTS) : null;
        const base = rollTier(rng, this.floorTime, this.state.floor);
        const tier = Math.min(4, base + (rng.next() < CHEST_LOOT.tierBumpChance ? 1 : 0)) as WeaponTier;
        if (weaponId && nature) this.giveFloorItem(r, { kind: "weapon", weaponId, tier, nature, x: at.x, z: at.z });
        else this.giveFloorItem(r, { kind: "gear", item: rollGear(rng, rng.pick(GEAR_SLOTS), tier, r.combat.cls), x: at.x, z: at.z });
      }
    }
    return true;
  }

  /**
   * Todas las armas menos la equipada, en el orden de WEAPONS, sobre puntos fijos de la sala inicial
   * que siguen a los MAX_PLAYERS primeros (reservados para aparecer).
   */
  private initialFloorWeapons(equipped: WeaponId): FloorItem[] {
    const ids = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => id !== equipped);
    const points = roomSpawnPoints(this.dungeon, this.dungeon.startRoomId, MAX_PLAYERS + ids.length).slice(MAX_PLAYERS);
    if (points.length < ids.length) throw new Error("la sala inicial no tiene sitio para las armas del suelo");
    const expiresAt = this.floorWeaponExpiry();
    return ids.map((weaponId, i) => ({ kind: "weapon" as const, weaponId, tier: 1, nature: "none", x: points[i]!.x, z: points[i]!.z, expiresAt }));
  }

  /** `ttl`: segundos simulados que le quedan a cada objeto al enviarlo; `kind` dice si es arma, pieza o reliquia. */
  private sendFloorWeapons(client: Client, record: PlayerRecord): void {
    client.send(MSG.floorWeapons, {
      items: record.floorWeapons.map((f) => {
        const ttl = f.expiresAt - this.floorTime;
        if (f.kind === "gear") return { kind: f.kind, item: f.item, x: f.x, z: f.z, ttl };
        if (f.kind === "relic") return { kind: f.kind, id: f.id, x: f.x, z: f.z, ttl };
        return { kind: f.kind, weaponId: f.weaponId, tier: f.tier, nature: f.nature, x: f.x, z: f.z, ttl };
      }),
    });
  }

  /**
   * Toma el objeto del suelo propio más cercano a ≤ PICKUP_RANGE (a igual distancia, el primero de la lista):
   * - arma: se intercambia con la equipada (con su tier);
   * - pieza: se equipa en su ranura;
   * - reliquia: se equipa.
   * Lo que se deja (arma, pieza o reliquia anterior) queda en el mismo sitio y vence a los FLOOR_WEAPON_TTL_S
   * desde ahora; sin nada que dejar, el objeto desaparece del suelo.
   */
  private tryPickup(record: PlayerRecord): void {
    const { x, z } = record.kinematic;
    let best = -1;
    let bestD2 = Infinity;
    record.floorWeapons.forEach((f, i) => {
      const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d2 <= PICKUP_RANGE ** 2 && d2 < bestD2) [best, bestD2] = [i, d2];
    });
    if (best === -1) return;
    const taken = record.floorWeapons[best]!;
    const at = { x: taken.x, z: taken.z, expiresAt: this.floorWeaponExpiry() };
    let left: FloorItem | null = null;
    if (taken.kind === "weapon") {
      left = {
        kind: "weapon", weaponId: record.combat.weaponId, tier: record.combat.weaponTier, nature: record.combat.weaponNature, ...at,
      };
      record.combat.weaponId = taken.weaponId;
      record.combat.weaponTier = taken.tier;
      record.combat.weaponNature = taken.nature;
      Object.assign(record.combat, newComboTimers());
    } else if (taken.kind === "gear") {
      const old = record.gear[taken.item.slot];
      if (old) left = { kind: "gear", item: old, ...at };
      record.gear[taken.item.slot] = taken.item;
      this.refreshMods(record);
    } else {
      if (record.relic) left = { kind: "relic", id: record.relic, ...at };
      record.relic = taken.id;
      this.refreshMods(record);
    }
    if (left) record.floorWeapons[best] = left;
    else record.floorWeapons.splice(best, 1);
    const client = this.clients.find((c) => c.sessionId === record.sessionId);
    if (client) this.sendFloorWeapons(client, record);
  }

  /**
   * Determinista según el estado actual (el registro puede llamarla más de una vez).
   * Junto a un aliado conectado y vivo: casilla caminable libre más cercana (Chebyshev ≤ 2) a la suya.
   * Si no hay aliado vivo (o no hay hueco), un punto libre de la sala inicial.
   */
  private spawnFor(joiningKey: string | undefined): KinematicState {
    const others = this.registry.connected().filter((r) => r.key !== joiningKey);
    const occupied = new Set(others.map((r) => `${tileOf(r.kinematic.x)},${tileOf(r.kinematic.z)}`));
    const free = (tx: number, tz: number) => isWalkableTile(this.dungeon, tx, tz) && !occupied.has(`${tx},${tz}`);

    const ally = others.find((r) => !r.combat.dead);
    if (ally) {
      const [ax, az] = [tileOf(ally.kinematic.x), tileOf(ally.kinematic.z)];
      // La casilla libre más cercana al aliado; a igual distancia, por dz y luego dx ascendentes.
      const candidates: { dx: number; dz: number }[] = [];
      for (let dz = -ALLY_SPAWN_RADIUS; dz <= ALLY_SPAWN_RADIUS; dz++) {
        for (let dx = -ALLY_SPAWN_RADIUS; dx <= ALLY_SPAWN_RADIUS; dx++) candidates.push({ dx, dz });
      }
      candidates.sort((a, b) => a.dx ** 2 + a.dz ** 2 - (b.dx ** 2 + b.dz ** 2) || a.dz - b.dz || a.dx - b.dx);
      const pick = candidates.find((c) => free(ax + c.dx, az + c.dz));
      if (pick) return still(tileCenter(ax + pick.dx, az + pick.dz));
    }
    const points = roomSpawnPoints(this.dungeon, this.dungeon.startRoomId, MAX_PLAYERS + 1);
    const point = points.find((p) => free(tileOf(p.x), tileOf(p.z))) ?? points[0]!;
    return still(point);
  }
}

function still(p: { x: number; z: number }): KinematicState {
  return { x: p.x, z: p.z, facing: 0, y: 0, vy: 0 };
}
