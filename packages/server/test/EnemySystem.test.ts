import { describe, expect, it, vi } from "vitest";
import {
  ARMED_CHANCE,
  ELITE,
  ENEMY_DEFS,
  PLAYER_RADIUS,
  WEAPONS,
  enemyScale,
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
  type Rng,
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
    // la fuente del golpe es la posición del enemigo
    expect(hits).toEqual([{ targetKey: "a", damage: 12, sourceId: s2.e.id, sourceX: s2.e.x, sourceZ: s2.e.z }]);
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
    expect(hits).toMatchObject([{ targetKey: "a", damage: 10, sourceId: e.id }]);
    // la fuente es el proyectil, que llega desde +X hasta tocar al jugador (no el mago, que quedó atrás)
    expect(hits[0]!.sourceZ).toBeCloseTo(31, 5);
    expect(hits[0]!.sourceX).toBeGreaterThan(20);
    expect(hits[0]!.sourceX).toBeLessThan(20 + 0.4 + 0.3 + 0.5);
    expect(sys.projectiles).toHaveLength(0);
  });

  it("arrinconado contra un muro con el jugador encima, no puede retroceder y dispara", () => {
    const { sys, e } = setup("mage", 16.6, 30);
    const pl = [P("a", 19.6, 30)];
    const hits = run(sys, pl, 60);
    expect(hits).toMatchObject([{ targetKey: "a", damage: 10, sourceId: e.id }]);
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
    e.loadout = { weaponId: "great-sword", tier: 2, nature: "none" };
    const pl = [P("a", 32.2, 30)];
    sys.step(pl, SIM_DT);
    expect(e.ai).toBe("telegraph");
    const hits = run(sys, pl, Math.ceil(ENEMY_DEFS.brute.telegraphS / SIM_DT) + 1);
    expect(hits).toEqual([{ targetKey: "a", damage: 23, sourceId: e.id, sourceX: 30, sourceZ: 30 }]);
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
    const loadout: EnemyLoadout = { weaponId: "guard-sword", tier: 1, nature: "none" };
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
    const shotR = ENEMY_DEFS.mage.ranged!.losRadius;
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

describe("escalado al crear", () => {
  /** Golpe cuerpo a cuerpo de `e` (desarmado) contra un jugador pegado a él. */
  function meleeHit(sys: EnemySystem, e: Enemy): EnemyHit[] {
    const pl = [P("a", e.x + 1, e.z)];
    return run(sys, pl, Math.ceil(ENEMY_DEFS[e.kind].telegraphS / SIM_DT) + 2).filter((h) => h.sourceId === e.id);
  }

  it("con nivel de grupo 3 y floorTime 300 un esbirro nuevo tiene la vida y el golpe escalados; uno ya vivo no cambia", () => {
    const sys = new EnemySystem(arena(), createRng(7));
    const [old] = sys.spawnWave([{ x: 24, z: 24 }], ["minion"]);
    sys.setFloorClock(300, 1, 3);
    const [fresh] = sys.spawnWave([{ x: 30, z: 30 }], ["minion"]);
    old!.loadout = fresh!.loadout = null;

    expect(fresh!.maxHp).toBe(Math.round(20 * 1.24 * 1.4));
    expect(fresh!.hp).toBe(fresh!.maxHp);
    expect(old!.maxHp).toBe(20);
    expect(old!.hp).toBe(20);

    // Uno por vez: el otro queda a 6 m, lejos de alcanzar al jugador en una telegrafía.
    expect(meleeHit(sys, fresh!).map((h) => h.damage)).toEqual([Math.round(6 * 1.12 * 1.2)]);
    sys.damage(fresh!.id, 9999);
    expect(meleeHit(sys, old!).map((h) => h.damage)).toEqual([6]);
  });

  it("el proyectil del mago lleva el daño escalado", () => {
    const { sys, e } = setup("mage", 28, 31);
    e.damageMult = 1.5;
    const hits = run(sys, [P("a", 20, 31)], 90);
    expect(hits).toMatchObject([{ targetKey: "a", damage: Math.round(10 * 1.5), sourceId: e.id }]);
  });
});

describe("hechiceros: tier y orbes del arcano", () => {
  const spot = [{ x: 30, z: 30 }];

  it("a 400 s aparecen los 3 hechiceros, todos con spellTier de 1 a 3", () => {
    const sys = new EnemySystem(arena(), createRng(11));
    sys.setFloorClock(400, 1);
    const kinds = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const [e] = sys.spawnWave(spot, ["mage"]);
      kinds.add(e!.kind);
      expect(e!.spellTier).toBeGreaterThanOrEqual(1);
      expect(e!.spellTier).toBeLessThanOrEqual(3);
    }
    expect([...kinds].sort()).toEqual(["mage", "pyromancer", "stormcaller"]);
  });

  it("a 0 s un mago de oleada es arcano", () => {
    const sys = new EnemySystem(arena(), createRng(11));
    expect(sys.spawnWave(spot, ["mage"])[0]!.kind).toBe("mage");
  });

  it("spawnAt: tier 0 desarma, 1..3 arma, y un hechicero con tier 0 cuenta como 1", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const b0 = sys.spawnAt("brute", 30, 30, 0);
    expect(b0.loadout).toBeNull();
    expect(b0.spellTier).toBe(0);
    expect(sys.spawnAt("brute", 30, 30, 2).loadout).toEqual({ weaponId: "great-sword", tier: 2, nature: "none" });
    const p = sys.spawnAt("pyromancer", 30, 30, 0);
    expect(p.spellTier).toBe(1);
    expect(p.loadout).toBeNull();
  });

  function fire(tier: 1 | 3) {
    const sys = new EnemySystem(arena(), createRng(5));
    const e = sys.spawnAt("mage", 30, 30, tier);
    const players = [P("a", 38, 30)];
    for (let i = 0; i < 400 && sys.projectiles.length === 0; i++) sys.step(players, SIM_DT);
    return sys.projectiles;
  }

  it("arcano tier 3: 3 orbes a 12 m/s a -15, 0 y +15 grados del rumbo", () => {
    const shots = fire(3);
    expect(shots).toHaveLength(3);
    const angles = shots.map((s) => Math.atan2(s.dirX, s.dirZ) - Math.PI / 2).sort((a, b) => a - b);
    shots.forEach((s) => {
      expect(s.speed).toBe(12);
      expect(s.radius).toBe(0.3);
    });
    const deg = (15 * Math.PI) / 180;
    expect(angles[0]).toBeCloseTo(-deg, 6);
    expect(angles[1]).toBeCloseTo(0, 6);
    expect(angles[2]).toBeCloseTo(deg, 6);
  });

  it("arcano tier 1: 1 orbe a 9 m/s", () => {
    const shots = fire(1);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.speed).toBe(9);
  });
});

