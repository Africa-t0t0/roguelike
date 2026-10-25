import { describe, expect, it } from "vitest";
import {
  MOVESETS,
  ENEMY_DEFS,
  REWIND_MAX_TICKS,
  SIM_DT,
  STARTING_WEAPON,
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
  x: 0, z: 0, facing: 0, y: 0, vy: 0, ...over,
});
const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, moveX: 0, moveZ: 0, facing: 0, sprint: false, jump: false, attack: true, interact: false, abilities: 0, viewTick: 0, ...over,
});

/** Un input procesado (combo e impacto) y, si trae `attack`, su ataque (como hace RunRoom). */
function press(
  cs: CombatSystem,
  c: CombatState,
  sys: EnemySystem,
  h: PositionHistory,
  attack: boolean,
  over: { k?: Partial<KinematicState>; inp?: Partial<PlayerInput>; now?: number } = {},
) {
  const inp = input({ attack, ...over.inp });
  const k = kin(over.k);
  const r = cs.onInputProcessed(c, k, inp, over.now ?? 100, sys, h);
  const swing = attack ? cs.attack(c, inp) : undefined;
  return { swing, impact: r.impact, r };
}
const noEnemies = () => world(0, 50).sys;
const inputsFor = (seconds: number) => Math.ceil(seconds / SIM_DT - 1e-9);

/** Clic y luego inputs quietos hasta el impacto (máx. 60). Devuelve el swing, el impacto y cuántos inputs tardó. */
function swingToImpact(
  cs: CombatSystem,
  c: CombatState,
  sys: EnemySystem,
  h: PositionHistory,
  click: Partial<PlayerInput> = {},
  after: Partial<PlayerInput> = {},
  now = 100,
) {
  const first = press(cs, c, sys, h, true, { inp: click, now });
  expect(first.impact).toBeNull();
  for (let i = 1; i <= 60; i++) {
    const { impact } = press(cs, c, sys, h, false, { inp: after, now });
    if (impact) return { swing: first.swing!, impact, inputs: i };
  }
  return { swing: first.swing!, impact: null, inputs: -1 };
}

describe("combo", () => {
  it("tres ataques separados por 12 inputs dan pasos 1, 2, 3; tras comboResetS de inputs vuelve al 1", () => {
    const { sys } = world(0, 1, 9999);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    const steps: number[] = [];
    for (let i = 0; i < 3; i++) {
      steps.push(press(cs, c, sys, h, true).swing!.step);
      for (let j = 0; j < 11; j++) press(cs, c, sys, h, false);
    }
    expect(steps).toEqual([1, 2, 3]);
    for (let j = 0; j < 60; j++) press(cs, c, sys, h, false);
    expect(c.comboStep).toBe(0);
    expect(press(cs, c, sys, h, true).swing!.step).toBe(1);
  });

  it("los ticks sin inputs no avanzan el golpe ni el impacto", () => {
    const { sys, e } = world(0, 1);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    expect(press(cs, c, sys, h, true).swing!.swung).toBe(true);
    for (let t = 1; t <= 30; t++) cs.step(new Map([["a", c]]), 100 + t, SIM_DT);
    expect(c.swingTimer).toBeGreaterThan(0);
    expect(c.impactPending).toBe(true);
    expect(e.hp).toBe(20);
    expect(press(cs, c, sys, h, true).swing!.swung).toBe(false);
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
          expect(press(cs, c, sys, h, true).swing!.step).toBe(k + 1);
          let sent = 0;
          let tick = 100;
          let result: ReturnType<typeof press> | undefined = undefined;
          for (let p = 0; sent < gap; p = (p + 1) % pattern.length) {
            for (let i = 0; i < pattern[p]! && sent < gap; i++) {
              sent++;
              result = press(cs, c, sys, h, sent === gap);
            }
            cs.step(new Map([["a", c]]), ++tick, SIM_DT);
          }
          expect(result!.swing!.swung, `golpe ${k + 1}, ${gap} inputs`).toBe(gap === n);
        }
      }
    });
  }

  it("un ataque 3 inputs después de otro no hace swing", () => {
    const { sys } = world(0, 1);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    expect(press(cs, c, sys, h, true).swing!.swung).toBe(true);
    press(cs, c, sys, h, false);
    press(cs, c, sys, h, false);
    expect(press(cs, c, sys, h, true).swing!.swung).toBe(false);
  });

  it("50 ataques sin inputs procesados en medio: un swing y, al impacto, un golpe por enemigo", () => {
    const { sys, e } = world(0, 1, 500);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    let swings = 0;
    for (let i = 0; i < 50; i++) if (cs.attack(c, input({ viewTick: 100 })).swung) swings++;
    expect(swings).toBe(1);
    expect(e.hp).toBe(500);
    let impacts = 0;
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      const { impact } = press(cs, c, sys, h, false, { inp: { viewTick: 100 } });
      if (impact) {
        impacts++;
        hits += impact.hits.length;
      }
    }
    expect(impacts).toBe(1);
    expect(hits).toBe(1);
    expect(e.hp).toBe(488);
  });

  it("no ataca muerto ni sin input.attack", () => {
    const cs = new CombatSystem();
    const dead = newCombatState("warrior", 1);
    dead.dead = true;
    expect(cs.attack(dead, input()).swung).toBe(false);
    expect(cs.attack(newCombatState("warrior", 1), input({ attack: false })).swung).toBe(false);
  });

  it("newCombatState usa STARTING_WEAPON por defecto y acepta otra arma", () => {
    expect(newCombatState("warrior", 1).weaponId).toBe(STARTING_WEAPON);
    expect(newCombatState("warrior", 1, "great-sword").weaponId).toBe("great-sword");
  });
});

