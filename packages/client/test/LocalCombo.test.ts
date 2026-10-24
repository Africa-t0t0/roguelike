import { describe, expect, it } from "vitest";
import { MOVESETS, SIM_DT } from "@roguelike/shared";
import { LocalCombo } from "../src/net/LocalCombo";

const [c1, c2, c3] = MOVESETS["one-hand-sword"].combo;
const free = { dead: false, dodging: false };

/** Avanza `seconds` de simulación con el clic en `attack`; devuelve los pasos que arrancaron. */
function run(combo: LocalCombo, seconds: number, attack: boolean, nowMs = 0): number[] {
  const started: number[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    const step = combo.tick(attack, free, nowMs);
    if (step) started.push(step);
  }
  return started;
}

describe("LocalCombo", () => {
  it("un clic arranca el golpe 1 enseguida y un clic a mitad del golpe se ignora", () => {
    const combo = new LocalCombo();
    expect(combo.tick(true, free, 0)).toBe(1);
    expect(combo.tick(true, free, 0)).toBe(0);
    expect(combo.state().comboStep).toBe(1);
    expect(combo.state().swingTimer).toBeGreaterThan(0);
  });

  it("mantener el clic encadena 1, 2, 3 y vuelve a 1, como el servidor", () => {
    const combo = new LocalCombo();
    const total = c1!.duration + c2!.duration + c3!.duration + SIM_DT * 3;
    expect(run(combo, total, true)).toEqual([1, 2, 3, 1]);
  });

  it("acepta cada golpe exactamente ceil(duration / SIM_DT) inputs después del anterior, como el servidor", () => {
    const combo = new LocalCombo();
    for (const [k, step] of MOVESETS["one-hand-sword"].combo.entries()) {
      expect(combo.tick(true, free, 0)).toBe(k + 1);
      const n = Math.ceil(step.duration / SIM_DT - 1e-9);
      for (let i = 0; i < n - 2; i++) combo.tick(false, free, 0);
      expect(combo.tick(true, free, 0)).toBe(0); // input n − 1
    }
    expect(combo.tick(true, free, 0)).toBe(1); // input n tras el golpe 3
  });

  it("tras comboResetS sin atacar, el combo vuelve al golpe 1", () => {
    const combo = new LocalCombo();
    expect(combo.tick(true, free, 0)).toBe(1);
    run(combo, c1!.duration + MOVESETS["one-hand-sword"].comboResetS + SIM_DT, false);
    expect(combo.tick(true, free, 0)).toBe(1);
  });

  it("dentro de la ventana del combo, el siguiente clic es el golpe 2", () => {
    const combo = new LocalCombo();
    combo.tick(true, free, 0);
    run(combo, c1!.duration + 0.1, false);
    expect(combo.tick(true, free, 0)).toBe(2);
  });

  it("muerto o esquivando no arranca golpes", () => {
    const combo = new LocalCombo();
    expect(combo.tick(true, { dead: true, dodging: false }, 0)).toBe(0);
    expect(combo.tick(true, { dead: false, dodging: true }, 0)).toBe(0);
    expect(combo.tick(true, free, 0)).toBe(1);
  });

  describe("estado para la animación del propio jugador", () => {
    it("mientras dura el golpe local manda el local", () => {
      const combo = new LocalCombo();
      combo.tick(true, free, 1000);
      const s = combo.heroCombat({ comboStep: 0, swingTimer: 0 }, 1000);
      expect(s.comboStep).toBe(1);
      expect(s.swingTimer).toBeGreaterThan(0);
    });

    it("el mismo golpe confirmado tarde por el servidor no se vuelve a reproducir", () => {
      const combo = new LocalCombo();
      combo.tick(true, free, 1000);
      run(combo, c1!.duration + SIM_DT, false, 1000); // el local ya terminó
      // el servidor (con lag) recién informa ese mismo golpe 1
      expect(combo.heroCombat({ comboStep: 1, swingTimer: 0.2 }, 1500)).toEqual({ comboStep: 0, swingTimer: 0 });
    });

    it("con lag, el eco atrasado de un golpe anterior del combo tampoco se repite", () => {
      const combo = new LocalCombo();
      expect(combo.tick(true, free, 1000)).toBe(1);
      run(combo, c1!.duration + SIM_DT, false, 1000);
      expect(combo.tick(true, free, 1350)).toBe(2);
      run(combo, c2!.duration + SIM_DT, false, 1350); // terminó el 2 localmente
      // el servidor va ~400 ms atrás y todavía informa el golpe 1
      expect(combo.heroCombat({ comboStep: 1, swingTimer: 0.1 }, 1750)).toEqual({ comboStep: 0, swingTimer: 0 });
      expect(combo.heroCombat({ comboStep: 2, swingTimer: 0.3 }, 2100)).toEqual({ comboStep: 0, swingTimer: 0 });
    });

    it("un golpe que el cliente no predijo lo decide el servidor", () => {
      const combo = new LocalCombo();
      expect(combo.heroCombat({ comboStep: 2, swingTimer: 0.2 }, 0)).toEqual({ comboStep: 2, swingTimer: 0.2 });
      combo.tick(true, free, 1000);
      run(combo, c1!.duration + SIM_DT, false, 1000);
      // mucho después del golpe local, el servidor vuelve a mandar
      expect(combo.heroCombat({ comboStep: 1, swingTimer: 0.2 }, 3000)).toEqual({ comboStep: 1, swingTimer: 0.2 });
    });
  });
});
