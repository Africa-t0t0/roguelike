import { describe, expect, it } from "vitest";
import { CLASS_DEFS, ENEMY_DEFS } from "@roguelike/shared";
import {
  chooseEnemyAnim,
  chooseHeroAnim,
  RecentHits,
  SpeedMeter,
  type EnemyAnimInput,
  type HeroAnimInput,
} from "../src/render/animState";

const hero = (over: Partial<HeroAnimInput> = {}): HeroAnimInput => ({
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
  it("quieto → Idle en bucle", () => {
    expect(chooseHeroAnim(hero())).toEqual({ clip: "Idle", loop: true, speed: 1 });
  });

  it("muerto → Death_A sin bucle, y gana a todo", () => {
    const all = hero({ dead: true, dodging: true, comboStep: 1, swingTimer: 0.2, airborne: true, hurtRecently: true, speed: 8 });
    expect(chooseHeroAnim(all)).toEqual({ clip: "Death_A", loop: false, speed: 1 });
  });

  it("esquivando → Dodge_Forward, y gana al ataque", () => {
    const c = chooseHeroAnim(hero({ dodging: true, comboStep: 2, swingTimer: 0.2, speed: 8 }));
    expect(c.clip).toBe("Dodge_Forward");
  });

  it("cada paso del combo tiene su clip, sin bucle", () => {
    const clips = [1, 2, 3].map((step) => chooseHeroAnim(hero({ comboStep: step, swingTimer: 0.1 })));
    expect(clips.map((c) => c.clip)).toEqual([
      "1H_Melee_Attack_Chop",
      "1H_Melee_Attack_Slice_Diagonal",
      "1H_Melee_Attack_Stab",
    ]);
    for (const c of clips) {
      expect(c.loop).toBe(false);
      expect(c.speed).toBe(1); // sin clipLengths
    }
  });

  it("sin swing activo el comboStep no muestra ataque", () => {
    expect(chooseHeroAnim(hero({ comboStep: 2, swingTimer: 0 })).clip).toBe("Idle");
  });

  it("el speed del ataque hace que el clip dure lo mismo que el swing", () => {
    const lengths = new Map([
      ["1H_Melee_Attack_Chop", 1.0],
      ["1H_Melee_Attack_Slice_Diagonal", 0.7],
      ["1H_Melee_Attack_Stab", 1.25],
    ]);
    const combo = CLASS_DEFS.warrior.combo;
    for (const step of [1, 2, 3]) {
      const c = chooseHeroAnim(hero({ comboStep: step, swingTimer: 0.05 }), lengths);
      expect(lengths.get(c.clip)! / c.speed).toBeCloseTo(combo[step - 1]!.duration);
    }
  });

  it("un swing en el aire muestra el ataque", () => {
    expect(chooseHeroAnim(hero({ airborne: true, comboStep: 1, swingTimer: 0.2 })).clip).toBe("1H_Melee_Attack_Chop");
  });

  it("en el aire → Jump_Idle (gana a herido y a correr)", () => {
    expect(chooseHeroAnim(hero({ airborne: true, hurtRecently: true, speed: 8 })).clip).toBe("Jump_Idle");
  });

  it("herido → Hit_A sin bucle (gana a correr)", () => {
    const c = chooseHeroAnim(hero({ hurtRecently: true, speed: 8 }));
    expect(c.clip).toBe("Hit_A");
    expect(c.loop).toBe(false);
  });

  it("speed > 6 → Running_A a ×1,4", () => {
    expect(chooseHeroAnim(hero({ speed: 6.5 }))).toEqual({ clip: "Running_A", loop: true, speed: 1.4 });
  });

  it("speed > 0,2 → Running_A a ×1", () => {
    expect(chooseHeroAnim(hero({ speed: 3 }))).toEqual({ clip: "Running_A", loop: true, speed: 1 });
    expect(chooseHeroAnim(hero({ speed: 6 })).speed).toBe(1);
  });

  it("speed ≤ 0,2 → Idle", () => {
    expect(chooseHeroAnim(hero({ speed: 0.2 })).clip).toBe("Idle");
  });
});

describe("chooseEnemyAnim", () => {
  it("quieto → Idle en bucle", () => {
    expect(chooseEnemyAnim(enemy({ ai: "idle" }))).toEqual({ clip: "Idle", loop: true, speed: 1 });
  });

  it("muerto → Death_A sin bucle, y gana a todo", () => {
    expect(chooseEnemyAnim(enemy({ ai: "dead", hurtRecently: true, speed: 5 }))).toEqual({
      clip: "Death_A",
      loop: false,
      speed: 1,
    });
  });

  it("telegrafía cuerpo a cuerpo → 1H_Melee_Attack_Chop sin bucle (brute y minion)", () => {
    for (const kind of ["brute", "minion"] as const) {
      const c = chooseEnemyAnim(enemy({ kind, ai: "telegraph", hurtRecently: true, speed: 3 }));
      expect(c).toEqual({ clip: "1H_Melee_Attack_Chop", loop: false, speed: 1 });
    }
  });

  it("telegrafía del mago → Spellcast_Shoot", () => {
    expect(chooseEnemyAnim(enemy({ kind: "mage", ai: "telegraph" })).clip).toBe("Spellcast_Shoot");
  });

  it("el speed de la telegrafía hace que el clip termine con ella", () => {
    const lengths = new Map([
      ["1H_Melee_Attack_Chop", 1.2],
      ["Spellcast_Shoot", 1.4],
    ]);
    for (const kind of ["brute", "minion", "mage"] as const) {
      const c = chooseEnemyAnim(enemy({ kind, ai: "telegraph" }), lengths);
      expect(lengths.get(c.clip)! / c.speed).toBeCloseTo(ENEMY_DEFS[kind].telegraphS);
    }
  });

  it("herido → Hit_A sin bucle (gana a correr)", () => {
    const c = chooseEnemyAnim(enemy({ hurtRecently: true, speed: 3 }));
    expect(c.clip).toBe("Hit_A");
    expect(c.loop).toBe(false);
  });

  it("speed > 0,2 → Running_A; ×1,3 si es minion", () => {
    expect(chooseEnemyAnim(enemy({ kind: "brute", speed: 3 }))).toEqual({ clip: "Running_A", loop: true, speed: 1 });
    expect(chooseEnemyAnim(enemy({ kind: "mage", speed: 3 })).speed).toBe(1);
    expect(chooseEnemyAnim(enemy({ kind: "minion", speed: 5 }))).toEqual({
      clip: "Running_A",
      loop: true,
      speed: 1.3,
    });
  });

  it("recover sin moverse → Idle", () => {
    expect(chooseEnemyAnim(enemy({ ai: "recover", speed: 0 })).clip).toBe("Idle");
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
