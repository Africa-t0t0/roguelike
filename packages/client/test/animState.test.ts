import { describe, expect, it } from "vitest";
import { MOVESETS, ENEMY_DEFS } from "@roguelike/shared";
import {
  chooseEnemyAnim,
  chooseHeroAnim,
  RecentHits,
  SpeedMeter,
  type EnemyAnimInput,
  type HeroAnimInput,
} from "../src/render/animState";
import { ENEMY_LOOKS } from "../src/render/looks";

const hero = (over: Partial<HeroAnimInput> = {}): HeroAnimInput => ({
  weaponId: "kingslayer-sword",
  speed: 0,
  airborne: false,
  dodging: false,
  comboStep: 0,
  swingTimer: 0,
  dead: false,
  hurtRecently: false,
  ...over,
});

const enemy = (over: Partial<EnemyAnimInput> = {}): EnemyAnimInput => ({
  kind: "brute",
  ai: "chase",
  speed: 0,
  hurtRecently: false,
  ...over,
});

describe("chooseHeroAnim", () => {
  it("quieto → idle del estilo en bucle", () => {
    expect(chooseHeroAnim(hero())).toEqual({ clip: "ss_idle", loop: true, speed: 1 });
    expect(chooseHeroAnim(hero({ weaponId: "great-sword" })).clip).toBe("gs_idle");
  });

  it("muerto → death del estilo sin bucle, y gana a todo", () => {
    const all = hero({ dead: true, dodging: true, comboStep: 1, swingTimer: 0.2, airborne: true, hurtRecently: true, speed: 8 });
    expect(chooseHeroAnim(all)).toEqual({ clip: "ss_death", loop: false, speed: 1 });
    expect(chooseHeroAnim({ ...all, weaponId: "great-sword" }).clip).toBe("gs_death");
  });

  it("esquivando → run del estilo a ×2, y gana al ataque", () => {
    expect(chooseHeroAnim(hero({ dodging: true, comboStep: 2, swingTimer: 0.2, speed: 8 }))).toEqual({
      clip: "ss_run",
      loop: true,
      speed: 2,
    });
    expect(chooseHeroAnim(hero({ weaponId: "great-sword", dodging: true })).clip).toBe("gs_run");
  });

  it("cada paso del combo de la espada tiene su clip, sin bucle", () => {
    const clips = [1, 2, 3].map((step) => chooseHeroAnim(hero({ comboStep: step, swingTimer: 0.1 })));
    expect(clips.map((c) => c.clip)).toEqual(["ss_slash", "ss_slash_3", "ss_attack_4"]);
    for (const c of clips) {
      expect(c.loop).toBe(false);
      expect(c.speed).toBe(1); // sin clipLengths
    }
  });

  it("mandoble, paso 2 con swing → gs_high_spin_attack ajustado a 0,9 s", () => {
    const lengths = new Map([["gs_high_spin_attack", 2.4]]);
    const c = chooseHeroAnim(hero({ weaponId: "great-sword", comboStep: 2, swingTimer: 0.3 }), lengths);
    expect(c.clip).toBe("gs_high_spin_attack");
    expect(c.loop).toBe(false);
    expect(c.speed).toBeCloseTo(2.4 / 0.9);
  });

  it("espada de guardia, paso 1 → duración 0,35 / 1,15", () => {
    const lengths = new Map([["ss_slash", 1.1]]);
    const c = chooseHeroAnim(hero({ weaponId: "guard-sword", comboStep: 1, swingTimer: 0.1 }), lengths);
    expect(c.clip).toBe("ss_slash");
    expect(1.1 / c.speed).toBeCloseTo(0.35 / 1.15);
  });

  it("sin swing activo el comboStep no muestra ataque", () => {
    expect(chooseHeroAnim(hero({ comboStep: 2, swingTimer: 0 })).clip).toBe("ss_idle");
  });

  it("un paso fuera del combo del arma no muestra ataque", () => {
    expect(chooseHeroAnim(hero({ weaponId: "great-sword", comboStep: 3, swingTimer: 0.2 })).clip).toBe("gs_idle");
  });

  it("el speed del ataque hace que el clip dure lo mismo que el swing", () => {
    const lengths = new Map([
      ["ss_slash", 1.0],
      ["ss_slash_3", 0.7],
      ["ss_attack_4", 1.25],
    ]);
    const combo = MOVESETS["one-hand-sword"].combo;
    for (const step of [1, 2, 3]) {
      const c = chooseHeroAnim(hero({ comboStep: step, swingTimer: 0.05 }), lengths);
      expect(lengths.get(c.clip)! / c.speed).toBeCloseTo(combo[step - 1]!.duration);
    }
  });

  it("un swing en el aire muestra el ataque", () => {
    expect(chooseHeroAnim(hero({ airborne: true, comboStep: 1, swingTimer: 0.2 })).clip).toBe("ss_slash");
  });

  it("en el aire → jump del estilo (gana a herido y a correr)", () => {
    expect(chooseHeroAnim(hero({ airborne: true, hurtRecently: true, speed: 8 })).clip).toBe("ss_jump");
    expect(chooseHeroAnim(hero({ weaponId: "great-sword", airborne: true })).clip).toBe("gs_jump");
  });

  it("herido → hit del estilo sin bucle (gana a correr)", () => {
    const c = chooseHeroAnim(hero({ hurtRecently: true, speed: 8 }));
    expect(c.clip).toBe("ss_impact");
    expect(c.loop).toBe(false);
  });

  it("speed > 6 → sprint del estilo", () => {
    expect(chooseHeroAnim(hero({ speed: 6.5 }))).toEqual({ clip: "ss_run_2", loop: true, speed: 1 });
    expect(chooseHeroAnim(hero({ weaponId: "great-sword", speed: 6.5 })).clip).toBe("gs_run_2");
  });

  it("speed > 0,2 → run del estilo", () => {
    expect(chooseHeroAnim(hero({ speed: 3 }))).toEqual({ clip: "ss_run", loop: true, speed: 1 });
    expect(chooseHeroAnim(hero({ speed: 6 })).clip).toBe("ss_run");
    expect(chooseHeroAnim(hero({ weaponId: "great-sword", speed: 3 })).clip).toBe("gs_run");
  });

  it("speed ≤ 0,2 → idle", () => {
    expect(chooseHeroAnim(hero({ speed: 0.2 })).clip).toBe("ss_idle");
  });
});

