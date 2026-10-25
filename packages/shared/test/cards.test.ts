import { describe, expect, it } from "vitest";
import {
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
    });
  });
  it("constantes", () => {
    expect(BASE_REGEN).toBe(0.5);
    expect(CHOICE_TIME_S).toBe(20);
    expect(MAX_ACTIVE_ABILITIES).toBe(4);
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
        { id: "kick", rank: 2 },
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
      expect(["kick", "warcry"]).toContain(a.id);
      expect(a.rank).toBe(a.id === "kick" ? 3 : 2);
    }
  });
  it("con todo al máximo da 3 de stat", () => {
    const ids: AbilityId[] = ["whirlwind", "kick", "warcry", "slam", "cleave"];
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
    applyCard(p, { kind: "ability", id: "kick", rank: 1 });
    expect(p.abilities).toEqual([{ id: "kick", rank: 1 }]);
    applyCard(p, { kind: "ability", id: "kick", rank: 2 });
    expect(p.abilities).toEqual([{ id: "kick", rank: 2 }]);
    applyCard(p, { kind: "stat", id: "magnet" });
    applyCard(p, { kind: "stat", id: "magnet" });
    expect(p.stats.magnet).toBe(2);
  });
});

describe("curva y velocidad de ataque", () => {
  it("xpToNext", () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(5)).toBe(260);
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
