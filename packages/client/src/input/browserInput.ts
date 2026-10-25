import { ABILITY_KEYS, type InputState } from "./InputState";

const GAME_KEYS = new Set<string>(["KeyW", "KeyA", "KeyS", "KeyD", "Space", ...ABILITY_KEYS]);

export interface BrowserInput {
  /** Desconecta todo. */
  detach(): void;
  /**
   * Suelta el puntero desde el juego (p. ej. al abrir el panel de cartas). A diferencia de Esc, las teclas
   * mantenidas siguen valiendo (WASD sigue moviendo en la elección sin pausa); solo se suelta el ataque.
   * Se vuelve a capturar con el siguiente clic en el canvas (lo hace la cámara).
   */
  releasePointer(): void;
}

/**
 * Conecta el teclado, el clic izquierdo y la pérdida de foco con `InputState`. El clic que bloquea el
 * puntero no ataca: solo cuenta con el puntero ya bloqueado.
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
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && document.pointerLockElement === canvas) input.keyDown("Mouse0");
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) input.keyUp("Mouse0");
  };
  let selfRelease = false;
  const onPointerLock = () => {
    if (document.pointerLockElement === canvas) return;
    if (selfRelease) input.keyUp("Mouse0");
    else input.blur();
    selfRelease = false;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("mousedown", onMouseDown);
  // En window: soltar fuera del canvas también suelta el ataque.
  window.addEventListener("mouseup", onMouseUp);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("pointerlockchange", onPointerLock);
  const detach = () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("pointerlockchange", onPointerLock);
  };
  const releasePointer = () => {
    if (document.pointerLockElement !== canvas) return;
    selfRelease = true;
    document.exitPointerLock();
  };
  return { detach, releasePointer };
}
