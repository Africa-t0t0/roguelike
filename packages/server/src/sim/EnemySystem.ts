import {
  ARMED_CHANCE,
  ELEMENTS,
  ELITE,
  ORB,
  SPELLS,
  ENEMY_DEFS,
  ENEMY_SPAWN_MIN_PLAYER_DIST_TILES,
  NATURE,
  FlowField,
  PLAYER_RADIUS,
  TIERS,
  TILE_SIZE,
  WEAPONS,
  casterKinds,
  casterTelegraphS,
  circlesOverlap,
  eliteChance,
  enemiesForRoom,
  enemyAttack,
  enemyScale,
  flowSourcesKey,
  hasLineOfSight,
  isCaster,
  isWalkableTile,
  moveCircle,
  natureEffects,
  rollTier,
  tileCenter,
  type Dungeon,
  type EnemyKind,
  type EnemyLoadout,
  type Nature,
  type Rng,
  type WeaponId,
  type WeaponTier,
  type CasterTier,
} from "@roguelike/shared";
import { beamLength, inBeam, inZone, type Hazard } from "./hazards";

export type EnemyAi = "idle" | "chase" | "telegraph" | "recover" | "dead";

export interface Enemy {
  id: string;
  kind: EnemyKind;
  roomId: number;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  ai: EnemyAi;
  /** segundos en el estado actual */
  aiTime: number;
  targetKey: string | null;
  cooldown: number;
  /** arma que lleva; null si va desarmado */
  loadout: EnemyLoadout | null;
  /** tier de sus hechizos (1..3), sorteado al crearlo; 0 si no es hechicero */
  spellTier: 0 | CasterTier;
  /** segundos que le quedan aturdido (Patada): ni se mueve ni ataca */
  stunned: number;
  /** segundos que le quedan congelado (hielo): como el aturdimiento, pero se avisa aparte al cliente */
  frozen: number;
  /** segundos de inmunidad a volver a congelarse tras descongelarse */
  freezeImmune: number;
  /** élite: más vida y daño, siempre armado, inmune a aturdir y congelar, y sus golpes llevan su naturaleza */
  elite: boolean;
  /** naturaleza del élite; "none" en los demás */
  nature: Nature;
  /** hechizos lanzados; el hechicero élite alterna el tipo de su ataque con ellos */
  casts: number;
  /** tipo del hechizo que prepara o lanzó por última vez (su propio `kind` salvo en el hechicero élite) */
  spell: EnemyKind;
  /** quemadura (fuego): daño por segundo, segundos restantes y quién la prendió */
  burn: { left: number; dps: number; ownerKey: string } | null;
  /** ralentización (hielo): fracción de velocidad que pierde y segundos restantes */
  slow: { left: number; frac: number } | null;
  /** instantes (reloj del sistema) de los últimos golpes de hielo, para contar hasta congelar */
  iceHits: number[];
  /** multiplicador de daño de sus golpes y proyectiles, fijado al crearlo (escalado) */
  damageMult: number;
}

export interface Projectile {
  id: string;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  radius: number;
  damage: number;
  life: number;
  sourceId: string;
  /** naturaleza del élite que lo lanzó */
  nature?: Nature;
  burnDps?: number;
}

/** Solo jugadores conectados. */
export interface SimPlayer {
  key: string;
  x: number;
  z: number;
  alive: boolean;
  /** multiplicador del radio de imán de orbes (carta Imán); 1 si falta */
  magnetMult?: number;
  /** multiplicador de la XP de los orbes que recoge (carta Aprendizaje); 1 si falta */
  xpMult?: number;
}

export interface EnemyDamageResult {
  killed: boolean;
  xp: number;
  /** posición del enemigo al recibir el golpe (0, 0 si no existe) */
  x: number;
  z: number;
  /** arma soltada al morir; solo los armados, con `TIERS[tier].dropChance` */
  drop: EnemyLoadout | null;
}

/** Quién golpea y con qué naturaleza; `affinity` es el conteo de cartas de Afinidad. */
export interface StrikeSource {
  key: string;
  nature: Nature;
  affinity: number;
}

/** Resultado de un golpe: el primero es el golpeado y los siguientes, los encadenados por el rayo. */
export type StrikeResult = EnemyDamageResult & { enemyId: string; amount: number };

export interface EnemyHit {
  targetKey: string;
  damage: number;
  sourceId: string;
  /** posición de la fuente al golpear (el enemigo o su proyectil); el Bloqueo mira desde dónde llega */
  sourceX: number;
  sourceZ: number;
  /** naturaleza del élite que golpea; ausente en los demás */
  nature?: Nature;
  /** daño por segundo de la quemadura que deja un élite de fuego (4 × su `damageMult`) */
  burnDps?: number;
}

