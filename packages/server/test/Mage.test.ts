import { describe, expect, it } from "vitest";
import {
  ABILITIES,
  MARK_S,
  METEOR_BIG_FALL_S,
  METEOR_RAIN_S,
  ORB_PULSE_S,
  SIM_DT,
  SPELL_RELEASE_S,
  createRng,
  newProgress,
  rollOffer,
  strikeDamage,
  weaponForClass,
  type AbilityId,
  type CombatEvent,
  type Dungeon,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";
import { AbilitySystem } from "../src/sim/AbilitySystem";
import { CombatSystem, moveSpeedMult, newCombatState, type CombatState } from "../src/sim/CombatSystem";
import { EnemySystem, type Enemy } from "../src/sim/EnemySystem";
import { PositionHistory } from "../src/sim/PositionHistory";

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

const NOW = 100;
const BASE = strikeDamage("staff", "mage", 1, 1, 1);
const kin = (over: Partial<KinematicState> = {}): KinematicState => ({ x: 20, z: 20, facing: 0, y: 0, vy: 0, ...over });
const mkInput = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, moveX: 0, moveZ: 0, facing: 0, sprint: false, jump: false, attack: false, interact: false, abilities: 0,
  viewTick: NOW, ...over,
});

function setup(abilities: { id: AbilityId; rank: number }[] = []) {
  const dungeon = arena();
  const sys = new EnemySystem(dungeon, createRng(7));
  const cs = new CombatSystem();
  const ab = new AbilitySystem(dungeon, cs);
  const h = new PositionHistory();
  const c = newCombatState("mage", 1);
  c.abilities = abilities.map((a) => ({ ...a }));
  const events: CombatEvent[] = [];
  const hits: { enemyId: string; amount: number }[] = [];
  return { dungeon, sys, cs, ab, h, c, events, hits };
}
type Env = ReturnType<typeof setup>;

function spawn(sys: EnemySystem, spots: { x: number; z: number }[], hp = 9999): Enemy[] {
  const es = sys.spawnWave(spots, ["minion"]);
  for (const e of es) e.hp = e.maxHp = hp;
  return es;
}

/** Un input como en RunRoom (combo, proyectil del bastón, habilidades, ataque) y un tick del mundo sin mover enemigos. */
function feed(env: Env, over: Partial<PlayerInput> = {}, k = kin(), party: CombatState[] = [env.c]) {
  const input = mkInput(over);
  const r = env.cs.onInputProcessed(env.c, k, input, NOW, env.sys, env.h, "a");
  if (r.shot) env.ab.staffShot(env.c, k, r.shot, "a", input.facing);
  const a = env.ab.onInput(env.c, k, input, NOW, env.sys, env.h, party, "a");
  env.hits.push(...a.hits);
  if (input.attack) env.cs.attack(env.c, input);
  for (const s of env.ab.step(new Map([["a", env.c]]), env.sys, SIM_DT, new Map([["a", k]]))) env.hits.push(...s.hits);
  env.events.push(...env.ab.takeEvents());
  return a;
}

function run(env: Env, seconds: number, over: Partial<PlayerInput> = {}, k = kin()) {
  for (let i = 0; i < Math.ceil(seconds / SIM_DT - 1e-9); i++) feed(env, over, k);
}

