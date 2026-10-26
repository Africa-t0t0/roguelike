import { describe, expect, it } from "vitest";
import {
  ENEMY_DEFS,
  SIM_DT,
  createRng,
  newProgress,
  playerMods,
  strikeDamage,
  type AbilityId,
  type Dungeon,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";
import { AbilitySystem } from "../src/sim/AbilitySystem";
import { CombatSystem, moveSpeedMult, newCombatState, type CombatState } from "../src/sim/CombatSystem";
import { EnemySystem, type Enemy, type EnemyHit, type SimPlayer } from "../src/sim/EnemySystem";
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
const inputsFor = (seconds: number) => Math.ceil(seconds / SIM_DT - 1e-9);
const P = (key: string, x: number, z: number): SimPlayer => ({ key, x, z, alive: true });

const kin = (over: Partial<KinematicState> = {}): KinematicState => ({ x: 28, z: 28, facing: 0, y: 0, vy: 0, ...over });
const mkInput = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, moveX: 0, moveZ: 0, facing: 0, sprint: false, jump: false, attack: false, interact: false, abilities: 0,
  viewTick: NOW, ...over,
});

function setup(abilities: { id: AbilityId; rank: number }[]) {
  const dungeon = arena();
  const sys = new EnemySystem(dungeon, createRng(7));
  const cs = new CombatSystem();
  const ab = new AbilitySystem(dungeon, cs);
  const h = new PositionHistory();
  const c = newCombatState("warrior", 1);
  c.abilities = abilities.map((a) => ({ ...a }));
  return { dungeon, sys, cs, ab, h, c };
}
type Env = ReturnType<typeof setup>;

/** Minions con mucha vida en esos puntos. */
function spawn(sys: EnemySystem, spots: { x: number; z: number }[], hp = 9999): Enemy[] {
  const es = sys.spawnWave(spots, ["minion"]);
  for (const e of es) e.hp = e.maxHp = hp;
  return es;
}

/** Un input como en RunRoom: combo (y onda), habilidades y después el ataque. */
function feed(env: Env, over: Partial<PlayerInput> = {}, k = kin(), c: CombatState = env.c, party: CombatState[] = [c]) {
  const input = mkInput(over);
  const r = env.cs.onInputProcessed(c, k, input, NOW, env.sys, env.h);
  if (r.impact) env.ab.onComboImpact(c, k, r.impact.step, "a");
  const a = env.ab.onInput(c, k, input, NOW, env.sys, env.h, party);
  const swing = input.attack ? env.cs.attack(c, input) : undefined;
  return { r, a, swing };
}

/** Mantiene `mask` hasta que algún input golpee (máx. 60); devuelve en qué input y sus golpes. */
function untilHits(env: Env, mask: number, k = kin()) {
  for (let i = 1; i <= 60; i++) {
    const { a } = feed(env, { abilities: mask }, k);
    if (a.hits.length > 0) return { at: i, hits: a.hits };
  }
  return { at: -1, hits: [] };
}

const tickAbilities = (env: Env, n: number, states = new Map([["a", env.c]])) => {
  for (let i = 0; i < n; i++) env.ab.step(states, env.sys, SIM_DT);
};

