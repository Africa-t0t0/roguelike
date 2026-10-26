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

  it("glifo del Tajo frontal", () => {
    const slots = abilityBarModel([{ id: "thrust", rank: 1 }], () => 0, false);
    expect(filled(slots[0]).glyph).toBe("➶");
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

describe("Celeridad (cooldownMult)", () => {
  it("con 0.5 predice la repetición del Empuje a los 3.6 s y la barra la muestra lista", () => {
    const a = new LocalAbility();
    a.setCooldownMult(0.5);
    a.setServer([{ id: "thrust", cooldown: 0 }], 0);
    expect(a.tick(0b1, { dead: false, swingTimer: 0 }, 0)).toBe("thrust");
    a.tick(0, { dead: false, swingTimer: 0 }, 1);
    const ms = 3600;
    for (let t = 0; t < 3.6; t += SIM_DT) a.tick(0, { dead: false, swingTimer: 0 }, ms);
    expect(a.cooldownLeft("thrust", ms)).toBe(0);
    const [s] = abilityBarModel([{ id: "thrust", rank: 1 }], (id) => a.cooldownLeft(id, ms), false, 0.5);
    expect(filled(s)).toMatchObject({ cooldownText: "", sweep: 0 });
    expect(a.tick(0b1, { dead: false, swingTimer: 0 }, ms)).toBe("thrust");
    const half = filled(abilityBarModel([{ id: "thrust", rank: 1 }], () => ABILITIES.thrust.cooldownS * 0.25, false, 0.5)[0]);
    expect(half.sweep).toBeCloseTo(0.5);
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

describe("abilityBarModel con cargas", () => {
  const slots = [{ id: "whirlwind" as const, rank: 1 }];
  const model = (cd: number, charges: number) => abilityBarModel(slots, () => cd, false, 1, () => ({ charges, max: 2 }))[0]!;

  it("con 1 de 2 cargas se puede lanzar: barrido de la recarga, sin número de segundos ni atenuar", () => {
    expect(model(4, 1)).toMatchObject({ charges: 1, maxCharges: 2, cooldownText: "", cooling: false });
    expect((model(4, 1) as { sweep: number }).sweep).toBeCloseTo(4 / ABILITIES.whirlwind.cooldownS);
  });

  it("sin cargas muestra los segundos y atenúa; con el máximo no hay barrido", () => {
    expect(model(4, 0)).toMatchObject({ charges: 0, cooldownText: "4", cooling: true });
    expect(model(0, 2)).toMatchObject({ charges: 2, sweep: 0, cooling: false });
  });
});