describe("mago: rol y bastón", () => {
  it("empieza con el bastón y menos vida que el caballero", () => {
    const m = newCombatState("mage", 1);
    expect(m.weaponId).toBe("staff");
    expect(m.maxHp).toBe(80);
    expect(newCombatState("warrior", 1).maxHp).toBe(120);
  });

  it("de la misma caída el mago recibe un bastón y el caballero la espada", () => {
    expect(weaponForClass("great-sword", "mage")).toBe("staff");
    expect(weaponForClass("great-sword", "warrior")).toBe("great-sword");
  });

  it("al mago solo le salen cartas de sus hechizos y al caballero las suyas", () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const cls of ["mage", "warrior"] as const) {
        for (const card of rollOffer(createRng(seed), newProgress(), { cls })) {
          if (card.kind === "ability") expect(ABILITIES[card.id].cls).toBe(cls);
        }
      }
    }
  });

  it("el ataque básico no pega en arco: suelta un proyectil que golpea al primer enemigo y se acaba", () => {
    const env = setup();
    const [near, far] = spawn(env.sys, [{ x: 20, z: 26 }, { x: 20, z: 30 }]);
    feed(env, { attack: true });
    expect(env.ab.playerShots).toHaveLength(0);
    run(env, 1);
    expect(env.hits).toEqual([expect.objectContaining({ enemyId: near!.id, amount: BASE })]);
    expect(far!.hp).toBe(9999);
    expect(env.ab.playerShots).toHaveLength(0);
  });

  it("un enemigo pegado al mago pero a su espalda no recibe el disparo", () => {
    const env = setup();
    const [behind] = spawn(env.sys, [{ x: 20, z: 18.5 }]);
    feed(env, { attack: true });
    run(env, 1.2);
    expect(behind!.hp).toBe(9999);
  });

  it("el bastón de fuego quema con el proyectil", () => {
    const env = setup();
    env.c.weaponNature = "fire";
    const [e] = spawn(env.sys, [{ x: 20, z: 25 }]);
    feed(env, { attack: true });
    run(env, 0.8);
    expect(e!.burn).not.toBeNull();
  });
});