describe("Torbellino", () => {
  it("rango 1: golpea a los 3 de alrededor a 2,5 m en su impacto, no al de 3,5 m; enfriamiento de 8 s", () => {
    // La pasiva no ocupa casilla: la tecla 1 es el Torbellino.
    const env = setup([{ id: "cleave", rank: 1 }, { id: "whirlwind", rank: 1 }]);
    const near = spawn(env.sys, [{ x: 28, z: 30.5 }, { x: 30.5, z: 28 }, { x: 25.5, z: 28 }]);
    const [far] = spawn(env.sys, [{ x: 28, z: 24.5 }]);

    expect(feed(env, { abilities: 1 }).a.started).toBe("whirlwind");
    const { at, hits } = untilHits(env, 1);
    expect(at).toBe(inputsFor(0.5 * 0.9));
    const amount = Math.round(BASE * 1.2);
    expect(hits.map((x) => x.enemyId).sort()).toEqual(near.map((e) => e.id).sort());
    expect(hits.every((x) => x.amount === amount)).toBe(true);
    for (const e of near) expect(e.hp).toBe(9999 - amount);
    expect(far!.hp).toBe(9999);
    expect(env.c.abilityCd.whirlwind).toBe(8);

    // Termina la animación; repetirlo en enfriamiento no hace nada.
    for (let i = 0; i < 30; i++) feed(env);
    expect(env.c.abilityAnim).toBeNull();
    tickAbilities(env, inputsFor(8) - 1);
    expect(feed(env, { abilities: 1 }).a.started).toBeUndefined();
    feed(env);
    tickAbilities(env, 1);
    expect(feed(env, { abilities: 1 }).a.started).toBe("whirlwind");
  });

  it("mantener la tecla no lo repite: hace falta soltarla", () => {
    const env = setup([{ id: "whirlwind", rank: 1 }]);
    expect(feed(env, { abilities: 1 }).a.started).toBe("whirlwind");
    for (let i = 0; i < 30; i++) feed(env, { abilities: 1 });
    tickAbilities(env, inputsFor(8));
    expect(feed(env, { abilities: 1 }).a.started).toBeUndefined();
  });

  it("rango 3: golpea dos veces, con 0,4 s entre golpes", () => {
    const env = setup([{ id: "whirlwind", rank: 3 }]);
    const [e] = spawn(env.sys, [{ x: 28, z: 30.5 }]);
    feed(env, { abilities: 1 });
    const first = untilHits(env, 0);
    const second = untilHits(env, 0);
    expect(first.at).toBe(inputsFor(0.45));
    expect(second.at).toBe(inputsFor(0.4));
    expect(e!.hp).toBe(9999 - 2 * Math.round(BASE * 1.6));
  });
});

describe("Patada", () => {
  it("daña al de enfrente, lo empuja ~3 m y lo aturde 1 s; al de la espalda no", () => {
    const env = setup([{ id: "kick", rank: 1 }]);
    const [front, back] = spawn(env.sys, [{ x: 28, z: 29.5 }, { x: 28, z: 26.5 }]);
    expect(feed(env, { abilities: 1 }).a.started).toBe("kick");
    const { at, hits } = untilHits(env, 1);
    expect(at).toBe(inputsFor(0.4 * 0.6));
    expect(hits.map((x) => x.enemyId)).toEqual([front!.id]);
    expect(front!.hp).toBe(9999 - Math.round(BASE * 0.5));
    expect(front!.z).toBeCloseTo(32.5, 5);
    expect(front!.x).toBeCloseTo(28, 5);
    expect(front!.stunned).toBe(1);
    expect(back!.hp).toBe(9999);
    expect(back!.z).toBe(26.5);
    expect(back!.stunned).toBe(0);
    expect(env.c.abilityCd.kick).toBe(6);

    // Aturdido: no se mueve durante ese segundo.
    const players = [P("a", 28, 28)];
    for (let i = 0; i < inputsFor(1) - 1; i++) env.sys.step(players, SIM_DT);
    expect(front!.z).toBeCloseTo(32.5, 5);
    expect(front!.stunned).toBeGreaterThan(0);
    env.sys.step(players, SIM_DT);
    expect(front!.stunned).toBe(0);
    env.sys.step(players, SIM_DT);
    expect(front!.z).toBeLessThan(32.5);
  });

  it("el empuje no atraviesa un muro cercano", () => {
    const env = setup([{ id: "kick", rank: 1 }]);
    const [e] = spawn(env.sys, [{ x: 28, z: 38.5 }]);
    feed(env, { abilities: 1 }, kin({ z: 37 }));
    untilHits(env, 0, kin({ z: 37 }));
    expect(e!.z).toBeCloseTo(40 - ENEMY_DEFS.minion.radius, 5);
  });

  it("el aturdido cancela la telegrafía y no ataca en ese tiempo", () => {
    const env = setup([]);
    const [e] = spawn(env.sys, [{ x: 28, z: 29 }]);
    const players = [P("a", 28, 28)];
    env.sys.step(players, SIM_DT);
    expect(e!.ai).toBe("telegraph");
    env.sys.stun(e!.id, 1);
    expect(e!.ai).toBe("chase");
    const hits: EnemyHit[] = [];
    for (let i = 0; i < inputsFor(1); i++) hits.push(...env.sys.step(players, SIM_DT));
    expect(hits).toEqual([]);
    for (let i = 0; i < 30; i++) hits.push(...env.sys.step(players, SIM_DT));
    expect(hits.length).toBeGreaterThan(0);
  });

  it("stunImmune no se aturde (el empuje sí)", () => {
    const env = setup([]);
    const [e] = spawn(env.sys, [{ x: 28, z: 29 }]);
    ENEMY_DEFS.minion.stunImmune = true;
    try {
      env.sys.stun(e!.id, 1);
      expect(e!.stunned).toBe(0);
      env.sys.knockback(e!.id, 0, 2, 3);
      expect(e!.z).toBeCloseTo(32, 5);
    } finally {
      delete ENEMY_DEFS.minion.stunImmune;
    }
  });
});

