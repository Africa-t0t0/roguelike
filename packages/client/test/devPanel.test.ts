import { describe, expect, it } from "vitest";
import { ABILITIES, parseDevCommand, STAT_CARDS } from "@roguelike/shared";
import { devCardOptions, devGearCommand, devRelicOptions, NATURE_LABELS, toggleLabel } from "../src/ui/devPanel";

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

  it("el selector de naturaleza usa sus etiquetas", () => {
    expect(NATURE_LABELS).toEqual(["Sin naturaleza", "Fuego", "Hielo", "Rayo"]);
  });

  it("los interruptores muestran sí o no", () => {
    expect(toggleLabel("Oleadas", true)).toBe("Oleadas: sí");
    expect(toggleLabel("Oleadas", false)).toBe("Oleadas: no");
  });

  it("la sección Equipo manda comandos válidos para el servidor", () => {
    const equip = devGearCommand(4, 3, "equip");
    expect(equip).toEqual({ cmd: "gear", slot: "boots", tier: 4, action: "equip" });
    expect(parseDevCommand(equip)).toEqual(equip);
    expect(devGearCommand(3, 2, "equip")).toEqual({ cmd: "gear", slot: "belt", tier: 3, action: "equip" });
    expect(devGearCommand(0, 0, "drop")).toEqual({ cmd: "gear", slot: "helmet", tier: 1, action: "drop" });
    const relics = devRelicOptions();
    expect(relics).toHaveLength(9);
    for (const r of relics) expect(parseDevCommand({ cmd: "relic", id: r.id })).toEqual({ cmd: "relic", id: r.id });
    expect(relics.find((r) => r.id === "oakHeart")?.label).toBe("Corazón de roble");
  });
});