describe("mago: hechizos", () => {
  const cast = (env: Env, over: Partial<PlayerInput> = {}) => feed(env, { abilities: 1, ...over });

  it("Escarcha congela una vez a quien está en la zona y el rango 3 lo deja lento al descongelarse", () => {
    const env = setup([{ id: "frost", rank: 3 }]);
    const [inside, outside] = spawn(env.sys, [{ x: 20, z: 26 }, { x: 30, z: 36 }]);
    const a = cast(env, { aimDist: 6 });
    expect(a.started).toBe("frost");
    expect(a.aimDist).toBeCloseTo(6);
    run(env, SPELL_RELEASE_S + 0.1);
    expect(inside!.frozen).toBeGreaterThan(0);
    expect(inside!.slow!.left).toBeGreaterThan(5);
    expect(outside!.frozen).toBe(0);
    expect(env.hits).toHaveLength(0);
  });

  it("Nova daña alrededor del mago; en el rango 3 tarda más, frena al mago y pega mucho más", () => {
    const env = setup([{ id: "nova", rank: 1 }]);
    const [e] = spawn(env.sys, [{ x: 20, z: 22.5 }]);
    cast(env);
    run(env, 0.5);
    expect(env.hits).toEqual([expect.objectContaining({ enemyId: e!.id, amount: Math.round(BASE * 1.5) })]);

    const big = setup([{ id: "nova", rank: 3 }]);
    spawn(big.sys, [{ x: 20, z: 24 }]);
    cast(big);
    run(big, 0.6);
    expect(big.hits).toHaveLength(0);
    expect(moveSpeedMult(big.c)).toBeCloseTo(0.5);
    run(big, 0.8);
    expect(big.hits).toEqual([expect.objectContaining({ amount: Math.round(BASE * 4.5) })]);
    expect(moveSpeedMult(big.c)).toBe(1);
  });

  it("Rayo arcano golpea solo al primero en el rango 1 y rebota en el 2", () => {
    const one = setup([{ id: "beam", rank: 1 }]);
    const [a1, b1] = spawn(one.sys, [{ x: 20, z: 25 }, { x: 22, z: 27 }]);
    cast(one);
    run(one, 0.4);
    expect(one.hits.map((h) => h.enemyId)).toEqual([a1!.id]);
    expect(b1!.hp).toBe(9999);
    expect(one.events.find((e) => e.type === "beam")).toBeDefined();

    const two = setup([{ id: "beam", rank: 2 }]);
    const [a2, b2] = spawn(two.sys, [{ x: 20, z: 25 }, { x: 22, z: 27 }]);
    cast(two);
    run(two, 0.4);
    expect(two.hits.map((h) => h.enemyId)).toEqual([a2!.id, b2!.id]);
    expect(two.hits[1]!.amount).toBe(Math.round(Math.round(BASE * 1.8) * 0.7));
  });

  it("la marca del Rayo (rango 3) explota con otro hechizo y se consume; el ataque básico no la detona", () => {
    const env = setup([{ id: "beam", rank: 3 }, { id: "nova", rank: 1 }]);
    const [e] = spawn(env.sys, [{ x: 20, z: 22.5 }]);
    cast(env);
    run(env, 0.6);
    expect(e!.marked).toBeGreaterThan(MARK_S - 1);
    feed(env, { attack: true });
    run(env, 0.7);
    expect(e!.marked).toBeGreaterThan(0);
    const before = env.hits.length;
    feed(env, { abilities: 2 });
    run(env, 0.6);
    expect(e!.marked).toBe(0);
    // el golpe de la Nova y el estallido de la marca
    expect(env.hits.length - before).toBe(2);
    expect(env.events.some((ev) => ev.type === "blast" && ev.kind === "mark")).toBe(true);
  });

  it("la Mina espera a que la pisen y el rango 3 deja cinco", () => {
    const env = setup([{ id: "mine", rank: 1 }]);
    cast(env, { aimDist: 6 });
    run(env, 1);
    expect(env.ab.playerZones.filter((z) => z.kind === "mine")).toHaveLength(1);
    expect(env.hits).toHaveLength(0);
    const [e] = spawn(env.sys, [{ x: 20, z: 26 }]);
    run(env, 0.1);
    expect(env.hits).toEqual([expect.objectContaining({ enemyId: e!.id, amount: BASE * 2 })]);
    expect(env.ab.playerZones).toHaveLength(0);

    const five = setup([{ id: "mine", rank: 3 }]);
    cast(five, { aimDist: 6 });
    run(five, 0.5);
    expect(five.ab.playerZones.filter((z) => z.kind === "mine")).toHaveLength(5);
  });

  it("el Remolino atraviesa y empuja; en el rango 3 salen ocho", () => {
    const env = setup([{ id: "gust", rank: 1 }]);
    const [a, b] = spawn(env.sys, [{ x: 20, z: 24 }, { x: 20, z: 27 }]);
    cast(env);
    run(env, 1.2);
    expect(env.hits.map((h) => h.enemyId).sort()).toEqual([a!.id, b!.id].sort());
    expect(a!.z).toBeGreaterThan(27);

    const eight = setup([{ id: "gust", rank: 3 }]);
    cast(eight);
    run(eight, SPELL_RELEASE_S + 0.05);
    expect(eight.ab.playerShots.filter((s) => s.kind === "gust")).toHaveLength(8);
  });

  it("la Esfera no golpea al tocar: pulsa daño a su alrededor; en el rango 3 deja rastro", () => {
    const env = setup([{ id: "orb", rank: 1 }]);
    const [e] = spawn(env.sys, [{ x: 21.5, z: 23 }]);
    cast(env);
    run(env, SPELL_RELEASE_S + ORB_PULSE_S * 2 + 0.1);
    const mine = env.hits.filter((h) => h.enemyId === e!.id);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine[0]!.amount).toBe(Math.round(BASE * 0.5));

    const trail = setup([{ id: "orb", rank: 3 }]);
    cast(trail);
    run(trail, 1.5);
    expect(trail.ab.playerZones.some((z) => z.kind === "trail")).toBe(true);
  });

  it("Sanación cura a todo el grupo vivo y su enfriamiento baja con el rango", () => {
    const env = setup([{ id: "heal", rank: 1 }]);
    const ally = newCombatState("warrior", 1);
    ally.hp = 10;
    env.c.hp = 10;
    feed(env, { abilities: 1 }, kin(), [env.c, ally]);
    expect(env.c.hp).toBeCloseTo(10 + 80 * 0.3);
    expect(ally.hp).toBeCloseTo(10 + 120 * 0.3);
    expect(env.c.abilityCd.heal).toBeCloseTo(20, 0);

    const max = setup([{ id: "heal", rank: 3 }]);
    max.c.hp = 1;
    feed(max, { abilities: 1 });
    expect(max.c.hp).toBe(max.c.maxHp);
    expect(max.c.abilityCd.heal).toBeCloseTo(17, 0);
  });

  it("Meteoros suelta los meteoritos del rango y, en el 3, uno gigante al final", () => {
    const env = setup([{ id: "meteors", rank: 1 }]);
    cast(env, { aimDist: 8 });
    run(env, SPELL_RELEASE_S + METEOR_RAIN_S + 1.5);
    expect(env.events.filter((e) => e.type === "blast" && e.kind === "meteor")).toHaveLength(5);
    expect(env.ab.playerZones).toHaveLength(0);

    const big = setup([{ id: "meteors", rank: 3 }]);
    const [e] = spawn(big.sys, [{ x: 20, z: 28 }]);
    cast(big, { aimDist: 8 });
    run(big, SPELL_RELEASE_S + METEOR_RAIN_S + METEOR_BIG_FALL_S + 0.5);
    expect(big.events.filter((ev) => ev.type === "blast" && ev.kind === "meteor")).toHaveLength(8);
    expect(big.events.filter((ev) => ev.type === "blast" && ev.kind === "meteorBig")).toHaveLength(1);
    expect(big.hits.some((h) => h.enemyId === e!.id && h.amount === BASE * 5)).toBe(true);
  });

  it("los hechizos llevan la naturaleza del bastón: con uno de fuego queman y con uno de hielo ralentizan", () => {
    const fire = setup([{ id: "nova", rank: 1 }]);
    fire.c.weaponNature = "fire";
    const [burned] = spawn(fire.sys, [{ x: 20, z: 22.5 }]);
    cast(fire);
    run(fire, 0.5);
    expect(burned!.burn).not.toBeNull();
    expect(fire.events.length).toBe(0);

    const ice = setup([{ id: "meteors", rank: 1 }]);
    ice.c.weaponNature = "ice";
    const [chilled] = spawn(ice.sys, [{ x: 20, z: 28 }]);
    cast(ice, { aimDist: 8 });
    run(ice, SPELL_RELEASE_S + METEOR_RAIN_S + 1);
    expect(chilled!.hp).toBeLessThan(9999);
    expect(chilled!.slow !== null || chilled!.frozen > 0 || chilled!.freezeImmune > 0).toBe(true);
    // Las zonas y los estallidos avisan su naturaleza para que el cliente los dibuje de ese color.
    expect(ice.events.filter((e) => e.type === "blast").every((e) => e.type === "blast" && e.nature === "ice")).toBe(true);
  });
});