/** Siguiente tipo de hechizo del hechicero élite al alternar: mage → pyromancer → stormcaller → mage. */
const NEXT_SPELL: Partial<Record<EnemyKind, EnemyKind>> = { mage: "pyromancer", pyromancer: "stormcaller", stormcaller: "mage" };

/** Campos de naturaleza que un proyectil o peligro de élite pasa a sus golpes (nada si no es de élite). */
function hazardNature(h: { nature?: Nature; burnDps?: number }): Pick<EnemyHit, "nature" | "burnDps"> {
  return h.nature === undefined ? {} : { nature: h.nature, burnDps: h.burnDps };
}

const MELEE_TOLERANCE = 0.3;
const DEAD_LINGER_S = 2;
const SEPARATION_EPS = 1e-4;
const STUN_EPS = 1e-9;
const STATUS_EPS = 1e-9;

function tileOf(v: number): number {
  return Math.floor(v / TILE_SIZE);
}

export class EnemySystem {
  private list: Enemy[] = [];
  private shots: Projectile[] = [];
  private hazardList: Hazard[] = [];
  private nextHazard = 1;
  /** Solo sandbox: congela a los enemigos que no preparan un ataque (los que ya preparan, terminan). */
  frozen = false;
  private activated = new Set<number>();
  private nextEnemy = 1;
  private nextShot = 1;
  private readonly field: FlowField;
  private floorTime = 0;
  private floor: number;
  private partyLevel = 1;
  /** reloj del sistema (solo avanza en `step`, así que se detiene en la pausa) */
  private clock = 0;
  private statusDamage: { key: string; result: StrikeResult }[] = [];
  private chains: { points: [number, number][] }[] = [];

  constructor(
    private readonly dungeon: Dungeon,
    private readonly rng: Rng,
  ) {
    this.field = new FlowField(dungeon);
    this.floor = dungeon.floor;
  }

  /** Mapa de flujo hacia los jugadores vivos que usa `step`; el director también lo lee. */
  get flow(): FlowField {
    return this.field;
  }

  /**
   * Reloj del piso y nivel del grupo: con ellos se sortean los tiers y se escalan la vida y el daño de los
   * enemigos que se creen después (los ya vivos no cambian).
   */
  setFloorClock(floorTime: number, floor: number, partyLevel = 1): void {
    this.floorTime = floorTime;
    this.floor = floor;
    this.partyLevel = partyLevel;
  }

  /** Enemigos que no están en su animación de muerte. */
  liveCount(): number {
    let n = 0;
    for (const e of this.list) if (e.ai !== "dead") n++;
    return n;
  }

  /** Un enemigo por spot, de tipo `kinds[i % kinds.length]`, persiguiendo y sin sala (roomId -1). */
  spawnWave(spots: readonly { x: number; z: number }[], kinds: readonly EnemyKind[]): Enemy[] {
    const created: Enemy[] = [];
    if (kinds.length === 0) return created;
    for (let i = 0; i < spots.length; i++) {
      const e = this.createEnemy(this.casterFor(kinds[i % kinds.length]!), -1, spots[i]!.x, spots[i]!.z);
      created.push(e);
    }
    return created;
  }

  /**
   * Solo sandbox: un enemigo persiguiendo, sin sala, con el tier pedido en vez de sortearlo. Minion y brute:
   * 0 = desarmado, 1..3 = su arma de `ARMED_CHANCE` con ese tier. Hechicero: ese tier de hechizo (0 cuenta como 1).
   * Con `elite` lo es (naturaleza sorteada si no se da) y, si puede llevar arma, la lleva siempre (tier mínimo 1).
   */
  spawnAt(kind: EnemyKind, x: number, z: number, tier: 0 | CasterTier, elite?: { nature?: Nature }): Enemy {
    return this.createEnemy(kind, -1, x, z, tier, elite);
  }

  /** Cada "mage" pedido se cambia por un hechicero de `casterKinds`; sin RNG si solo hay uno. */
  private casterFor(kind: EnemyKind): EnemyKind {
    if (kind !== "mage") return kind;
    const options = casterKinds(this.floorTime);
    return options.length > 1 ? this.rng.pick(options) : options[0]!;
  }

  /** Solo sandbox: mata a todos los vivos sin orbes ni armas soltadas. */
  killAll(): void {
    for (const e of this.list) {
      if (e.ai === "dead") continue;
      e.hp = 0;
      this.setAi(e, "dead");
    }
  }

