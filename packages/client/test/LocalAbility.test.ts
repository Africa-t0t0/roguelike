import { describe, expect, it } from "vitest";
import { ABILITIES, SIM_DT } from "@roguelike/shared";
import { LocalAbility } from "../src/net/LocalAbility";

const free = { dead: false, swingTimer: 0 };
const TICK_MS = SIM_DT * 1000;

/** Una LocalAbility con estas casillas (enfriamiento 0 según el servidor). */
function withSlots(...ids: (keyof typeof ABILITIES)[]): LocalAbility {
  const a = new LocalAbility();
  a.setServer(ids.map((id) => ({ id, cooldown: 0 })), 0);
  return a;
}

/** `n` inputs con la máscara `mask`, desde `startMs`; devuelve las habilidades que arrancaron. */
function run(a: LocalAbility, n: number, mask: number, startMs: number, ctx = free): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = a.tick(mask, ctx, startMs + i * TICK_MS);
    if (s) out.push(s);
  }
  return out;
}

describe("LocalAbility", () => {
  it("apretar la tecla 1 arranca la habilidad de la casilla 1 enseguida, y su animación", () => {
    const a = withSlots("whirlwind", "kick");
    expect(a.tick(0b01, free, 1000)).toBe("whirlwind");
    expect(a.heroAbility(1000)).toEqual({ id: "whirlwind", elapsed: 0 });
    expect(a.heroAbility(1300)!.elapsed).toBeCloseTo(0.3);
    expect(a.heroAbility(1000 + ABILITIES.whirlwind.animS * 1000)).toBeNull();
    expect(a.locked()).toBe(true); // no se ataca durante la animación
  });

  it("solo con el flanco: mantener la tecla no la repite", () => {
    const a = withSlots("kick");
    expect(run(a, 200, 0b1, 0)).toEqual(["kick"]);
  });

  it("no se repite mientras dura el enfriamiento; al terminar, sí", () => {
    const a = withSlots("kick");
    expect(a.tick(1, free, 0)).toBe("kick");
    const cdTicks = Math.ceil(ABILITIES.kick.cooldownS / SIM_DT - 1e-9);
    // soltar y apretar a lo largo del enfriamiento
    let started = 0;
    for (let i = 1; i < cdTicks; i++) if (a.tick(i % 2 === 0 ? 1 : 0, free, i * TICK_MS)) started++;
    expect(started).toBe(0);
    a.tick(0, free, cdTicks * TICK_MS);
    expect(a.tick(1, free, (cdTicks + 1) * TICK_MS)).toBe("kick");
  });

  it("con el enfriamiento que informa el servidor (sin lanzarla localmente) no la predice", () => {
    const a = new LocalAbility();
    a.setServer([{ id: "slam", cooldown: 3 }], 0);
    expect(a.tick(1, free, 0)).toBeUndefined();
    a.tick(0, free, 1000);
    expect(a.tick(1, free, 3100)).toBe("slam"); // el del servidor también corre
  });

  it("tras lanzarla localmente, el enfriamiento atrasado del servidor no la retiene de más", () => {
    const a = withSlots("kick");
    expect(a.tick(1, free, 0)).toBe("kick");
    // el servidor la lanzó ~100 ms después: su enfriamiento va más alto que el local
    a.setServer([{ id: "kick", cooldown: ABILITIES.kick.cooldownS - 0.1 }], 200);
    const cdTicks = Math.ceil(ABILITIES.kick.cooldownS / SIM_DT - 1e-9);
    for (let i = 1; i <= cdTicks; i++) a.tick(0, free, i * TICK_MS);
    expect(a.tick(1, free, (cdTicks + 1) * TICK_MS)).toBe("kick");
  });

  it("no arranca durante un swing ni durante otra habilidad, ni muerto", () => {
    const a = withSlots("kick", "warcry");
    expect(a.tick(1, { dead: false, swingTimer: 0.2 }, 0)).toBeUndefined();
    a.tick(0, free, TICK_MS);
    expect(a.tick(1, free, 2 * TICK_MS)).toBe("kick");
    expect(a.tick(0b11, free, 3 * TICK_MS)).toBeUndefined(); // la Patada sigue en curso
    const b = withSlots("kick");
    expect(b.tick(1, { dead: true, swingTimer: 0 }, 0)).toBeUndefined();
  });

  it("la animación bloquea las demás exactamente ceil(animS / SIM_DT) inputs, como el servidor", () => {
    const a = withSlots("kick", "warcry");
    expect(a.tick(0b01, free, 0)).toBe("kick");
    const n = Math.ceil(ABILITIES.kick.animS / SIM_DT - 1e-9);
    for (let i = 1; i < n; i++) {
      expect(a.tick(i % 2 === 0 ? 0b10 : 0, free, i * TICK_MS)).toBeUndefined();
    }
    expect(a.tick(0b10, free, n * TICK_MS)).toBe("warcry");
  });

  it("Bloqueo: mantenido, sin swing ni animación; se puede lanzar otra habilidad bloqueando", () => {
    const a = withSlots("block", "kick");
    a.tick(0b01, free, 0);
    expect(a.isBlocking).toBe(true);
    expect(a.locked()).toBe(true); // bloqueando no se ataca
    expect(a.blocking(0b01)).toBe(true);
    expect(a.blocking(0b10)).toBe(false);
    expect(a.tick(0b11, free, TICK_MS)).toBe("kick");
    expect(a.isBlocking).toBe(false); // durante la animación no bloquea
    a.tick(0, free, 2 * TICK_MS);
    expect(a.isBlocking).toBe(false);
    a.tick(0b01, { dead: false, swingTimer: 0.3 }, 3 * TICK_MS);
    expect(a.isBlocking).toBe(false); // con un swing en curso tampoco
  });

  it("muerto no bloquea y corta la animación", () => {
    const a = withSlots("kick", "block");
    a.tick(0b01, free, 0);
    a.tick(0, { dead: true, swingTimer: 0 }, TICK_MS);
    expect(a.locked()).toBe(false);
    a.tick(0b10, { dead: true, swingTimer: 0 }, 2 * TICK_MS);
    expect(a.isBlocking).toBe(false);
  });

  it("la habilidad que anuncia el servidor y no se predijo se muestra; el eco de una predicha, no", () => {
    const a = withSlots("kick");
    a.fromServer("warcry", 5000);
    expect(a.heroAbility(5100)).toEqual({ id: "warcry", elapsed: expect.closeTo(0.1) });
    const b = withSlots("kick");
    b.tick(1, free, 0);
    run(b, 40, 0, TICK_MS); // la Patada local ya terminó
    b.fromServer("kick", 900); // eco atrasado
    expect(b.heroAbility(900)).toBeNull();
  });
});
