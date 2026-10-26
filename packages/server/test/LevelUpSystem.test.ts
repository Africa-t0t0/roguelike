import { describe, expect, it } from "vitest";
import { CHOICE_TIME_S, createRng, newProgress } from "@roguelike/shared";
import { LevelUpSystem, type ChoiceEvent, type ChoiceRecord } from "../src/sim/LevelUpSystem";

const rec = (key: string, pendingChoices = 0): ChoiceRecord => ({ key, progress: newProgress(), pendingChoices });
const offers = (events: ChoiceEvent[]) => events.filter((e) => e.type === "offer");
const applied = (events: ChoiceEvent[]) => events.filter((e) => e.type === "applied");

/** Elige con el offerId de la oferta abierta de `r` (−1 si no tiene: se ignora). */
function choose(sys: LevelUpSystem, r: ChoiceRecord, index: number): ChoiceEvent[] {
  const [o] = sys.openOffer(r.key);
  return sys.choose(r, o?.type === "offer" ? o.offerId : -1, index);
}

/** Avanza `seconds` en pasos de 1/30 s y junta los eventos. */
function run(sys: LevelUpSystem, seconds: number, connected: ChoiceRecord[]): ChoiceEvent[] {
  const events: ChoiceEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 30); i++) events.push(...sys.step(1 / 30, connected));
  return events;
}

/** onLevelsGained no devuelve nada: las ofertas salen en el siguiente step. */
function gain(sys: LevelUpSystem, n: number, connected: ChoiceRecord[], all: ChoiceRecord[]): ChoiceEvent[] {
  sys.onLevelsGained(n, connected, all);
  return sys.step(0, connected);
}

function setup(seed = 1) {
  const sys = new LevelUpSystem(createRng(seed));
  const ana = rec("ana");
  const beto = rec("beto");
  return { sys, ana, beto };
}