  private createEnemy(
    kind: EnemyKind,
    roomId: number,
    x: number,
    z: number,
    tier?: 0 | CasterTier,
    forceElite?: { nature?: Nature },
  ): Enemy {
    const caster = isCaster(kind);
    const armed = ARMED_CHANCE[kind];
    // Con tier pedido (sandbox) no se sortea nada; si no, se sortea el arma o el tier de hechizo.
    let loadout: EnemyLoadout | null =
      tier === undefined ? this.rollLoadout(kind) : armed && tier !== 0 ? { weaponId: armed.weaponId, tier, nature: "none" } : null;
    const spellTier: 0 | CasterTier = !caster
      ? 0
      : tier === undefined ? rollTier(this.rng, this.floorTime, this.floor) : tier === 0 ? 1 : tier;
    // El sorteo de élite consume RNG solo cuando hay probabilidad (desde el minuto 3), para no mover las
    // secuencias sembradas anteriores. Los de sandbox (tier pedido) solo lo son si se pide.
    // En las salas no hay élites: solo las oleadas (roomId -1).
    const chance = roomId === -1 ? eliteChance(this.floorTime) : 0;
    const isElite = forceElite !== undefined || (tier === undefined && chance > 0 && this.rng.next() < chance);
    const nature: Nature = isElite ? (forceElite?.nature ?? this.rng.pick(ELEMENTS)) : "none";
    if (isElite && armed) {
      const t = loadout?.tier ?? (tier === undefined ? rollTier(this.rng, this.floorTime, this.floor) : 1);
      loadout = { weaponId: armed.weaponId, tier: t, nature };
    }
    const def = ENEMY_DEFS[kind];
    const scale = enemyScale(this.floorTime, this.partyLevel);
    const damageMult = scale.damageMult * (isElite ? ELITE.damageMult : 1);
    const hp = Math.round(def.hp * scale.hpMult) * (isElite ? ELITE.hpMult : 1);
    const e: Enemy = {
      id: `e${this.nextEnemy++}`, kind, roomId, x, z, facing: 0,
      hp, maxHp: hp, ai: "chase", aiTime: 0, targetKey: null, cooldown: 0,
      loadout, spellTier, stunned: 0, frozen: 0, freezeImmune: 0, elite: isElite, nature, casts: 0, spell: kind, burn: null, slow: null, iceHits: [],
      damageMult,
    };
    this.list.push(e);
    return e;
  }

  /** Sortea si va armado (`ARMED_CHANCE`) y, si lo va, el tier según el reloj del piso. */
  private rollLoadout(kind: EnemyKind): EnemyLoadout | null {
    const armed = ARMED_CHANCE[kind];
    if (!armed || this.rng.next() >= armed.chance) return null;
    return { weaponId: armed.weaponId, tier: rollTier(this.rng, this.floorTime, this.floor), nature: "none" };
  }

  get enemies(): readonly Enemy[] {
    return this.list;
  }

  get projectiles(): readonly Projectile[] {
    return this.shots;
  }

  get hazards(): readonly Hazard[] {
    return this.hazardList;
  }

