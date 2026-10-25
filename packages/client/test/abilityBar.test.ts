import { describe, expect, it } from "vitest";
import { ABILITIES, SIM_DT } from "@roguelike/shared";
import { LocalAbility } from "../src/net/LocalAbility";
import { abilityBarModel, formatCooldown, rankPips, type AbilitySlotModel } from "../src/ui/abilityBar";

type Filled = Extract<AbilitySlotModel, { empty: false }>;
function filled(s: AbilitySlotModel | undefined): Filled {
  if (!s || s.empty) throw new Error("casilla vacía");
  return s;
}

describe("textos de la barra de habilidades", () => {
  it("formatCooldown: segundos enteros hacia arriba; bajo 1 s, una décima", () => {
    expect(formatCooldown(3)).toBe("3");
    expect(formatCooldown(2.2)).toBe("3");
    expect(formatCooldown(0.5)).toBe("0.5");
    expect(formatCooldown(0.42)).toBe("0.5");
    expect(formatCooldown(0.96)).toBe("1");
    expect(formatCooldown(0)).toBe("");
    expect(formatCooldown(-1)).toBe("");
    expect(formatCooldown(Number.NaN)).toBe("");
  });

  it("rankPips: un punto lleno por rango, de 3", () => {
    expect(rankPips(1)).toBe("●○○");
    expect(rankPips(2)).toBe("●●○");
    expect(rankPips(3)).toBe("●●●");
    expect(rankPips(0)).toBe("○○○");
    expect(rankPips(7)).toBe("●●●");
  });
});

describe("abilityBarModel", () => {
  it("con 2 habilidades: 2 casillas llenas y 2 vacías, con su tecla", () => {
    const slots = abilityBarModel(
      [
        { id: "whirlwind", rank: 2 },
        { id: "block", rank: 1 },
      ],
      () => 0,
      false,
    );
    expect(slots).toHaveLength(4);
    expect(slots.map((s) => s.key)).toEqual(["1", "2", "3", "4"]);
    expect(slots.map((s) => s.empty)).toEqual([false, false, true, true]);
    expect(slots[0]).toMatchObject({ glyph: "⟳", name: "Torbellino", pips: "●●○", cooldownText: "", sweep: 0 });
    expect(slots[1]).toMatchObject({ glyph: "⛨", name: "Bloqueo", active: false });
  });

  it("glifo de cada habilidad activa", () => {
    const ids = ["whirlwind", "kick", "warcry", "slam"] as const;
    const slots = abilityBarModel(ids.map((id) => ({ id, rank: 1 })), () => 0, false);
    expect(slots.map((s) => filled(s).glyph)).toEqual(["⟳", "↯", "✶", "◎"]);
  });

  it("el barrido es la fracción de enfriamiento que queda", () => {
    const s = filled(abilityBarModel([{ id: "kick", rank: 1 }], () => 3, false)[0]);
    expect(s.sweep).toBeCloseTo(3 / ABILITIES.kick.cooldownS);
    expect(s.cooldownText).toBe("3");
  });

  it("el Bloqueo se marca activo mientras se mantiene", () => {
    const [s] = abilityBarModel([{ id: "block", rank: 1 }], () => 0, true);
    expect(s).toMatchObject({ active: true, sweep: 0 });
  });
});

describe("LocalAbility.cooldownLeft", () => {
  it("al apretar la tecla manda el enfriamiento local (mayor) aunque el servidor aún diga 0", () => {
    const a = new LocalAbility();
    a.setServer([{ id: "kick", cooldown: 0 }], 0);
    expect(a.cooldownLeft("kick", 0)).toBe(0);
    a.tick(0b1, { dead: false, swingTimer: 0 }, 0);
    expect(a.cooldownLeft("kick", 0)).toBeCloseTo(ABILITIES.kick.cooldownS);
    a.tick(0b1, { dead: false, swingTimer: 0 }, SIM_DT * 1000);
    expect(a.cooldownLeft("kick", SIM_DT * 1000)).toBeCloseTo(ABILITIES.kick.cooldownS - SIM_DT);
  });

  it("sin lanzarla localmente, el del servidor corriendo desde que llegó", () => {
    const a = new LocalAbility();
    a.setServer([{ id: "slam", cooldown: 4 }], 1000);
    expect(a.cooldownLeft("slam", 2000)).toBeCloseTo(3);
    expect(a.cooldownLeft("slam", 9000)).toBe(0);
  });
});