describe("LevelUpSystem: pausa del grupo", () => {
  it("un nivel con 2 conectados pausa y ofrece 1/1 a cada uno; al elegir ambos termina", () => {
    const { sys, ana, beto } = setup();
    const ev = gain(sys, 1, [ana, beto], [ana, beto]);
    expect(sys.paused).toBe(true);
    expect(sys.pauseLeft).toBe(CHOICE_TIME_S);
    expect(ana.pendingChoices).toBe(1);
    expect(beto.pendingChoices).toBe(1);
    const o = offers(ev);
    expect(o.map((e) => e.key).sort()).toEqual(["ana", "beto"]);
    for (const e of o) {
      expect(e).toMatchObject({ index: 1, total: 1, deadlineS: CHOICE_TIME_S });
      expect(e.type === "offer" && e.cards.length).toBe(3);
    }
    expect(sys.isChoosing("ana")).toBe(true);

    const a = choose(sys, ana, 0);
    const card = o.find((e) => e.key === "ana")!;
    expect(a).toEqual([{ type: "applied", key: "ana", card: card.type === "offer" && card.cards[0] }]);
    expect(sys.isChoosing("ana")).toBe(false);
    expect(ana.pendingChoices).toBe(0);
    expect(sys.paused).toBe(true);
    choose(sys, beto, 2);
    expect(sys.paused).toBe(false);
    expect(beto.pendingChoices).toBe(0);
    expect(ana.progress).not.toEqual(newProgress());
  });

  it("Foco 1: si uno no elige, a los 20 s se le asigna una carta al azar y la pausa termina", () => {
    const { sys, ana, beto } = setup();
    gain(sys, 1, [ana, beto], [ana, beto]);
    choose(sys, ana, 1);
    const before = run(sys, CHOICE_TIME_S - 1, [ana, beto]);
    expect(applied(before)).toEqual([]);
    expect(sys.paused).toBe(true);
    expect(sys.pauseLeft).toBeCloseTo(1, 5);
    const ev = run(sys, 1, [ana, beto]);
    expect(applied(ev).map((e) => e.key)).toEqual(["beto"]);
    expect(sys.paused).toBe(false);
    expect(beto.pendingChoices).toBe(0);
  });

  it("Foco 1: si el que no elige se desconecta, la pausa termina en el siguiente step y su elección queda pendiente", () => {
    const { sys, ana, beto } = setup();
    gain(sys, 1, [ana, beto], [ana, beto]);
    choose(sys, ana, 0);
    const ev = sys.step(1 / 30, [ana]);
    expect(sys.paused).toBe(false);
    expect(ev).toEqual([]);
    expect(beto.pendingChoices).toBe(1);
    expect(sys.isChoosing("beto")).toBe(false);
  });

  it("los desconectados suman elecciones pendientes pero no pausan solos", () => {
    const { sys, ana, beto } = setup();
    const ev = gain(sys, 1, [], [ana, beto]);
    expect(ev).toEqual([]);
    expect(sys.paused).toBe(false);
    expect(ana.pendingChoices).toBe(1);
    expect(beto.pendingChoices).toBe(1);
  });

  it("Foco 3: dos niveles dan dos ofertas seguidas (1/2 y 2/2) con 20 s cada una", () => {
    const { sys, ana } = setup();
    const first = offers(gain(sys, 2, [ana], [ana]));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ key: "ana", index: 1, total: 2 });
    expect(ana.pendingChoices).toBe(2);

    const ev1 = run(sys, CHOICE_TIME_S, [ana]);
    expect(applied(ev1)).toHaveLength(1);
    const second = offers(ev1);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ key: "ana", index: 2, total: 2, deadlineS: CHOICE_TIME_S });
    expect(sys.paused).toBe(true);
    expect(sys.pauseLeft).toBeCloseTo(CHOICE_TIME_S, 5);

    run(sys, CHOICE_TIME_S - 1, [ana]);
    expect(sys.paused).toBe(true);
    const ev2 = run(sys, 1, [ana]);
    expect(applied(ev2)).toHaveLength(1);
    expect(offers(ev2)).toEqual([]);
    expect(sys.paused).toBe(false);
    expect(ana.pendingChoices).toBe(0);
  });

  it("al elegir antes de tiempo la siguiente oferta llega enseguida con 20 s", () => {
    const { sys, ana } = setup();
    gain(sys, 2, [ana], [ana]);
    run(sys, 5, [ana]);
    const ev = choose(sys, ana, 0);
    expect(applied(ev)).toHaveLength(1);
    expect(offers(ev)).toMatchObject([{ key: "ana", index: 2, total: 2 }]);
    expect(sys.pauseLeft).toBe(CHOICE_TIME_S);
  });

  it("ignora índices fuera de rango, elecciones repetidas o sin oferta abierta", () => {
    const { sys, ana, beto } = setup();
    expect(choose(sys, ana, 0)).toEqual([]);
    expect(ana.progress).toEqual(newProgress());

    gain(sys, 1, [ana, beto], [ana, beto]);
    for (const bad of [-1, 3, 1.5, Number.NaN]) expect(choose(sys, ana, bad)).toEqual([]);
    expect(ana.pendingChoices).toBe(1);
    expect(applied(choose(sys, ana, 0))).toHaveLength(1);
    expect(choose(sys, ana, 1)).toEqual([]);
    expect(ana.pendingChoices).toBe(0);
    const p = ana.progress;
    const total = Object.values(p.stats).reduce((s, n) => s + (n ?? 0), 0) + p.abilities.length;
    expect(total).toBe(1);
  });
});

describe("LevelUpSystem: offerId", () => {
  it("cada oferta abierta lleva un offerId creciente y openOffer devuelve el mismo", () => {
    const { sys, ana, beto } = setup();
    const ev = offers(gain(sys, 2, [ana, beto], [ana, beto]));
    const ids = ev.map((e) => (e.type === "offer" ? e.offerId : -1));
    expect(new Set(ids).size).toBe(2);
    const [again] = sys.openOffer("ana");
    expect(again!.type === "offer" && again!.offerId).toBe(ids[ev.findIndex((e) => e.key === "ana")]);
    choose(sys, ana, 0);
    const next = offers(choose(sys, beto, 0));
    expect(next).toHaveLength(2);
    for (const e of next) expect(e.type === "offer" && e.offerId).toBeGreaterThan(Math.max(...ids));
  });

  it("una elección con un offerId viejo, llegada tras abrirse la siguiente oferta, se ignora", () => {
    const { sys, ana } = setup();
    const [first] = offers(gain(sys, 2, [ana], [ana]));
    const oldId = first!.type === "offer" ? first!.offerId : -1;
    const [second] = offers(sys.choose(ana, oldId, 0));
    expect(second).toMatchObject({ key: "ana", index: 2, total: 2 });
    expect(ana.pendingChoices).toBe(1);
    // Doble clic: el mismo mensaje llega otra vez.
    expect(sys.choose(ana, oldId, 0)).toEqual([]);
    expect(ana.pendingChoices).toBe(1);
    expect(sys.isChoosing("ana")).toBe(true);
    expect(sys.paused).toBe(true);
    const newId = second!.type === "offer" ? second!.offerId : -1;
    expect(applied(sys.choose(ana, newId, 0))).toHaveLength(1);
    expect(ana.pendingChoices).toBe(0);
  });
});