describe("peligros de los hechiceros", () => {
  const mk = (kind: EnemyKind, tier: 1 | 2 | 3, ex = 20, ez = 30) => {
    const r = setup(kind, ex, ez);
    r.e.spellTier = tier;
    return r;
  };

  it("pirómano tier 1: zona fija en el objetivo, daña 14 una sola vez a quien se queda", () => {
    const { sys, e } = mk("pyromancer", 1);
    const a = P("a", 29, 30);
    const hits = run(sys, [a], 2);
    expect(e.ai).toBe("telegraph");
    expect(sys.hazards).toHaveLength(1);
    expect(sys.hazards[0]).toMatchObject({ kind: "zone", phase: "warn", size: 2.5, x: 29, z: 30 });
    expect(hits).toEqual([]);
    run(sys, [a], 60);
    expect(sys.hazards).toEqual([]);
  });

  it("pirómano: el que se movió 4 m no recibe daño, el que se queda sí (una vez)", () => {
    const stay = mk("pyromancer", 1);
    const a = P("a", 29, 30);
    const h1 = run(stay.sys, [a], 40);
    expect(h1.filter((h) => h.sourceId === stay.e.id)).toMatchObject([{ targetKey: "a", damage: 14, sourceX: 29, sourceZ: 30 }]);

    const move = mk("pyromancer", 1);
    const b = P("a", 29, 30);
    run(move.sys, [b], 2);
    b.z += 4;
    expect(move.sys.hazards[0]).toMatchObject({ x: 29, z: 30 });
    expect(run(move.sys, [b], 40)).toEqual([]);
  });

  it("pirómano tier 3: tres zonas, en el objetivo y a ±3 m en la perpendicular", () => {
    const { sys } = mk("pyromancer", 3);
    run(sys, [P("a", 29, 30)], 2);
    const zs = sys.hazards.map((h) => [Math.round(h.x), Math.round(h.z)]).sort((p, q) => p[1]! - q[1]!);
    expect(zs).toEqual([[29, 27], [29, 30], [29, 33]]);
  });

  it("dos jugadores en la misma zona reciben un golpe cada uno", () => {
    const { sys } = mk("pyromancer", 1);
    const hits = run(sys, [P("a", 29, 30), P("b", 29.5, 30)], 40);
    expect(hits.map((h) => h.targetKey).sort()).toEqual(["a", "b"]);
  });

  it("si el pirómano muere tras marcar, la zona igual explota", () => {
    const { sys, e } = mk("pyromancer", 1);
    run(sys, [P("a", 29, 30)], 2);
    sys.damage(e.id, 9999);
    const hits = run(sys, [P("a", 29, 30)], 40);
    expect(hits).toMatchObject([{ targetKey: "a", damage: 14 }]);
  });

  it("invocador tier 2: sigue al jugador el 60 % de la preparación, luego queda fijo, y dispara 0,15 s", () => {
    const { sys, e } = mk("stormcaller", 2, 18, 30);
    const a = P("a", 28, 30);
    run(sys, [a], 2);
    expect(e.ai).toBe("telegraph");
    const h = sys.hazards[0]!;
    expect(h).toMatchObject({ kind: "beam", phase: "warn", size: 0.8, total: 0.9 });
    // 60 % de 0,9 s = 0,54 s ≈ 16 ticks: dentro del seguimiento
    a.z = 32;
    run(sys, [a], 3);
    expect(h.dirZ).toBeGreaterThan(0.1);
    // pasado el seguimiento, queda fijo
    run(sys, [a], 14);
    const fixed = h.dirZ;
    a.z = 26;
    run(sys, [a], 3);
    expect(h.dirZ).toBe(fixed);
  });

  it("invocador: daña 12 a quien está en la línea al disparar y el rayo dura 0,15 s en fire", () => {
    const { sys, e } = mk("stormcaller", 2, 18, 30);
    const a = P("a", 28, 30);
    const off = P("b", 28, 33);
    const hits: EnemyHit[] = [];
    let fireTicks = 0;
    for (let i = 0; i < 40; i++) {
      hits.push(...sys.step([a, off], SIM_DT));
      if (sys.hazards.some((h) => h.phase === "fire")) fireTicks++;
    }
    expect(hits).toMatchObject([{ targetKey: "a", damage: 12, sourceId: e.id, sourceX: 18, sourceZ: 30 }]);
    expect(hits).toHaveLength(1);
    expect(fireTicks).toBeGreaterThanOrEqual(4);
    expect(fireTicks).toBeLessThanOrEqual(5);
    expect(sys.hazards).toEqual([]);
    expect(sys.projectiles).toEqual([]);
  });

  it("invocador aturdido en la telegrafía: su rayo desaparece y no daña", () => {
    const { sys, e } = mk("stormcaller", 2, 18, 30);
    const a = P("a", 28, 30);
    run(sys, [a], 5);
    expect(sys.hazards).toHaveLength(1);
    sys.stun(e.id, 5);
    expect(run(sys, [a], 60)).toEqual([]);
    expect(sys.hazards).toEqual([]);
  });

  it("invocador muerto o killAll en la telegrafía: el rayo se quita", () => {
    const { sys, e } = mk("stormcaller", 1, 18, 30);
    run(sys, [P("a", 28, 30)], 5);
    sys.killAll();
    expect(e.ai).toBe("dead");
    run(sys, [P("a", 28, 30)], 1);
    expect(sys.hazards).toEqual([]);
  });

  it("un muro entre el mago y el jugador corta el rayo y no hay daño", () => {
    const d = arena();
    const { sys, e } = setup("stormcaller", 22, 30, d);
    e.spellTier = 1;
    const a = P("a", 33, 30);
    run(sys, [a], 2);
    expect(e.ai).toBe("telegraph");
    // el muro aparece con la preparación en curso (el largo se recalcula al apuntar)
    for (let z = 8; z < 20; z++) d.tiles[z * d.width + 14] = 0;
    run(sys, [a], 1);
    const h = sys.hazards[0]!;
    expect(h.length).toBeLessThan(dist(e, a));
    expect(run(sys, [a], 60)).toEqual([]);
  });
});


