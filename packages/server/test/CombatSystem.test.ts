import { describe, expect, it } from "vitest";
import {
  ENEMY_DEFS,
  createRng,
  type Dungeon,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";
import { EnemySystem, type SimPlayer } from "../src/sim/EnemySystem";
import { PositionHistory } from "../src/sim/PositionHistory";
import { CombatSystem, newCombatState, type CombatState } from "../src/sim/CombatSystem";

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

const P = (key: string, x: number, z: number): SimPlayer => ({ key, x, z, alive: true });

/** Un enemigo `minion` con muchísima vida en (x,z); los demás muertos. */
function world(x: number, z: number, hp = 20) {
  const sys = new EnemySystem(arena(), createRng(7));
  const created = sys.activateRooms([P("a", 38, 38)], 4);
  const e = created[0]!;
  for (const o of created.slice(1)) sys.damage(o.id, 9999);
  e.kind = "minion";
  e.hp = e.maxHp = hp;
  e.x = x;
  e.z = z;
  return { sys, e };
}

const kin = (over: Partial<KinematicState> = {}): KinematicState => ({
  x: 0, z: 0, facing: 0, dodgeTime: 0, dodgeCooldown: 0, dodgeDirX: 0, dodgeDirZ: 0, y: 0, vy: 0, ...over,
});
const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, moveX: 0, moveZ: 0, facing: 0, dodge: false, sprint: false, jump: false, attack: true, viewTick: 0, ...over,
});

describe("combo", () => {
  it("tres ataques separados por 0.4 s dan pasos 1, 2, 3; tras 2 s vuelve al 1", () => {
    const { sys } = world(0, 1);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    const states = new Map([["a", c]]);
    const kins = new Map([["a", kin()]]);
    const steps: number[] = [];
    let now = 0;
    for (let i = 0; i < 3; i++) {
      steps.push(cs.attack(c, kin(), input(), 100, sys, h).step);
      cs.step(states, kins, now + 0.4, 0.4);
      now += 0.4;
    }
    expect(steps).toEqual([1, 2, 3]);
    cs.step(states, kins, now + 2, 2);
    expect(c.comboStep).toBe(0);
    expect(cs.attack(c, kin(), input(), 100, sys, h).step).toBe(1);
  });

  it("un ataque 0.1 s después de otro no hace swing", () => {
    const { sys } = world(0, 1);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    expect(cs.attack(c, kin(), input(), 100, sys, h).swung).toBe(true);
    cs.step(new Map([["a", c]]), new Map([["a", kin()]]), 0.1, 0.1);
    expect(cs.attack(c, kin(), input(), 100, sys, h).swung).toBe(false);
  });

  it("ráfaga de 50 ataques en el mismo tick: un swing y un golpe por enemigo", () => {
    const { sys } = world(0, 1, 500);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    let swings = 0;
    let hits = 0;
    for (let i = 0; i < 50; i++) {
      const r = cs.attack(c, kin(), input({ viewTick: 100 }), 100, sys, h);
      if (r.swung) swings++;
      hits += r.hits.length;
    }
    expect(swings).toBe(1);
    expect(hits).toBe(1);
  });

  it("no ataca muerto, esquivando ni sin input.attack", () => {
    const { sys } = world(0, 1);
    const cs = new CombatSystem();
    const h = new PositionHistory();
    const dead = newCombatState("warrior", 1);
    dead.dead = true;
    expect(cs.attack(dead, kin(), input(), 100, sys, h).swung).toBe(false);
    expect(cs.attack(newCombatState("warrior", 1), kin({ dodgeTime: 0.1 }), input(), 100, sys, h).swung).toBe(false);
    expect(cs.attack(newCombatState("warrior", 1), kin(), input({ attack: false }), 100, sys, h).swung).toBe(false);
  });
});

describe("daño", () => {
  it("el paso 3 hace round(12 * 1.5) = 18; un enemigo detrás no recibe daño", () => {
    const { sys, e } = world(0, 2, 100);
    // segundo enemigo detrás (facing 0 = +Z, así que z negativo)
    const back = sys.enemies.find((x) => x !== e && x.ai === "dead")!;
    back.ai = "idle";
    back.hp = back.maxHp = 100;
    back.x = 0;
    back.z = -2;
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    c.comboStep = 2;
    c.comboTimer = 1;
    const h = new PositionHistory();
    const r = cs.attack(c, kin(), input({ viewTick: 100 }), 100, sys, h);
    expect(r.step).toBe(3);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ enemyId: e.id, amount: 18, killed: false });
    expect(e.hp).toBe(82);
    expect(back.hp).toBe(100);
  });

  it("las muertes suman xp a xpGained sin llamar a grantXp", () => {
    const { sys, e } = world(0, 1, 5);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const r = cs.attack(c, kin(), input({ viewTick: 100 }), 100, sys, new PositionHistory());
    expect(r.hits[0]!.killed).toBe(true);
    expect(r.xpGained).toBe(ENEMY_DEFS[e.kind].xp);
    expect(cs.xp).toBe(0);
  });
});