describe("Grito de guerra", () => {
  it("da +25 % a los dos del grupo durante 8 s y el golpe del otro hace round(base × 1,25)", () => {
    const env = setup([{ id: "warcry", rank: 1 }]);
    const other = newCombatState("warrior", 1);
    const party = [env.c, other];
    expect(feed(env, { abilities: 1 }, kin(), env.c, party).a.started).toBe("warcry");
    for (const p of party) {
      expect(p.buffDamage).toBe(0.25);
      expect(p.buffLeft).toBe(8);
    }

    const [e] = spawn(env.sys, [{ x: 28, z: 29.5 }]);
    feed(env, { attack: true }, kin(), other, party);
    let hit = 0;
    for (let i = 0; i < 30 && hit === 0; i++) {
      const r = feed(env, {}, kin(), other, party).r;
      if (r.impact) hit = r.impact.hits[0]!.amount;
    }
    expect(hit).toBe(Math.round(BASE * 1.25));
    expect(e!.hp).toBe(9999 - hit);

    const states = new Map([["a", env.c], ["b", other]]);
    tickAbilities(env, inputsFor(8) - 1, states);
    expect(other.buffDamage).toBe(0.25);
    tickAbilities(env, 1, states);
    expect(other.buffDamage).toBe(0);
    expect(env.c.buffDamage).toBe(0);
  });

  it("con un Grito mayor activo se queda el mayor; los muertos no lo reciben", () => {
    const env = setup([{ id: "warcry", rank: 1 }]);
    const strong = newCombatState("warrior", 1);
    strong.buffDamage = 0.45;
    strong.buffLeft = 3;
    const dead = newCombatState("warrior", 1);
    dead.dead = true;
    feed(env, { abilities: 1 }, kin(), env.c, [env.c, strong, dead]);
    expect(strong.buffDamage).toBe(0.45);
    expect(strong.buffLeft).toBe(3);
    expect(dead.buffDamage).toBe(0);
  });

  it("el daño de habilidad lleva la Fuerza y el Grito", () => {
    const env = setup([{ id: "slam", rank: 1 }]);
    env.c.mods = playerMods({ ...newProgress(), stats: { strength: 2 } });
    env.c.buffDamage = 0.35;
    env.c.buffLeft = 8;
    spawn(env.sys, [{ x: 28, z: 30 }]);
    feed(env, { abilities: 1 });
    const { hits } = untilHits(env, 0);
    expect(hits[0]!.amount).toBe(Math.round(BASE * 1.5 * 1.2 * 1.35));
  });
});

describe("Golpe sísmico", () => {
  it("daña en radio 3,5 a los 0,5 s", () => {
    const env = setup([{ id: "slam", rank: 1 }]);
    const [inside, outside] = spawn(env.sys, [{ x: 31, z: 28 }, { x: 28, z: 23.8 }]);
    expect(feed(env, { abilities: 1 }).a.started).toBe("slam");
    const { at, hits } = untilHits(env, 0);
    expect(at).toBe(inputsFor(0.5));
    expect(hits.map((x) => x.enemyId)).toEqual([inside!.id]);
    expect(inside!.hp).toBe(9999 - Math.round(BASE * 1.5));
    expect(outside!.hp).toBe(9999);
  });

  it("el impacto usa el rango del momento de lanzarla aunque suba de rango antes del impacto", () => {
    const env = setup([{ id: "slam", rank: 1 }]);
    spawn(env.sys, [{ x: 31, z: 28 }]);
    feed(env, { abilities: 1 });
    env.c.abilities[0]!.rank = 2;
    const { hits } = untilHits(env, 0);
    expect(hits[0]!.amount).toBe(Math.round(BASE * 1.5));
  });
});

