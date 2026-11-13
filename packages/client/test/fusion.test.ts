import { describe, expect, it } from "vitest";
import { abilityCooldownS, SIM_DT } from "@roguelike/shared";
import { LocalAbility } from "../src/net/LocalAbility";
import { abilityBarModel } from "../src/ui/abilityBar";
import { currentFusion, fusableAbilities, fusionHint, fusionNeed } from "../src/ui/fusionPanel";

describe("fusión en el cliente", () => {
  it("la barra muestra la casilla fusionada con los dos glifos y el ciclo de la más lenta", () => {
    const [slot] = abilityBarModel([{ id: "whirlwind", rank: 1, partners: [{ id: "throw", rank: 1 }] }], (id) => (id === "whirlwind" ? 2 : 0));
    if (!slot || slot.empty) throw new Error("vacía");
    expect(slot.fused).toBe(true);
    expect(slot.name).toBe("Torbellino + Lanzar la espada");
    expect(slot.glyph).toBe("⟳⚔");
    expect(slot.cooling).toBe(true);
    expect(slot.sweep).toBeCloseTo(2 / Math.max(abilityCooldownS("whirlwind", 1), abilityCooldownS("throw", 1)));
  });

  it("predice la casilla: arranca la que lleva y gasta solo de la que lleva las cargas", () => {
    const a = new LocalAbility();
    a.setServer([{ id: "whirlwind", rank: 1, cooldown: 0, partners: [{ id: "throw", rank: 1 }] }], 0);
    expect(a.tick(1, { dead: false, swingTimer: 0 }, 0)).toBe("whirlwind");
    expect(a.partnersOf("whirlwind")).toEqual([{ id: "throw", rank: 1 }]);
    const slow = Math.max(abilityCooldownS("whirlwind", 1), abilityCooldownS("throw", 1));
    expect(a.cooldownLeft("whirlwind", SIM_DT * 1000)).toBeCloseTo(slow, 0);
  });

  it("el Tajo frontal de rango 3 da sus 3 cargas a la fusión", () => {
    const a = new LocalAbility();
    a.setServer([{ id: "thrust", rank: 3, cooldown: 0, charges: 3, partners: [{ id: "warcry", rank: 1 }] }], 0);
    let t = 0;
    let casts = 0;
    for (let i = 0; i < 3; i++) {
      if (a.tick(1, { dead: false, swingTimer: 0 }, t) === "thrust") casts++;
      // Suelta la tecla y espera a que termine también el Grito.
      for (let k = 0; k < 40; k++) a.tick(0, { dead: false, swingTimer: 0 }, (t += SIM_DT * 1000));
    }
    expect(casts).toBe(3);
    expect(a.chargesOf("thrust", t)).toEqual({ charges: 0, max: 3 });
  });

  it("el panel: sin fusión pide dos; con ella, una que se suma", () => {
    const slots = [{ id: "slam" as const }, { id: "whirlwind" as const, partners: [{ id: "throw" as const }] }, { id: "hook" as const }];
    expect(fusableAbilities(slots)).toEqual(["slam", "hook"]);
    expect(currentFusion(slots)).toEqual(["whirlwind", "throw"]);
    expect(fusionNeed([])).toBe(2);
    expect(fusionNeed(["whirlwind", "throw"])).toBe(1);
    expect(fusionHint([], ["slam", "hook"])).toBe("Golpe sísmico + Gancho de cadena");
    expect(fusionHint(["whirlwind", "throw"], ["hook"])).toBe("Torbellino + Lanzar la espada + Gancho de cadena");
  });
});
