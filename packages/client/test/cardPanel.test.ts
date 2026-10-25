import { describe, expect, it } from "vitest";
import type { CardOffer } from "@roguelike/shared";
import { CardChoice, cardKindLabel, formatCountdown, formatGroupStatus } from "../src/ui/cardPanel";

const cards: CardOffer[] = [
  { kind: "ability", id: "whirlwind", rank: 1 },
  { kind: "stat", id: "vitality" },
  { kind: "stat", id: "fury" },
];
const offer = (index = 1, total = 2, deadlineS = 20) => ({ cards, index, total, deadlineS });

describe("textos del panel de cartas", () => {
  it("estado del grupo: ✓ quien ya eligió, «eligiendo…» quien no", () => {
    expect(
      formatGroupStatus([
        { name: "Ana", choosing: false },
        { name: "Bruno", choosing: true },
      ]),
    ).toBe("Ana ✓ · Bruno eligiendo…");
    expect(formatGroupStatus([{ name: "Ana", choosing: true }])).toBe("Ana eligiendo…");
  });

  it("cuenta regresiva m:ss, en segundos enteros hacia arriba y nunca negativa", () => {
    expect(formatCountdown(20)).toBe("0:20");
    expect(formatCountdown(19.2)).toBe("0:20");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(0.01)).toBe("0:01");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-3)).toBe("0:00");
    expect(formatCountdown(75)).toBe("1:15");
  });

  it("tipo de cada carta", () => {
    expect(cardKindLabel({ kind: "ability", id: "kick", rank: 1 })).toBe("Habilidad nueva");
    expect(cardKindLabel({ kind: "ability", id: "kick", rank: 2 })).toBe("Mejora de habilidad");
    expect(cardKindLabel({ kind: "ability", id: "cleave", rank: 1 })).toBe("Pasiva");
    expect(cardKindLabel({ kind: "stat", id: "regen" })).toBe("Atributo");
  });
});

describe("CardChoice", () => {
  it("elegir dos veces envía una sola elección", () => {
    const c = new CardChoice();
    c.open(offer(), 0);
    expect(c.choose(1)).toBe(true);
    expect(c.choose(1)).toBe(false);
    expect(c.choose(2)).toBe(false);
    expect(c.chosen).toBe(1);
  });

  it("no se elige sin oferta ni con un índice fuera de rango", () => {
    const c = new CardChoice();
    expect(c.choose(0)).toBe(false);
    c.open(offer(), 0);
    expect(c.choose(3)).toBe(false);
    expect(c.choose(-1)).toBe(false);
    expect(c.choose(0)).toBe(true);
  });

  it("la siguiente oferta desbloquea el panel", () => {
    const c = new CardChoice();
    c.open(offer(1, 2), 0);
    c.choose(0);
    c.open(offer(2, 2), 0);
    expect(c.chosen).toBeUndefined();
    expect(c.choose(2)).toBe(true);
  });

  it("en la pausa del grupo: tras elegir sigue visible esperando; cierra al reanudar", () => {
    const c = new CardChoice();
    c.open(offer(), 0);
    c.sync({ paused: true, choosing: true });
    c.choose(0);
    c.sync({ paused: true, choosing: false });
    expect(c.visible(true)).toBe(true);
    expect(c.status(true)).toBe("Esperando al grupo…");
    c.sync({ paused: false, choosing: false });
    expect(c.offer).toBeUndefined();
    expect(c.visible(false)).toBe(false);
  });

  it("un `choosing` viejo (del parche anterior a la oferta) no la cierra", () => {
    const c = new CardChoice();
    c.open(offer(), 0);
    c.sync({ paused: false, choosing: false });
    expect(c.offer).toBeDefined();
    c.sync({ paused: false, choosing: true });
    c.sync({ paused: false, choosing: false }); // venció: carta al azar
    expect(c.offer).toBeUndefined();
  });

  it("si vence en la pausa sin elegir, queda bloqueada esperando al grupo", () => {
    const c = new CardChoice();
    c.open(offer(), 0);
    c.sync({ paused: true, choosing: true });
    c.sync({ paused: true, choosing: false });
    expect(c.locked).toBe(true);
    expect(c.choose(0)).toBe(false);
  });

  it("en la pausa el panel se ve aunque no tenga oferta propia", () => {
    const c = new CardChoice();
    expect(c.visible(true)).toBe(true);
    expect(c.visible(false)).toBe(false);
    expect(c.status(true)).toBe("Esperando al grupo…");
  });

  it("cuenta: `pauseLeft` en la pausa; sin pausa, local desde `deadlineS`", () => {
    const c = new CardChoice();
    c.open(offer(1, 1, 20), 1000);
    expect(c.secondsLeft({ paused: true, pauseLeft: 12.5 }, 9000)).toBe(12.5);
    expect(c.secondsLeft({ paused: false, pauseLeft: 0 }, 6000)).toBeCloseTo(15);
    expect(c.secondsLeft({ paused: false, pauseLeft: 0 }, 60_000)).toBe(0);
  });

  it("encabezado «Elección 1 de 2»", () => {
    const c = new CardChoice();
    c.open(offer(1, 2), 0);
    expect(c.heading()).toBe("Elección 1 de 2");
  });
});
