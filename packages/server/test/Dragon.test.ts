import { describe, expect, it } from "vitest";
import { createRng, DRAGON, dragonFloorScale, dragonHp, SIM_DT, type Dungeon } from "@roguelike/shared";
import { chooseMove, newBossState, stripBurnt } from "../src/sim/dragon";
import { EnemySystem, type EnemyHit, type SimPlayer } from "../src/sim/EnemySystem";

/** Sala abierta de 20×20 casillas: x y z entre 4 y 44 m. */
function arena(): Dungeon {
  const width = 24;
  const tiles = new Uint8Array(width * width);
  for (let z = 2; z < 22; z++) for (let x = 2; x < 22; x++) tiles[z * width + x] = 1;
  const rooms = [{ id: 0, x: 2, z: 2, w: 20, h: 20, kind: "boss" as const, neighbors: [] }];
  return { seed: 1, floor: 1, width, height: width, tiles, rooms, startRoomId: 0, bossRoomId: 0 };
}

const P = (key: string, x: number, z: number): SimPlayer => ({ key, x, z, alive: true });

/** El dragón en (24, 24) mirando a +Z, ya sin entrada ni espera. */
function setup() {
  const sys = new EnemySystem(arena(), createRng(3));
  const e = sys.spawnBoss(24, 24, 1000, 1);
  e.boss!.intro = 0;
  return { sys, e };
}

/** Corre `s` segundos con esos jugadores y junta los golpes. */
function run(sys: EnemySystem, players: SimPlayer[], s: number): EnemyHit[] {
  const hits: EnemyHit[] = [];
  for (let i = 0; i < Math.ceil(s / SIM_DT); i++) hits.push(...sys.step(players, SIM_DT));
  return hits;
}

describe("dragón: elección de ataque", () => {
  const body = (specials = 0) => ({ id: "e1", x: 0, z: 0, facing: 0, hp: 1, maxHp: 1, damageMult: 1, slowFrac: 0, cooldown: 0, boss: { ...newBossState(), specials } });
  it("pisotón si lo rodean dos; zarpazo de cerca; lanzallamas a media distancia; pasada lejos o cada tercer especial", () => {
    expect(chooseMove(body(), P("a", 0, 2), [P("a", 0, 2), P("b", 2, 0)])).toBe("stomp");
    expect(chooseMove(body(), P("a", 0, 3), [P("a", 0, 3)])).toBe("claw");
    expect(chooseMove(body(), P("a", 0, 8), [P("a", 0, 8)])).toBe("flame");
    expect(chooseMove(body(), P("a", 0, 15), [P("a", 0, 15)])).toBe("flyby");
    expect(chooseMove(body(2), P("a", 0, 8), [P("a", 0, 8)])).toBe("flyby");
  });
  it("la vida escala con jugadores y piso", () => {
    expect(dragonHp(1, 1, 0, 1)).toBe(DRAGON.hp);
    expect(dragonHp(2, 1, 0, 1)).toBe(DRAGON.hp * 1.75);
    expect(dragonHp(1, 3, 0, 1)).toBe(Math.round(DRAGON.hp * 1.6 ** 2));
  });

  it("cada piso es más duro: más vida, más daño, más rápido y con armadura (con tope)", () => {
    const [f1, f2, f9] = [1, 2, 9].map(dragonFloorScale);
    expect(f1).toEqual({ hp: 1, damage: 1, tempo: 1, armor: 0 });
    expect(f2!.hp).toBeGreaterThan(f1!.hp);
    expect(f2!.damage).toBeGreaterThan(f1!.damage);
    expect(f2!.tempo).toBeGreaterThan(1);
    expect(f2!.armor).toBeGreaterThan(0);
    expect(f9!.tempo).toBeLessThanOrEqual(1.8);
    expect(f9!.armor).toBeLessThanOrEqual(0.6);
  });
});

describe("dragón: escalado del piso", () => {
  it("la armadura le quita esa fracción a cada golpe", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const e = sys.spawnBoss(24, 24, 1000, 1, { tempo: 1, armor: 0.4 });
    const [r] = sys.strike(e.id, 100, { key: "a", nature: "none", affinity: 0 } as never);
    expect(r!.amount).toBe(60);
    expect(e.hp).toBe(940);
  });

  it("con más ritmo el aviso dura menos", () => {
    const warn = (tempo: number) => {
      const sys = new EnemySystem(arena(), createRng(3));
      const e = sys.spawnBoss(24, 24, 1000, 1, { tempo, armor: 0 });
      e.boss!.intro = 0;
      sys.step([P("a", 24, 26)], SIM_DT);
      return e.boss!.stageLeft;
    };
    expect(warn(1.5)).toBeLessThan(warn(1));
  });
});

