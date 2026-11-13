import { describe, expect, it } from "vitest";
import { gearDiff, gearScore, gearTooltip, gearVerdict, pickupInfo, formatFloorTime, formatHp, formatRespawn, formatStatus, formatWeapon, formatXp, tierColor } from "../src/ui/hud";
import type { GearItem } from "@roguelike/shared";

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
    expect(formatXp(14.6, 30)).toBe("14/30 XP"); // la XP puede ser fraccionaria (Aprendizaje)
    expect(formatXp(29.6, 30)).toBe("29/30 XP"); // sin subir de nivel no se muestra el lleno
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

  it("formatWeapon suma la naturaleza", () => {
    expect(formatWeapon("great-sword", 4, "fire")).toBe("Mandoble legendario de fuego");
  });

  it("formatStatus lista solo los estados activos, en orden", () => {
    expect(formatStatus({ burnLeft: 2, slowLeft: 0, stunLeft: 0.2 })).toEqual([
      { kind: "burn", left: 2 },
      { kind: "stun", left: 0.2 },
    ]);
    expect(formatStatus({ burnLeft: 0, slowLeft: 0, stunLeft: 0 })).toEqual([]);
  });
});

const boots = (tier: 1 | 2, value: number): GearItem => ({ slot: "boots", tier, stats: [{ stat: "moveSpeed", value }], legendary: null });

describe("equipo en el HUD y el aviso", () => {
  it("gearDiff: sin pieza actual, una línea por stat sin tono", () => {
    expect(gearDiff(undefined, boots(2, 0.075))).toEqual([{ text: "+7,5 % velocidad de movimiento" }]);
  });

  it("gearDiff: la misma stat sube en verde y baja en rojo", () => {
    expect(gearDiff(boots(1, 0.05), boots(2, 0.075))).toEqual([{ text: "+7,5 % velocidad de movimiento (+2,5 %)", tone: "gain" }]);
    expect(gearDiff(boots(2, 0.075), boots(1, 0.05))).toEqual([{ text: "+5 % velocidad de movimiento (-2,5 %)", tone: "loss" }]);
  });

  it("gearDiff: la stat nueva en verde y la que se pierde al final en rojo; planas sin %", () => {
    const next: GearItem = { slot: "helmet", tier: 2, stats: [{ stat: "maxHp", value: 22.5 }, { stat: "regen", value: 1.5 }], legendary: null };
    const cur: GearItem = { slot: "helmet", tier: 2, stats: [{ stat: "maxHp", value: 15 }, { stat: "damage", value: 0.09 }], legendary: null };
    expect(gearDiff(cur, next)).toEqual([
      { text: "+22,5 vida máxima (+7,5)", tone: "gain" },
      { text: "+1,5 de regeneración por segundo (nueva)", tone: "gain" },
      { text: "+9 % daño (la pierdes)", tone: "loss" },
    ]);
  });

  it("gearScore y gearVerdict: puntos por stat de tier 1; casilla vacía, mejor, pareja o peor", () => {
    expect(gearScore(boots(1, 0.05), [])).toBeCloseTo(1);
    expect(gearScore(boots(2, 0.075), [])).toBeCloseTo(1.5);
    expect(gearVerdict(undefined, boots(1, 0.05), [])).toBe("new");
    expect(gearVerdict(boots(1, 0.05), boots(2, 0.075), [])).toBe("better");
    expect(gearVerdict(boots(2, 0.075), boots(1, 0.05), [])).toBe("worse");
    expect(gearVerdict(boots(1, 0.05), boots(1, 0.05), [])).toBe("even");
    // El legendario solo suma si tiene su habilidad.
    const leg: GearItem = { slot: "gloves", tier: 4, stats: [{ stat: "attackSpeed", value: 0.15 }], legendary: "whirlCharges" };
    expect(gearScore(leg, ["whirlwind"]) - gearScore(leg, [])).toBe(2);
  });

  it("pickupInfo: verbo, nombre y líneas por tipo", () => {
    const eq = pickupInfo({ kind: "gear", item: boots(2, 0.075), x: 0, z: 0, ttl: 9 }, {}, []);
    expect(eq).toMatchObject({
      verb: "Equipar", name: "Botas templadas (T2)", lines: [{ text: "+7,5 % velocidad de movimiento" }], verdict: { kind: "new", text: "★ Casilla vacía" },
    });
    expect(pickupInfo({ kind: "gear", item: boots(2, 0.075), x: 0, z: 0, ttl: 9 }, { boots: boots(1, 0.05) }, []).verdict).toEqual({ kind: "better", text: "▲ Mejor que tu T1" });
    const relic = pickupInfo({ kind: "relic", id: "oakHeart", x: 0, z: 0, ttl: 9 }, {}, []);
    expect(relic).toMatchObject({ verb: "Tomar", name: "Corazón de roble", lines: [{ text: "+40 de vida máxima y +1 de regeneración por segundo" }] });
    const w = pickupInfo({ kind: "weapon", weaponId: "great-sword", tier: 2, nature: "none", x: 0, z: 0, ttl: 9 }, {}, []);
    expect(w).toMatchObject({ verb: "Recoger", name: "Mandoble templado", lines: [] });
  });

  const legend: GearItem = {
    slot: "gloves", tier: 4, stats: [{ stat: "attackSpeed", value: 0.15 }], legendary: "whirlCharges",
  };

  it("el tooltip de una legendaria sin la habilidad lleva la marca de inactiva; con ella no", () => {
    const off = gearTooltip(legend, []);
    expect(off.effect).toEqual({ text: "Torbellino tiene 2 cargas", inactive: true });
    expect(gearTooltip(legend, ["whirlwind"]).effect).toEqual({ text: "Torbellino tiene 2 cargas", inactive: false });
    expect(pickupInfo({ kind: "gear", item: legend, x: 0, z: 0, ttl: 9 }, {}, []).lines.at(-1)).toMatchObject({ inactive: true });
  });

  it("cinturón: nombre, stat principal y legendarias con su habilidad", () => {
    const belt: GearItem = { slot: "belt", tier: 4, stats: [{ stat: "regen", value: 2.5 }], legendary: "throwCharges" };
    expect(gearTooltip(belt, []).effect).toEqual({ text: "Lanzar la espada tiene 2 cargas", inactive: true });
    expect(gearTooltip(belt, ["throw"]).effect?.inactive).toBe(false);
    expect(pickupInfo({ kind: "gear", item: belt, x: 0, z: 0, ttl: 9 }, {}, [])).toMatchObject({ name: "Cinturón legendario (T4)" });
    expect(gearDiff(undefined, belt)).toEqual([{ text: "+2,5 de regeneración por segundo" }]);
  });

  it("una legendaria sin habilidad requerida (lastStand) nunca está inactiva", () => {
    const chest: GearItem = { slot: "chest", tier: 4, stats: [{ stat: "damageTaken", value: 0.125 }], legendary: "lastStand" };
    expect(gearTooltip(chest, []).effect?.inactive).toBe(false);
  });
});
