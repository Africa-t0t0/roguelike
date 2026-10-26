import { ABILITIES, SIM_DT, type AbilityId, type LegendaryId } from "@roguelike/shared";

/** Lo mismo que el `countDown` del servidor: por debajo de esto cuenta como 0. */
const EPS = 1e-9;
const countDown = (v: number, dt: number): number => (v - dt > EPS ? v - dt : 0);

/**
 * Tras una habilidad local, cuánto más que su enfriamiento (o su animación) lo que diga el servidor de
 * ella se toma como eco atrasado de lo ya predicho (como en `LocalCombo`).
 */
const ECHO_WINDOW_MS = 1000;

/** Cargas máximas del Torbellino con `whirlCharges` (el servidor no sincroniza el máximo). */
const WHIRL_CHARGES = 2;

/** Una casilla como la informa el servidor: habilidad, enfriamiento que le queda (s) y cargas (1 si la habilidad no tiene). */
export interface AbilitySlotView {
  id: AbilityId;
  /** segundos que le quedan al ciclo de recarga en curso; 0 solo con las cargas al máximo */
  cooldown: number;
  charges?: number;
}

/** Estado de una habilidad con cargas: cargas disponibles y segundos que le quedan al ciclo de recarga (0 con el máximo). */
interface ChargeState {
  charges: number;
  cd: number;
}

/**
 * Avanza `dt` s un estado con cargas, como `AbilitySystem.step` del servidor: al terminar un ciclo vuelve 1 carga y,
 * si faltan más, empieza otro de `cycle` s.
 */
function advanceCharges(st: ChargeState, dt: number, max: number, cycle: number): ChargeState {
  let { charges, cd } = st;
  let left = dt;
  while (cd > 0 && left > 0) {
    if (left < cd - EPS) {
      cd -= left;
      left = 0;
      break;
    }
    left -= cd;
    charges = Math.min(max, charges + 1);
    cd = charges < max ? cycle : 0;
  }
  return { charges, cd };
}

export function isAbilityId(id: unknown): id is AbilityId {
  return typeof id === "string" && Object.hasOwn(ABILITIES, id);
}

/**
 * Copia local de las habilidades del propio jugador (el mismo orden y las mismas reglas que
 * `AbilitySystem.onInput` del servidor, por cada input) para que la animación arranque al apretar la
 * tecla y el Bloqueo frene y deje de atacar sin esperar al servidor. Solo es visual: el daño, los
 * enfriamientos de verdad y el Grito los decide el servidor.
 */
export class LocalAbility {
  private slots: AbilitySlotView[] = [];
  /** enfriamiento del servidor y cuándo llegó (reloj de `tick`), por habilidad */
  private server = new Map<AbilityId, { cd: number; atMs: number }>();
  /** cargas y recarga de las habilidades con cargas lanzadas localmente, por input (solo con máximo > 1) */
  private localCharges = new Map<AbilityId, ChargeState>();
  /** cargas y ciclo de recarga del servidor y cuándo llegaron, por habilidad */
  private serverCharges = new Map<AbilityId, ChargeState & { atMs: number }>();
  private legendaries: readonly LegendaryId[] = [];
  /** enfriamientos que corren por las habilidades lanzadas localmente, por input */
  private localCd = new Map<AbilityId, number>();
  private lastCastMs = new Map<AbilityId, number>();
  private heldMask = 0;
  /** animación en curso según los inputs (lo que bloquea otras habilidades y el ataque) */
  private anim: { id: AbilityId; left: number } | null = null;
  /** animación a dibujar (`startMs` en el reloj de `tick`) */
  private shown: { id: AbilityId; startMs: number } | null = null;
  private blockingNow = false;
  /** multiplicador de enfriamiento (Celeridad), el sincronizado del servidor */
  private cooldownMult = 1;

  setCooldownMult(m: number): void {
    this.cooldownMult = Number.isFinite(m) && m > 0 ? m : 1;
  }

  /** Efectos legendarios del equipo puesto (el máximo de cargas sale de `whirlCharges`). */
  setLegendaries(l: readonly LegendaryId[]): void {
    this.legendaries = l;
  }

