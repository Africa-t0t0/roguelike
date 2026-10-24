import { describe, expect, it } from "vitest";
import { createTickClock } from "../src/net/tickClock";

describe("viewTick", () => {
  it("interpola el tick del servidor según el instante de recepción", () => {
    const clock = createTickClock();
    clock.push(0, 10);
    clock.push(100, 13);
    expect(clock.sample(50)).toBeCloseTo(11.5, 9);
  });

  it("sin snapshots da 0; fuera del rango se sujeta a los extremos", () => {
    const clock = createTickClock();
    expect(clock.sample(123)).toBe(0);
    clock.push(0, 10);
    clock.push(100, 13);
    expect(clock.sample(-50)).toBe(10);
    expect(clock.sample(500)).toBe(13);
  });
});