describe("impacto", () => {
  it("attack no daña; el impacto llega tras ceil(0.45 × 0.35 / SIM_DT) = 5 inputs, por 12", () => {
    const { sys, e } = world(0, 1, 100);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    const first = press(cs, c, sys, h, true, { inp: { viewTick: 100 } });
    expect(first.swing).toEqual({ swung: true, step: 1 });
    expect(first.impact).toBeNull();
    expect(e.hp).toBe(100);
    expect(inputsFor(0.45 * 0.35)).toBe(5);
    for (let i = 1; i < 5; i++) {
      expect(press(cs, c, sys, h, false, { inp: { viewTick: 100 } }).impact, `input ${i}`).toBeNull();
      expect(e.hp).toBe(100);
    }
    const r = press(cs, c, sys, h, false, { inp: { viewTick: 100 } });
    expect(r.impact).toEqual({
      step: 1,
      hits: [{ enemyId: e.id, amount: 12, killed: false, x: 0, z: 1 }],
      kills: [],
    });
    expect(r.r.damage).toBe(0);
    expect(e.hp).toBe(88);
    for (let i = 0; i < 30; i++) expect(press(cs, c, sys, h, false).impact).toBeNull();
  });

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
    const { swing, impact } = swingToImpact(cs, c, sys, h, { viewTick: 100 }, { viewTick: 100 });
    expect(swing.step).toBe(3);
    expect(impact!.step).toBe(3);
    expect(impact!.hits).toHaveLength(1);
    expect(impact!.hits[0]).toMatchObject({ enemyId: e.id, amount: 18, killed: false });
    expect(e.hp).toBe(82);
    expect(back.hp).toBe(100);
  });

  it("las muertes salen en kills (posición, xp y drop) sin llamar a grantXp", () => {
    const { sys, e } = world(0, 1, 5);
    e.loadout = null;
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const { impact } = swingToImpact(cs, c, sys, new PositionHistory());
    expect(impact!.hits[0]!.killed).toBe(true);
    expect(impact!.kills).toEqual([{ x: 0, z: 1, xp: ENEMY_DEFS[e.kind].xp, drop: null }]);
    expect(cs.xp).toBe(0);
  });

  it("newCombatState lleva tier 1 por defecto y acepta otro", () => {
    expect(newCombatState("warrior", 1).weaponTier).toBe(1);
    expect(newCombatState("warrior", 1, "great-sword", 3).weaponTier).toBe(3);
  });

  it("un impacto de la Kingslayer tier 3 hace round(12 × 1.7) = 20", () => {
    const { sys, e } = world(0, 1, 100);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1, "kingslayer-sword", 3);
    const { impact } = swingToImpact(cs, c, sys, new PositionHistory());
    expect(Math.round(12 * 1.7)).toBe(20);
    expect(impact!.hits[0]!.amount).toBe(20);
    expect(e.hp).toBe(80);
  });

  it("el daño usa el nivel del grupo en el momento del impacto", () => {
    const { sys } = world(0, 1, 100);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const h = new PositionHistory();
    press(cs, c, sys, h, true);
    cs.level = 2;
    let impact = null;
    for (let i = 0; i < 10 && !impact; i++) impact = press(cs, c, sys, h, false).impact;
    expect(impact!.hits[0]!.amount).toBe(14);
  });

  it("dirección fijada: si el jugador gira entre el clic y el impacto, el arco usa la del clic", () => {
    const { sys, e } = world(0, 1.5, 100);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const { impact } = swingToImpact(cs, c, sys, new PositionHistory(), { facing: 0 }, { facing: Math.PI });
    expect(impact!.hits.map((x) => x.enemyId)).toEqual([e.id]);
    expect(c.swingFacing).toBe(0);
  });

  it("dirección fijada: un enemigo detrás de la dirección del clic no recibe el golpe aunque el jugador gire hacia él", () => {
    const { sys, e } = world(0, -1.5, 100);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    const { impact } = swingToImpact(cs, c, sys, new PositionHistory(), { facing: 0 }, { facing: Math.PI });
    expect(impact!.hits).toEqual([]);
    expect(e.hp).toBe(100);
  });

  it("mandoble: el paso 2 a nivel 3 hace 35 y alcanza a un enemigo a 3,1 m dentro de 220°", () => {
    const a = (100 * Math.PI) / 180; // a 100° de la dirección: dentro de 220°/2, fuera de 160°/2
    const { sys, e } = world(3.1 * Math.sin(a), 3.1 * Math.cos(a), 100);
    const cs = new CombatSystem();
    cs.level = 3;
    const c = newCombatState("warrior", 3, "great-sword");
    const h = new PositionHistory();
    // paso 1 (160°, 3,0 m): no llega
    const s1 = swingToImpact(cs, c, sys, h);
    expect(s1.swing.step).toBe(1);
    expect(s1.impact!.hits).toEqual([]);
    for (let i = 0; i < inputsFor(0.7) - 1 - s1.inputs; i++) press(cs, c, sys, h, false);
    const s2 = swingToImpact(cs, c, sys, h);
    expect(s2.swing.step).toBe(2);
    expect(s2.inputs).toBe(inputsFor(0.6 * 0.9));
    expect(s2.impact!.hits).toEqual([expect.objectContaining({ enemyId: e.id, amount: 35 })]);
    expect(e.hp).toBe(65);
  });
});

