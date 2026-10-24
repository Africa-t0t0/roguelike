import { describe, expect, it } from "vitest";
import {
  MOVESETS,
  SIM_DT,
  STARTING_WEAPON,
  WEAPONS,
  advanceCombo,
  cancelImpact,
  isWeaponId,
  newComboTimers,
  strikeDamage,
  strikeOf,
  tryStartSwing,
} from "../src/index";

describe("strikeOf / strikeDamage", () => {
  it("guard-sword paso 1", () => {
    const s = strikeOf("guard-sword", 1);
    expect(s.duration).toBeCloseTo(0.35 / 1.15, 9);
    expect(s.range).toBeCloseTo(1.98, 9);
    expect(s.arcDeg).toBe(120);
    expect(s.impactAt).toBe(0.45);
  });
  it("great-sword paso 2", () => {
    const s = strikeOf("great-sword", 2);
    expect(s.duration).toBe(0.9);
    expect(s.range).toBe(3.2);
    expect(s.arcDeg).toBe(220);
  });
  it("daño", () => {
    expect(strikeDamage("kingslayer-sword", "warrior", 1, 3)).toBe(18);
    expect(strikeDamage("great-sword", "warrior", 3, 2)).toBe(35);
  });
  it("datos", () => {
    expect(STARTING_WEAPON).toBe("kingslayer-sword");
    expect(isWeaponId("guard-sword")).toBe(true);
    expect(isWeaponId("x")).toBe(false);
    expect(MOVESETS["great-sword"].combo).toHaveLength(2);
    expect(WEAPONS["guard-sword"].speedMult).toBe(1.15);
  });
});

describe("combo con impacto", () => {
  it("newComboTimers", () => {
    expect(newComboTimers()).toEqual({ comboStep: 0, swingTimer: 0, comboTimer: 0, impactTimer: 0, impactPending: false });
  });

  it("el impacto devuelve true una sola vez, en el avance 12 (mandoble)", () => {
    const c = newComboTimers();
    expect(tryStartSwing(c, "great-sword")).toBe(1);
    const hits: number[] = [];
    for (let i = 1; i <= 30; i++) if (advanceCombo(c, SIM_DT)) hits.push(i);
    expect(hits).toEqual([Math.ceil((0.55 * 0.7) / SIM_DT - 1e-9)]);
    expect(hits[0]).toBe(12);
  });

  it("guard-sword libera el siguiente golpe tras 10 avances", () => {
    const c = newComboTimers();
    tryStartSwing(c, "guard-sword");
    for (let i = 0; i < 9; i++) advanceCombo(c, SIM_DT);
    expect(tryStartSwing(c, "guard-sword")).toBe(0);
    advanceCombo(c, SIM_DT);
    expect(tryStartSwing(c, "guard-sword")).toBe(2);
  });

  it("cancelImpact: ningún avance da true y el combo sigue", () => {
    const c = newComboTimers();
    tryStartSwing(c, "kingslayer-sword");
    cancelImpact(c);
    for (let i = 0; i < 12; i++) expect(advanceCombo(c, SIM_DT)).toBe(false);
    expect(tryStartSwing(c, "kingslayer-sword")).toBe(2);
  });

  it("combo del mandoble de 2 pasos vuelve al 1", () => {
    const c = newComboTimers();
    expect(tryStartSwing(c, "great-sword")).toBe(1);
    for (let i = 0; i < 24; i++) advanceCombo(c, SIM_DT);
    expect(tryStartSwing(c, "great-sword")).toBe(2);
    for (let i = 0; i < 30; i++) advanceCombo(c, SIM_DT);
    expect(tryStartSwing(c, "great-sword")).toBe(1);
  });

  it("el impacto nunca ocurre en el input que empieza el swing", () => {
    const c = newComboTimers();
    tryStartSwing(c, "kingslayer-sword");
    expect(c.impactPending).toBe(true);
    expect(c.impactTimer).toBeCloseTo(0.45 * 0.35, 9);
  });
});
