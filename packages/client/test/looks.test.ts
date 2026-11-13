import { describe, expect, it } from "vitest";
import { ABILITIES, ARMED_CHANCE, MOVESETS, WEAPONS, weaponsOf, type EnemyKind, type WeaponId } from "@roguelike/shared";
import { chooseEnemyAnim } from "../src/render/animState";
import { allClipIds, ENEMY_LOOKS, KNIGHT_LOOK, MAGE_PLAYER_LOOK, PLAYER_LOOK, PLAYER_LOOKS, WEAPON_LOOKS, type LookKind } from "../src/render/looks";

/** Nombres de los clips en `public/assets/mixamo/anims/` (solo las rutas: nada se carga). */
const ANIM_FILES = Object.keys(import.meta.glob("../public/assets/mixamo/anims/*.glb")).map((f) =>
  f.slice(f.lastIndexOf("/") + 1, -".glb".length),
);

/** Animaciones y nodos de un modelo KayKit (.glb) de `public/assets/kaykit/`. */
function glbOf(asset: string): { clips: Set<string>; nodes: Set<string> } {
  const files: Record<string, string> = {
    knight: "characters/Knight.glb",
    mageHero: "characters/Mage.glb",
    skeletonWarrior: "skeletons/Skeleton_Warrior.glb",
    skeletonMinion: "skeletons/Skeleton_Minion.glb",
    skeletonMage: "skeletons/Skeleton_Mage.glb",
  };
  // Sin los tipos de Node en el cliente: el módulo `fs` se pide en tiempo de ejecución (las pruebas corren en Node).
  type Fs = { readFileSync(path: URL): Uint8Array };
  const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
  const glb = fs.readFileSync(new URL(`../public/assets/kaykit/${files[asset]}`, import.meta.url));
  const jsonLength = new DataView(glb.buffer, glb.byteOffset, glb.byteLength).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
    animations: { name: string }[];
    nodes: { name: string }[];
  };
  return { clips: new Set(json.animations.map((a) => a.name)), nodes: new Set(json.nodes.map((n) => n.name)) };
}

