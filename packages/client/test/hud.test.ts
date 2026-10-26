import { describe, expect, it } from "vitest";
import { formatFloorTime, formatHp, formatRespawn, formatWeapon, formatXp, tierColor } from "../src/ui/hud";

describe("textos del HUD", () => {
  it("formatHp", () => {
    expect(formatHp(96, 120)).toBe("96/120");
    expect(formatHp(0, 120)).toBe("0/120");
  });

  it("formatHp redondea hacia arriba y no baja de 0", () => {
    expect(formatHp(95.2, 120)).toBe("96/120");
    expect(formatHp(-3, 120)).toBe("0/120");
  });

  it("formatWeapon da el nombre del arma con su tier", () => {
    expect(formatWeapon("great-sword", 2)).toBe("Mandoble templado");
    expect(formatWeapon("kingslayer-sword", 1)).toBe("Espada del Kingslayer oxidada");
    expect(formatWeapon("guard-sword", 3)).toBe("Espada de guardia rúnica");
  });

  it("formatFloorTime: mm:ss, los minutos no se cortan en 60", () => {
    expect(formatFloorTime(0)).toBe("00:00");
    expect(formatFloorTime(65)).toBe("01:05");
    expect(formatFloorTime(3660)).toBe("61:00");
    expect(formatFloorTime(59.9)).toBe("00:59");
    expect(formatFloorTime(-2)).toBe("00:00");
  });

  it("formatXp", () => {
    expect(formatXp(14, 30)).toBe("14/30 XP");
    expect(formatXp(14.6, 30)).toBe("15/30 XP"); // la XP puede ser fraccionaria (Aprendizaje)
  });

  it("formatRespawn cuenta segundos enteros hacia arriba, mínimo 1", () => {
    expect(formatRespawn(5)).toBe("Caíste — reapareces en 5…");
    expect(formatRespawn(4.97)).toBe("Caíste — reapareces en 5…");
    expect(formatRespawn(4)).toBe("Caíste — reapareces en 4…");
    expect(formatRespawn(0.2)).toBe("Caíste — reapareces en 1…");
    expect(formatRespawn(0)).toBe("Caíste — reapareces en 1…");
  });

  it("tierColor: dorado para tier 1 y el color del brillo, aclarado, para 2 y 3", () => {
    expect(tierColor(1)).toBe("#d9b46a");
    expect(tierColor(2)).toBe("rgb(147, 180, 255)");
    expect(tierColor(3)).toBe("rgb(197, 139, 255)");
  });
});