describe("mago: legendarias", () => {
  const withLegendary = (abilities: { id: AbilityId; rank: number }[], legendary: string) => {
    const env = setup(abilities);
    env.c.fx = { ...env.c.fx, legendaries: [legendary as never] };
    return env;
  };

  it("tripleShot: el tercer golpe del bastón sale en abanico de tres", () => {
    const env = withLegendary([], "tripleShot");
    let most = 0;
    for (let i = 0; i < Math.ceil(2 / SIM_DT); i++) {
      feed(env, { attack: true });
      most = Math.max(most, env.ab.playerShots.filter((s) => s.kind === "bolt").length);
    }
    expect(most).toBeGreaterThanOrEqual(3);
  });

  it("healShield: la Sanación deja un escudo que absorbe daño", () => {
    const env = withLegendary([{ id: "heal", rank: 1 }], "healShield");
    feed(env, { abilities: 1 });
    expect(env.c.shield).toBeCloseTo(80 * 0.15);
    env.cs.queueEnemyHits(new Map([["a", env.c]]), [{ targetKey: "a", damage: 10, sourceX: 20, sourceZ: 21, sourceId: "x" }], NOW);
    const hp = env.c.hp;
    feed(env, { abilities: 1 });
    expect(env.c.hp).toBe(hp);
    expect(env.c.shield).toBeCloseTo(2);
  });

  it("orbTwin lanza dos esferas, mineCharges guarda dos minas y meteorBurn deja fuego", () => {
    const orb = withLegendary([{ id: "orb", rank: 1 }], "orbTwin");
    feed(orb, { abilities: 1 });
    run(orb, 0.4);
    expect(orb.ab.playerShots.filter((s) => s.kind === "orb")).toHaveLength(2);

    const mine = withLegendary([{ id: "mine", rank: 1 }], "mineCharges");
    feed(mine, { abilities: 1, aimDist: 4 });
    run(mine, 0.7);
    feed(mine, { abilities: 0 });
    feed(mine, { abilities: 1, aimDist: 8 });
    run(mine, 0.7);
    expect(mine.ab.playerZones.filter((z) => z.kind === "mine")).toHaveLength(2);

    const fire = withLegendary([{ id: "meteors", rank: 1 }], "meteorBurn");
    feed(fire, { abilities: 1, aimDist: 8 });
    run(fire, 2);
    expect(fire.ab.playerZones.some((z) => z.kind === "fire")).toBe(true);
  });

  it("beamPierce atraviesa a todos los de la línea y gustDash empuja al mago hacia atrás", () => {
    const beam = withLegendary([{ id: "beam", rank: 1 }], "beamPierce");
    const [a, b] = spawn(beam.sys, [{ x: 20, z: 24 }, { x: 20, z: 28 }]);
    feed(beam, { abilities: 1 });
    run(beam, 0.4);
    expect(beam.hits.map((h) => h.enemyId)).toEqual([a!.id, b!.id]);
    expect(beam.hits[1]!.amount).toBe(beam.hits[0]!.amount);

    const gust = withLegendary([{ id: "gust", rank: 1 }], "gustDash");
    feed(gust, { abilities: 1 });
    let dash: { x: number; z: number } | undefined;
    for (let i = 0; i < 30 && !dash; i++) dash = feed(gust).dash;
    expect(dash!.z).toBeCloseTo(16, 0);
  });
});