describe("looks", () => {
  it("allClipIds trae cada clip de MOVESETS y ENEMY_LOOKS, sin repetidos", () => {
    const ids = allClipIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of Object.values(MOVESETS)) {
      for (const c of Object.values(m.locomotion)) expect(ids).toContain(c);
      for (const s of m.combo) expect(ids).toContain(s.clip);
    }
    // Los esqueletos KayKit suenan sus propias animaciones: no piden clips de Mixamo.
    for (const look of Object.values(ENEMY_LOOKS)) {
      expect(look.ownClips).toBeDefined();
      for (const c of Object.values(look.clips)) expect(ids).not.toContain(c);
    }
  });

  it("allClipIds incluye los clips de las habilidades, y existen en public/", () => {
    const ids = allClipIds();
    for (const clip of ["ss_slash_3", "ss_power_up", "gs_jump_attack", "gs_slide_attack", "gs_high_spin_attack"]) {
      expect(ids).toContain(clip);
      expect(ANIM_FILES).toContain(clip);
    }
    for (const def of Object.values(ABILITIES)) if (def.clip) expect(ids).toContain(def.clip);
  });

  it("WEAPON_LOOKS tiene una entrada por cada arma", () => {
    expect(Object.keys(WEAPON_LOOKS).sort()).toEqual(Object.keys(WEAPONS).sort());
    for (const look of Object.values(WEAPON_LOOKS)) expect(look.grip.scale).toBeGreaterThan(0);
  });

  it("alturas y clips de los enemigos según el plan", () => {
    expect(PLAYER_LOOK).toMatchObject({ asset: "knight", height: 1.8 });
    const expected: Record<LookKind, [string, number, string[]]> = {
      brute: ["skeletonWarrior", 2.4, ["Idle_Combat", "Running_A", "Unarmed_Melee_Attack_Punch_B", "Hit_A", "Death_C_Skeletons"]],
      minion: ["skeletonMinion", 1.7, ["Idle_B", "Running_C", "Unarmed_Melee_Attack_Punch_A", "Hit_B", "Death_C_Skeletons"]],
      mage: ["skeletonMage", 2.2, ["Idle", "Walking_D_Skeletons", "Spellcast_Shoot", "Hit_A", "Death_C_Skeletons"]],
      pyromancer: ["skeletonMage", 2.2, ["Idle", "Walking_D_Skeletons", "Spellcast_Shoot", "Hit_A", "Death_C_Skeletons"]],
      stormcaller: ["skeletonMage", 2.2, ["Idle", "Walking_D_Skeletons", "Spellcast_Shoot", "Hit_A", "Death_C_Skeletons"]],
      healer: ["skeletonMage", 2.2, ["Idle", "Walking_D_Skeletons", "Spellcast_Shoot", "Hit_A", "Death_C_Skeletons"]],
    };
    for (const [kind, [asset, height, clips]] of Object.entries(expected)) {
      const look = ENEMY_LOOKS[kind as LookKind];
      expect(look.asset).toBe(asset);
      expect(look.height).toBe(height);
      const c = look.clips;
      expect([c.idle, c.run, c.attack, c.hit, c.death]).toEqual(clips);
    }
  });

  it("todo clip que puede elegir chooseEnemyAnim, armado o no, tiene su animación en el modelo del esqueleto", () => {
    const ais = ["idle", "chase", "telegraph", "recover", "dead"];
    for (const kind of Object.keys(ENEMY_LOOKS) as LookKind[]) {
      const weapons: (WeaponId | null)[] = [null];
      const armed = ARMED_CHANCE[kind];
      if (armed) weapons.push(armed.weaponId);
      for (const weaponId of weapons) {
        for (const ai of ais) {
          for (const speed of [0, 3]) {
            for (const hurtRecently of [false, true]) {
              const { clip } = chooseEnemyAnim({ kind, ai, speed, hurtRecently, weaponId });
              const own = ENEMY_LOOKS[kind].ownClips?.[clip];
              expect(own, `${kind}: ${clip}`).toBeDefined();
              expect(glbOf(ENEMY_LOOKS[kind].asset).clips.has(own!.clip), `${kind}: ${clip} → ${own!.clip}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("brute y minion llevan un arma del pack por cada arma con que pueden nacer; el mago, su bastón", () => {
    for (const kind of ["brute", "minion"] as const) {
      expect(ENEMY_LOOKS[kind].slotWeapons?.[ARMED_CHANCE[kind]!.weaponId]).toBeDefined();
    }
    expect(ENEMY_LOOKS.mage.prop).toBe("skeletonStaff");
  });

  describe.each([
    ["warrior", KNIGHT_LOOK, "knight"],
    ["mage", MAGE_PLAYER_LOOK, "mageHero"],
  ] as const)("héroe KayKit (%s)", (cls, look, asset) => {
    const { clips, nodes } = glbOf(asset);

    it("es el cuerpo de su rol", () => expect(PLAYER_LOOKS[cls]).toBe(look));

    it("cada clip que puede sonar (locomoción, combo y habilidades del rol) tiene el suyo en el modelo", () => {
      const wanted = new Set<string>();
      for (const w of weaponsOf(cls)) {
        const m = MOVESETS[WEAPONS[w].movesetId];
        for (const c of Object.values(m.locomotion)) wanted.add(c);
        for (const s of m.combo) wanted.add(s.clip);
      }
      for (const def of Object.values(ABILITIES)) if (def.cls === cls && def.clip) wanted.add(def.clip);
      for (const c of wanted) {
        const own = look.ownClips?.[c];
        expect(own, c).toBeDefined();
        expect(clips.has(own!.clip), `${c} → ${own!.clip}`).toBe(true);
      }
    });

    it("las mallas de armas que oculta o muestra existen en el modelo, y cada arma del rol tiene la suya", () => {
      const names = [...(look.hideMeshes ?? []), ...Object.values(look.ownWeapons ?? {}).flat()];
      for (const n of names) expect(nodes.has(n), n).toBe(true);
      for (const w of weaponsOf(cls)) expect(look.ownWeapons?.[w], w).toBeDefined();
    });
  });
});
