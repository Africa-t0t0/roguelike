import {
  ENEMY_DEFS,
  ENEMY_SPAWN_MIN_PLAYER_DIST_TILES,
  PLAYER_RADIUS,
  TILE_SIZE,
  circlesOverlap,
  enemiesForRoom,
  isWalkableTile,
  moveCircle,
  tileCenter,
  type Dungeon,
  type EnemyKind,
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

  constructor(
    private readonly dungeon: Dungeon,
    private readonly rng: Rng,
  ) {}

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
        const kind = kinds[i]!;
        const def = ENEMY_DEFS[kind];
        const e: Enemy = {
          id: `e${this.nextEnemy++}`, kind, roomId: room.id, x: c.x, z: c.z, facing: 0,
          hp: def.hp, maxHp: def.hp, ai: "chase", aiTime: 0, targetKey: null, cooldown: 0,
        };
        this.list.push(e);
        created.push(e);
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

  private setAi(e: Enemy, ai: EnemyAi): void {
    e.ai = ai;
    e.aiTime = 0;
  }

  private stepEnemy(e: Enemy, alive: readonly SimPlayer[], dt: number, hits: EnemyHit[]): void {
    let target = alive.find((p) => p.key === e.targetKey);
    if (!target) {
      target = this.nearest(e, alive);
      e.targetKey = target?.key ?? null;
    }
    if (!target) {
      if (e.ai !== "idle") this.setAi(e, "idle");
      return;
    }
    if (e.ai === "idle") this.setAi(e, "chase");

    const def = ENEMY_DEFS[e.kind];
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
      } else if (d - PLAYER_RADIUS <= def.attackRange + MELEE_TOLERANCE) {
        hits.push({ targetKey: target.key, damage: def.damage, sourceId: e.id });
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
      const sign = d < def.ranged.preferredMin ? -1 : 1;
      if (d > 0) this.moveEnemy(e, (sign * dx) / d, (sign * dz) / d, def.speed * dt, def.radius);
      return;
    }
    if (d - PLAYER_RADIUS <= def.attackRange && e.cooldown <= 0) {
      this.setAi(e, "telegraph");
      return;
    }
    if (d > 0) this.moveEnemy(e, dx / d, dz / d, Math.min(def.speed * dt, d), def.radius);
  }

  private moveEnemy(e: Enemy, dirX: number, dirZ: number, len: number, radius: number): void {
    const m = moveCircle(this.dungeon, e.x, e.z, dirX * len, dirZ * len, radius);
    e.x = m.x;
    e.z = m.z;
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

  damage(enemyId: string, amount: number): { killed: boolean; xp: number } {
    const e = this.list.find((x) => x.id === enemyId);
    if (!e || e.ai === "dead") return { killed: false, xp: 0 };
    e.hp = Math.max(0, e.hp - amount);
    if (e.hp > 0) return { killed: false, xp: 0 };
    this.setAi(e, "dead");
    return { killed: true, xp: ENEMY_DEFS[e.kind].xp };
  }
}