  /** Cargas máximas de la habilidad: 2 el Torbellino con `whirlCharges`, 1 las demás (lo mismo que el servidor). */
  maxCharges(id: AbilityId): number {
    return id === "whirlwind" && this.legendaries.includes("whirlCharges") ? WHIRL_CHARGES : 1;
  }

  private cycle(id: AbilityId): number {
    return ABILITIES[id].cooldownS * this.cooldownMult;
  }

  /** Panel de pruebas: el servidor puso los enfriamientos a cero; aquí se olvidan los predichos. */
  resetCooldowns(): void {
    this.localCharges.clear();
    this.localCd.clear();
    this.lastCastMs.clear();
  }

  /** Casillas y enfriamientos del último estado propio del servidor (en orden de casilla, sin la pasiva). */
  setServer(slots: AbilitySlotView[], nowMs: number): void {
    this.slots = slots.map((s) => ({ ...s }));
    for (const s of slots) {
      this.server.set(s.id, { cd: s.cooldown, atMs: nowMs });
      this.serverCharges.set(s.id, { charges: s.charges ?? 1, cd: s.cooldown, atMs: nowMs });
    }
  }

  /**
   * Un input: después de avanzar el combo y antes del ataque, como el servidor. `mask`: teclas 1-4
   * mantenidas; `swingTimer`: el del combo ya avanzado. `stunned`: aturdido, no puede empezar habilidades
   * nuevas ni bloquear, pero la animación en curso sigue (como en el servidor, donde el aturdimiento no la corta).
   * Devuelve la habilidad que arrancó, si alguna.
   */
  tick(mask: number, ctx: { dead: boolean; swingTimer: number; stunned?: boolean }, nowMs: number): AbilityId | undefined {
    for (const [id, cd] of this.localCd) this.localCd.set(id, countDown(cd, SIM_DT));
    for (const [id, st] of this.localCharges) this.localCharges.set(id, advanceCharges(st, SIM_DT, this.maxCharges(id), this.cycle(id)));
    const pressed = mask & ~this.heldMask;
    this.heldMask = mask;
    if (ctx.dead) {
      this.anim = null;
      this.shown = null;
      this.blockingNow = false;
      return undefined;
    }
    if (this.anim) {
      this.anim.left = countDown(this.anim.left, SIM_DT);
      if (this.anim.left === 0) this.anim = null;
    }

    let started: AbilityId | undefined;
    for (let i = 0; i < this.slots.length; i++) {
      if ((pressed & (1 << i)) === 0) continue;
      const { id } = this.slots[i]!;
      const def = ABILITIES[id];
      if (def.kind !== "active" || ctx.stunned || !this.ready(id, nowMs) || ctx.swingTimer > 0 || this.anim) continue;
      this.spend(id, nowMs);
      this.lastCastMs.set(id, nowMs);
      this.anim = { id, left: def.animS };
      this.shown = { id, startMs: nowMs };
      started = id;
      break;
    }

    this.blockingNow = this.blocking(mask) && !ctx.stunned && ctx.swingTimer === 0 && !this.anim;
    return started;
  }

  /** Si con estas teclas mantenidas se pide el Bloqueo (tiene la casilla y mantiene su tecla). */
  blocking(held: number): boolean {
    const slot = this.slots.findIndex((s) => s.id === "block");
    return slot >= 0 && (held & (1 << slot)) !== 0;
  }

  /** Bloqueando según el último input (lo que frena el movimiento del siguiente, como en el servidor). */
  get isBlocking(): boolean {
    return this.blockingNow;
  }

  /** No se puede atacar: una habilidad en curso o el Bloqueo. */
  locked(): boolean {
    return this.anim !== null || this.blockingNow;
  }

  /**
   * El servidor anunció una habilidad del propio jugador. Si es el eco de una predicha se ignora; si no
   * (p. ej. el cliente no la predijo), se dibuja desde ahora.
   */
  fromServer(id: AbilityId, nowMs: number): void {
    const last = this.lastCastMs.get(id);
    if (last !== undefined && nowMs < last + this.echoMs(id)) return;
    this.shown = { id, startMs: nowMs };
  }