describe("EnemySystem: naturaleza de las armas", () => {
  const FIRE = { key: "ana", nature: "fire", affinity: 0 } as const;
  const ICE = { key: "ana", nature: "ice", affinity: 0 } as const;
  const LIGHT = { key: "ana", nature: "lightning", affinity: 0 } as const;
  /** Suma el daño de estado de `steps` ticks. */
  function burned(sys: EnemySystem, p: SimPlayer[], steps: number): number {
    let total = 0;
    for (let i = 0; i < steps; i++) {
      sys.step(p, SIM_DT);
      for (const s of sys.takeStatusDamage()) total += s.result.amount;
    }
    return total;
  }
  const far = [P("a", 2 * TILE_SIZE, 2 * TILE_SIZE)];

  it("fuego: un golpe de 20 quema 12 en 3 s y no más", () => {
    const { sys, e } = setup("brute", IN_ROOM.x, IN_ROOM.z);
    e.hp = e.maxHp = 9999;
    sys.strike(e.id, 20, FIRE);
    expect(e.burn).toMatchObject({ dps: 4, ownerKey: "ana" });
    expect(burned(sys, far, 120)).toBeCloseTo(12, 0);
    expect(e.burn).toBeNull();
  });

  it("fuego: un segundo golpe renueva a 3 s con el mayor dps", () => {
    const { sys, e } = setup("brute", IN_ROOM.x, IN_ROOM.z);
    e.hp = e.maxHp = 9999;
    sys.strike(e.id, 20, FIRE);
    burned(sys, far, 45);
    sys.strike(e.id, 10, FIRE);
    expect(e.burn!.dps).toBe(4);
    expect(e.burn!.left).toBe(3);
    // Un golpe más fuerte sube el dps.
    sys.strike(e.id, 50, FIRE);
    expect(e.burn!.dps).toBe(10);
  });

  it("fuego: si la quemadura mata, el resultado trae killed, xp y drop", () => {
    const { sys, e } = setup("brute", IN_ROOM.x, IN_ROOM.z);
    e.hp = 2;
    e.loadout = { weaponId: ARMED_CHANCE.brute!.weaponId, tier: 3, nature: "none" };
    const dropRoll = vi.spyOn(sys["rng"], "next").mockReturnValue(0);
    sys.strike(e.id, 0, FIRE);
    // 0 de daño no enciende nada útil: se enciende a mano un dps que mate.
    e.burn = { left: 3, dps: 4, ownerKey: "ana" };
    const out: { key: string; result: ReturnType<EnemySystem["takeStatusDamage"]>[number]["result"] }[] = [];
    for (let i = 0; i < 30 && e.ai !== "dead"; i++) {
      sys.step(far, SIM_DT);
      out.push(...sys.takeStatusDamage());
    }
    const last = out.at(-1)!;
    expect(last.key).toBe("ana");
    expect(last.result).toMatchObject({ killed: true, xp: ENEMY_DEFS.brute.xp, enemyId: e.id });
    expect(e.ai).toBe("dead");
    expect(last.result.drop).not.toBeNull();
    expect(e.burn).toBeNull();
    dropRoll.mockRestore();
  });

  it("hielo: un golpe lo ralentiza al 70 % durante 2 s", () => {
    const far0 = setup("minion", IN_ROOM.x, IN_ROOM.z);
    const slow = setup("minion", IN_ROOM.x, IN_ROOM.z);
    const target = [P("a", 36, 18)];
    slow.e.hp = slow.e.maxHp = 9999;
    slow.sys.strike(slow.e.id, 1, ICE);
    run(far0.sys, target, 30);
    run(slow.sys, target, 30);
    const d0 = dist({ x: IN_ROOM.x, z: IN_ROOM.z }, far0.e);
    const d1 = dist({ x: IN_ROOM.x, z: IN_ROOM.z }, slow.e);
    expect(d1 / d0).toBeCloseTo(0.7, 1);
    run(slow.sys, target, 40);
    expect(slow.e.slow).toBeNull();
  });

  it("hielo: 3 golpes en 2 s congelan 0,8 s y cancelan la telegrafía; el 4.º no repite (inmunidad 4 s)", () => {
    const { sys, e } = setup("brute", IN_ROOM.x, IN_ROOM.z);
    e.hp = e.maxHp = 9999;
    sys.strike(e.id, 1, ICE);
    run(sys, far, 30);
    sys.strike(e.id, 1, ICE);
    run(sys, far, 30);
    expect(e.frozen).toBe(0);
    e.ai = "telegraph";
    e.aiTime = 0;
    sys.strike(e.id, 1, ICE);
    expect(e.frozen).toBeCloseTo(0.8, 5);
    expect(e.ai).toBe("chase");
    const [x, z] = [e.x, e.z];
    run(sys, [P("a", x + 1, z)], 20);
    expect([e.x, e.z]).toEqual([x, z]);
    run(sys, far, 10);
    expect(e.frozen).toBe(0);
    // En el segundo siguiente: tres golpes más no lo vuelven a congelar.
    for (let i = 0; i < 4; i++) sys.strike(e.id, 1, ICE);
    expect(e.frozen).toBe(0);
  });

  it("hielo: un élite no se congela", () => {
    const { sys, e } = setup("brute", IN_ROOM.x, IN_ROOM.z);
    e.hp = e.maxHp = 9999;
    e.elite = true;
    for (let i = 0; i < 5; i++) sys.strike(e.id, 1, ICE);
    expect(e.frozen).toBe(0);
    expect(e.slow).not.toBeNull();
  });

  /** Sistema con 4 enemigos de mucha vida: el golpeado en (18,18) y vecinos a las distancias dadas. */
  function chainSetup(roll: number, dists: number[]) {
    const rng: Rng = { next: () => roll, int: (a) => a, pick: (arr) => arr[0]! };
    const sys = new EnemySystem(arena(), rng);
    const made = sys.spawnWave(
      [{ x: 18, z: 18 }, ...dists.map((d) => ({ x: 18 - d, z: 18 }))],
      ["brute"],
    );
    for (const m of made) m.hp = m.maxHp = 9999;
    return { sys, made };
  }

  it("rayo: encadena solo a los vecinos a ≤ 4 m (máx. 2) con el 50 %", () => {
    const { sys, made } = chainSetup(0.1, [2, 3, 6]);
    const out = sys.strike(made[0]!.id, 20, LIGHT);
    expect(out.map((r) => r.enemyId)).toEqual([made[0]!.id, made[1]!.id, made[2]!.id]);
    expect(out.map((r) => r.amount)).toEqual([20, 10, 10]);
    expect(made[3]!.hp).toBe(9999);
    expect(made[1]!.hp).toBe(9989);
    const chains = sys.takeChains();
    expect(chains).toHaveLength(1);
    expect(chains[0]!.points).toHaveLength(3);
    expect(sys.takeChains()).toEqual([]);
  });

  it("rayo: si el golpeado muere, la cadena igual sale; sin vecinos o sin suerte solo el golpeado", () => {
    const { sys, made } = chainSetup(0.1, [2]);
    made[0]!.hp = 1;
    const out = sys.strike(made[0]!.id, 20, LIGHT);
    expect(out[0]!.killed).toBe(true);
    expect(out).toHaveLength(2);
    const alone = chainSetup(0.1, []);
    expect(alone.sys.strike(alone.made[0]!.id, 20, LIGHT)).toHaveLength(1);
    expect(alone.sys.takeChains()).toEqual([]);
    const unlucky = chainSetup(0.9, [2]);
    expect(unlucky.sys.strike(unlucky.made[0]!.id, 20, LIGHT)).toHaveLength(1);
  });
});