describe("chooseEnemyAnim", () => {
  it("quieto → idle del enemigo en bucle", () => {
    expect(chooseEnemyAnim(enemy({ ai: "idle" }))).toEqual({ clip: ENEMY_LOOKS.brute.clips.idle, loop: true, speed: 1 });
    expect(chooseEnemyAnim(enemy({ kind: "mage", ai: "idle" })).clip).toBe("mg_idle");
  });

  it("muerto → death sin bucle, y gana a todo (mago: gs_death)", () => {
    expect(chooseEnemyAnim(enemy({ kind: "mage", ai: "dead", hurtRecently: true, speed: 5 }))).toEqual({
      clip: "gs_death",
      loop: false,
      speed: 1,
    });
    expect(chooseEnemyAnim(enemy({ ai: "dead" })).clip).toBe(ENEMY_LOOKS.brute.clips.death);
  });

  it("telegrafía → attack del enemigo sin bucle (gana a herido y a correr)", () => {
    for (const kind of ["brute", "minion", "mage"] as const) {
      const c = chooseEnemyAnim(enemy({ kind, ai: "telegraph", hurtRecently: true, speed: 3 }));
      expect(c).toEqual({ clip: ENEMY_LOOKS[kind].clips.attack, loop: false, speed: 1 });
    }
  });

  it("telegrafía del mago → mg_attack con speed = largo / 0,7", () => {
    const c = chooseEnemyAnim(enemy({ kind: "mage", ai: "telegraph" }), new Map([["mg_attack", 2.1]]));
    expect(c.clip).toBe("mg_attack");
    expect(c.speed).toBeCloseTo(2.1 / 0.7);
  });

  it("el speed de la telegrafía hace que el clip termine con ella", () => {
    const lengths = new Map([
      [ENEMY_LOOKS.brute.clips.attack, 1.2],
      [ENEMY_LOOKS.minion.clips.attack, 0.9],
      [ENEMY_LOOKS.mage.clips.attack, 1.4],
    ]);
    for (const kind of ["brute", "minion", "mage"] as const) {
      const c = chooseEnemyAnim(enemy({ kind, ai: "telegraph" }), lengths);
      expect(lengths.get(c.clip)! / c.speed).toBeCloseTo(ENEMY_DEFS[kind].telegraphS);
    }
  });

  it("herido → hit del enemigo sin bucle (gana a correr)", () => {
    const c = chooseEnemyAnim(enemy({ hurtRecently: true, speed: 3 }));
    expect(c.clip).toBe(ENEMY_LOOKS.brute.clips.hit);
    expect(c.loop).toBe(false);
  });

  it("speed > 0,2 → run del enemigo, a runSpeed (por defecto 1)", () => {
    expect(chooseEnemyAnim(enemy({ kind: "brute", speed: 3 }))).toEqual({ clip: "cr_run", loop: true, speed: 1 });
    expect(chooseEnemyAnim(enemy({ kind: "mage", speed: 3 }))).toEqual({ clip: "cr_walking", loop: true, speed: 1 });
    expect(chooseEnemyAnim(enemy({ kind: "minion", speed: 5 }))).toEqual({
      clip: "cr_run",
      loop: true,
      speed: ENEMY_LOOKS.minion.runSpeed,
    });
  });

  it("recover sin moverse → idle", () => {
    expect(chooseEnemyAnim(enemy({ ai: "recover", speed: 0 })).clip).toBe(ENEMY_LOOKS.brute.clips.idle);
  });
});

describe("RecentHits", () => {
  it("marca herido durante 0,3 s desde el instante del golpe, no antes", () => {
    const hits = new RecentHits();
    hits.hit("e1", 1000);
    expect(hits.recently("e1", 999)).toBe(false);
    expect(hits.recently("e1", 1000)).toBe(true);
    expect(hits.recently("e1", 1299)).toBe(true);
    expect(hits.recently("e1", 1300)).toBe(false);
    expect(hits.recently("e2", 1100)).toBe(false);
  });

  it("forget borra la marca", () => {
    const hits = new RecentHits();
    hits.hit("e1", 1000);
    hits.forget("e1");
    expect(hits.recently("e1", 1100)).toBe(false);
  });
});

describe("SpeedMeter", () => {
  it("converge a la velocidad en el plano", () => {
    const m = new SpeedMeter();
    let v = 0;
    for (let i = 0; i <= 60; i++) v = m.sample(i * 0.03, i * 0.04, 1 / 60); // 1,8 m/s en X y 2,4 en Z = 3 m/s
    expect(v).toBeCloseTo(3, 1);
  });

  it("la primera muestra da 0 y un salto de teletransporte no da velocidades absurdas", () => {
    const m = new SpeedMeter();
    expect(m.sample(0, 0, 1 / 60)).toBe(0);
    expect(m.sample(50, 0, 1 / 60)).toBe(0);
  });
});