describe("Bloqueo", () => {
  const hitFrom = (sx: number, sz: number): EnemyHit => ({ targetKey: "a", damage: 10, sourceId: "e1", sourceX: sx, sourceZ: sz });

  it("mantenido: de frente 30 %, por la espalda 100 %, velocidad a la mitad y sin atacar; al soltar vuelve todo", () => {
    const env = setup([{ id: "block", rank: 1 }]);
    const states = new Map([["a", env.c]]);
    feed(env, { abilities: 1 });
    expect(env.c.blocking).toBe(true);
    expect(moveSpeedMult(env.c)).toBe(0.5);
    expect(feed(env, { abilities: 1, attack: true }).swing!.swung).toBe(false);

    env.cs.queueEnemyHits(states, [hitFrom(28, 31)], NOW);
    expect(feed(env, { abilities: 1 }).r.damage).toBeCloseTo(3, 9);
    env.cs.queueEnemyHits(states, [hitFrom(28, 25)], NOW);
    expect(feed(env, { abilities: 1 }).r.damage).toBeCloseTo(10, 9);

    feed(env, { abilities: 0 });
    expect(env.c.blocking).toBe(false);
    expect(moveSpeedMult(env.c)).toBe(1);
    env.cs.queueEnemyHits(states, [hitFrom(28, 31)], NOW);
    expect(feed(env, { abilities: 0 }).r.damage).toBeCloseTo(10, 9);
    expect(feed(env, { attack: true }).swing!.swung).toBe(true);
  });

  it("se combina con la Agilidad y vale para los golpes que vencen por plazo en step", () => {
    const env = setup([{ id: "block", rank: 2 }]);
    env.c.mods = playerMods({ ...newProgress(), stats: { agility: 1 } });
    feed(env, { abilities: 1 });
    expect(moveSpeedMult(env.c)).toBeCloseTo(1.08 * 0.5, 9);
    const states = new Map([["a", env.c]]);
    env.cs.queueEnemyHits(states, [hitFrom(29, 30)], NOW);
    const { damaged } = env.cs.step(states, NOW + 10, SIM_DT, new Map([["a", kin()]]));
    expect(damaged[0]!.amount).toBeCloseTo(2, 9);
  });

  it("un swing en curso no bloquea hasta que termina", () => {
    const env = setup([{ id: "block", rank: 1 }]);
    feed(env, { attack: true });
    feed(env, { abilities: 1 });
    expect(env.c.blocking).toBe(false);
    for (let i = 0; i < 20; i++) feed(env, { abilities: 1 });
    expect(env.c.blocking).toBe(true);
  });
});

describe("Onda de corte", () => {
  /** Ataca en cada input hasta que exista la onda; devuelve los pasos de los impactos vistos. */
  function comboUntilShot(env: Env, k: KinematicState): number[] {
    const steps: number[] = [];
    for (let i = 0; i < 120 && env.ab.playerShots.length === 0; i++) {
      const { r } = feed(env, { attack: true, facing: k.facing }, k);
      if (r.impact) steps.push(r.impact.step);
    }
    return steps;
  }

  it("la onda lleva la naturaleza del arma del dueño al lanzarla", () => {
    const env = setup([{ id: "cleave", rank: 1 }]);
    env.c.weaponNature = "ice";
    const k = kin({ x: 20, facing: Math.PI / 2 });
    comboUntilShot(env, k);
    expect(env.ab.playerShots[0]!.nature).toBe("ice");
  });

  it("el 3.er golpe de la Kingslayer lanza una onda que daña una vez a 2 enemigos alineados a 4 y 5 m", () => {
    const env = setup([{ id: "cleave", rank: 1 }]);
    const k = kin({ x: 20, facing: Math.PI / 2 });
    const [a, b] = spawn(env.sys, [{ x: 24, z: 28 }, { x: 25, z: 28 }]);
    expect(comboUntilShot(env, k)).toEqual([1, 2, 3]);
    expect(env.ab.playerShots).toHaveLength(1);
    expect(a!.hp).toBe(9999);

    const hits: { key: string; enemyId: string; amount: number }[] = [];
    for (let i = 0; i < 30; i++) {
      for (const res of env.ab.step(new Map([["a", env.c]]), env.sys, SIM_DT)) {
        for (const h of res.hits) hits.push({ key: res.key, enemyId: h.enemyId, amount: h.amount });
      }
    }
    const amount = Math.round(BASE * 0.6);
    expect(hits).toEqual([
      { key: "a", enemyId: a!.id, amount },
      { key: "a", enemyId: b!.id, amount },
    ]);
    expect(env.ab.playerShots).toHaveLength(0);
  });

  it("sin la pasiva no hay onda; la onda desaparece contra un muro", () => {
    const none = setup([]);
    for (let i = 0; i < 60; i++) feed(none, { attack: true });
    expect(none.ab.playerShots).toHaveLength(0);

    const env = setup([{ id: "cleave", rank: 1 }]);
    const k = kin({ x: 37, facing: Math.PI / 2 });
    comboUntilShot(env, k);
    expect(env.ab.playerShots).toHaveLength(1);
    tickAbilities(env, 8);
    expect(env.ab.playerShots).toHaveLength(0);
  });
});