  /** Qué animación de habilidad dibujar para el propio jugador y cuánto lleva (s), o null. */
  heroAbility(nowMs: number): { id: AbilityId; elapsed: number } | null {
    const s = this.shown;
    if (!s) return null;
    const elapsed = (nowMs - s.startMs) / 1000;
    if (elapsed >= ABILITIES[s.id].animS) {
      this.shown = null;
      return null;
    }
    return { id: s.id, elapsed: Math.max(0, elapsed) };
  }

  /**
   * Enfriamiento que le queda a `id` (s), para la barra: el mayor entre el local (reacciona al apretar la
   * tecla) y el del servidor, que sigue corriendo desde que llegó. Con el reloj de juego, quieto en la pausa.
   */
  cooldownLeft(id: AbilityId, nowMs: number): number {
    if (this.maxCharges(id) > 1) return this.chargeState(id, nowMs).cd;
    const s = this.server.get(id);
    const server = s ? s.cd - (nowMs - s.atMs) / 1000 : 0;
    const left = Math.max(this.localCd.get(id) ?? 0, server);
    return left > EPS ? left : 0;
  }

  /**
   * Sin enfriamiento. Tras lanzarla localmente vale el enfriamiento local (el del servidor llega atrasado y
   * la retendría de más); si no, el que informa el servidor, que sigue corriendo desde que llegó.
   */
  private ready(id: AbilityId, nowMs: number): boolean {
    if (this.maxCharges(id) > 1) return this.chargeState(id, nowMs).charges >= 1;
    if ((this.localCd.get(id) ?? 0) > 0) return false;
    const last = this.lastCastMs.get(id);
    if (last !== undefined && nowMs < last + this.echoMs(id)) return true;
    const s = this.server.get(id);
    return !s || s.cd - (nowMs - s.atMs) / 1000 <= EPS;
  }

  /** Cargas que tiene `id` y su máximo, para la barra (sin cargas: 1 de 1 lista, 0 de 1 en enfriamiento). */
  chargesOf(id: AbilityId, nowMs: number): { charges: number; max: number } {
    const max = this.maxCharges(id);
    if (max === 1) return { charges: this.cooldownLeft(id, nowMs) > 0 ? 0 : 1, max };
    return { charges: this.chargeState(id, nowMs).charges, max };
  }

  /** Cuánto después de lanzarla lo que diga el servidor se toma como eco atrasado: toda la recarga (todas las cargas) más la ventana. */
  private echoMs(id: AbilityId): number {
    return this.cycle(id) * this.maxCharges(id) * 1000 + ECHO_WINDOW_MS;
  }

  /** Gasta lo que cuesta lanzarla: con cargas, una (empezando el ciclo si estaba lleno); sin ellas, el enfriamiento entero. */
  private spend(id: AbilityId, nowMs: number): void {
    const max = this.maxCharges(id);
    if (max === 1) {
      this.localCd.set(id, this.cycle(id));
      return;
    }
    const st = this.chargeState(id, nowMs);
    this.localCharges.set(id, st.cd > 0 ? { charges: st.charges - 1, cd: st.cd } : { charges: max - 1, cd: this.cycle(id) });
  }

  /** Estado de cargas de una habilidad con máximo > 1: el predicho tras lanzarla (hasta que el eco del servidor ya no atrase), si no, el del servidor corrido hasta ahora. */
  private chargeState(id: AbilityId, nowMs: number): ChargeState {
    const max = this.maxCharges(id);
    const last = this.lastCastMs.get(id);
    const local = this.localCharges.get(id);
    if (local && last !== undefined && nowMs < last + this.echoMs(id)) return local;
    const s = this.serverCharges.get(id);
    if (!s) return { charges: max, cd: 0 };
    const base = { charges: Math.min(max, s.charges), cd: s.cd };
    return advanceCharges(base, Math.max(0, (nowMs - s.atMs) / 1000), max, this.cycle(id));
  }
}
