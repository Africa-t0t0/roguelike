import type { InputState } from "./InputState";

const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "Space"]);

/** Conecta el teclado y la pérdida de foco con `InputState`. Devuelve la función para desconectar. */
export function attachBrowserInput(input: InputState, canvas: HTMLCanvasElement): () => void {
  const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement;
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault(); // que Space no haga scroll ni pulse botones
    input.keyDown(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => input.keyUp(e.code);
  // Sin foco no llegan los keyup: soltar todo para no seguir caminando solo.
  const onBlur = () => input.blur();
  const onVisibility = () => {
    if (document.hidden) input.blur();
  };
  const onPointerLock = () => {
    if (document.pointerLockElement !== canvas) input.blur();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("pointerlockchange", onPointerLock);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("pointerlockchange", onPointerLock);
  };
}
