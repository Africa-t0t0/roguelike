import { describe, expect, it } from "vitest";
import {
  MOVESETS,
  ENEMY_DEFS,
  REWIND_MAX_TICKS,
  SIM_DT,
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
  seq: 1, moveX: 0, moveZ: 0, facing: 0, dodge: false, sprint: false, jump: false, attack: true, interact: false, viewTick: 0, ...over,
});

/** Un input procesado y, si trae `attack`, su ataque (como hace RunRoom). */
function press(cs: CombatSystem, c: CombatState, sys: EnemySystem, h: PositionHistory, attack: boolean) {
  const inp = input({ attack });
  cs.onInputProcessed(c, kin(), inp);
  return attack ? cs.attack(c, kin(), inp, 100, sys, h) : undefined;
}
const inputsFor = (seconds: number) => Math.ceil(seconds / SIM_DT - 1e-9);

describe("combo", () => {
  it("tres ataques separados por 12 inputs dan pasos 1, 2, 3; tras comboResetS de inputs vuelve al 1", () => {
    const { sys } = world(0, 1);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    const steps: number[] = [];
    for (let i = 0; i < 3; i++) {
      steps.push(press(cs, c, sys, h, true)!.step);
      for (let j = 0; j < 11; j++) press(cs, c, sys, h, false);
    }
    expect(steps).toEqual([1, 2, 3]);
    for (let j = 0; j < 60; j++) press(cs, c, sys, h, false);
    expect(c.comboStep).toBe(0);
    expect(press(cs, c, sys, h, true)!.step).toBe(1);
  });

  it("los ticks sin inputs no avanzan el golpe", () => {
    const { sys } = world(0, 1);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    expect(press(cs, c, sys, h, true)!.swung).toBe(true);
    for (let t = 1; t <= 30; t++) cs.step(new Map([["a", c]]), new Map([["a", kin()]]), 100 + t, SIM_DT);
    expect(c.swingTimer).toBeGreaterThan(0);
    expect(press(cs, c, sys, h, true)!.swung).toBe(false);
  });

  // patrón de inputs por tick: ráfagas de 3 y ticks sin nada en medio.
  for (const [name, pattern] of [
    ["en ráfagas de 3 por tick", [3]],
    ["con ticks vacíos en medio", [1, 0, 2, 0, 0, 3]],
  ] as const) {
    it(`un ataque exactamente duration/SIM_DT inputs después del anterior se acepta ${name}`, () => {
      for (const [k, step] of MOVESETS["one-hand-sword"].combo.entries()) {
        const n = inputsFor(step.duration);
        for (const gap of [n - 1, n]) {
          const { sys } = world(0, 1, 9999);
          const cs = new CombatSystem();
          const c = newCombatState("warrior", 1);
          const h = new PositionHistory();
          // Lleva el combo al golpe k+1.
          for (let s = 0; s < k; s++) {
            press(cs, c, sys, h, true);
            for (let j = 0; j < inputsFor(MOVESETS["one-hand-sword"].combo[s]!.duration) - 1; j++) press(cs, c, sys, h, false);
          }
          expect(press(cs, c, sys, h, true)!.step).toBe(k + 1);
          let sent = 0;
          let tick = 100;
          let result: ReturnType<typeof press> = undefined;
          for (let p = 0; sent < gap; p = (p + 1) % pattern.length) {
            for (let i = 0; i < pattern[p]! && sent < gap; i++) {
              sent++;
              result = press(cs, c, sys, h, sent === gap);
            }
            cs.step(new Map([["a", c]]), new Map([["a", kin()]]), ++tick, SIM_DT);
          }
          expect(result!.swung, `golpe ${k + 1}, ${gap} inputs`).toBe(gap === n);
        }
      }
    });
  }

  it("un ataque 3 inputs después de otro no hace swing", () => {
    const { sys } = world(0, 1);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    expect(press(cs, c, sys, h, true)!.swung).toBe(true);
    press(cs, c, sys, h, false);
    press(cs, c, sys, h, false);
    expect(press(cs, c, sys, h, true)!.swung).toBe(false);
  });

  it("50 ataques sin inputs procesados en medio: un swing y un golpe por enemigo", () => {
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
  const NOW = 104;
  const CLAMP = NOW - REWIND_MAX_TICKS;
  // currentZ: posición actual (la usada como respaldo cuando el historial no tiene el tick).
  // El historial cubre desde antes del límite: solo en `inArcAt` el enemigo estaba en el arco.
  function setup(currentZ = 8, inArcAt = 100) {
    const { sys, e } = world(0, currentZ, 100);
    const h = new PositionHistory();
    for (let t = CLAMP - 2; t <= NOW; t++) h.record(t, [{ id: e.id, x: 0, z: t === inArcAt ? 1.5 : 8 }]);
    return { sys, e, h };
  }
  it("viewTick 100 con nowTick 104 golpea al enemigo que estaba en el arco", () => {
    const { sys, h } = setup();
    const r = new CombatSystem().attack(newCombatState("warrior", 1), kin(), input({ viewTick: 100 }), NOW, sys, h);
    expect(r.hits).toHaveLength(1);
  });
  it("viewTick en el límite (nowTick − REWIND_MAX_TICKS) todavía rebobina", () => {
    const { sys, h } = setup(8, CLAMP);
    const r = new CombatSystem().attack(newCombatState("warrior", 1), kin(), input({ viewTick: CLAMP }), NOW, sys, h);
    expect(r.hits).toHaveLength(1);
  });
  it("un viewTick más viejo que el límite se lleva al límite y no golpea (el respaldo actual estaría en el arco)", () => {
    const { sys, h } = setup(1.5);
    const r = new CombatSystem().attack(newCombatState("warrior", 1), kin(), input({ viewTick: CLAMP - 10 }), NOW, sys, h);
    expect(r.swung).toBe(true);
    expect(r.hits).toHaveLength(0);
  });
  it("un viewTick enorme se limita a nowTick (el respaldo actual estaría en el arco)", () => {
    const { sys, h } = setup(1.5);
    const r = new CombatSystem().attack(newCombatState("warrior", 1), kin(), input({ viewTick: 1e9 }), NOW, sys, h);
    expect(r.hits).toHaveLength(0);
  });
});

describe("golpes de enemigos", () => {
  const H = 100;
  const hit = (damage: number) => [{ targetKey: "a", damage, sourceId: "e1" }];
  function ctx(c: CombatState) {
    const states = new Map([["a", c]]);
    const cs = new CombatSystem();
    const tick = (t: number, k = kin()) => cs.step(states, new Map([["a", k]]), t, SIM_DT);
    return { states, cs, tick };
  }
  const idle = (viewTick: number) => input({ attack: false, interact: false, viewTick });

  it("se aplica en cuanto llega un input con viewTick >= H sin esquivar", () => {
    const c = newCombatState("warrior", 1);
    const { states, cs, tick } = ctx(c);
    cs.queueEnemyHits(states, hit(6), H);
    expect(tick(H).damaged).toEqual([]);
    expect(cs.onInputProcessed(c, kin(), idle(H - 1))).toEqual({ damage: 0, died: false });
    expect(tick(H + 1).damaged).toEqual([]);
    expect(c.hp).toBe(120);
    expect(cs.onInputProcessed(c, kin(), idle(H))).toEqual({ damage: 6, died: false });
    expect(c.hp).toBe(114);
    expect(c.pendingHits).toHaveLength(0);
  });

  it("se descarta si un input (aunque con viewTick < H) empieza una esquiva", () => {
    const c = newCombatState("warrior", 1);
    const { states, cs, tick } = ctx(c);
    cs.queueEnemyHits(states, hit(6), H);
    for (let t = H; t <= H + 2; t++) tick(t);
    // procesado en el tick 103
    expect(cs.onInputProcessed(c, kin({ dodgeTime: 0.2 }), idle(H - 1)).damage).toBe(0);
    expect(c.pendingHits).toHaveLength(0);
    for (let t = H + 3; t <= H + REWIND_MAX_TICKS + 2; t++) expect(tick(t).damaged).toEqual([]);
    expect(c.hp).toBe(120);
  });

  it("sin inputs se aplica en el tick H + REWIND_MAX_TICKS", () => {
    const c = newCombatState("warrior", 1);
    const { states, cs, tick } = ctx(c);
    cs.queueEnemyHits(states, hit(6), H);
    for (let t = H; t < H + REWIND_MAX_TICKS; t++) expect(tick(t).damaged).toEqual([]);
    expect(tick(H + REWIND_MAX_TICKS).damaged).toEqual([{ key: "a", amount: 6 }]);
    expect(c.hp).toBe(114);
  });

  it("un golpe por input que mata deja al jugador muerto", () => {
    const c = newCombatState("warrior", 1);
    c.hp = 5;
    const { states, cs } = ctx(c);
    cs.queueEnemyHits(states, hit(6), H);
    expect(cs.onInputProcessed(c, kin(), idle(H))).toEqual({ damage: 6, died: true });
    expect(c).toMatchObject({ hp: 0, dead: true, pendingHits: [] });
    expect(c.respawnIn).toBe(5);
  });

  it("ignora golpes a jugadores muertos o inexistentes", () => {
    const c = newCombatState("warrior", 1);
    c.dead = true;
    const { states, cs } = ctx(c);
    cs.queueEnemyHits(states, [...hit(6), { targetKey: "zzz", damage: 5, sourceId: "e1" }], H);
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
    const r = cs.step(states, kins, REWIND_MAX_TICKS, 0.2);
    expect(r.died).toEqual(["a"]);
    expect(c.dead).toBe(true);
    expect(c.respawnIn).toBe(5);
    expect(c.pendingHits).toHaveLength(0);

    let respawned: string[] = [];
    for (let i = 0; i < 10; i++) {
      const rr = cs.step(states, kins, REWIND_MAX_TICKS + 1 + i, 0.5);
      if (rr.respawned.length) respawned = rr.respawned;
    }
    expect(respawned).toEqual(["a"]);
    expect(c.dead).toBe(false);
    expect(c.hp).toBe(120);
    expect(c.invulnFor).toBe(1);

    cs.queueEnemyHits(states, [{ targetKey: "a", damage: 12, sourceId: "e" }], 100);
    expect(cs.onInputProcessed(c, kin(), input({ attack: false, interact: false, viewTick: 100 })).damage).toBe(0);
    cs.queueEnemyHits(states, [{ targetKey: "a", damage: 12, sourceId: "e" }], 100);
    cs.step(states, kins, 100 + REWIND_MAX_TICKS, 0.2);
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
