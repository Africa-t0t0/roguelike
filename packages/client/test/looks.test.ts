import { describe, expect, it } from "vitest";
import { MOVESETS, WEAPONS, type EnemyKind } from "@roguelike/shared";
import { allClipIds, ENEMY_LOOKS, PLAYER_LOOK, WEAPON_LOOKS } from "../src/render/looks";

describe("looks", () => {
  it("allClipIds trae cada clip de MOVESETS y ENEMY_LOOKS, sin repetidos", () => {
    const ids = allClipIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of Object.values(MOVESETS)) {
      for (const c of Object.values(m.locomotion)) expect(ids).toContain(c);
      for (const s of m.combo) expect(ids).toContain(s.clip);
    }
    for (const look of Object.values(ENEMY_LOOKS)) {
      for (const c of Object.values(look.clips)) expect(ids).toContain(c);
    }
  });

  it("WEAPON_LOOKS tiene una entrada por cada arma", () => {
    expect(Object.keys(WEAPON_LOOKS).sort()).toEqual(Object.keys(WEAPONS).sort());
    for (const look of Object.values(WEAPON_LOOKS)) expect(look.grip.scale).toBeGreaterThan(0);
  });

  it("alturas y clips de los enemigos según el plan", () => {
    expect(PLAYER_LOOK).toEqual({ asset: "kingslayer", height: 1.8 });
    const expected: Record<EnemyKind, [string, number, string[]]> = {
      brute: ["brute", 2.4, ["cr_idle", "cr_run", "cr_swiping", "gs_impact", "cr_dying"]],
      minion: ["minion", 1.7, ["cr_idle_2", "cr_run", "cr_punch", "gs_impact_4", "cr_dying"]],
      mage: ["mage", 2.2, ["mg_idle", "cr_walking", "mg_attack", "gs_impact_2", "gs_death"]],
    };
    for (const [kind, [asset, height, clips]] of Object.entries(expected)) {
      const look = ENEMY_LOOKS[kind as EnemyKind];
      expect(look.asset).toBe(asset);
      expect(look.height).toBe(height);
      const c = look.clips;
      expect([c.idle, c.run, c.attack, c.hit, c.death]).toEqual(clips);
    }
  });
});
