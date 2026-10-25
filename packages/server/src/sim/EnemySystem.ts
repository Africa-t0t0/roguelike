import {
  ARMED_CHANCE,
  ENEMY_DEFS,
  ENEMY_SPAWN_MIN_PLAYER_DIST_TILES,
  FlowField,
  PLAYER_RADIUS,
  TIERS,
  TILE_SIZE,
  circlesOverlap,
  enemiesForRoom,
  enemyAttack,
  flowSourcesKey,
  hasLineOfSight,
  isWalkableTile,
  moveCircle,
  rollTier,
  tileCenter,
  type Dungeon,
  type EnemyKind,
  type EnemyLoadout,
  type Rng,
} from "@roguelike/shared";

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
}

/** Solo jugadores conectados. */
export interface SimPlayer {
  key: string;
  x: number;
  z: number;
  alive: boolean;
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

export interface EnemyHit {
  targetKey: string;
  damage: number;
  sourceId: string;
}

const MELEE_TOLERANCE = 0.3;
const DEAD_LINGER_S = 2;
const SEPARATION_EPS = 1e-4;

function tileOf(v: number): number {
  return Math.floor(v / TILE_SIZE);
}

export class EnemySystem {
  private list: Enemy[] = [];
  private shots: Projectile[] = [];
  private activated = new Set<number>();
  private nextEnemy = 1;
  private nextShot = 1;
  private readonly field: FlowField;
  private floorTime = 0;
  private floor: number;

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

  /** Reloj del piso con el que se sortean los tiers de los enemigos que se creen después. */
  setFloorClock(floorTime: number, floor: number): void {
    this.floorTime = floorTime;
    this.floor = floor;
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
      const e = this.createEnemy(kinds[i % kinds.length]!, -1, spots[i]!.x, spots[i]!.z);
      created.push(e);
    }
    return created;
  }

  private createEnemy(kind: EnemyKind, roomId: number, x: number, z: number): Enemy {
    const def = ENEMY_DEFS[kind];
    const e: Enemy = {
      id: `e${this.nextEnemy++}`, kind, roomId, x, z, facing: 0,
      hp: def.hp, maxHp: def.hp, ai: "chase", aiTime: 0, targetKey: null, cooldown: 0,
      loadout: this.rollLoadout(kind),
    };
    this.list.push(e);
    return e;
  }

  /** Sortea si va armado (`ARMED_CHANCE`) y, si lo va, el tier según el reloj del piso. */
  private rollLoadout(kind: EnemyKind): EnemyLoadout | null {
    const armed = ARMED_CHANCE[kind];
    if (!armed || this.rng.next() >= armed.chance) return null;
    return { weaponId: armed.weaponId, tier: rollTier(this.rng, this.floorTime, this.floor) };
  }

  get enemies(): readonly Enemy[] {
    return this.list;
  }

  get projectiles(): readonly Projectile[] {
    return this.shots;
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
        created.push(this.createEnemy(kinds[i]!, room.id, c.x, c.z));
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

    for (const e of this.list) {
      e.aiTime += dt;
      if (e.ai === "dead") continue;
      e.cooldown = Math.max(0, e.cooldown - dt);
      this.stepEnemy(e, alive, dt, hits);
    }
    this.list = this.list.filter((e) => !(e.ai === "dead" && e.aiTime >= DEAD_LINGER_S));
    this.separate();
    this.stepProjectiles(alive, dt, hits);
    return hits;
  }

  /** Recalcula el flujo solo si cambió el conjunto de casillas de los jugadores vivos. */
  private refreshFlow(alive: readonly SimPlayer[]): void {
    const sources = alive.map((p) => ({ tx: tileOf(p.x), tz: tileOf(p.z) }));
    if (flowSourcesKey(sources) !== this.field.sourcesKey) this.field.rebuild(sources);
  }

  private setAi(e: Enemy, ai: EnemyAi): void {
    e.ai = ai;
    e.aiTime = 0;
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
      if (e.aiTime < def.telegraphS) return;
      if (def.ranged) {
        const dirX = d > 0 ? dx / d : Math.sin(e.facing);
        const dirZ = d > 0 ? dz / d : Math.cos(e.facing);
        this.shots.push({
          id: `p${this.nextShot++}`, x: e.x, z: e.z, dirX, dirZ, speed: def.ranged.projectileSpeed,
          radius: def.ranged.projectileRadius, damage: def.damage, life: def.ranged.lifetimeS, sourceId: e.id,
        });
      } else if (d - PLAYER_RADIUS <= atk.attackRange + MELEE_TOLERANCE) {
        hits.push({ targetKey: target.key, damage: atk.damage, sourceId: e.id });
      }
      e.cooldown = def.cooldownS;
      this.setAi(e, "recover");
      return;
    }

    // chase
    if (def.ranged) {
      if (d >= def.ranged.preferredMin && d <= def.ranged.preferredMax) {
        if (e.cooldown <= 0) this.setAi(e, "telegraph");
        return;
      }
      // retrocede en línea recta, como siempre; para acercarse usa la navegación
      if (d < def.ranged.preferredMin) {
        if (d > 0) this.moveEnemy(e, -dx / d, -dz / d, def.speed * dt, def.radius);
      } else {
        this.chaseMove(e, target, d, def.speed * dt, def.radius);
      }
      return;
    }
    if (d - PLAYER_RADIUS <= atk.attackRange && e.cooldown <= 0) {
      this.setAi(e, "telegraph");
      return;
    }
    this.chaseMove(e, target, d, Math.min(def.speed * dt, d), def.radius);
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
        hits.push({ targetKey: victim.key, damage: p.damage, sourceId: p.sourceId });
        continue;
      }
      if (p.life > 0) keep.push(p);
    }
    this.shots = keep;
  }

  /** Si el id no existe devuelve x: 0, z: 0: el llamador solo debe usar la posición cuando `killed`. */
  damage(enemyId: string, amount: number): EnemyDamageResult {
    const e = this.list.find((x) => x.id === enemyId);
    if (!e || e.ai === "dead") return { killed: false, xp: 0, x: e?.x ?? 0, z: e?.z ?? 0, drop: null };
    e.hp = Math.max(0, e.hp - amount);
    if (e.hp > 0) return { killed: false, xp: 0, x: e.x, z: e.z, drop: null };
    this.setAi(e, "dead");
    // solo los armados sortean soltar su arma
    const drop = e.loadout && this.rng.next() < TIERS[e.loadout.tier].dropChance ? { ...e.loadout } : null;
    return { killed: true, xp: ENEMY_DEFS[e.kind].xp, x: e.x, z: e.z, drop };
  }
}
