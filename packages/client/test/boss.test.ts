import { describe, expect, it } from "vitest";
import { DRAGON } from "@roguelike/shared";
import { parseHazard, type EnemySnapshot } from "../src/net/connection";
import { stripBurntM, warnFill } from "../src/render/bossHazardViews";
import { chooseDragonClip, dragonAltitude } from "../src/render/dragonViews";
import { totemPulse } from "../src/render/totemView";
import { bossTitle } from "../src/ui/hud";

type Dr = Pick<EnemySnapshot, "ai" | "bossMove" | "bossStage" | "enraged">;
const idle: Dr = { ai: "chase", bossMove: null, bossStage: null, enraged: false };

describe("dragón en el cliente", () => {
  it("clips: quieto, caminando, zarpazo, lanzallamas y la pasada por tramos", () => {
    expect(chooseDragonClip(idle, 0).clip).toBe("Idle_loop");
    expect(chooseDragonClip(idle, 3).clip).toBe("Walk_menacing_loop");
    expect(chooseDragonClip({ ...idle, bossMove: "claw", bossStage: "warn" }, 0).clip).toBe("Attack");
    expect(chooseDragonClip({ ...idle, bossMove: "flame", bossStage: "act" }, 0).clip).toBe("AttackPose");
    expect(chooseDragonClip({ ...idle, bossMove: "flyby", bossStage: "warn" }, 0).clip).toBe("GroundToFly");
    expect(chooseDragonClip({ ...idle, bossMove: "flyby", bossStage: "act" }, 0).clip).toBe("Flying_loop");
    // Con furia, el zarpazo se acelera como su aviso.
    const calm = chooseDragonClip({ ...idle, bossMove: "claw", bossStage: "warn" }, 0).rate;
    expect(chooseDragonClip({ ...idle, bossMove: "claw", bossStage: "warn", enraged: true }, 0).rate).toBeCloseTo(calm / DRAGON.enrageTimeMult);
  });
  it("vuela solo en la pasada (y despega un poco en su aviso)", () => {
    expect(dragonAltitude({ ...idle })).toBe(0);
    expect(dragonAltitude({ ...idle, bossMove: "flyby", bossStage: "act" })).toBeGreaterThan(2);
    expect(dragonAltitude({ ...idle, bossMove: "flyby", bossStage: "warn" })).toBeGreaterThan(0);
    expect(dragonAltitude({ ...idle, ai: "dead", bossMove: "flyby", bossStage: "act" })).toBe(0);
  });
  it("avisos: se llenan hasta el golpe; la franja se quema con el vuelo", () => {
    expect(warnFill(1, 1)).toBe(0);
    expect(warnFill(0.25, 1)).toBe(0.75);
    const strip = { phase: "fire" as const, left: 5, total: 6, length: 20 };
    expect(stripBurntM(strip)).toBeCloseTo(DRAGON.flyby.speed);
    expect(stripBurntM({ ...strip, left: 0 })).toBe(20);
    expect(stripBurntM({ ...strip, phase: "warn" })).toBe(0);
  });
  it("los peligros del dragón se aceptan al leer el estado", () => {
    for (const kind of ["arc", "cone", "ring", "strip"]) {
      expect(parseHazard({ kind, x: 0, z: 0, dirX: 0, dirZ: 1, length: 4, size: 90, left: 1, total: 1, phase: "warn" })?.kind).toBe(kind);
    }
  });
  it("tótem y barra del jefe", () => {
    expect(totemPulse("open", 0)).toBeGreaterThan(totemPulse("idle", 0));
    expect(bossTitle(2, false)).toBe("Dragón · piso 2");
    expect(bossTitle(1, true)).toBe("Dragón enfurecido · piso 1");
  });
});
