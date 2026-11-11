import { ABILITY_KEYS, type InputState } from "./InputState";

const GAME_KEYS = new Set<string>(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", ...ABILITY_KEYS]);

export interface BrowserInput {
  /** Desconecta todo. */
  detach(): void;
}

/**
 * Conecta el teclado, el clic izquierdo y la pérdida de foco con `InputState`. Solo ataca el clic sobre el
 * canvas: los de los paneles (cartas, pruebas) no cuentan.
 */
export function attachBrowserInput(input: InputState, canvas: HTMLCanvasElement): BrowserInput {
  const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement;
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault(); // que Space no haga scroll ni pulse botones, ni 1-4 escriban
    input.keyDown(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => input.keyUp(e.code);
  // Sin foco no llegan los keyup: soltar todo para no seguir caminando solo.
  const onBlur = () => input.blur();
  const onVisibility = () => {
    if (document.hidden) input.blur();
  };
  // Con eventos de puntero: Babylon cancela el `pointerdown` del canvas y con eso el navegador ya no manda `mousedown`.
  const onMouseDown = (e: PointerEvent) => {
    if (e.button === 0 && e.pointerType !== "touch" && e.target === canvas) input.keyDown("Mouse0"); // el toque va por los sticks
  };
  const onMouseUp = (e: PointerEvent) => {
    if (e.button === 0) input.keyUp("Mouse0");
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("pointerdown", onMouseDown);
  // En window: soltar fuera del canvas también suelta el ataque.
  window.addEventListener("pointerup", onMouseUp);
  document.addEventListener("visibilitychange", onVisibility);
  const detach = () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("pointerdown", onMouseDown);
    window.removeEventListener("pointerup", onMouseUp);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  return { detach };
}
