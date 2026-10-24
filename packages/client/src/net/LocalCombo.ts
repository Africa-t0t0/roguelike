import { CLASS_DEFS, SIM_DT } from "@roguelike/shared";

const EPS = 1e-9;
/**
 * Tras terminar el último golpe local, cuánto tiempo el combo que informa el servidor se toma como eco
 * de lo ya dibujado (llega una ida y vuelta tarde, más lo que el servidor tarde en procesar los inputs).
 */
const ECHO_WINDOW_MS = 1000;

export interface ComboView {
  comboStep: number;
  swingTimer: number;
}

/**
 * Copia local del combo del guerrero (mismas reglas que el `CombatSystem` del servidor) para que el
 * clip de ataque del propio jugador arranque al hacer clic. Solo es visual: el daño lo decide el servidor.
 */
export class LocalCombo {
  private comboStep = 0;
  private swingTimer = 0;
  private comboTimer = 0;
  /** Cuándo termina (o terminó) el último golpe local, en el reloj de `tick`. */
  private lastEndMs: number | undefined;

  /** Un paso de simulación con el `attack` enviado. Devuelve el golpe que arrancó (1..3) o 0. */
  tick(attack: boolean, blocked: { dead: boolean; dodging: boolean }, nowMs: number): number {
    const def = CLASS_DEFS.warrior;
    let started = 0;
    if (attack && !blocked.dead && !blocked.dodging && this.swingTimer <= 0) {
      started = this.comboTimer > 0 ? (this.comboStep % def.combo.length) + 1 : 1;
      const duration = def.combo[started - 1]!.duration;
      this.comboStep = started;
      this.swingTimer = duration;
      this.comboTimer = duration + def.comboResetS;
      this.lastEndMs = nowMs + duration * 1000;
    }
    this.swingTimer = Math.max(0, this.swingTimer - SIM_DT);
    this.comboTimer = Math.max(0, this.comboTimer - SIM_DT);
    if (this.comboTimer <= EPS) {
      this.comboTimer = 0;
      this.comboStep = 0;
    }
    return started;
  }

  state(): ComboView {
    return { comboStep: this.comboStep, swingTimer: this.swingTimer };
  }

  /**
   * Qué golpe dibujar para el propio jugador: el local mientras dura. Poco después de un golpe local,
   * lo que diga el servidor es el eco atrasado de esos mismos golpes (se reproducirían dos veces) y se
   * ignora. Fuera de esa ventana manda el servidor (p. ej. un golpe que el cliente no predijo).
   */
  heroCombat(server: ComboView, nowMs: number): ComboView {
    if (this.swingTimer > 0) return this.state();
    if (this.lastEndMs !== undefined && nowMs < this.lastEndMs + ECHO_WINDOW_MS) return { comboStep: 0, swingTimer: 0 };
    return { comboStep: server.comboStep, swingTimer: server.swingTimer };
  }
}