describe("Foco 1: golpe cancelado", () => {
  it("morir en step() entre el clic y el impacto lo anula, también tras reaparecer", () => {
    const { sys, e } = world(0, 1, 100);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    c.hp = 5;
    const h = new PositionHistory();
    const states = new Map([["a", c]]);
    press(cs, c, sys, h, true);
    cs.queueEnemyHits(states, [{ targetKey: "a", damage: 12, sourceId: "e" }], 0);
    expect(cs.step(states, REWIND_MAX_TICKS, SIM_DT).died).toEqual(["a"]);
    expect(c.impactPending).toBe(false);
    for (let i = 0; i < 10; i++) expect(press(cs, c, sys, h, false).impact).toBeNull();
    c.respawnIn = SIM_DT;
    cs.step(states, REWIND_MAX_TICKS + 1, SIM_DT);
    expect(c.dead).toBe(false);
    for (let i = 0; i < 10; i++) expect(press(cs, c, sys, h, false).impact).toBeNull();
    expect(e.hp).toBe(100);
  });

  it("morir por un golpe enemigo aplicado en un input anterior al impacto lo anula", () => {
    const { sys, e } = world(0, 1, 100);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1);
    c.hp = 5;
    const h = new PositionHistory();
    press(cs, c, sys, h, true);
    cs.queueEnemyHits(new Map([["a", c]]), [{ targetKey: "a", damage: 12, sourceId: "e" }], 50);
    expect(press(cs, c, sys, h, false, { inp: { viewTick: 50 } }).r).toEqual({ damage: 12, died: true, impact: null });
    for (let i = 0; i < 10; i++) expect(press(cs, c, sys, h, false).impact).toBeNull();
    expect(e.hp).toBe(100);
  });
});

describe("Foco 2: la misma arma rápida y lenta", () => {
  it("guard-sword: impacto en el input ceil(0.45 × (0.35/1.15) / SIM_DT) = 5 y el siguiente golpe se libera antes", () => {
    expect(inputsFor(0.45 * (0.35 / 1.15))).toBe(5);
    const { sys, e } = world(0, 1, 100);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1, "guard-sword");
    const h = new PositionHistory();
    const { impact, inputs } = swingToImpact(cs, c, sys, h);
    expect(inputs).toBe(5);
    expect(impact!.hits).toEqual([expect.objectContaining({ enemyId: e.id, amount: 10 })]);
    // libera el siguiente golpe tras ceil((0.35/1.15)/SIM_DT) = 10 inputs, frente a 11 de la espada inicial
    const free = inputsFor(0.35 / 1.15);
    expect(free).toBe(10);
    expect(free).toBeLessThan(inputsFor(0.35));
    for (let i = inputs; i < free - 1; i++) press(cs, c, sys, h, false);
    expect(press(cs, c, sys, h, true).swing!.swung).toBe(true);
  });

  it("procesando 3 inputs por tick el impacto ocurre una sola vez", () => {
    const { sys, e } = world(0, 1, 100);
    const cs = new CombatSystem();
    const c = newCombatState("warrior", 1, "guard-sword");
    const h = new PositionHistory();
    const states = new Map([["a", c]]);
    let impacts = 0;
    let sent = 0;
    for (let tick = 100; tick < 112; tick++) {
      for (let i = 0; i < 3; i++) {
        const r = press(cs, c, sys, h, sent === 0, { now: tick });
        sent++;
        if (r.impact) {
          impacts++;
          expect(sent - 1).toBe(5);
        }
      }
      cs.step(states, tick + 1, SIM_DT);
    }
    expect(impacts).toBe(1);
    expect(e.hp).toBe(90);
  });
});

