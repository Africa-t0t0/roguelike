import { describe, expect, it } from "vitest";
import {
  abilitySlotsOf,
  activeAbilityCount,
  canFuse,
  fusionLead,
  ABILITIES,
  STAT_CARDS,
  applyCard,
  cardText,
  cardTitle,
  createRng,
  playerMods,
  rollOffer,
  strikeOf,
  xpToNext,
  MAX_ACTIVE_ABILITIES,
  BASE_REGEN,
  CHOICE_TIME_S,
  THRUST_WIDTH,
  PROTOCOL_VERSION,
  type AbilityId,
  type CardOffer,
  type Progress,
} from "../src";

const empty = (): Progress => ({ stats: {}, abilities: [] });

describe("playerMods", () => {
  it("acumula y respeta el piso de daño recibido", () => {
    const m = playerMods({ stats: { strength: 2, fury: 1, ironskin: 10 }, abilities: [] });
    expect(m.damageMult).toBeCloseTo(1.2);
    expect(m.attackSpeedMult).toBeCloseTo(1.1);
    expect(m.damageTakenMult).toBeCloseTo(0.4);
  });
  it("vacío es neutro", () => {
    const m = playerMods(empty());
    expect(m).toEqual({
      maxHpBonus: 0,
      regen: 0,
      damageMult: 1,
      attackSpeedMult: 1,
      reachMult: 1,
      moveSpeedMult: 1,
      damageTakenMult: 1,
      lifeOnKill: 0,
      magnetMult: 1,
      xpMult: 1,
      cooldownMult: 1,
      affinity: 0,
      resist: { fire: 0, ice: 0, lightning: 0 },
      maxHpMult: 1,
    });
  });
  it("constantes", () => {
    expect(BASE_REGEN).toBe(0.5);
    expect(CHOICE_TIME_S).toBe(20);
    expect(MAX_ACTIVE_ABILITIES).toBe(4);
  });
});

describe("Aprendizaje, Celeridad y Tajo frontal", () => {
  it("mods de las cartas nuevas", () => {
    expect(playerMods({ stats: { haste: 10 }, abilities: [] }).cooldownMult).toBeCloseTo(0.5);
    expect(playerMods({ stats: { haste: 2 }, abilities: [] }).cooldownMult).toBeCloseTo(0.81);
    expect(playerMods({ stats: { learning: 2 }, abilities: [] }).xpMult).toBeCloseTo(1.3);
  });
  it("rollOffer puede ofrecer thrust, learning y haste", () => {
    const rng = createRng(3);
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) for (const c of rollOffer(rng, empty())) seen.add(c.id);
    for (const id of ["thrust", "learning", "haste"]) expect(seen.has(id)).toBe(true);
  });
  it("definición del Tajo y clips", () => {
    const t = ABILITIES.thrust;
    expect(t.kind).toBe("active");
    expect(t.cooldownS).toBe(8);
    expect(t.clip).toBe("gs_slide_attack");
    expect(t.ranks.map((r) => r.range)).toEqual([10, 10, 10]);
    expect(t.ranks[2]!.count).toBe(3);
    expect(THRUST_WIDTH).toBe(1.4);
    expect(ABILITIES.slam.clip).toBe("gs_jump_attack");
    expect(PROTOCOL_VERSION).toBe(20);
  });
  it("cardText del Tajo menciona 10 m y, en rango 3, sus cargas", () => {
    expect(cardText({ kind: "ability", id: "thrust", rank: 2 })).toContain("10 m");
    expect(cardText({ kind: "ability", id: "thrust", rank: 3 })).toContain("3 cargas");
  });
});

describe("rollOffer", () => {
  it("progreso vacío: 3 cartas, 1 de habilidad rango 1, 2 de stat distintas", () => {
    const rng = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const o = rollOffer(rng, empty());
      expect(o).toHaveLength(3);
      const ab = o.filter((c) => c.kind === "ability");
      const st = o.filter((c) => c.kind === "stat");
      expect(ab).toHaveLength(1);
      expect(ab[0]!.kind === "ability" && ab[0]!.rank).toBe(1);
      expect(st).toHaveLength(2);
      expect(st[0]!.id).not.toBe(st[1]!.id);
    }
  });
  it("con 4 activas y pasiva al máximo solo sube activas que no están en 3", () => {
    const p: Progress = {
      stats: {},
      abilities: [
        { id: "whirlwind", rank: 3 },
        { id: "hook", rank: 2 },
        { id: "warcry", rank: 1 },
        { id: "slam", rank: 3 },
        { id: "cleave", rank: 3 },
      ],
    };
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      const a = rollOffer(rng, p).find((c) => c.kind === "ability");
      expect(a).toBeDefined();
      if (a?.kind !== "ability") throw new Error();
      expect(["hook", "warcry"]).toContain(a.id);
      expect(a.rank).toBe(a.id === "hook" ? 3 : 2);
    }
  });
  it("con todo al máximo da 3 de stat", () => {
    const ids: AbilityId[] = ["whirlwind", "warcry", "slam", "cleave", "thrust", "throw", "hook", "banner"];
    const p: Progress = { stats: {}, abilities: ids.map((id) => ({ id, rank: 3 })) };
    const o = rollOffer(createRng(1), p);
    expect(o).toHaveLength(3);
    expect(o.every((c) => c.kind === "stat")).toBe(true);
    expect(new Set(o.map((c) => c.id)).size).toBe(3);
  });
});