  activateRooms(players: readonly SimPlayer[], playerCount: number): Enemy[] {
    const created: Enemy[] = [];
    for (const room of this.dungeon.rooms) {
      if (room.kind !== "combat" || this.activated.has(room.id)) continue;
      const inside = players.some(
        (p) =>
          p.alive &&
          tileOf(p.x) >= room.x && tileOf(p.x) < room.x + room.w &&
          tileOf(p.z) >= room.z && tileOf(p.z) < room.z + room.h,
      );
      if (!inside) continue;
      this.activated.add(room.id);

      const n = enemiesForRoom(this.dungeon.floor, playerCount);
      const kinds: EnemyKind[] = [];
      const brutes = Math.ceil(n / 2);
      for (let i = 0; i < brutes; i++) kinds.push("brute");
      for (let i = 0; i < n - brutes; i++) kinds.push(i % 2 === 0 ? "minion" : "mage");
      this.shuffle(kinds);

      const tiles = this.spawnTiles(room, players, n);
      for (let i = 0; i < Math.min(n, tiles.length); i++) {
        const c = tileCenter(tiles[i]!.tx, tiles[i]!.tz);
        created.push(this.createEnemy(this.casterFor(kinds[i]!), room.id, c.x, c.z));
      }
    }
    return created;
  }

  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
  }

  /** Casillas lejos de todo jugador (en orden aleatorio); si faltan, las más lejanas. */
  private spawnTiles(room: Dungeon["rooms"][number], players: readonly SimPlayer[], n: number) {
    const all: { tx: number; tz: number; d: number }[] = [];
    for (let tz = room.z; tz < room.z + room.h; tz++) {
      for (let tx = room.x; tx < room.x + room.w; tx++) {
        if (!isWalkableTile(this.dungeon, tx, tz)) continue;
        let d = Infinity;
        for (const p of players) d = Math.min(d, Math.max(Math.abs(tx - tileOf(p.x)), Math.abs(tz - tileOf(p.z))));
        all.push({ tx, tz, d });
      }
    }
    const ok = all.filter((t) => t.d >= ENEMY_SPAWN_MIN_PLAYER_DIST_TILES);
    this.shuffle(ok);
    if (ok.length >= n) return ok;
    const rest = all.filter((t) => t.d < ENEMY_SPAWN_MIN_PLAYER_DIST_TILES);
    rest.sort((a, b) => b.d - a.d || a.tz - b.tz || a.tx - b.tx);
    return [...ok, ...rest];
  }

  step(players: readonly SimPlayer[], dt: number): EnemyHit[] {
    const hits: EnemyHit[] = [];
    const alive = players.filter((p) => p.alive);
    this.refreshFlow(alive);
    this.clock += dt;

    for (const e of this.list) {
      e.aiTime += dt;
      if (e.ai === "dead") continue;
      this.stepStatus(e, dt);
      // La quemadura pudo matarlo (TS no ve que stepStatus cambia `ai`).
      if ((e.ai as EnemyAi) === "dead") continue;
      e.cooldown = Math.max(0, e.cooldown - dt);
      if (e.frozen > 0) {
        // Congelado: igual que aturdido.
        e.frozen = e.frozen - dt > STUN_EPS ? e.frozen - dt : 0;
        continue;
      }
      if (e.stunned > 0) {
        // Aturdido: el tiempo corre, pero ni se mueve ni ataca.
        e.stunned = e.stunned - dt > STUN_EPS ? e.stunned - dt : 0;
        continue;
      }
      if (this.frozen && e.ai !== "telegraph") continue;
      this.stepEnemy(e, alive, dt, hits);
    }
    this.list = this.list.filter((e) => !(e.ai === "dead" && e.aiTime >= DEAD_LINGER_S));
    this.separate();
    this.stepProjectiles(alive, dt, hits);
    this.stepHazards(alive, dt, hits);
    return hits;
  }

  /** Avanza la quemadura (daño por tick), la ralentización y la inmunidad al congelamiento. */
  private stepStatus(e: Enemy, dt: number): void {
    if (e.freezeImmune > 0) e.freezeImmune = Math.max(0, e.freezeImmune - dt);
    if (e.slow) {
      e.slow.left -= dt;
      if (e.slow.left <= STATUS_EPS) e.slow = null;
    }
    const burn = e.burn;
    if (!burn) return;
    const span = Math.min(dt, burn.left);
    burn.left -= dt;
    if (burn.left <= STATUS_EPS) e.burn = null;
    const amount = burn.dps * span;
    const r = this.damage(e.id, amount);
    this.statusDamage.push({ key: burn.ownerKey, result: { ...r, enemyId: e.id, amount } });
  }

  /** Recalcula el flujo solo si cambió el conjunto de casillas de los jugadores vivos. */
  refreshFlow(alive: readonly SimPlayer[]): void {
    const sources = alive.map((p) => ({ tx: tileOf(p.x), tz: tileOf(p.z) }));
    if (flowSourcesKey(sources) !== this.field.sourcesKey) this.field.rebuild(sources);
  }

  private setAi(e: Enemy, ai: EnemyAi): void {
    e.ai = ai;
    e.aiTime = 0;
  }

  /**
   * Solo sandbox: cada hechicero vivo, sin aturdir y fuera de telegrafía apunta al jugador vivo más cercano
   * y lanza ya su hechizo (con su aviso, igual que al atacar solo).
   */
  castNow(players: readonly SimPlayer[]): void {
    const alive = players.filter((p) => p.alive);
    for (const e of this.list) {
      if (!isCaster(e.kind) || e.ai === "dead" || e.ai === "telegraph" || e.stunned > 0) continue;
      const target = this.nearest(e, alive);
      if (!target) continue;
      e.targetKey = target.key;
      e.cooldown = 0;
      this.startTelegraph(e, target);
    }
  }

  /** Golpe de `e` contra `target`, con la naturaleza y la quemadura de un élite. */
  private hitFrom(e: Enemy, targetKey: string, damage: number, sourceX: number, sourceZ: number): EnemyHit {
    const hit: EnemyHit = { targetKey, damage, sourceId: e.id, sourceX, sourceZ };
    if (e.nature !== "none") {
      hit.nature = e.nature;
      hit.burnDps = ELITE.playerBurnDps * e.damageMult;
    }
    return hit;
  }

  /** Entra en telegrafía; los hechiceros de zona y rayo crean aquí su peligro en aviso. */
  private startTelegraph(e: Enemy, target: SimPlayer): void {
    this.setAi(e, "telegraph");
    // El hechicero élite alterna entre su hechizo y el siguiente; el daño y el tier son siempre los suyos.
    e.spell = e.elite && e.casts % 2 === 1 ? (NEXT_SPELL[e.kind] ?? e.kind) : e.kind;
    e.casts++;
    const damage = Math.round(ENEMY_DEFS[e.kind].damage * e.damageMult);
    const tier = Math.max(1, e.spellTier) as CasterTier;
    const dx = target.x - e.x;
    const dz = target.z - e.z;
    const d = Math.hypot(dx, dz);
    const dirX = d > 0 ? dx / d : Math.sin(e.facing);
    const dirZ = d > 0 ? dz / d : Math.cos(e.facing);
    if (e.spell === "pyromancer") {
      const spell = SPELLS.pyromancer.tiers[tier];
      // Una zona en el objetivo; con tres, otras dos a los lados (perpendicular a mago→objetivo).
      const offsets = spell.count === 3 ? [0, -SPELLS.pyromancer.sideOffsetM, SPELLS.pyromancer.sideOffsetM] : [0];
      for (const off of offsets) {
        this.hazardList.push({
          id: `h${this.nextHazard++}`, kind: "zone", sourceId: e.id,
          x: target.x + dirZ * off, z: target.z - dirX * off, dirX: 0, dirZ: 0, length: 0, size: spell.radius,
          damage, left: SPELLS.pyromancer.fuseS, total: SPELLS.pyromancer.fuseS, phase: "warn", ...this.hazardFx(e),
        });
      }
    } else if (e.spell === "stormcaller") {
      const total = casterTelegraphS(e.spell, e.spellTier);
      this.hazardList.push({
        id: `h${this.nextHazard++}`, kind: "beam", sourceId: e.id, x: e.x, z: e.z, dirX, dirZ,
        length: beamLength(this.dungeon, e.x, e.z, dirX, dirZ, SPELLS.stormcaller.length),
        size: SPELLS.stormcaller.tiers[tier].width, damage, left: total, total, phase: "warn", ...this.hazardFx(e),
      });
    }
  }

  /** Naturaleza y quemadura que un peligro hereda de su lanzador élite. */
  private hazardFx(e: Enemy): Pick<Hazard, "nature" | "burnDps"> {
    return e.nature === "none" ? {} : { nature: e.nature, burnDps: ELITE.playerBurnDps * e.damageMult };
  }

  /** El rayo en aviso del tormentoso pasa a disparo (queda fijo) y golpea una vez a cada jugador en la línea. */
  private fireBeam(e: Enemy, alive: readonly SimPlayer[], hits: EnemyHit[]): void {
    const h = this.hazardList.find((z) => z.kind === "beam" && z.sourceId === e.id && z.phase === "warn");
    if (!h) return;
    h.phase = "fire";
    h.left = h.total = SPELLS.stormcaller.fireS;
    for (const p of alive) {
      if (inBeam(h, p.x, p.z, PLAYER_RADIUS)) hits.push({ targetKey: p.key, damage: h.damage, sourceId: e.id, sourceX: h.x, sourceZ: h.z, ...hazardNature(h) });
    }
  }

  private stepHazards(alive: readonly SimPlayer[], dt: number, hits: EnemyHit[]): void {
    const keep: Hazard[] = [];
    for (const h of this.hazardList) {
      const owner = this.list.find((e) => e.id === h.sourceId);
      if (h.kind === "beam" && h.phase === "warn") {
        // Aviso huérfano (aturdido, muerto o fuera de telegrafía sin disparar): se quita.
        if (!owner || owner.ai !== "telegraph") continue;
        h.x = owner.x;
        h.z = owner.z;
        // Sigue al objetivo durante el primer trackFrac de la preparación; después queda fijo.
        const target = alive.find((p) => p.key === owner.targetKey);
        if (target && h.left > h.total * (1 - SPELLS.stormcaller.trackFrac)) {
          const d = Math.hypot(target.x - h.x, target.z - h.z);
          if (d > 0) {
            h.dirX = (target.x - h.x) / d;
            h.dirZ = (target.z - h.z) / d;
          }
        }
        h.length = beamLength(this.dungeon, h.x, h.z, h.dirX, h.dirZ, SPELLS.stormcaller.length);
      }
      h.left -= dt;
      if (h.left > 0 || (h.kind === "beam" && h.phase === "warn")) {
        keep.push(h);
        continue;
      }
      if (h.kind === "zone") {
        for (const p of alive) {
          if (inZone(h, p.x, p.z, PLAYER_RADIUS)) {
            hits.push({ targetKey: p.key, damage: h.damage, sourceId: h.sourceId, sourceX: h.x, sourceZ: h.z, ...hazardNature(h) });
          }
        }
      }
    }
    this.hazardList = keep;
  }

  private stepEnemy(e: Enemy, alive: readonly SimPlayer[], dt: number, hits: EnemyHit[]): void {
    // Persiguiendo, el objetivo es el jugador más cercano por recorrido (el mismo hacia el que lleva el flujo);
    // durante la telegrafía o la recuperación se mantiene el que tenía.
    let target = e.ai === "chase" || e.ai === "idle" ? this.nearestByPath(e, alive) : undefined;
    target ??= alive.find((p) => p.key === e.targetKey) ?? this.nearest(e, alive);
    e.targetKey = target?.key ?? null;
    if (!target) {
      if (e.ai !== "idle") this.setAi(e, "idle");
      return;
    }
    if (e.ai === "idle") this.setAi(e, "chase");

    const def = ENEMY_DEFS[e.kind];
    const speed = def.speed * (1 - (e.slow?.frac ?? 0));
    const atk = enemyAttack(e.kind, e.loadout);
    const dx = target.x - e.x;
    const dz = target.z - e.z;
    const d = Math.hypot(dx, dz);
    if (e.ai !== "recover" && d > 0) e.facing = Math.atan2(dx, dz);

    if (e.ai === "recover") {
      if (e.cooldown <= 0) this.setAi(e, "chase");
      return;
    }

    if (e.ai === "telegraph") {
      if (e.aiTime < casterTelegraphS(e.spell, e.spellTier)) return;
      if (e.spell === "mage") {
        const dirX = d > 0 ? dx / d : Math.sin(e.facing);
        const dirZ = d > 0 ? dz / d : Math.cos(e.facing);
        const spell = SPELLS.mage.tiers[Math.max(1, e.spellTier) as CasterTier];
        // Abanico centrado en el rumbo, de spreadDeg entre orbes vecinos (1 orbe = recto).
        for (let k = 0; k < spell.count; k++) {
          const a = ((k - (spell.count - 1) / 2) * spell.spreadDeg * Math.PI) / 180;
          const [cos, sin] = [Math.cos(a), Math.sin(a)];
          this.shots.push({
            id: `p${this.nextShot++}`, x: e.x, z: e.z, dirX: dirX * cos + dirZ * sin, dirZ: dirZ * cos - dirX * sin,
            speed: spell.speed, radius: ORB.radius, damage: Math.round(def.damage * e.damageMult),
            life: ORB.lifetimeS, sourceId: e.id, ...(e.nature === "none" ? {} : { nature: e.nature, burnDps: ELITE.playerBurnDps * e.damageMult }),
          });
        }
      } else if (e.spell === "stormcaller") {
        // Sin proyectil: el rayo en preparación pasa a disparo y daña ya a quien está en la línea.
        this.fireBeam(e, alive, hits);
      } else if (def.ranged) {
        // Pirómano: sus zonas se crearon al entrar en la telegrafía y explotan solas.
      } else if (d - PLAYER_RADIUS <= atk.attackRange + MELEE_TOLERANCE) {
        hits.push(this.hitFrom(e, target.key, Math.round(atk.damage * e.damageMult), e.x, e.z));
      }
      e.cooldown = def.cooldownS;
      this.setAi(e, "recover");
      return;
    }

    // chase
    if (def.ranged) {
      // Solo se planta o retrocede si el proyectil pasaría; tras un muro sigue acercándose con la navegación.
      const r = def.ranged.losRadius;
      const los = hasLineOfSight(this.dungeon, e.x, e.z, target.x, target.z, r);
      if (los && d >= def.ranged.preferredMin && d <= def.ranged.preferredMax) {
        if (e.cooldown <= 0) this.startTelegraph(e, target);
        return;
      }
      if (!los) {
        this.chaseMove(e, target, d, speed * dt, def.radius);
        return;
      }
      if (d < def.ranged.preferredMin) {
        // Retrocede en línea recta; si un muro no lo deja o al retroceder perdería la vista, dispara desde ahí
        // (si no, quedaba yendo y viniendo contra la esquina o arrinconado sin disparar nunca).
        const [px, pz] = [e.x, e.z];
        if (d > 0) this.moveEnemy(e, -dx / d, -dz / d, speed * dt, def.radius);
        const moved = Math.hypot(e.x - px, e.z - pz) > 1e-3;
        if (!moved || !hasLineOfSight(this.dungeon, e.x, e.z, target.x, target.z, r)) {
          e.x = px;
          e.z = pz;
          if (e.cooldown <= 0) this.startTelegraph(e, target);
        }
        return;
      }
      this.chaseMove(e, target, d, speed * dt, def.radius);
      return;
    }
    if (d - PLAYER_RADIUS <= atk.attackRange && e.cooldown <= 0) {
      this.startTelegraph(e, target);
      return;
    }
    this.chaseMove(e, target, d, Math.min(speed * dt, d), def.radius);
  }

  /** Con línea de vista va directo al objetivo; sin ella, hacia el centro de la siguiente casilla del flujo. */
  private chaseMove(e: Enemy, target: SimPlayer, d: number, len: number, radius: number): void {
    if (!hasLineOfSight(this.dungeon, e.x, e.z, target.x, target.z, radius)) {
      const next = this.field.next(tileOf(e.x), tileOf(e.z));
      if (next) {
        const c = tileCenter(next.tx, next.tz);
        const nx = c.x - e.x;
        const nz = c.z - e.z;
        const nd = Math.hypot(nx, nz);
        if (nd > 0) {
          this.moveEnemy(e, nx / nd, nz / nd, len, radius);
          return;
        }
      }
    }
    if (d > 0) this.moveEnemy(e, (target.x - e.x) / d, (target.z - e.z) / d, len, radius);
  }

  private moveEnemy(e: Enemy, dirX: number, dirZ: number, len: number, radius: number): void {
    const m = moveCircle(this.dungeon, e.x, e.z, dirX * len, dirZ * len, radius);
    e.x = m.x;
    e.z = m.z;
  }

  /** Jugador vivo en la casilla fuente del flujo que alcanza al enemigo; si hay varios, el más cercano. */
  private nearestByPath(e: Enemy, alive: readonly SimPlayer[]): SimPlayer | undefined {
    const src = this.field.source(tileOf(e.x), tileOf(e.z));
    if (!src) return undefined;
    return this.nearest(e, alive.filter((p) => tileOf(p.x) === src.tx && tileOf(p.z) === src.tz));
  }

  private nearest(e: Enemy, alive: readonly SimPlayer[]): SimPlayer | undefined {
    let best: SimPlayer | undefined;
    let bestD = Infinity;
    for (const p of alive) {
      const d = (p.x - e.x) ** 2 + (p.z - e.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private separate(): void {
    const live = this.list.filter((e) => e.ai !== "dead");
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]!;
        const b = live[j]!;
        const ra = ENEMY_DEFS[a.kind].radius;
        const rb = ENEMY_DEFS[b.kind].radius;
        if (!circlesOverlap({ x: a.x, z: a.z, radius: ra }, { x: b.x, z: b.z, radius: rb })) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const nx = d > 0 ? dx / d : 1;
        const nz = d > 0 ? dz / d : 0;
        const push = (ra + rb - d) / 2 + SEPARATION_EPS;
        this.moveEnemy(a, -nx, -nz, push, ra);
        this.moveEnemy(b, nx, nz, push, rb);
      }
    }
  }

  private stepProjectiles(alive: readonly SimPlayer[], dt: number, hits: EnemyHit[]): void {
    const keep: Projectile[] = [];
    for (const p of this.shots) {
      p.x += p.dirX * p.speed * dt;
      p.z += p.dirZ * p.speed * dt;
      p.life -= dt;
      if (!isWalkableTile(this.dungeon, tileOf(p.x), tileOf(p.z))) continue;
      const victim = alive.find((pl) => circlesOverlap(p, { x: pl.x, z: pl.z, radius: PLAYER_RADIUS }));
      if (victim) {
        hits.push({ targetKey: victim.key, damage: p.damage, sourceId: p.sourceId, sourceX: p.x, sourceZ: p.z, ...hazardNature(p) });
        continue;
      }
      if (p.life > 0) keep.push(p);
    }
    this.shots = keep;
  }

  /**
   * Aturde `s` segundos (se queda el mayor si ya lo estaba) y cancela su telegrafía. Los muertos, los élites y los
   * `stunImmune` no se aturden.
   */
  stun(enemyId: string, s: number): void {
    const e = this.list.find((x) => x.id === enemyId);
    if (!e || e.ai === "dead" || e.elite || ENEMY_DEFS[e.kind].stunImmune) return;
    e.stunned = Math.max(e.stunned, s);
    if (e.ai === "telegraph") this.setAi(e, "chase");
  }

  /** Congela `s` segundos y cancela su telegrafía; no afecta a muertos, élites ni `stunImmune`. */
  private freeze(e: Enemy, s: number): void {
    if (e.ai === "dead" || e.elite || ENEMY_DEFS[e.kind].stunImmune) return;
    e.frozen = Math.max(e.frozen, s);
    // La inmunidad cuenta desde que se descongela: dura lo congelado más freezeImmuneS.
    e.freezeImmune = e.frozen + NATURE.freezeImmuneS;
    e.iceHits = [];
    if (e.ai === "telegraph") this.setAi(e, "chase");
  }

  /**
   * Golpe de un jugador: daño más el efecto de la naturaleza de su arma sobre el golpeado (fuego quema, hielo
   * ralentiza y congela, rayo salta a vecinos). El primer resultado es el golpeado; los demás, los encadenados.
   */
  strike(enemyId: string, amount: number, src: StrikeSource): StrikeResult[] {
    const e = this.list.find((x) => x.id === enemyId);
    const fx = natureEffects(src.nature, src.affinity);
    // Se sortea antes del daño para que el orden de la RNG no dependa de si hay arma que soltar.
    const chain = fx.chainChance > 0 && this.rng.next() < fx.chainChance;
    const r = this.damage(enemyId, amount);
    const out: StrikeResult[] = [{ ...r, enemyId, amount }];
    if (!e) return out;
    if (e.ai !== "dead") {
      if (fx.burnFrac > 0) {
        const dps = amount * fx.burnFrac;
        if (!e.burn || dps >= e.burn.dps) e.burn = { left: NATURE.burnS, dps, ownerKey: src.key };
        else e.burn.left = NATURE.burnS;
      }
      if (fx.slowFrac > 0) {
        e.slow = { left: NATURE.slowS, frac: Math.max(fx.slowFrac, e.slow?.frac ?? 0) };
        this.countIceHit(e);
      }
    }
    if (chain) {
      const points: [number, number][] = [[r.x, r.z]];
      const near = this.list
        .filter((x) => x !== e && x.ai !== "dead" && Math.hypot(x.x - r.x, x.z - r.z) <= NATURE.chainRangeM)
        .sort((a, b) => Math.hypot(a.x - r.x, a.z - r.z) - Math.hypot(b.x - r.x, b.z - r.z))
        .slice(0, NATURE.chainTargets);
      for (const n of near) {
        const dmg = Math.round(amount * NATURE.chainFrac);
        out.push({ ...this.damage(n.id, dmg), enemyId: n.id, amount: dmg });
        points.push([n.x, n.z]);
      }
      if (near.length > 0) this.chains.push({ points });
    }
    return out;
  }

  /** Cuenta un golpe de hielo; a los `freezeHits` dentro de `freezeWindowS` lo congela (si no es inmune). */
  private countIceHit(e: Enemy): void {
    if (e.freezeImmune > 0 || e.elite || ENEMY_DEFS[e.kind].stunImmune) return;
    e.iceHits.push(this.clock);
    e.iceHits = e.iceHits.filter((t) => this.clock - t <= NATURE.freezeWindowS + STATUS_EPS);
    if (e.iceHits.length >= NATURE.freezeHits) this.freeze(e, NATURE.freezeS);
  }

  /** Daño y muertes por quemadura desde la última llamada. */
  takeStatusDamage(): { key: string; result: StrikeResult }[] {
    return this.statusDamage.splice(0);
  }

  /** Cadenas del rayo desde la última llamada (para el evento `chain`). */
  takeChains(): { points: [number, number][] }[] {
    return this.chains.splice(0);
  }

  /** Empuja `m` metros en la dirección (dirX, dirZ) contra los muros. */
  knockback(enemyId: string, dirX: number, dirZ: number, m: number): void {
    const e = this.list.find((x) => x.id === enemyId);
    const len = Math.hypot(dirX, dirZ);
    if (!e || e.ai === "dead" || len === 0) return;
    this.moveEnemy(e, dirX / len, dirZ / len, m, ENEMY_DEFS[e.kind].radius);
  }

  /** Si el id no existe devuelve x: 0, z: 0: el llamador solo debe usar la posición cuando `killed`. */
  damage(enemyId: string, amount: number): EnemyDamageResult {
    const e = this.list.find((x) => x.id === enemyId);
    if (!e || e.ai === "dead") return { killed: false, xp: 0, x: e?.x ?? 0, z: e?.z ?? 0, drop: null };
    e.hp = Math.max(0, e.hp - amount);
    if (e.hp > 0) return { killed: false, xp: 0, x: e.x, z: e.z, drop: null };
    this.setAi(e, "dead");
    e.burn = null;
    e.frozen = 0;
    e.slow = null;
    e.iceHits = [];
    e.freezeImmune = 0;
    return { killed: true, xp: ENEMY_DEFS[e.kind].xp * (e.elite ? ELITE.xpMult : 1), x: e.x, z: e.z, drop: this.rollDrop(e) };
  }

  /**
   * Arma que suelta al morir. El élite la suelta con `ELITE.dropChance`, un tier más (hasta 4) y su naturaleza;
   * el hechicero, que no lleva arma, trae una al azar. Los demás armados, con `TIERS[tier].dropChance`.
   */
  private rollDrop(e: Enemy): EnemyLoadout | null {
    if (!e.elite) return e.loadout && this.rng.next() < TIERS[e.loadout.tier].dropChance ? { ...e.loadout } : null;
    if (this.rng.next() >= ELITE.dropChance) return null;
    const weaponId = e.loadout?.weaponId ?? this.rng.pick(Object.keys(WEAPONS) as WeaponId[]);
    const tier = Math.min(4, (e.loadout?.tier ?? e.spellTier) + 1) as WeaponTier;
    return { weaponId, tier, nature: e.nature };
  }
}