describe("LevelUpSystem: elección sin pausa", () => {
  it("offerSolo no pausa, ofrece las pendientes de a una y vence a los 20 s", () => {
    const { sys } = setup();
    const ana = rec("ana", 2);
    const ev = sys.offerSolo(ana);
    expect(sys.paused).toBe(false);
    expect(offers(ev)).toMatchObject([{ key: "ana", index: 1, total: 2, deadlineS: CHOICE_TIME_S }]);
    expect(sys.isChoosing("ana")).toBe(true);
    // Una segunda llamada con una oferta abierta no abre otra.
    expect(sys.offerSolo(ana)).toEqual([]);

    run(sys, CHOICE_TIME_S - 1, [ana]);
    expect(ana.pendingChoices).toBe(2);
    const ev1 = run(sys, 1, [ana]);
    expect(applied(ev1)).toHaveLength(1);
    expect(offers(ev1)).toMatchObject([{ key: "ana", index: 2, total: 2 }]);
    expect(ana.pendingChoices).toBe(1);

    expect(applied(choose(sys, ana, 2))).toHaveLength(1);
    expect(ana.pendingChoices).toBe(0);
    expect(sys.isChoosing("ana")).toBe(false);
    expect(sys.paused).toBe(false);
  });

  it("openOffer devuelve la oferta abierta con el tiempo que le queda", () => {
    const { sys, ana } = setup();
    expect(sys.openOffer("ana")).toEqual([]);
    const [first] = gain(sys, 2, [ana], [ana]);
    run(sys, 5, [ana]);
    const [again] = sys.openOffer("ana");
    expect(again).toMatchObject({ key: "ana", index: 1, total: 2 });
    expect(again!.type === "offer" && first!.type === "offer" && again!.cards).toEqual(first!.type === "offer" && first!.cards);
    expect(again!.type === "offer" && again!.deadlineS).toBeCloseTo(CHOICE_TIME_S - 5, 5);
  });

  it("offerSolo sin elecciones pendientes no hace nada", () => {
    const { sys, ana } = setup();
    expect(sys.offerSolo(ana)).toEqual([]);
    expect(sys.isChoosing("ana")).toBe(false);
  });

  it("si quien elige solo se desconecta, su oferta se cierra y la elección queda pendiente", () => {
    const { sys } = setup();
    const ana = rec("ana", 1);
    sys.offerSolo(ana);
    expect(sys.step(1 / 30, [])).toEqual([]);
    expect(sys.isChoosing("ana")).toBe(false);
    expect(ana.pendingChoices).toBe(1);
  });

  it("una subida de nivel con una elección sin pausa abierta la convierte en parte de la pausa", () => {
    const { sys, beto } = setup();
    const ana = rec("ana", 1);
    sys.offerSolo(ana);
    const ev = gain(sys, 1, [ana, beto], [ana, beto]);
    expect(sys.paused).toBe(true);
    expect(ana.pendingChoices).toBe(2);
    expect(offers(ev).map((e) => e.key).sort()).toEqual(["ana", "beto"]);
    choose(sys, ana, 0);
    choose(sys, beto, 0);
    // Termina la pausa; a Ana le queda una pendiente y la recibe sin pausa.
    const after = sys.step(1 / 30, [ana, beto]);
    expect(sys.paused).toBe(false);
    expect(offers(after)).toMatchObject([{ key: "ana", index: 1, total: 1 }]);
  });
});

describe("LevelUpSystem: Afinidad", () => {
  it("solo se ofrece si el arma equipada tiene naturaleza", () => {
    const seen = (nature: "none" | "fire") => {
      const sys = new LevelUpSystem(createRng(7));
      const r: ChoiceRecord = { ...rec("ana"), combat: { weaponNature: nature } };
      let found = false;
      for (let i = 0; i < 300 && !found; i++) {
        r.pendingChoices = 1;
        const [o] = sys.offerSolo(r);
        if (o?.type === "offer" && o.cards.some((c) => c.kind === "stat" && c.id === "affinity")) found = true;
        sys.choose(r, o?.type === "offer" ? o.offerId : -1, 0);
      }
      return found;
    };
    expect(seen("none")).toBe(false);
    expect(seen("fire")).toBe(true);
  });
});
