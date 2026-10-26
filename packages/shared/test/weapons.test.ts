import { describe, expect, it } from "vitest";
import {
  ARMED_CHANCE,
  MOVESETS,
  SIM_DT,
  STARTING_WEAPON,
  WEAPONS,
  advanceCombo,
  enemyAttack,
  isWeaponTier,
  weaponDisplayName,
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
  it("todo impactAt de los estilos de las armas está en (0, 1)", () => {
    for (const w of Object.values(WEAPONS)) {
      for (const s of MOVESETS[w.movesetId].combo) {
        expect(s.impactAt, `${w.id} ${s.clip}`).toBeGreaterThan(0);
        expect(s.impactAt, `${w.id} ${s.clip}`).toBeLessThan(1);
      }
    }
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

describe("tiers de arma", () => {
  it("nombre visible con sufijo concordante", () => {
    expect(weaponDisplayName("great-sword", 2)).toBe("Mandoble templado");
    expect(weaponDisplayName("guard-sword", 3)).toBe("Espada de guardia rúnica");
    expect(weaponDisplayName("kingslayer-sword", 1)).toBe("Espada del Kingslayer oxidada");
  });
  it("strikeDamage escala por tier y sin tier queda igual", () => {
    expect(strikeDamage("great-sword", "warrior", 1, 1, 3)).toBe(Math.round(18 * 1 * 1.7));
    expect(strikeDamage("great-sword", "warrior", 1, 1)).toBe(18);
  });
  it("isWeaponTier", () => {
    expect(isWeaponTier(1)).toBe(true);
    expect(isWeaponTier(0)).toBe(false);
    expect(isWeaponTier(4)).toBe(true);
    expect(isWeaponTier(5)).toBe(false);
    expect(isWeaponTier("2")).toBe(false);
  });
});

describe("enemyAttack / ARMED_CHANCE", () => {
  it("desarmado usa la definición base", () => {
    expect(enemyAttack("minion", null)).toEqual({ damage: 6, attackRange: 1.2 });
  });
  it("brute con mandoble templado", () => {
    const a = enemyAttack("brute", { weaponId: "great-sword", tier: 2, nature: "none" });
    expect(a.damage).toBe(Math.round((12 * 18) / 12 * 1.3));
    expect(a.attackRange).toBeCloseTo(2.25, 9);
  });
  it("minion con espada de guardia", () => {
    const a = enemyAttack("minion", { weaponId: "guard-sword", tier: 1, nature: "none" });
    expect(a.damage).toBe(5);
    expect(a.attackRange).toBeCloseTo(1.485, 9);
  });
  it("quién va armado", () => {
    expect(ARMED_CHANCE.mage).toBeNull();
    expect(ARMED_CHANCE.minion).toEqual({ chance: 0.6, weaponId: "guard-sword" });
    expect(ARMED_CHANCE.brute).toEqual({ chance: 0.6, weaponId: "great-sword" });
  });
});
