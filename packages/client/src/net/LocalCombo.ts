import { advanceCombo, newComboTimers, SIM_DT, tryStartSwing, type ComboTimers, type WeaponId } from "@roguelike/shared";

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
 * Copia local del combo del arma equipada (las mismas `advanceCombo`/`tryStartSwing`, en el mismo orden, que
 * el `CombatSystem` del servidor por cada input procesado) para que el clip de ataque del propio jugador
 * arranque al hacer clic. Solo es visual: el daño lo decide el servidor.
 */
export class LocalCombo {
  private c: ComboTimers = newComboTimers();
  /** Arma del último `tick`: si cambia, el combo empieza de cero (como un arma recién tomada). */
  private weaponId: WeaponId | undefined;
  /** Cuándo termina (o terminó) el último golpe local, en el reloj de `tick`. */
  private lastEndMs: number | undefined;

  /**
   * Un paso de simulación con el `attack` enviado y el arma equipada (la que informa el servidor):
   * `advance` y luego `attack`. Devuelve el golpe que arrancó (1..n) o 0.
   */
  tick(
    attack: boolean,
    blocked: { dead: boolean; locked: boolean },
    nowMs: number,
    weaponId: WeaponId,
    attackSpeedMult = 1,
  ): number {
    this.advance(weaponId);
    return this.attack(attack, blocked, nowMs, weaponId, attackSpeedMult);
  }

  /**
   * Primera mitad del paso: avanza el combo (como `onInputProcessed` en el servidor). Entre `advance` y
   * `attack` va la habilidad del mismo input, que mira el swing ya avanzado.
   */
  advance(weaponId: WeaponId): void {
    if (weaponId !== this.weaponId) {
      this.weaponId = weaponId;
      this.c = newComboTimers();
    }
    advanceCombo(this.c, SIM_DT);
  }

  /**
   * Segunda mitad del paso: intenta arrancar un golpe. `locked`: algo impide atacar (una habilidad en curso
   * o el Bloqueo). `attackSpeedMult`: el sincronizado (Furia), el mismo que usa el servidor.
   */
  attack(
    attack: boolean,
    blocked: { dead: boolean; locked: boolean },
    nowMs: number,
    weaponId: WeaponId,
    attackSpeedMult = 1,
  ): number {
    if (!attack || blocked.dead || blocked.locked || weaponId !== this.weaponId) return 0;
    const started = tryStartSwing(this.c, weaponId, attackSpeedMult);
    if (started) this.lastEndMs = nowMs + this.c.swingTimer * 1000;
    return started;
  }

  state(): ComboView {
    return { comboStep: this.c.comboStep, swingTimer: this.c.swingTimer };
  }

  /**
   * Qué golpe dibujar para el propio jugador: el local mientras dura. Poco después de un golpe local,
   * lo que diga el servidor es el eco atrasado de esos mismos golpes (se reproducirían dos veces) y se
   * ignora. Fuera de esa ventana manda el servidor (p. ej. un golpe que el cliente no predijo).
   */
  heroCombat(server: ComboView, nowMs: number): ComboView {
    if (this.c.swingTimer > 0) return this.state();
    if (this.lastEndMs !== undefined && nowMs < this.lastEndMs + ECHO_WINDOW_MS) return { comboStep: 0, swingTimer: 0 };
    return { comboStep: server.comboStep, swingTimer: server.swingTimer };
  }
}