describe("rebobinado al impacto", () => {
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
  const run = (sys: EnemySystem, h: PositionHistory, impactViewTick: number, clickViewTick = NOW) =>
    swingToImpact(new CombatSystem(), newCombatState("warrior", 1), sys, h, { viewTick: clickViewTick }, { viewTick: impactViewTick }, NOW);

  it("usa el viewTick del input del impacto: 100 con nowTick 104 golpea al que estaba en el arco (no el del clic)", () => {
    const { sys, h } = setup();
    const r = run(sys, h, 100, NOW);
    expect(r.impact!.hits).toHaveLength(1);
  });
  it("el viewTick del clic no cuenta: clic en 100, impacto con viewTick 104 → no golpea", () => {
    const { sys, h } = setup();
    const r = run(sys, h, NOW, 100);
    expect(r.impact!.hits).toHaveLength(0);
  });
  it("viewTick en el límite (nowTick − REWIND_MAX_TICKS) todavía rebobina", () => {
    const { sys, h } = setup(8, CLAMP);
    expect(run(sys, h, CLAMP).impact!.hits).toHaveLength(1);
  });
  it("un viewTick más viejo que el límite se lleva al límite y no golpea (el respaldo actual estaría en el arco)", () => {
    const { sys, h } = setup(1.5);
    const r = run(sys, h, CLAMP - 10);
    expect(r.swing.swung).toBe(true);
    expect(r.impact!.hits).toHaveLength(0);
  });
  it("un viewTick enorme se limita a nowTick (el respaldo actual estaría en el arco)", () => {
    const { sys, h } = setup(1.5);
    expect(run(sys, h, 1e9).impact!.hits).toHaveLength(0);
  });
});

describe("golpes de enemigos", () => {
  const H = 100;
  const hit = (damage: number) => [{ targetKey: "a", damage, sourceId: "e1" }];
  function ctx(c: CombatState) {
    const states = new Map([["a", c]]);
    const cs = new CombatSystem();
    const tick = (t: number) => cs.step(states, t, SIM_DT);
    return { states, cs, tick };
  }
  const idle = (viewTick: number) => input({ attack: false, interact: false, viewTick });

  it("se aplica en cuanto llega un input con viewTick >= H", () => {
    const c = newCombatState("warrior", 1);
    const { states, cs, tick } = ctx(c);
    cs.queueEnemyHits(states, hit(6), H);
    expect(tick(H).damaged).toEqual([]);
    expect(cs.onInputProcessed(c, kin(), idle(H - 1), H + 1, noEnemies(), new PositionHistory())).toEqual({ damage: 0, died: false, impact: null });
    expect(tick(H + 1).damaged).toEqual([]);
    expect(c.hp).toBe(120);
    expect(cs.onInputProcessed(c, kin(), idle(H), H + 1, noEnemies(), new PositionHistory())).toEqual({ damage: 6, died: false, impact: null });
    expect(c.hp).toBe(114);
    expect(c.pendingHits).toHaveLength(0);
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
    expect(cs.onInputProcessed(c, kin(), idle(H), H + 1, noEnemies(), new PositionHistory())).toEqual({ damage: 6, died: true, impact: null });
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
    const cs = new CombatSystem();
    cs.queueEnemyHits(states, [{ targetKey: "a", damage: 12, sourceId: "e" }], 0);
    const r = cs.step(states, REWIND_MAX_TICKS, 0.2);
    expect(r.died).toEqual(["a"]);
    expect(c.dead).toBe(true);
    expect(c.respawnIn).toBe(5);
    expect(c.pendingHits).toHaveLength(0);

    let respawned: string[] = [];
    for (let i = 0; i < 10; i++) {
      const rr = cs.step(states, REWIND_MAX_TICKS + 1 + i, 0.5);
      if (rr.respawned.length) respawned = rr.respawned;
    }
    expect(respawned).toEqual(["a"]);
    expect(c.dead).toBe(false);
    expect(c.hp).toBe(120);
    expect(c.invulnFor).toBe(1);

    cs.queueEnemyHits(states, [{ targetKey: "a", damage: 12, sourceId: "e" }], 100);
    expect(cs.onInputProcessed(c, kin(), input({ attack: false, interact: false, viewTick: 100 }), 100, noEnemies(), new PositionHistory()).damage).toBe(0);
    cs.queueEnemyHits(states, [{ targetKey: "a", damage: 12, sourceId: "e" }], 100);
    cs.step(states, 100 + REWIND_MAX_TICKS, 0.2);
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
