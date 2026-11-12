import { describe, expect, it } from "vitest";
import {
  BLADE_BLAST_MULT,
  BLADE_MARK_S,
  BLADE_SPLASH_MULT,
  SIM_DT,
  THRUST_TRAIL_S,
  createRng,
  strikeDamage,
  type AbilityId,
  type CombatEvent,
  type Dungeon,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";
import { AbilitySystem, abilityCharges } from "../src/sim/AbilitySystem";
import { attackSpeedOf, CombatSystem, damageMultOf, moveSpeedMult, newCombatState, type CombatState } from "../src/sim/CombatSystem";
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
const BASE = strikeDamage("kingslayer-sword", "warrior", 1, 1, 1);
const inputsFor = (s: number) => Math.ceil(s / SIM_DT - 1e-9);
const mkInput = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, moveX: 0, moveZ: 0, facing: 0, sprint: false, jump: false, attack: false, interact: false, abilities: 0, viewTick: NOW, ...over,
});

function setup(abilities: { id: AbilityId; rank: number }[]) {
  const dungeon = arena();
  const sys = new EnemySystem(dungeon, createRng(7));
  const cs = new CombatSystem();
  const ab = new AbilitySystem(dungeon, cs);
  const c = newCombatState("warrior", 1);
  c.abilities = abilities.map((a) => ({ ...a }));
  // Como RunRoom: la posición la lleva el registro y la mueven los saltos y embestidas.
  const env = { sys, cs, ab, h: new PositionHistory(), c, k: { x: 20, z: 20, facing: 0, y: 0, vy: 0 } as KinematicState, hits: [] as { enemyId: string; amount: number }[], events: [] as CombatEvent[] };
  return env;
}
type Env = ReturnType<typeof setup>;

function spawn(sys: EnemySystem, spots: { x: number; z: number }[], hp = 9999): Enemy[] {
  const es = sys.spawnWave(spots, ["minion"]);
  for (const e of es) e.hp = e.maxHp = hp;
  return es;
}

/** Un input como en RunRoom (combo, habilidad, ataque) y un tick del mundo; los enemigos no se mueven solos. */
function feed(env: Env, over: Partial<PlayerInput> = {}, party: CombatState[] = [env.c], partyAt = new Map<CombatState, { x: number; z: number }>()) {
  const input = mkInput(over);
  const r = env.cs.onInputProcessed(env.c, env.k, input, NOW, env.sys, env.h, "a");
  if (r.impact) env.hits.push(...r.impact.hits);
  const a = env.ab.onInput(env.c, env.k, input, NOW, env.sys, env.h, party, "a", partyAt);
  if (a.dash) env.k = { ...env.k, x: a.dash.x, z: a.dash.z };
  env.hits.push(...a.hits);
  if (input.attack) env.cs.attack(env.c, input);
  for (const s of env.ab.step(new Map([["a", env.c]]), env.sys, SIM_DT, new Map([["a", env.k]]))) env.hits.push(...s.hits);
  env.events.push(...env.ab.takeEvents());
  env.c.invulnFor = Math.max(0, env.c.invulnFor - SIM_DT);
  return a;
}
const run = (env: Env, s: number, over: Partial<PlayerInput> = {}) => {
  for (let i = 0; i < inputsFor(s); i++) feed(env, over);
};

describe("Torbellino", () => {
  it("rango 2: más daño y 1 s menos de enfriamiento", () => {
    const env = setup([{ id: "whirlwind", rank: 2 }]);
    spawn(env.sys, [{ x: 20, z: 22 }]);
    feed(env, { abilities: 1 });
    run(env, 1);
    expect(env.hits.map((h) => h.amount)).toEqual([Math.round(BASE * 1.6)]);
    expect(env.c.abilityCd.whirlwind).toBeLessThan(7);
  });

  it("rango 3: gira 4 s golpeando una y otra vez, aparta a los enemigos y frena al caballero mientras gira", () => {
    const env = setup([{ id: "whirlwind", rank: 3 }]);
    const [e] = spawn(env.sys, [{ x: 20, z: 21.5 }]);
    feed(env, { abilities: 1 });
    run(env, 0.3);
    expect(moveSpeedMult(env.c)).toBeLessThan(1);
    run(env, 3.9);
    // Lo aparta un poco a cada golpe hasta sacarlo del radio (en partida vuelven a entrar caminando).
    expect(env.hits.length).toBeGreaterThanOrEqual(5);
    expect(env.hits.every((h) => h.enemyId === e!.id)).toBe(true);
    expect(e!.z).toBeGreaterThan(22);
    run(env, 0.3);
    expect(env.c.abilityAnim).toBeNull();
    expect(moveSpeedMult(env.c)).toBe(1);
  });
});

describe("Grito de guerra", () => {
  it("solo llega a los aliados cercanos; el rango 3 da +30 % de daño y +20 % de velocidad de ataque 12 s", () => {
    const env = setup([{ id: "warcry", rank: 3 }]);
    const near = newCombatState("warrior", 1);
    const far = newCombatState("mage", 1);
    const at = new Map([[near, { x: 24, z: 20 }], [far, { x: 20, z: 35 }]]);
    feed(env, { abilities: 1 }, [env.c, near, far], at);
    expect(near.buffDamage).toBe(0.3);
    expect(near.buffLeft).toBe(12);
    expect(attackSpeedOf(near)).toBeCloseTo(1.2);
    expect(far.buffDamage).toBe(0);
    expect(env.c.abilityCd.warcry).toBeCloseTo(17, 1);
  });
});

