import { describe, expect, it, vi } from "vitest";
import {
  ENEMY_DEFS,
  PLAYER_RADIUS,
  enemyAttack,
  ENEMY_SPAWN_MIN_PLAYER_DIST_TILES,
  SIM_DT,
  TILE_SIZE,
  circlesOverlap,
  createRng,
  generateDungeon,
  hasLineOfSight,
  isWalkableTile,
  type Dungeon,
  type EnemyKind,
  type EnemyLoadout,
} from "@roguelike/shared";
import { EnemySystem, type Enemy, type EnemyHit, type SimPlayer } from "../src/sim/EnemySystem";

/** Mapa a mano: sala de inicio, sala de combate grande (tiles 8..19) y sala de jefe; todo suelo. */
function arena(): Dungeon {
  const width = 30;
  const tiles = new Uint8Array(width * width);
  const rooms = [
    { id: 0, x: 1, z: 1, w: 3, h: 3, kind: "start" as const, neighbors: [1] },
    { id: 1, x: 8, z: 8, w: 12, h: 12, kind: "combat" as const, neighbors: [0, 2] },
    { id: 2, x: 24, z: 24, w: 4, h: 4, kind: "boss" as const, neighbors: [1] },
  ];
  for (const r of rooms) {
    for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) tiles[z * width + x] = 1;
  }
  return { seed: 1, floor: 1, width, height: width, tiles, rooms, startRoomId: 0, bossRoomId: 2 };
}

const P = (key: string, x: number, z: number, alive = true): SimPlayer => ({ key, x, z, alive });
const IN_ROOM = { x: 18, z: 18 }; // dentro de la sala de combate de arena()

/** Crea un único enemigo del tipo dado; los demás quedan "muertos" para siempre. */
function setup(kind: EnemyKind, x: number, z: number, d = arena()) {
  const sys = new EnemySystem(d, createRng(7));
  const created = sys.activateRooms([P("a", 38, 38)], 4);
  const e = created[0]!;
  for (const other of created.slice(1)) {
    sys.damage(other.id, 9999);
    other.aiTime = -1e9;
  }
  e.kind = kind;
  e.loadout = null;
  e.hp = e.maxHp = ENEMY_DEFS[kind].hp;
  e.x = x;
  e.z = z;
  return { sys, e };
}

