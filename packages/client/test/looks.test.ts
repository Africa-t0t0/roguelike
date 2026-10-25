import { describe, expect, it } from "vitest";
import { ARMED_CHANCE, MOVESETS, WEAPONS, type EnemyKind, type WeaponId } from "@roguelike/shared";
import { chooseEnemyAnim } from "../src/render/animState";
import { allClipIds, ENEMY_LOOKS, PLAYER_LOOK, WEAPON_LOOKS } from "../src/render/looks";

/** Nombres de los clips en `public/assets/mixamo/anims/` (solo las rutas: nada se carga). */
const ANIM_FILES = Object.keys(import.meta.glob("../public/assets/mixamo/anims/*.glb")).map((f) =>
  f.slice(f.lastIndexOf("/") + 1, -".glb".length),
);

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

  it("todo clip que puede elegir chooseEnemyAnim, armado o no, está en allClipIds y en public/", () => {
    const ids = allClipIds();
    const ais = ["idle", "chase", "telegraph", "recover", "dead"];
    for (const kind of Object.keys(ENEMY_LOOKS) as EnemyKind[]) {
      const weapons: (WeaponId | null)[] = [null];
      const armed = ARMED_CHANCE[kind];
      if (armed) weapons.push(armed.weaponId);
      for (const weaponId of weapons) {
        for (const ai of ais) {
          for (const speed of [0, 3]) {
            for (const hurtRecently of [false, true]) {
              const { clip } = chooseEnemyAnim({ kind, ai, speed, hurtRecently, weaponId });
              expect(ids).toContain(clip);
              expect(ANIM_FILES).toContain(clip);
            }
          }
        }
      }
    }
  });

  it("brute y minion tienen gripScale (> 0) para su arma; el mago no la necesita", () => {
    for (const kind of ["brute", "minion"] as const) expect(ENEMY_LOOKS[kind].gripScale).toBeGreaterThan(0);
  });
});
