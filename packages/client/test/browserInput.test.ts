import { afterEach, describe, expect, it, vi } from "vitest";
import { InputState } from "../src/input/InputState";
import { attachBrowserInput } from "../src/input/browserInput";
import { isValidCombatEvent } from "../src/net/connection";

type Listener = (e: unknown) => void;

/** Entorno mínimo (vitest corre en node): window/document/canvas con addEventListener y despacho manual. */
function setup() {
  const make = () => {
    const l = new Map<string, Listener[]>();
    return {
      l,
      addEventListener: (t: string, f: Listener) => l.set(t, [...(l.get(t) ?? []), f]),
      removeEventListener: (t: string, f: Listener) => l.set(t, (l.get(t) ?? []).filter((x) => x !== f)),
      fire: (t: string, e: unknown) => (l.get(t) ?? []).forEach((f) => f(e)),
    };
  };
  const win = make();
  const doc = Object.assign(make(), { pointerLockElement: null as unknown, hidden: false, exitPointerLock: () => {} });
  const canvas = make();
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("HTMLInputElement", class {});
  const input = new InputState();
  const bi = attachBrowserInput(input, canvas as unknown as HTMLCanvasElement);
  return { input, bi, canvas, win };
}

const attacking = (input: InputState) => input.sample(0, 0).attack;

afterEach(() => vi.unstubAllGlobals());

describe("ataque sin bloqueo de puntero (elección sin pausa)", () => {
  it("con la bandera y sobre el canvas, el clic izquierdo ataca; al soltar, deja de atacar", () => {
    const { input, bi, canvas, win } = setup();
    bi.attackWithoutLock = true;
    canvas.fire("mousedown", { button: 0, target: canvas });
    expect(attacking(input)).toBe(true);
    win.fire("mouseup", { button: 0 });
    expect(attacking(input)).toBe(false);
  });

  it("un clic en otro elemento (botón de carta) no ataca", () => {
    const { input, bi, canvas } = setup();
    bi.attackWithoutLock = true;
    canvas.fire("mousedown", { button: 0, target: {} });
    expect(attacking(input)).toBe(false);
  });

  it("sin la bandera ni bloqueo no ataca", () => {
    const { input, canvas } = setup();
    canvas.fire("mousedown", { button: 0, target: canvas });
    expect(attacking(input)).toBe(false);
  });

  it("perder el foco suelta el ataque", () => {
    const { input, bi, canvas, win } = setup();
    bi.attackWithoutLock = true;
    canvas.fire("mousedown", { button: 0, target: canvas });
    win.fire("blur", {});
    expect(attacking(input)).toBe(false);
  });
});

describe("eventos de combate", () => {
  it("ignora una habilidad con id desconocido y deja pasar el resto", () => {
    expect(isValidCombatEvent({ type: "ability", key: "a", id: "nope" })).toBe(false);
    expect(isValidCombatEvent({ type: "ability", key: "a" })).toBe(false);
    expect(isValidCombatEvent(null)).toBe(false);
    expect(isValidCombatEvent({ type: "swing", key: "a", step: 0 })).toBe(true);
  });
});