function run(sys: EnemySystem, players: SimPlayer[], steps: number): EnemyHit[] {
  const hits: EnemyHit[] = [];
  for (let i = 0; i < steps; i++) hits.push(...sys.step(players, SIM_DT));
  return hits;
}
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe("activación", () => {
  it("devuelve [] fuera de salas de combate y 4 enemigos válidos al entrar", () => {
    const d = generateDungeon(123, 1);
    const room = d.rooms.find((r) => r.kind === "combat")!;
    const sys = new EnemySystem(d, createRng(5));
    expect(sys.activateRooms([P("a", 0.1, 0.1)], 1)).toEqual([]);
    // esquina de la sala
    const tx = room.x;
    const tz = room.z;
    expect(isWalkableTile(d, tx, tz)).toBe(true);
    const pl = P("a", (tx + 0.5) * TILE_SIZE, (tz + 0.5) * TILE_SIZE);
    const made = sys.activateRooms([pl], 1);
    expect(made).toHaveLength(4);
    const seen = new Set<string>();
    for (const e of made) {
      const etx = Math.floor(e.x / TILE_SIZE);
      const etz = Math.floor(e.z / TILE_SIZE);
      expect(isWalkableTile(d, etx, etz)).toBe(true);
      expect(etx >= room.x && etx < room.x + room.w && etz >= room.z && etz < room.z + room.h).toBe(true);
      expect(Math.max(Math.abs(etx - tx), Math.abs(etz - tz))).toBeGreaterThanOrEqual(ENEMY_SPAWN_MIN_PLAYER_DIST_TILES);
      expect(e.x).toBe((etx + 0.5) * TILE_SIZE);
      seen.add(`${etx},${etz}`);
      expect(e.ai).toBe("chase");
    }
    expect(seen.size).toBe(4);
    expect(made.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(made.filter((e) => e.kind === "brute")).toHaveLength(2);
    expect(sys.activateRooms([pl], 1)).toEqual([]);
  });

  it("start y boss nunca generan enemigos", () => {
    const d = arena();
    const sys = new EnemySystem(d, createRng(1));
    expect(sys.activateRooms([P("a", 5, 5), P("b", 50, 50)], 2)).toEqual([]);
    expect(sys.enemies).toHaveLength(0);
  });

  it("un jugador muerto no activa la sala", () => {
    const sys = new EnemySystem(arena(), createRng(1));
    expect(sys.activateRooms([P("a", IN_ROOM.x, IN_ROOM.z, false)], 1)).toEqual([]);
  });

  it("es determinista con la misma semilla", () => {
    const a = new EnemySystem(arena(), createRng(9)).activateRooms([P("a", 18, 18)], 2);
    const b = new EnemySystem(arena(), createRng(9)).activateRooms([P("a", 18, 18)], 2);
    expect(a).toEqual(b);
  });
});

describe("cuerpo a cuerpo", () => {
  it("un brute se acerca, telegrafía a 1 m y golpea una sola vez por ciclo", () => {
    const { sys, e } = setup("brute", 30, 30);
    const pl = [P("a", 35, 30)];
    const d0 = dist(e, pl[0]!);
    run(sys, pl, 10);
    expect(dist(e, pl[0]!)).toBeLessThan(d0);

    const s2 = setup("brute", 30, 30);
    const p2 = [P("a", 31, 30)];
    s2.sys.step(p2, SIM_DT);
    expect(s2.e.ai).toBe("telegraph");
    expect(s2.e.facing).toBeCloseTo(Math.PI / 2);
    const def = ENEMY_DEFS.brute;
    const tele = Math.ceil(def.telegraphS / SIM_DT) + 1;
    const hits = run(s2.sys, p2, tele);
    expect(hits).toEqual([{ targetKey: "a", damage: 12, sourceId: s2.e.id }]);
    expect(s2.e.ai).toBe("recover");
    // nada más antes de que acabe el enfriamiento
    expect(run(s2.sys, p2, Math.floor(def.cooldownS / SIM_DT) - 2)).toEqual([]);
  });

  it("si el jugador se aleja durante la telegrafía no hay golpe", () => {
    const { sys, e } = setup("brute", 30, 30);
    const pl = [P("a", 31, 30)];
    sys.step(pl, SIM_DT);
    expect(e.ai).toBe("telegraph");
    pl[0]!.x = 34;
    const hits = run(sys, pl, 25);
    expect(hits).toEqual([]);
    expect(e.ai).toBe("recover");
  });
});

describe("mago", () => {
  it("retrocede a 3 m y se acerca a 15 m", () => {
    const near = setup("mage", 30, 30);
    const p1 = [P("a", 33, 30)];
    run(near.sys, p1, 10);
    expect(dist(near.e, p1[0]!)).toBeGreaterThan(3);
    const far = setup("mage", 30, 30);
    const p2 = [P("a", 45, 30)];
    run(far.sys, p2, 10);
    expect(dist(far.e, p2[0]!)).toBeLessThan(15);
  });

  it("dispara y el proyectil golpea a un jugador quieto", () => {
    const { sys, e } = setup("mage", 28, 31);
    const pl = [P("a", 20, 31)];
    const hits = run(sys, pl, 90);
    expect(hits).toEqual([{ targetKey: "a", damage: 10, sourceId: e.id }]);
    expect(sys.projectiles).toHaveLength(0);
  });

  it("arrinconado contra un muro con el jugador encima, no puede retroceder y dispara", () => {
    const { sys, e } = setup("mage", 16.6, 30);
    const pl = [P("a", 19.6, 30)];
    const hits = run(sys, pl, 60);
    expect(hits).toEqual([{ targetKey: "a", damage: 10, sourceId: e.id }]);
  });

  it("un proyectil contra un muro desaparece sin golpear", () => {
    const d = arena();
    d.tiles[15 * d.width + 11] = 0; // pilar en x 22..24, z 30..32
    const { sys, e } = setup("mage", 28, 31, d);
    // Empieza a telegrafiar viendo al jugador; durante la telegrafía este se esconde tras el pilar.
    const pl = [P("a", 20, 26)];
    let sawProjectile = false;
    const hits: EnemyHit[] = [];
    for (let i = 0; i < 60; i++) {
      hits.push(...sys.step(pl, SIM_DT));
      if (sys.projectiles.length > 0) sawProjectile = true;
      if (e.ai === "telegraph") Object.assign(pl[0]!, { x: 18.5, z: 31 });
      if (i === 0) e.cooldown = 99; // un solo disparo
    }
    expect(sawProjectile).toBe(true);
    expect(hits).toEqual([]);
    expect(sys.projectiles).toHaveLength(0);
  });
});

describe("separación y objetivos", () => {
  it("dos enemigos superpuestos se separan sin entrar en muros", () => {
    const d = arena();
    const sys = new EnemySystem(d, createRng(3));
    const [a, b] = sys.activateRooms([P("a", 38, 38)], 4) as [Enemy, Enemy];
    // junto al muro oeste de la sala (x = 16)
    a.x = 17.2; a.z = 20; b.x = 17.3; b.z = 20;
    const pl = [P("a", 38, 38)];
    a.kind = b.kind = "minion";
    sys.step(pl, SIM_DT);
    for (const e of sys.enemies) {
      const r = ENEMY_DEFS[e.kind].radius;
      expect(isWalkableTile(d, Math.floor((e.x - r) / TILE_SIZE), Math.floor(e.z / TILE_SIZE))).toBe(true);
    }
    expect(
      circlesOverlap(
        { x: a.x, z: a.z, radius: ENEMY_DEFS[a.kind].radius },
        { x: b.x, z: b.z, radius: ENEMY_DEFS[b.kind].radius },
      ),
    ).toBe(false);
  });

  it("cambia de objetivo si desaparece y queda idle sin jugadores", () => {
    const { sys, e } = setup("brute", 30, 30);
    sys.step([P("a", 33, 30), P("b", 40, 30)], SIM_DT);
    expect(e.targetKey).toBe("a");
    sys.step([P("b", 40, 30)], SIM_DT);
    expect(e.targetKey).toBe("b");
    sys.step([P("b", 40, 30, false)], SIM_DT);
    expect(e.ai).toBe("idle");
    const before = { x: e.x, z: e.z };
    expect(sys.step([], SIM_DT)).toEqual([]);
    expect(sys.enemies.every((x) => x.ai === "idle" || x.ai === "dead")).toBe(true);
    expect({ x: e.x, z: e.z }).toEqual(before);
    // vuelve a la vida si aparece alguien
    sys.step([P("c", 33, 30)], SIM_DT);
    expect(e.targetKey).toBe("c");
  });
});

describe("daño", () => {
  it("mata una sola vez, no golpea muerto y desaparece tras 2 s", () => {
    const { sys, e } = setup("minion", 30, 30);
    expect(sys.damage("nope", 5)).toMatchObject({ killed: false, xp: 0, drop: null });
    expect(sys.damage(e.id, 5)).toMatchObject({ killed: false, xp: 0, drop: null });
    expect(sys.damage(e.id, 999)).toEqual({ killed: true, xp: ENEMY_DEFS.minion.xp, x: 30, z: 30, drop: null });
    expect(e.ai).toBe("dead");
    expect(sys.damage(e.id, 999)).toMatchObject({ killed: false, xp: 0, drop: null });
    const pl = [P("a", 30.5, 30)];
    expect(run(sys, pl, 30)).toEqual([]);
    expect(sys.enemies).toContain(e);
    run(sys, pl, 45);
    expect(sys.enemies).not.toContain(e);
  });
});

/** Mapa en "L" de 20x20 (igual que en shared/test/nav.test.ts): sala A (1..5,1..5), pasillo horizontal
 *  z=3 (x 6..14), pasillo vertical x=14 (z 4..12) y sala B (12..16,13..17). */
function lDungeon(): Dungeon {
  const width = 20;
  const height = 20;
  const tiles = new Uint8Array(width * height);
  const fill = (x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) tiles[z * width + x] = 1;
  };
  fill(1, 1, 5, 5);
  fill(6, 3, 14, 3);
  fill(14, 4, 14, 12);
  fill(12, 13, 16, 17);
  return { seed: 0, floor: 1, width, height, tiles, rooms: [], startRoomId: 0, bossRoomId: 0 };
}

