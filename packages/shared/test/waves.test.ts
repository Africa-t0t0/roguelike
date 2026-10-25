import { describe, expect, it } from "vitest";
import {
  createRng,
  maxLiveEnemies,
  rollTier,
  splitXp,
  tierWeights,
  waveGroupSize,
  waveInterval,
  waveKinds,
} from "../src";

describe("director de oleadas", () => {
  it("intervalo", () => {
    expect(waveInterval(0)).toBe(10);
    expect(waveInterval(60)).toBe(5);
    expect(waveInterval(600)).toBe(2);
  });
  it("tamaño del grupo", () => {
    expect(waveGroupSize(0, 1)).toBe(1);
    expect(waveGroupSize(180, 3)).toBe(5);
  });
  it("tipos permitidos", () => {
    expect(waveKinds(30)).toEqual(["minion"]);
    expect(waveKinds(90)).toEqual(["minion", "brute"]);
    expect(waveKinds(130)).toEqual(["minion", "brute", "mage"]);
  });
  it("tope de vivos", () => {
    expect(maxLiveEnemies(1)).toBe(30);
    expect(maxLiveEnemies(4)).toBe(60);
  });
});

describe("tiers por tiempo", () => {
  it("pesos", () => {
    expect(tierWeights(0, 1)).toEqual([1, 0, 0]);
    expect(tierWeights(150, 1)).toEqual([0.7, 0.25, 0.05]);
    expect(tierWeights(60, 2)).toEqual([0.7, 0.25, 0.05]);
    expect(tierWeights(300, 1)).toEqual([0.4, 0.4, 0.2]);
  });
  it("rollTier respeta los pesos", () => {
    const rng = createRng(7);
    const n = 2000;
    const c = [0, 0, 0];
    for (let i = 0; i < n; i++) c[rollTier(rng, 300, 1) - 1]!++;
    const w = [0.4, 0.4, 0.2];
    for (let i = 0; i < 3; i++) expect(Math.abs(c[i]! / n - w[i]!)).toBeLessThan(0.05);
  });
  it("rollTier a t=0 es siempre tier 1", () => {
    const rng = createRng(1);
    for (let i = 0; i < 100; i++) expect(rollTier(rng, 0, 1)).toBe(1);
  });
});

describe("splitXp", () => {
  it("suma exacta y valores de 1 a 4", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = createRng(seed);
      for (let xp = 1; xp <= 40; xp++) {
        const parts = splitXp(xp, rng);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(xp);
        for (const p of parts) {
          expect(Number.isInteger(p)).toBe(true);
          expect(p).toBeGreaterThanOrEqual(1);
          expect(p).toBeLessThanOrEqual(4);
        }
      }
    }
  });
  it("xp <= 0 da []", () => {
    expect(splitXp(0, createRng(1))).toEqual([]);
    expect(splitXp(-3, createRng(1))).toEqual([]);
  });
});