describe("dragón: ataques", () => {
  it("espera su entrada antes de atacar", () => {
    const sys = new EnemySystem(arena(), createRng(3));
    const e = sys.spawnBoss(24, 24, 1000, 1);
    run(sys, [P("a", 24, 27)], DRAGON.introS - 0.2);
    expect(e.boss!.move).toBeNull();
    run(sys, [P("a", 24, 27)], 0.3);
    expect(e.boss!.move).toBe("claw");
  });

  it("zarpazo: avisa en el suelo y golpea al de delante, no al de detrás", () => {
    const { sys, e } = setup();
    const front = P("a", 24, 27);
    const back = P("b", 24, 21.5);
    // Solo el de delante está a tiro: el pisotón necesita dos cerca.
    const hits = run(sys, [front], 0.1);
    expect(e.boss!.move).toBe("claw");
    expect(sys.hazards.map((h) => h.kind)).toEqual(["arc"]);
    hits.push(...run(sys, [front, back], DRAGON.claw.warnS));
    expect(hits.map((h) => h.targetKey)).toEqual(["a"]);
    expect(hits[0]!.damage).toBe(DRAGON.claw.damage);
    expect(sys.hazards).toHaveLength(0);
  });

  it("lanzallamas: tras el aviso quema a pulsos dentro del cono y deja quemadura", () => {
    const { sys, e } = setup();
    const p = P("a", 24, 31);
    run(sys, [p], 0.1);
    expect(e.boss!.move).toBe("flame");
    const hits = run(sys, [p], DRAGON.flame.warnS + DRAGON.flame.fireS);
    const pulses = Math.floor(DRAGON.flame.fireS / DRAGON.flame.tickS);
    expect(hits.length).toBeGreaterThanOrEqual(pulses);
    expect(hits.every((h) => h.element === "fire" && h.burnDps === DRAGON.flame.burnDps)).toBe(true);
    expect(e.boss!.move).toBeNull();
  });

  it("pasada: despega, no recibe daño en vuelo, cruza la sala y deja una franja que quema", () => {
    const { sys, e } = setup();
    const p = P("a", 24, 40);
    run(sys, [p], 0.1);
    expect(e.boss!.move).toBe("flyby");
    run(sys, [p], DRAGON.flyby.takeoffS);
    expect(e.boss!.airborne).toBe(true);
    const r = sys.strike(e.id, 100, { key: "a", nature: "none", affinity: 0 });
    expect(r[0]!.amount).toBe(0);
    expect(e.hp).toBe(1000);
    // Vuela hacia el jugador hasta cerca del muro y aterriza.
    const hits = run(sys, [p], 2);
    expect(e.boss!.airborne).toBe(false);
    expect(e.z).toBeGreaterThan(38);
    expect(hits.some((h) => h.targetKey === "a" && h.element === "fire")).toBe(true);
    const strip = sys.hazards.find((h) => h.kind === "strip")!;
    expect(stripBurnt(strip)).toBeCloseTo(strip.length);
  });

  it("pisotón: con dos cerca, daña y aparta a los dos", () => {
    const { sys, e } = setup();
    const ps = [P("a", 24, 26), P("b", 26, 24)];
    const hits = run(sys, ps, 0.1 + DRAGON.stomp.warnS);
    expect(e.boss!.move).toBeNull();
    expect(hits.map((h) => h.targetKey).sort()).toEqual(["a", "b"]);
    expect(sys.takePushes().map((x) => x.m)).toEqual([DRAGON.stomp.pushM, DRAGON.stomp.pushM]);
  });

  it("con la mitad de vida se enfurece: avisa y lo dice una vez; la pasada deja dos franjas", () => {
    const { sys, e } = setup();
    e.hp = 499;
    run(sys, [P("a", 24, 40)], 0.1);
    expect(e.boss!.enraged).toBe(true);
    expect(sys.takeEvents().filter((ev) => ev.type === "boss")).toHaveLength(1);
    expect(sys.hazards.filter((h) => h.kind === "strip")).toHaveLength(2);
  });

  it("no lo empujan, no lo aturden y sus avisos se van si muere", () => {
    const { sys, e } = setup();
    sys.knockback(e.id, 1, 0, 5);
    sys.stun(e.id, 3);
    expect([e.x, e.stunned]).toEqual([24, 0]);
    run(sys, [P("a", 24, 27)], 0.1);
    expect(sys.hazards).toHaveLength(1);
    sys.damage(e.id, 5000);
    run(sys, [P("a", 24, 27)], 0.1);
    expect(sys.hazards).toHaveLength(0);
    expect(sys.boss()).toBeUndefined();
  });
});