describe("exclusión con el combo", () => {
  it("una habilidad durante un swing no hace nada, y atacar durante la animación tampoco", () => {
    const env = setup([{ id: "whirlwind", rank: 1 }]);
    expect(feed(env, { attack: true }).swing!.swung).toBe(true);
    expect(feed(env, { abilities: 1 }).a.started).toBeUndefined();
    expect(env.c.abilityCd.whirlwind ?? 0).toBe(0);
    for (let i = 0; i < 20; i++) feed(env);
    expect(feed(env, { abilities: 1 }).a.started).toBe("whirlwind");
    expect(feed(env, { abilities: 1, attack: true }).swing!.swung).toBe(false);
  });

  it("una tecla sin habilidad no hace nada", () => {
    const env = setup([{ id: "whirlwind", rank: 1 }]);
    expect(feed(env, { abilities: 0b1110 }).a.started).toBeUndefined();
    expect(env.c.abilityAnim).toBeNull();
  });
});

describe("Celeridad", () => {
  it("con haste 2 el Torbellino queda en enfriamiento 8 × cooldownMult (0,9²)", () => {
    const env = setup([{ id: "whirlwind", rank: 1 }]);
    env.c.mods = playerMods({ ...newProgress(), stats: { haste: 2 } });
    expect(feed(env, { abilities: 1 }).a.started).toBe("whirlwind");
    expect(env.c.abilityCd.whirlwind).toBeCloseTo(8 * 0.9 ** 2, 12);
  });
});

describe("Tajo frontal", () => {
  it("rango 3: golpea a 2 enemigos alineados a 3 y 7,5 m en su impacto; no al de 1,5 m de costado", () => {
    const env = setup([{ id: "thrust", rank: 3 }]);
    const inLine = spawn(env.sys, [{ x: 28, z: 31 }, { x: 28, z: 35.5 }]);
    const [side] = spawn(env.sys, [{ x: 29.5, z: 31 }]);
    expect(feed(env, { abilities: 1 }).a.started).toBe("thrust");
    expect(env.c.abilityCd.thrust).toBe(7);
    const { at, hits } = untilHits(env, 1);
    expect(at).toBe(inputsFor(0.45 * 0.7));
    const amount = Math.round(BASE * 2);
    expect(hits.map((x) => x.enemyId).sort()).toEqual(inLine.map((e) => e.id).sort());
    expect(hits.every((x) => x.amount === amount)).toBe(true);
    expect(side!.hp).toBe(9999);
  });

  it("la línea queda fija al lanzarla: girar después no la cambia", () => {
    const env = setup([{ id: "thrust", rank: 1 }]);
    const [ahead] = spawn(env.sys, [{ x: 28, z: 31 }]);
    feed(env, { abilities: 1, facing: 0 });
    const hits: string[] = [];
    for (let i = 0; i < 30; i++) hits.push(...feed(env, { facing: Math.PI }).a.hits.map((h) => h.enemyId));
    expect(hits).toEqual([ahead!.id]);
  });

  it("Foco 4: no golpea a un enemigo detrás de un muro", () => {
    const env = setup([{ id: "thrust", rank: 3 }]);
    // Muro de 2 casillas (x 26-30 m, z 30-32 m) entre el jugador (28, 28) y el enemigo (28, 33,5).
    for (const tx of [13, 14]) env.dungeon.tiles[15 * env.dungeon.width + tx] = 0;
    const [behind] = spawn(env.sys, [{ x: 28, z: 33.5 }]);
    const [front] = spawn(env.sys, [{ x: 28, z: 29.2 }]);
    feed(env, { abilities: 1 });
    const hits: string[] = [];
    for (let i = 0; i < 30; i++) hits.push(...feed(env).a.hits.map((h) => h.enemyId));
    expect(hits).toEqual([front!.id]);
    expect(behind!.hp).toBe(9999);
  });
});
