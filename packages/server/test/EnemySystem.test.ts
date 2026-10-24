import { describe, expect, it } from "vitest";
import {
  ENEMY_DEFS,
  ENEMY_SPAWN_MIN_PLAYER_DIST_TILES,
  SIM_DT,
  TILE_SIZE,
  circlesOverlap,
  createRng,
  generateDungeon,
  isWalkableTile,
  type Dungeon,
  type EnemyKind,
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

  it("un proyectil contra un muro desaparece sin golpear", () => {
    const d = arena();
    d.tiles[15 * d.width + 11] = 0; // pilar en x 22..24, z 30..32
    const { sys, e } = setup("mage", 28, 31, d);
    const pl = [P("a", 18.5, 31)];
    let sawProjectile = false;
    const hits: EnemyHit[] = [];
    for (let i = 0; i < 60; i++) {
      hits.push(...sys.step(pl, SIM_DT));
      if (sys.projectiles.length > 0) sawProjectile = true;
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
    expect(sys.damage("nope", 5)).toEqual({ killed: false, xp: 0 });
    expect(sys.damage(e.id, 5)).toEqual({ killed: false, xp: 0 });
    expect(sys.damage(e.id, 999)).toEqual({ killed: true, xp: ENEMY_DEFS.minion.xp });
    expect(e.ai).toBe("dead");
    expect(sys.damage(e.id, 999)).toEqual({ killed: false, xp: 0 });
    const pl = [P("a", 30.5, 30)];
    expect(run(sys, pl, 30)).toEqual([]);
    expect(sys.enemies).toContain(e);
    run(sys, pl, 45);
    expect(sys.enemies).not.toContain(e);
  });
});
