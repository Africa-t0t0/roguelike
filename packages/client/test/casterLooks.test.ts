import { describe, expect, it } from "vitest";
import { CASTER_COLORS, casterTint, chargeScale } from "../src/render/casterLooks";

describe("aspecto de los hechiceros", () => {
  it("chargeScale crece de 0,15 a 1 y se acota", () => {
    expect(chargeScale(0, 0.7)).toBeCloseTo(0.15, 6);
    expect(chargeScale(0.7, 0.7)).toBeCloseTo(1, 6);
    expect(chargeScale(2, 0.7)).toBe(1);
    expect(chargeScale(-1, 0.7)).toBeCloseTo(0.15, 6);
    expect(chargeScale(0.35, 0.7)).toBeCloseTo(0.575, 6);
  });

  it("CASTER_COLORS tiene los tres hechiceros", () => {
    expect(Object.keys(CASTER_COLORS).sort()).toEqual(["mage", "pyromancer", "stormcaller"]);
    expect(CASTER_COLORS.pyromancer.r).toBe(1);
  });

  it("casterTint usa el color del tipo con fuerza 0,35", () => {
    expect(casterTint("stormcaller")).toEqual({ color: CASTER_COLORS.stormcaller, strength: 0.35 });
  });
});
