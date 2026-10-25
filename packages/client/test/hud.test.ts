import { describe, expect, it } from "vitest";
import { formatHp, formatRespawn, formatWeapon, formatXp } from "../src/ui/hud";

describe("textos del HUD", () => {
  it("formatHp", () => {
    expect(formatHp(96, 120)).toBe("Vida 96/120");
    expect(formatHp(0, 120)).toBe("Vida 0/120");
  });

  it("formatHp redondea hacia arriba y no baja de 0", () => {
    expect(formatHp(95.2, 120)).toBe("Vida 96/120");
    expect(formatHp(-3, 120)).toBe("Vida 0/120");
  });

  it("formatWeapon da el nombre del arma", () => {
    expect(formatWeapon("great-sword")).toBe("Mandoble");
    expect(formatWeapon("kingslayer-sword")).toBe("Espada del Kingslayer");
  });

  it("formatXp", () => {
    expect(formatXp(2, 14, 30)).toBe("Nivel 2 · 14/30 XP");
  });

  it("formatRespawn cuenta segundos enteros hacia arriba, mínimo 1", () => {
    expect(formatRespawn(5)).toBe("Caíste — reapareces en 5…");
    expect(formatRespawn(4.97)).toBe("Caíste — reapareces en 5…");
    expect(formatRespawn(4)).toBe("Caíste — reapareces en 4…");
    expect(formatRespawn(0.2)).toBe("Caíste — reapareces en 1…");
    expect(formatRespawn(0)).toBe("Caíste — reapareces en 1…");
  });
});