describe("Golpe sísmico", () => {
  it("es invulnerable durante la animación y aturde 1 s a los golpeados", () => {
    const env = setup([{ id: "slam", rank: 1 }]);
    const [e] = spawn(env.sys, [{ x: 22, z: 20 }]);
    feed(env, { abilities: 1 });
    expect(env.c.invulnFor).toBeGreaterThan(0.8);
    run(env, 0.55);
    expect(env.hits).toHaveLength(1);
    expect(e!.stunned).toBeGreaterThan(0.9);
  });

  it("rango 3: canaliza antes del golpe (no golpea al aterrizar) y hace daño masivo", () => {
    const env = setup([{ id: "slam", rank: 3 }]);
    spawn(env.sys, [{ x: 22, z: 20 }]);
    feed(env, { abilities: 1 });
    run(env, 0.6);
    expect(env.hits).toHaveLength(0);
    run(env, 0.6);
    expect(env.hits.map((h) => h.amount)).toEqual([BASE * 4]);
  });
});

describe("Tajo frontal", () => {
  it("embiste 10 m atravesando enemigos y deja un rastro que sigue dañando", () => {
    const env = setup([{ id: "thrust", rank: 1 }]);
    const [a, b] = spawn(env.sys, [{ x: 20, z: 23 }, { x: 20.4, z: 27 }]);
    feed(env, { abilities: 1 });
    run(env, 0.4);
    expect(env.k.z).toBeCloseTo(30, 0);
    const first = env.hits.filter((h) => h.amount === Math.round(BASE * 1.5)).map((h) => h.enemyId).sort();
    expect(first).toEqual([a!.id, b!.id].sort());
    expect(env.ab.playerZones.filter((z) => z.kind === "scar").length).toBeGreaterThan(4);
    const before = a!.hp;
    run(env, 1.1);
    expect(a!.hp).toBeLessThan(before);
    run(env, THRUST_TRAIL_S);
    expect(env.ab.playerZones.filter((z) => z.kind === "scar")).toHaveLength(0);
  });

  it("rango 3: tres cargas seguidas", () => {
    const env = setup([{ id: "thrust", rank: 3 }]);
    expect(abilityCharges(env.c, "thrust")).toBe(3);
    for (let n = 0; n < 3; n++) {
      expect(feed(env, { abilities: 1 }).started).toBe("thrust");
      run(env, 0.5);
    }
    expect(feed(env, { abilities: 1 }).started).toBeUndefined();
  });
});

describe("Lanzar la espada", () => {
  it("rango 3: ocho espadas en todas las direcciones que marcan; el siguiente golpe del caballero hace estallar la marca", () => {
    const env = setup([{ id: "throw", rank: 3 }]);
    const [target, neighbour] = spawn(env.sys, [{ x: 20, z: 21.5 }, { x: 21.5, z: 21.5 }]);
    feed(env, { abilities: 1 });
    run(env, 0.25);
    expect(env.ab.playerShots.filter((s) => s.kind === "sword")).toHaveLength(8);
    run(env, 1.2);
    expect(target!.bladeMark).toBeGreaterThan(BLADE_MARK_S - 2);
    // La vuelta de las propias espadas no la hace estallar.
    run(env, 1.5);
    expect(target!.bladeMark).toBeGreaterThan(0);
    const hp = target!.hp;
    const nHp = neighbour!.hp;
    // Un tajo normal (de frente) la hace estallar.
    feed(env, { attack: true });
    run(env, 0.4);
    expect(target!.bladeMark).toBe(0);
    expect(env.events.some((e) => e.type === "blast" && e.kind === "blade")).toBe(true);
    expect(hp - target!.hp).toBeGreaterThanOrEqual(BASE * BLADE_BLAST_MULT);
    expect(nHp - neighbour!.hp).toBeGreaterThanOrEqual(Math.round(BASE * BLADE_SPLASH_MULT));
  });
});

describe("Gancho de cadena", () => {
  it("rango 3: atrae a todos a 20 m, los aturde 2 s y deja al caballero invulnerable 2 s", () => {
    const env = setup([{ id: "hook", rank: 3 }]);
    const es = spawn(env.sys, [{ x: 20, z: 38 }, { x: 36, z: 20 }, { x: 25, z: 25 }]);
    feed(env, { abilities: 1 });
    run(env, 0.3);
    for (const e of es) {
      expect(e.stunned).toBeGreaterThan(1.5);
      expect(Math.hypot(e.x - 20, e.z - 20)).toBeLessThan(3);
    }
    expect(env.c.invulnFor).toBeGreaterThan(1.5);
  });
});

describe("Estandarte", () => {
  it("da daño extra al grupo dentro; en rango 3 sus golpes llevan fuego, hielo y rayo a la vez", () => {
    const env = setup([{ id: "banner", rank: 3 }]);
    const [e] = spawn(env.sys, [{ x: 20, z: 21.5 }]);
    feed(env, { abilities: 1 });
    run(env, 0.7);
    expect(damageMultOf(env.c)).toBeCloseTo(1.5);
    feed(env, { attack: true });
    run(env, 0.4);
    expect(e!.burn).not.toBeNull();
    expect(e!.slow).not.toBeNull();
    // Fuera del estandarte se pierde enseguida.
    env.k = { ...env.k, x: 35, z: 35 };
    run(env, 0.1);
    expect(damageMultOf(env.c)).toBe(1);
  });
});