const center = (tx: number, tz: number) => ({ x: (tx + 0.5) * TILE_SIZE, z: (tz + 0.5) * TILE_SIZE });

describe("armas de los enemigos", () => {
  it("el 60 % de los esbirros va armado con espada de guardia; los magos nunca", () => {
    const sys = new EnemySystem(arena(), createRng(11));
    const spots = Array.from({ length: 500 }, () => IN_ROOM);
    const minions = sys.spawnWave(spots, ["minion"]);
    expect(minions).toHaveLength(500);
    const armed = minions.filter((e) => e.loadout !== null);
    expect(armed.every((e) => e.loadout!.weaponId === "guard-sword")).toBe(true);
    expect(Math.abs(armed.length / 500 - 0.6)).toBeLessThanOrEqual(0.06);
    const mages = sys.spawnWave(spots.slice(0, 200), ["mage"]);
    expect(mages.every((e) => e.loadout === null)).toBe(true);
  });

  it("con setFloorClock(0, 1) todos los armados son tier 1; más tarde aparecen tiers altos", () => {
    const sys = new EnemySystem(arena(), createRng(4));
    sys.setFloorClock(0, 1);
    const early = sys.spawnWave(Array.from({ length: 300 }, () => IN_ROOM), ["minion", "brute"]);
    const earlyArmed = early.filter((e) => e.loadout);
    expect(earlyArmed.length).toBeGreaterThan(0);
    expect(earlyArmed.every((e) => e.loadout!.tier === 1)).toBe(true);
    sys.setFloorClock(300, 1);
    const late = sys.spawnWave(Array.from({ length: 300 }, () => IN_ROOM), ["brute"]);
    expect(late.filter((e) => e.loadout).every((e) => e.loadout!.weaponId === "great-sword")).toBe(true);
    expect(late.some((e) => e.loadout?.tier === 3)).toBe(true);
  });

  it("un bruto con mandoble templado golpea por 23 desde 2,2 m", () => {
    const { sys, e } = setup("brute", 30, 30);
    e.loadout = { weaponId: "great-sword", tier: 2 };
    const pl = [P("a", 32.2, 30)];
    sys.step(pl, SIM_DT);
    expect(e.ai).toBe("telegraph");
    const hits = run(sys, pl, Math.ceil(ENEMY_DEFS.brute.telegraphS / SIM_DT) + 1);
    expect(hits).toEqual([{ targetKey: "a", damage: 23, sourceId: e.id }]);
    expect(e.x).toBe(30);
  });

  it("los enemigos de sala también sortean su loadout", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const made = new EnemySystem(arena(), createRng(seed)).activateRooms([P("a", IN_ROOM.x, IN_ROOM.z)], 4);
      for (const e of made) {
        if (e.kind === "mage") expect(e.loadout).toBeNull();
        else if (e.loadout) expect(e.loadout.weaponId).toBe(e.kind === "brute" ? "great-sword" : "guard-sword");
        seen.add(e.loadout ? "armed" : "bare");
      }
    }
    expect(seen).toEqual(new Set(["armed", "bare"]));
  });
});

