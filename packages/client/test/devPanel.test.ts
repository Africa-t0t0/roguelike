import { describe, expect, it } from "vitest";
import { ABILITIES, parseDevCommand, STAT_CARDS } from "@roguelike/shared";
import { devCardOptions, toggleLabel } from "../src/ui/devPanel";

describe("panel de pruebas", () => {
  it("ofrece cada habilidad en sus 3 rangos y cada carta de stat, todas válidas para el servidor", () => {
    const options = devCardOptions();
    expect(options).toHaveLength(Object.keys(ABILITIES).length * 3 + Object.keys(STAT_CARDS).length);
    for (const o of options) expect(parseDevCommand({ cmd: "card", card: o.card })).toEqual({ cmd: "card", card: o.card });
    expect(options.find((o) => o.card.kind === "ability" && o.card.id === "thrust" && o.card.rank === 3)?.label).toBe(
      "Tajo frontal III",
    );
    expect(options.find((o) => o.card.kind === "stat" && o.card.id === "haste")?.label).toBe("Celeridad");
  });

  it("los interruptores muestran sí o no", () => {
    expect(toggleLabel("Oleadas", true)).toBe("Oleadas: sí");
    expect(toggleLabel("Oleadas", false)).toBe("Oleadas: no");
  });
});