describe("rebobinado", () => {
  // currentZ: posición actual (la usada como respaldo cuando el historial no tiene el tick).
  function setup(currentZ = 8) {
    const { sys, e } = world(0, currentZ, 100);
    const h = new PositionHistory();
    for (let t = 95; t <= 104; t++) h.record(t, [{ id: e.id, x: 0, z: t === 100 ? 1.5 : 8 }]);
    return { sys, e, h };
  }
  it("viewTick 100 con nowTick 104 golpea al enemigo que estaba en el arco", () => {
    const { sys, h } = setup();
    const r = new CombatSystem().attack(newCombatState("warrior", 1), kin(), input({ viewTick: 100 }), 104, sys, h);
    expect(r.hits).toHaveLength(1);
  });
  it("viewTick 90 con nowTick 104 se limita a 98 y no golpea (el respaldo actual estaría en el arco)", () => {
    const { sys, h } = setup(1.5);
    const r = new CombatSystem().attack(newCombatState("warrior", 1), kin(), input({ viewTick: 90 }), 104, sys, h);
    expect(r.swung).toBe(true);
    expect(r.hits).toHaveLength(0);
  });
  it("un viewTick enorme se limita a nowTick (el respaldo actual estaría en el arco)", () => {
    const { sys, h } = setup(1.5);
    const r = new CombatSystem().attack(newCombatState("warrior", 1), kin(), input({ viewTick: 1e9 }), 104, sys, h);
    expect(r.hits).toHaveLength(0);
  });
});

describe("golpes de enemigos", () => {
  const hit = (damage: number) => [{ targetKey: "a", damage, sourceId: "e1" }];
  function ctx(c: CombatState) {
    return { states: new Map([["a", c]]), cs: new CombatSystem() };
  }

  it("se aplica tras la gracia si no esquiva", () => {
    const c = newCombatState("warrior", 1);
    const { states, cs } = ctx(c);
    cs.queueEnemyHits(states, hit(6), 1);
    expect(cs.step(states, new Map([["a", kin()]]), 1.05, 0.05).damaged).toEqual([]);
    const r = cs.step(states, new Map([["a", kin()]]), 1.15, 0.1);
    expect(r.damaged).toEqual([{ key: "a", amount: 6 }]);
    expect(c.hp).toBe(114);
  });

  it("se descarta si el jugador empieza a esquivar dentro de la gracia", () => {
    const c = newCombatState("warrior", 1);
    const { states, cs } = ctx(c);
    cs.queueEnemyHits(states, hit(6), 1);
    cs.step(states, new Map([["a", kin({ dodgeTime: 0.2 })]]), 1.05, 0.05);
    const r = cs.step(states, new Map([["a", kin()]]), 1.2, 0.15);
    expect(r.damaged).toEqual([]);
    expect(c.hp).toBe(120);
    expect(c.pendingHits).toHaveLength(0);
  });

  it("ignora golpes a jugadores muertos o inexistentes", () => {
    const c = newCombatState("warrior", 1);
    c.dead = true;
    const { states, cs } = ctx(c);
    cs.queueEnemyHits(states, [...hit(6), { targetKey: "zzz", damage: 5, sourceId: "e1" }], 1);
    expect(c.pendingHits).toHaveLength(0);
  });
});

describe("muerte y reaparición", () => {
  it("muere, reaparece a los 5 s con invulnerabilidad y descarta golpes durante ella", () => {
    const c = newCombatState("warrior", 1);
    c.hp = 10;
    const states = new Map([["a", c]]);
    const kins = new Map([["a", kin()]]);
    const cs = new CombatSystem();
    cs.queueEnemyHits(states, [{ targetKey: "a", damage: 12, sourceId: "e" }], 0);
    const r = cs.step(states, kins, 0.2, 0.2);
    expect(r.died).toEqual(["a"]);
    expect(c.dead).toBe(true);
    expect(c.respawnIn).toBe(5);
    expect(c.pendingHits).toHaveLength(0);

    let respawned: string[] = [];
    for (let i = 0; i < 10; i++) {
      const rr = cs.step(states, kins, 0.7 + i * 0.5, 0.5);
      if (rr.respawned.length) respawned = rr.respawned;
    }
    expect(respawned).toEqual(["a"]);
    expect(c.dead).toBe(false);
    expect(c.hp).toBe(120);
    expect(c.invulnFor).toBe(1);

    cs.queueEnemyHits(states, [{ targetKey: "a", damage: 12, sourceId: "e" }], 6);
    cs.step(states, kins, 6.2, 0.2);
    expect(c.hp).toBe(120);
    expect(c.pendingHits).toHaveLength(0);
  });
});

describe("niveles", () => {
  it("grantXp(20) sube a nivel 2: maxHp 132, hp +12", () => {
    const c = newCombatState("warrior", 1);
    c.hp = 100;
    const cs = new CombatSystem();
    expect(cs.grantXp(new Map([["a", c]]), 20)).toEqual([2]);
    expect(cs.level).toBe(2);
    expect(cs.xp).toBe(0);
    expect(c.maxHp).toBe(132);
    expect(c.hp).toBe(112);
  });

  it("grantXp(100) sube varios niveles", () => {
    const cs = new CombatSystem();
    const levels = cs.grantXp(new Map([["a", newCombatState("warrior", 1)]]), 100);
    // 20 -> L2, 30 -> L3, 40 -> L4 (suma 90), sobran 10 de 50
    expect(levels).toEqual([2, 3, 4]);
    expect(cs.xp).toBe(10);
  });

  it("los muertos no reviven pero reciben el nuevo maxHp", () => {
    const c = newCombatState("warrior", 1);
    c.hp = 0;
    c.dead = true;
    const cs = new CombatSystem();
    cs.grantXp(new Map([["a", c]]), 20);
    expect(c.hp).toBe(0);
    expect(c.dead).toBe(true);
    expect(c.maxHp).toBe(132);
  });
});