describe("oleadas", () => {
  it("spawnWave crea uno por spot, cicla los tipos, en chase y con roomId -1", () => {
    const sys = new EnemySystem(arena(), createRng(2));
    const spots = [{ x: 18, z: 18 }, { x: 20, z: 18 }, { x: 22, z: 18 }];
    const made = sys.spawnWave(spots, ["minion", "brute"]);
    expect(made.map((e) => e.kind)).toEqual(["minion", "brute", "minion"]);
    for (const [i, e] of made.entries()) {
      expect(e.ai).toBe("chase");
      expect(e.roomId).toBe(-1);
      expect({ x: e.x, z: e.z }).toEqual(spots[i]);
      expect(e.hp).toBe(ENEMY_DEFS[e.kind].hp);
    }
    expect(sys.enemies).toHaveLength(3);
  });

  it("liveCount no cuenta a los que están muriendo", () => {
    const sys = new EnemySystem(arena(), createRng(2));
    const made = sys.spawnWave([IN_ROOM, IN_ROOM, IN_ROOM], ["minion"]);
    expect(sys.liveCount()).toBe(3);
    sys.damage(made[0]!.id, 9999);
    expect(sys.enemies).toHaveLength(3);
    expect(sys.liveCount()).toBe(2);
  });
});

describe("botín", () => {
  it("al morir un armado devuelve su posición, la XP y a veces suelta su arma", () => {
    const loadout: EnemyLoadout = { weaponId: "guard-sword", tier: 1 };
    let drops = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const sys = new EnemySystem(arena(), createRng(seed));
      const [e] = sys.spawnWave([{ x: 19, z: 21 }], ["minion"]);
      e!.loadout = { ...loadout };
      expect(sys.damage(e!.id, 5).drop).toBeNull();
      const r = sys.damage(e!.id, 999);
      expect(r).toMatchObject({ killed: true, xp: ENEMY_DEFS.minion.xp, x: 19, z: 21 });
      if (r.drop) {
        expect(r.drop).toEqual(loadout);
        drops++;
      }
    }
    // dropChance 0.10 sobre 200 muertes
    expect(drops).toBeGreaterThanOrEqual(8);
    expect(drops).toBeLessThanOrEqual(35);
  });

  it("un desarmado nunca suelta nada", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const sys = new EnemySystem(arena(), createRng(seed));
      const [e] = sys.spawnWave([IN_ROOM], ["brute"]);
      e!.loadout = null;
      expect(sys.damage(e!.id, 9999)).toMatchObject({ killed: true, drop: null });
    }
  });
});