describe("applyCard", () => {
  it("agrega habilidad nueva en rango 1 y sube rangos", () => {
    const p = empty();
    applyCard(p, { kind: "ability", id: "hook", rank: 1 });
    expect(p.abilities).toEqual([{ id: "hook", rank: 1 }]);
    applyCard(p, { kind: "ability", id: "hook", rank: 2 });
    expect(p.abilities).toEqual([{ id: "hook", rank: 2 }]);
    applyCard(p, { kind: "stat", id: "magnet" });
    applyCard(p, { kind: "stat", id: "magnet" });
    expect(p.stats.magnet).toBe(2);
  });
});

describe("curva y velocidad de ataque", () => {
  it("xpToNext", () => {
    expect(xpToNext(1)).toBe(65);
    expect(xpToNext(5)).toBe(165);
  });
  it("strikeOf divide la duración", () => {
    expect(strikeOf("kingslayer-sword", 1, 1.25).duration).toBeCloseTo(0.35 / 1.25);
    expect(strikeOf("kingslayer-sword", 1).duration).toBeCloseTo(0.35);
  });
});

describe("textos", () => {
  it("ninguna carta posible tiene título o texto vacío", () => {
    const cards: CardOffer[] = [];
    for (const id of Object.keys(STAT_CARDS)) cards.push({ kind: "stat", id: id as never });
    for (const id of Object.keys(ABILITIES)) for (const rank of [1, 2, 3] as const) cards.push({ kind: "ability", id: id as AbilityId, rank });
    for (const c of cards) {
      expect(cardTitle(c).length).toBeGreaterThan(0);
      expect(cardText(c).length).toBeGreaterThan(0);
    }
  });
});

describe("fusión", () => {
  const abilities = [
    { id: "slam" as const, rank: 2 },
    { id: "cleave" as const, rank: 1 },
    { id: "warcry" as const, rank: 1 },
    { id: "thrust" as const, rank: 3 },
    { id: "hook" as const, rank: 1 },
  ];
  it("ocupa la casilla de la primera aprendida de las suyas; lleva la animación la que mueve", () => {
    const slots = abilitySlotsOf(abilities, ["warcry", "thrust"]);
    expect(slots.map((s) => [s.id, s.partners?.map((p) => p.id)])).toEqual([["slam", undefined], ["thrust", ["warcry"]], ["hook", undefined]]);
    expect(slots[1]).toEqual({ id: "thrust", rank: 3, partners: [{ id: "warcry", rank: 1 }] });
    expect(fusionLead(["heal", "meteors", "frost"])).toBe("meteors");
  });
  it("crece: con tres juntas, una casilla lanza las tres", () => {
    const slots = abilitySlotsOf(abilities, ["warcry", "thrust", "hook"]);
    expect(slots.map((s) => s.id)).toEqual(["slam", "thrust"]);
    expect(slots[1]!.partners!.map((p) => p.id)).toEqual(["warcry", "hook"]);
  });
  it("cada habilidad que entra libera una casilla", () => {
    const p: Progress = { stats: {}, abilities: [...abilities, { id: "whirlwind", rank: 1 }], fusion: ["warcry", "thrust"] };
    expect(activeAbilityCount(p)).toBe(4);
    p.fusion!.push("hook");
    expect(activeAbilityCount(p)).toBe(3);
  });
  it("sin fusión se eligen dos; con ella, una que no esté dentro", () => {
    const p: Progress = { stats: {}, abilities, fusion: [] };
    expect(canFuse(p, ["slam", "hook"])).toBe(true);
    expect(canFuse(p, ["slam"])).toBe(false);
    expect(canFuse(p, ["slam", "slam"])).toBe(false);
    expect(canFuse(p, ["slam", "cleave"])).toBe(false);
    p.fusion = ["slam", "hook"];
    expect(canFuse(p, ["warcry"])).toBe(true);
    expect(canFuse(p, ["slam"])).toBe(false);
    expect(canFuse(p, ["warcry", "thrust"])).toBe(false);
    expect(canFuse(p, ["banner"])).toBe(false);
  });
});