describe("élites", () => {
  const spots = Array.from({ length: 100 }, (_, i) => ({ x: 30 + (i % 10) * 0.1, z: 30 + Math.floor(i / 10) * 0.1 }));
  const wave = (floorTime: number, kinds: EnemyKind[], seed = 4) => {
    const sys = new EnemySystem(arena(), createRng(seed));
    sys.setFloorClock(floorTime, 1, 1);
    return { sys, list: sys.spawnWave(spots, kinds) };
  };

  it("antes del minuto 3 no hay élites ni se consume RNG de más", () => {
    const { list } = wave(100, ["minion", "brute"]);
    expect(list.some((e) => e.elite)).toBe(false);
    expect(list.every((e) => e.nature === "none")).toBe(true);
  });

  it("con eliteChance > 0 hay élites: vida x3 del escalado, armados con su naturaleza e inmunes al aturdimiento", () => {
    const { sys, list } = wave(3000, ["minion", "brute"]);
    const elites = list.filter((e) => e.elite);
    expect(elites.length).toBeGreaterThan(0);
    expect(elites.length).toBeLessThan(list.length);
    const { hpMult, damageMult } = enemyScale(3000, 1);
    for (const e of elites) {
      expect(e.maxHp).toBe(Math.round(ENEMY_DEFS[e.kind].hp * hpMult) * ELITE.hpMult);
      expect(e.damageMult).toBeCloseTo(damageMult * ELITE.damageMult, 12);
      expect(["fire", "ice", "lightning"]).toContain(e.nature);
      expect(e.loadout).toMatchObject({ weaponId: ARMED_CHANCE[e.kind]!.weaponId, nature: e.nature });
      sys.stun(e.id, 2);
      expect(e.stunned).toBe(0);
    }
    for (const e of list.filter((x) => !x.elite)) {
      expect(e.nature).toBe("none");
      expect(e.maxHp).toBe(Math.round(ENEMY_DEFS[e.kind].hp * hpMult));
    }
  });

  it("los golpes cuerpo a cuerpo de un élite llevan su naturaleza y su quemadura", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const e = sys.spawnAt("minion", 20, 30, 1, { nature: "fire" });
    e.damageMult = 2;
    const hits = run(sys, [P("a", 20.9, 30)], 60);
    expect(hits[0]).toMatchObject({ nature: "fire", burnDps: ELITE.playerBurnDps * 2 });
  });

  it("spawnAt sin élite no marca nada en los golpes", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    sys.spawnAt("minion", 20, 30, 1);
    const hits = run(sys, [P("a", 20.9, 30)], 60);
    expect(hits[0]).not.toHaveProperty("nature");
  });

  it("un piromante élite alterna zona y rayo en lanzamientos seguidos, con el daño y el tier propios", () => {
    const sys = new EnemySystem(arena(), createRng(5));
    const e = sys.spawnAt("pyromancer", 20, 30, 2, { nature: "ice" });
    const a = P("a", 29, 30);
    const seen: string[] = [];
    for (let i = 0; i < 600 && seen.length < 3; i++) {
      sys.step([a], SIM_DT);
      const h = sys.hazards.find((x) => x.phase === "warn" && !seen.includes(x.id + x.kind));
      if (h && !seen.some((s) => s.startsWith(h.id))) seen.push(h.id + h.kind);
    }
    expect(seen.map((s) => s.replace(/^h\d+/, ""))).toEqual(["zone", "beam", "zone"]);
    expect(e.spellTier).toBe(2);
    expect(sys.hazards.every((h) => h.nature === "ice" && h.damage === Math.round(ENEMY_DEFS.pyromancer.damage * e.damageMult))).toBe(true);
  });

  it("matar a un élite da la xp x4 y, con la RNG forzada, suelta su arma un tier arriba con su naturaleza", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const e = sys.spawnAt("brute", 20, 30, 3, { nature: "lightning" });
    vi.spyOn(sys["rng"], "next").mockReturnValue(0);
    const r = sys.damage(e.id, 1e9);
    expect(r.xp).toBe(ENEMY_DEFS.brute.xp * ELITE.xpMult);
    expect(r.drop).toEqual({ weaponId: ARMED_CHANCE.brute!.weaponId, tier: 4, nature: "lightning" });
  });

  it("el hechicero élite suelta un arma al azar de WEAPONS; sin suerte no suelta, pero la xp sigue x4", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const e = sys.spawnAt("mage", 20, 30, 2, { nature: "fire" });
    const r = vi.spyOn(sys["rng"], "next").mockReturnValue(0);
    const win = sys.damage(e.id, 1e9);
    expect(Object.keys(WEAPONS)).toContain(win.drop!.weaponId);
    expect(win.drop).toMatchObject({ tier: 3, nature: "fire" });
    const f = sys.spawnAt("mage", 20, 30, 1, { nature: "fire" });
    r.mockReturnValue(0.99);
    const lose = sys.damage(f.id, 1e9);
    expect(lose.drop).toBeNull();
    expect(lose.xp).toBe(ENEMY_DEFS.mage.xp * ELITE.xpMult);
  });
});