describe("navegación", () => {
  for (const kind of ["minion", "brute"] as const) {
    it(`un ${kind} de oleada rodea las paredes de la L hasta alcanzar al jugador sin meterse en muros`, () => {
      const d = lDungeon();
      const sys = new EnemySystem(d, createRng(1));
      const [e] = sys.spawnWave([center(14, 16)], [kind]);
      e!.loadout = null;
      const pl = [P("a", center(2, 3).x, center(2, 3).z)];
      const range = enemyAttack(kind, null).attackRange;
      let reached = false;
      for (let i = 0; i < 30 / SIM_DT && !reached; i++) {
        sys.step(pl, SIM_DT);
        expect(isWalkableTile(d, Math.floor(e!.x / TILE_SIZE), Math.floor(e!.z / TILE_SIZE))).toBe(true);
        if (e!.ai === "telegraph") {
          expect(dist(e!, pl[0]!) - PLAYER_RADIUS).toBeLessThanOrEqual(range);
          reached = true;
        }
      }
      expect(reached).toBe(true);
    });
  }

  it("un mago de oleada rodea la L y solo telegrafía con línea de vista, hasta acertar al jugador", () => {
    const d = lDungeon();
    const sys = new EnemySystem(d, createRng(1));
    // Bajando por el pasillo vertical entra en su banda de 6-10 m con el muro de por medio.
    const [e] = sys.spawnWave([center(2, 3)], ["mage"]);
    const pl = [P("a", center(12, 13).x, center(12, 13).z)];
    const shotR = ENEMY_DEFS.mage.ranged!.projectileRadius;
    let hit = false;
    for (let i = 0; i < 30 / SIM_DT && !hit; i++) {
      const before = e!.ai;
      hit = sys.step(pl, SIM_DT).some((h) => h.targetKey === "a" && h.sourceId === e!.id);
      expect(isWalkableTile(d, Math.floor(e!.x / TILE_SIZE), Math.floor(e!.z / TILE_SIZE))).toBe(true);
      // Al entrar en telegrafía debe ver al jugador (con el radio del proyectil).
      if (before !== "telegraph" && e!.ai === "telegraph") {
        expect(hasLineOfSight(d, e!.x, e!.z, pl[0]!.x, pl[0]!.z, shotR)).toBe(true);
      }
    }
    expect(hit).toBe(true);
  });

  it("con dos jugadores ataca al más cercano por recorrido aunque el otro esté más cerca en línea recta", () => {
    const d = lDungeon();
    const sys = new EnemySystem(d, createRng(1));
    const [e] = sys.spawnWave([center(14, 6)], ["minion"]);
    e!.loadout = null;
    // A: más cerca en línea recta (~9 casillas) pero tras muros (recorrido 12); B: recorrido 10
    const a = P("a", center(5, 5).x, center(5, 5).z);
    const b = P("b", center(14, 16).x, center(14, 16).z);
    const range = enemyAttack("minion", null).attackRange;
    let telegraphed = false;
    for (let i = 0; i < 10 / SIM_DT && !telegraphed; i++) {
      sys.step([a, b], SIM_DT);
      expect(isWalkableTile(d, Math.floor(e!.x / TILE_SIZE), Math.floor(e!.z / TILE_SIZE))).toBe(true);
      if (e!.ai === "telegraph") {
        expect(e!.targetKey).toBe("b");
        expect(dist(e!, b) - PLAYER_RADIUS).toBeLessThanOrEqual(range);
        telegraphed = true;
      }
    }
    expect(telegraphed).toBe(true);
  });

  it("el flujo parte de los jugadores vivos y solo se recalcula si cambian sus casillas", () => {
    const sys = new EnemySystem(arena(), createRng(1));
    sys.spawnWave([{ x: 30, z: 30 }], ["minion"]);
    const spy = vi.spyOn(sys.flow, "rebuild");
    sys.step([P("a", 21, 21), P("b", 3, 3, false)], SIM_DT);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sys.flow.distance(10, 10)).toBe(0);
    expect(sys.flow.distance(1, 1)).toBe(Infinity);
    sys.step([P("a", 21.5, 20.5), P("b", 3, 3, false)], SIM_DT); // misma casilla
    expect(spy).toHaveBeenCalledTimes(1);
    sys.step([P("a", 23, 21)], SIM_DT);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(sys.flow.distance(11, 10)).toBe(0);
  });
});
