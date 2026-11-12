import { describe, expect, it } from "vitest";
import { ENEMY_BUFF, ENEMY_DEFS, ENEMY_HEAL, SIM_DT, createRng, type CombatEvent, type Dungeon } from "@roguelike/shared";
import { EnemySystem, type SimPlayer } from "../src/sim/EnemySystem";

/** Sala abierta de 12×12 casillas: x y z entre 16 y 40 m. */
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

const player: SimPlayer = { key: "a", x: 20, z: 20, alive: true };

function run(sys: EnemySystem, seconds: number, events: CombatEvent[] = []) {
  sys.refreshFlow([player]);
  for (let i = 0; i < Math.ceil(seconds / SIM_DT); i++) {
    sys.step([player], SIM_DT);
    events.push(...sys.takeEvents());
  }
  return events;
}

describe("refuerzo del hechicero arcano", () => {
  it("con un aliado cerca avisa, y tras el gesto los de su radio pegan y corren más un rato", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const mage = sys.spawnAt("mage", 20, 28, 1);
    const near = sys.spawnAt("brute", 22, 30, 0);
    const far = sys.spawnAt("brute", 38, 38, 0);
    mage.buffCd = 0;
    mage.cooldown = 0;
    const events = run(sys, 0.2);
    expect(events.find((e) => e.type === "enemyBuff")).toMatchObject({ radius: ENEMY_BUFF.radius, castS: ENEMY_BUFF.castS });
    expect(near.buffLeft).toBe(0);
    run(sys, ENEMY_BUFF.castS + 0.1);
    expect(near.buffLeft).toBeGreaterThan(ENEMY_BUFF.durationS - 0.5);
    expect(mage.buffLeft).toBeGreaterThan(0);
    expect(far.buffLeft).toBe(0);
    expect(mage.buffCd).toBeGreaterThan(ENEMY_BUFF.everyS - 1);
    run(sys, ENEMY_BUFF.durationS + 0.2);
    expect(near.buffLeft).toBe(0);
  });

  it("aturdido durante el gesto no hay refuerzo; solo, tampoco lo intenta", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const mage = sys.spawnAt("mage", 20, 28, 1);
    const near = sys.spawnAt("brute", 22, 30, 0);
    mage.buffCd = 0;
    mage.cooldown = 0;
    run(sys, 0.3);
    sys.stun(mage.id, 2);
    run(sys, 1.5);
    expect(near.buffLeft).toBe(0);

    const alone = new EnemySystem(arena(), createRng(3));
    const m = alone.spawnAt("mage", 20, 28, 1);
    m.buffCd = 0;
    m.cooldown = 0;
    expect(run(alone, 1).some((e) => e.type === "enemyBuff")).toBe(false);
  });

  it("el golpe de un enemigo reforzado hace más daño", () => {
    const hit = (buffed: boolean) => {
      const sys = new EnemySystem(arena(), createRng(3));
      const brute = sys.spawnAt("brute", 20, 21.2, 0);
      if (buffed) brute.buffLeft = 60;
      sys.refreshFlow([player]);
      for (let i = 0; i < 200; i++) {
        const hits = sys.step([player], SIM_DT);
        if (hits.length > 0) return hits[0]!.damage;
      }
      return 0;
    };
    expect(hit(true)).toBe(Math.round(hit(false) * ENEMY_BUFF.damageMult));
  });
});

describe("curandero", () => {
  it("cura al aliado más herido a su alcance y nunca a sí mismo ni a otro curandero", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const healer = sys.spawnAt("healer", 20, 29, 0);
    const other = sys.spawnAt("healer", 24, 29, 0);
    const hurt = sys.spawnAt("brute", 22, 31, 0);
    const worse = sys.spawnAt("brute", 18, 31, 0);
    hurt.hp = hurt.maxHp * 0.8;
    worse.hp = worse.maxHp * 0.2;
    healer.hp = 1;
    other.hp = 1;
    healer.cooldown = 0;
    other.cooldown = 999;
    const before = worse.hp;
    const events = run(sys, ENEMY_DEFS.healer.telegraphS + 0.3);
    const heal = events.find((e) => e.type === "enemyHeal");
    expect(heal).toMatchObject({ targetId: worse.id });
    expect(worse.hp).toBeCloseTo(before + Math.round(worse.maxHp * ENEMY_HEAL.frac));
    expect(healer.hp).toBe(1);
    expect(other.hp).toBe(1);
  });

  it("sin heridos no hace nada, y no ataca al jugador", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const healer = sys.spawnAt("healer", 20, 29, 0);
    sys.spawnAt("brute", 38, 38, 0);
    healer.cooldown = 0;
    sys.refreshFlow([player]);
    let hits = 0;
    for (let i = 0; i < 200; i++) hits += sys.step([player], SIM_DT).filter((h) => h.sourceId === healer.id).length;
    expect(hits).toBe(0);
    expect(sys.projectiles).toHaveLength(0);
  });
});