describe("mago: ajustes", () => {
  it("el proyectil sale hacia donde se apunta al soltarlo, no hacia donde empezó el golpe", () => {
    const env = setup();
    feed(env, { attack: true, facing: 0 });
    for (let i = 0; i < 30 && env.ab.playerShots.length === 0; i++) feed(env, { facing: Math.PI / 2 });
    const [shot] = env.ab.playerShots;
    expect(shot!.dirX).toBeCloseTo(1);
    expect(shot!.dirZ).toBeCloseTo(0);
  });

  it("la Esfera de rango 3 sale en las ocho direcciones", () => {
    const env = setup([{ id: "orb", rank: 3 }]);
    feed(env, { abilities: 1 });
    run(env, 0.4);
    const orbs = env.ab.playerShots.filter((s) => s.kind === "orb");
    expect(orbs).toHaveLength(8);
    expect(new Set(orbs.map((s) => `${s.dirX.toFixed(2)},${s.dirZ.toFixed(2)}`)).size).toBe(8);
  });

  it("al mago no le sale la carta de Alcance, y al caballero sí puede salirle", () => {
    const seen = { mage: false, warrior: false };
    for (let seed = 1; seed <= 200; seed++) {
      for (const cls of ["mage", "warrior"] as const) {
        if (rollOffer(createRng(seed), newProgress(), { cls }).some((c) => c.kind === "stat" && c.id === "reach")) seen[cls] = true;
      }
    }
    expect(seen).toEqual({ mage: false, warrior: true });
  });

  it("un hechizo apretado en mitad de un disparo sale al terminar el disparo", () => {
    const env = setup([{ id: "nova", rank: 1 }]);
    feed(env, { attack: true });
    expect(feed(env, { attack: true, abilities: 1 }).started).toBeUndefined();
    let started: AbilityId | undefined;
    for (let i = 0; i < 30 && !started; i++) started = feed(env, { attack: true, abilities: 1 }).started;
    expect(started).toBe("nova");
  });
});
