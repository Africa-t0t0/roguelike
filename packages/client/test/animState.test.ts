import { describe, expect, it } from "vitest";
import { MOVESETS, ENEMY_DEFS } from "@roguelike/shared";
import {
  chooseEnemyAnim,
  chooseHeroAnim,
  heroBodyYaw,
  moveSector,
  RecentHits,
  SpeedMeter,
  type EnemyAnimInput,
  type HeroAnimInput,
} from "../src/render/animState";
import { ENEMY_LOOKS } from "../src/render/looks";

const hero = (over: Partial<HeroAnimInput> = {}): HeroAnimInput => ({
  weaponId: "kingslayer-sword",
  speed: 0,
  moveAngle: 0,
  airborne: false,
  comboStep: 0,
  swingTimer: 0,
  dead: false,
  hurtRecently: false,
  blocking: false,
  ...over,
});

const enemy = (over: Partial<EnemyAnimInput> = {}): EnemyAnimInput => ({
  kind: "brute",
  ai: "chase",
  speed: 0,
  hurtRecently: false,
  weaponId: null,
  ...over,
});

describe("chooseHeroAnim", () => {
  it("quieto → idle del estilo en bucle", () => {
    expect(chooseHeroAnim(hero())).toEqual({ clip: "ss_idle", loop: true, speed: 1 });
    expect(chooseHeroAnim(hero({ weaponId: "great-sword" })).clip).toBe("gs_idle");
  });

  it("muerto → death del estilo sin bucle, y gana a todo", () => {
    const all = hero({ dead: true, comboStep: 1, swingTimer: 0.2, airborne: true, hurtRecently: true, speed: 8 });
    expect(chooseHeroAnim(all)).toEqual({ clip: "ss_death", loop: false, speed: 1 });
    expect(chooseHeroAnim({ ...all, weaponId: "great-sword" }).clip).toBe("gs_death");
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

  it("speed > 6 hacia adelante → sprint del estilo, con el paso ajustado", () => {
    expect(chooseHeroAnim(hero({ speed: 8 }))).toEqual({ clip: "ss_run", loop: true, speed: 8 / 4.9 });
    expect(chooseHeroAnim(hero({ weaponId: "great-sword", speed: 8 })).clip).toBe("gs_run_2");
  });

  it("corre en la dirección del movimiento respecto de la mirada (clips que avanzan hacia ese lado)", () => {
    const at = (moveAngle: number, weaponId: HeroAnimInput["weaponId"] = "kingslayer-sword") =>
      chooseHeroAnim(hero({ speed: 5, moveAngle, weaponId })).clip;
    expect([at(0), at(Math.PI), at(Math.PI / 2), at(-Math.PI / 2)]).toEqual(["ss_run", "ss_run_2", "ss_strafe_4", "ss_strafe_3"]);
    expect([at(0, "great-sword"), at(Math.PI, "great-sword"), at(Math.PI / 2, "great-sword"), at(-Math.PI / 2, "great-sword")]).toEqual([
      "gs_run_2",
      "gs_run",
      "gs_strafe_4",
      "gs_strafe_3",
    ]);
    // las diagonales del teclado van con adelante o atrás
    expect([at(Math.PI / 4), at(-Math.PI / 4), at((3 * Math.PI) / 4)]).toEqual(["ss_run", "ss_run", "ss_run_2"]);
  });

  it("la velocidad del clip acompaña a la del movimiento, dentro de límites", () => {
    expect(chooseHeroAnim(hero({ speed: 4.9 })).speed).toBeCloseTo(1);
    expect(chooseHeroAnim(hero({ speed: 2.45 })).speed).toBeCloseTo(0.6);
    expect(chooseHeroAnim(hero({ speed: 0.5 })).speed).toBeCloseTo(0.6);
    expect(chooseHeroAnim(hero({ speed: 10, moveAngle: Math.PI / 2 })).speed).toBeCloseTo(2.2);
  });

  it("habilidad: whirlwind → gs_high_spin_attack ajustado a 0,9 s, sin bucle, y gana al ataque", () => {
    const lengths = new Map([["gs_high_spin_attack", 2.4]]);
    const c = chooseHeroAnim(
      hero({ ability: { id: "whirlwind", elapsed: 0.1 }, comboStep: 1, swingTimer: 0.2, airborne: true, blocking: true }),
      lengths,
    );
    expect(c.clip).toBe("gs_high_spin_attack");
    expect(c.loop).toBe(false);
    expect(c.speed).toBeCloseTo(2.4 / 0.9);
  });

  it("habilidad: cada activa usa su clip; la muerte gana a la habilidad", () => {
    expect(chooseHeroAnim(hero({ ability: { id: "kick", elapsed: 0 } })).clip).toBe("ss_kick");
    expect(chooseHeroAnim(hero({ ability: { id: "warcry", elapsed: 0 } })).clip).toBe("ss_power_up");
    expect(chooseHeroAnim(hero({ ability: { id: "slam", elapsed: 0 } })).clip).toBe("gs_jump_attack");
    expect(chooseHeroAnim(hero({ ability: { id: "thrust", elapsed: 0 } })).clip).toBe("gs_slide_attack");
    expect(chooseHeroAnim(hero({ dead: true, ability: { id: "kick", elapsed: 0 } })).clip).toBe("ss_death");
  });

  it("habilidad ya terminada (elapsed ≥ animS) no se muestra", () => {
    expect(chooseHeroAnim(hero({ ability: { id: "kick", elapsed: 0.6 } })).clip).toBe("ss_idle");
  });

  it("bloqueando → ss_block_idle en bucle, también al moverse o con el mandoble", () => {
    expect(chooseHeroAnim(hero({ blocking: true }))).toEqual({ clip: "ss_block_idle", loop: true, speed: 1 });
    expect(chooseHeroAnim(hero({ blocking: true, speed: 3 })).clip).toBe("ss_block_idle");
    expect(chooseHeroAnim(hero({ blocking: true, weaponId: "great-sword" })).clip).toBe("ss_block_idle");
    expect(chooseHeroAnim(hero({ blocking: true, dead: true })).clip).toBe("ss_death");
  });

  it("con attackSpeedMult el clip del golpe dura lo mismo que el swing acelerado", () => {
    const lengths = new Map([["ss_slash", 1.0]]);
    const c = chooseHeroAnim(hero({ comboStep: 1, swingTimer: 0.1, attackSpeedMult: 1.2 }), lengths);
    expect(1.0 / c.speed).toBeCloseTo(MOVESETS["one-hand-sword"].combo[0]!.duration / 1.2);
  });

  it("speed ≤ 0,2 → idle", () => {
    expect(chooseHeroAnim(hero({ speed: 0.2 })).clip).toBe("ss_idle");
  });
});

describe("moveSector / heroBodyYaw", () => {
  it("gira el cuerpo lo que falta para que el clip apunte a donde va", () => {
    expect(moveSector(Math.PI / 4)).toEqual({ dir: "run", yaw: Math.PI / 4 });
    expect(moveSector((3 * Math.PI) / 4).dir).toBe("runBack");
    expect(moveSector((3 * Math.PI) / 4).yaw).toBeCloseTo(-Math.PI / 4);
    expect(moveSector((-3 * Math.PI) / 4).yaw).toBeCloseTo(Math.PI / 4);
    expect(moveSector(Math.PI / 2)).toEqual({ dir: "runRight", yaw: 0 });
    expect(moveSector(-Math.PI / 2)).toEqual({ dir: "runLeft", yaw: 0 });
    expect(moveSector(3 * Math.PI).dir).toBe("runBack"); // se normaliza
  });

  it("sin giro quieto, atacando, en el aire o muerto", () => {
    const diag = { speed: 5, moveAngle: Math.PI / 4 };
    expect(heroBodyYaw(hero(diag))).toBeCloseTo(Math.PI / 4);
    expect(heroBodyYaw(hero({ moveAngle: Math.PI / 4 }))).toBe(0);
    expect(heroBodyYaw(hero({ ...diag, comboStep: 1, swingTimer: 0.1 }))).toBe(0);
    expect(heroBodyYaw(hero({ ...diag, airborne: true }))).toBe(0);
    expect(heroBodyYaw(hero({ ...diag, dead: true }))).toBe(0);
    expect(heroBodyYaw(hero({ ...diag, blocking: true }))).toBe(0);
    expect(heroBodyYaw(hero({ ...diag, ability: { id: "kick", elapsed: 0.1 } }))).toBe(0);
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

  it("aturdido → hit del enemigo en bucle lento (gana a telegrafía y a correr; la muerte gana)", () => {
    const c = chooseEnemyAnim(enemy({ stunned: 1, ai: "telegraph", speed: 3, hurtRecently: true }));
    expect(c.clip).toBe(ENEMY_LOOKS.brute.clips.hit);
    expect(c.loop).toBe(true);
    expect(c.speed).toBeGreaterThan(0);
    expect(c.speed).toBeLessThan(1);
    expect(chooseEnemyAnim(enemy({ stunned: 1, ai: "dead" })).clip).toBe(ENEMY_LOOKS.brute.clips.death);
    expect(chooseEnemyAnim(enemy({ stunned: 0, ai: "idle" })).clip).toBe(ENEMY_LOOKS.brute.clips.idle);
  });

  it("recover sin moverse → idle", () => {
    expect(chooseEnemyAnim(enemy({ ai: "recover", speed: 0 })).clip).toBe(ENEMY_LOOKS.brute.clips.idle);
  });

  it("bruto armado con mandoble: la telegrafía usa gs_slash ajustado a 0,6 s; desarmado, cr_swiping", () => {
    const lengths = new Map([
      ["gs_slash", 1.5],
      ["cr_swiping", 1.2],
    ]);
    const armed = chooseEnemyAnim(enemy({ kind: "brute", ai: "telegraph", weaponId: "great-sword" }), lengths);
    expect(armed.clip).toBe("gs_slash");
    expect(armed.loop).toBe(false);
    expect(armed.speed).toBeCloseTo(1.5 / 0.6);
    // sin el largo del clip, velocidad 1
    expect(chooseEnemyAnim(enemy({ kind: "brute", ai: "telegraph", weaponId: "great-sword" })).speed).toBe(1);
    const bare = chooseEnemyAnim(enemy({ kind: "brute", ai: "telegraph", weaponId: null }), lengths);
    expect(bare.clip).toBe("cr_swiping");
    expect(bare.speed).toBeCloseTo(1.2 / 0.6);
  });

  it("esbirro armado con espada de guardia: la telegrafía usa ss_slash", () => {
    const c = chooseEnemyAnim(enemy({ kind: "minion", ai: "telegraph", weaponId: "guard-sword" }), new Map([["ss_slash", 0.8]]));
    expect(c.clip).toBe("ss_slash");
    expect(c.speed).toBeCloseTo(0.8 / ENEMY_DEFS.minion.telegraphS);
  });

  it("armado, el resto de los clips no cambia", () => {
    const w = { weaponId: "great-sword" as const };
    expect(chooseEnemyAnim(enemy({ ...w, ai: "idle" })).clip).toBe(ENEMY_LOOKS.brute.clips.idle);
    expect(chooseEnemyAnim(enemy({ ...w, speed: 3 })).clip).toBe(ENEMY_LOOKS.brute.clips.run);
    expect(chooseEnemyAnim(enemy({ ...w, hurtRecently: true })).clip).toBe(ENEMY_LOOKS.brute.clips.hit);
    expect(chooseEnemyAnim(enemy({ ...w, ai: "dead" })).clip).toBe(ENEMY_LOOKS.brute.clips.death);
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

  it("da la dirección del movimiento respecto de la mirada (0 = +Z, π/2 = +X)", () => {
    const m = new SpeedMeter();
    for (let i = 0; i <= 60; i++) m.sample(i * 0.05, 0, 1 / 60); // hacia +X
    expect(m.angleFrom(0)).toBeCloseTo(Math.PI / 2, 2); // mirando a +Z: va a la derecha
    expect(m.angleFrom(Math.PI / 2)).toBeCloseTo(0, 2); // mirando a +X: va adelante
    expect(Math.abs(m.angleFrom(-Math.PI / 2))).toBeCloseTo(Math.PI, 2); // mirando a −X: va atrás
  });
});
