import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRng } from "@roguelike/shared";
import { LagSimulator, parseLagParams } from "../src/net/LagSimulator";

describe("parseLagParams", () => {
  it("lee lag, jitter y loss, acotando loss a 0.5", () => {
    expect(parseLagParams("?lag=150&jitter=20&loss=0.9")).toEqual({
      delayMs: 150,
      jitterMs: 20,
      loss: 0.5,
    });
  });

  it("devuelve todo 0 si falta o es inválido", () => {
    const zero = { delayMs: 0, jitterMs: 0, loss: 0 };
    expect(parseLagParams("")).toEqual(zero);
    expect(parseLagParams("?lag=abc&jitter=-5&loss=x")).toEqual(zero);
  });
});

describe("LagSimulator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("con retraso 0 ejecuta de inmediato y en forma síncrona", () => {
    const sim = new LagSimulator({ delayMs: 0, jitterMs: 0, loss: 0 }, createRng(1));
    const fn = vi.fn();
    sim.inbound(fn);
    sim.outbound(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("inbound con delay 100 ejecuta a los 50 ms, no a los 49", () => {
    const sim = new LagSimulator({ delayMs: 100, jitterMs: 0, loss: 0 }, createRng(1));
    const fn = vi.fn();
    sim.inbound(fn);
    vi.advanceTimersByTime(49);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("con jitter mantiene el orden de programación", () => {
    const sim = new LagSimulator({ delayMs: 100, jitterMs: 80, loss: 0 }, createRng(7));
    const out: number[] = [];
    for (let i = 0; i < 50; i++) {
      sim.inbound(() => out.push(i));
      vi.advanceTimersByTime(3);
    }
    vi.advanceTimersByTime(1000);
    expect(out).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("outbound descarta ~loss; inbound nunca descarta", () => {
    const sim = new LagSimulator({ delayMs: 0, jitterMs: 0, loss: 0.2 }, createRng(42));
    let sent = 0;
    let received = 0;
    for (let i = 0; i < 1000; i++) {
      sim.outbound(() => sent++);
      sim.inbound(() => received++);
    }
    expect(sent).toBeGreaterThanOrEqual(750);
    expect(sent).toBeLessThanOrEqual(850);
    expect(received).toBe(1000);
  });
});
