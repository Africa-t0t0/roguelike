import { ABILITIES, SIM_DT, type AbilityId } from "@roguelike/shared";

/** Lo mismo que el `countDown` del servidor: por debajo de esto cuenta como 0. */
const EPS = 1e-9;
const countDown = (v: number, dt: number): number => (v - dt > EPS ? v - dt : 0);

/**
 * Tras una habilidad local, cuánto más que su enfriamiento (o su animación) lo que diga el servidor de
 * ella se toma como eco atrasado de lo ya predicho (como en `LocalCombo`).
 */
const ECHO_WINDOW_MS = 1000;

/** Una casilla como la informa el servidor: habilidad y enfriamiento que le queda (s). */
export interface AbilitySlotView {
  id: AbilityId;
  cooldown: number;
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
  /** enfriamientos que corren por las habilidades lanzadas localmente, por input */
  private localCd = new Map<AbilityId, number>();
  private lastCastMs = new Map<AbilityId, number>();
  private heldMask = 0;
  /** animación en curso según los inputs (lo que bloquea otras habilidades y el ataque) */
  private anim: { id: AbilityId; left: number } | null = null;
  /** animación a dibujar (`startMs` en el reloj de `tick`) */
  private shown: { id: AbilityId; startMs: number } | null = null;
  private blockingNow = false;

  /** Casillas y enfriamientos del último estado propio del servidor (en orden de casilla, sin la pasiva). */
  setServer(slots: AbilitySlotView[], nowMs: number): void {
    this.slots = slots.map((s) => ({ ...s }));
    for (const s of slots) this.server.set(s.id, { cd: s.cooldown, atMs: nowMs });
  }

  /**
   * Un input: después de avanzar el combo y antes del ataque, como el servidor. `mask`: teclas 1-4
   * mantenidas; `swingTimer`: el del combo ya avanzado. Devuelve la habilidad que arrancó, si alguna.
   */
  tick(mask: number, ctx: { dead: boolean; swingTimer: number }, nowMs: number): AbilityId | undefined {
    for (const [id, cd] of this.localCd) this.localCd.set(id, countDown(cd, SIM_DT));
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
      if (def.kind !== "active" || !this.ready(id, nowMs) || ctx.swingTimer > 0 || this.anim) continue;
      this.localCd.set(id, def.cooldownS);
      this.lastCastMs.set(id, nowMs);
      this.anim = { id, left: def.animS };
      this.shown = { id, startMs: nowMs };
      started = id;
      break;
    }

    this.blockingNow = this.blocking(mask) && ctx.swingTimer === 0 && !this.anim;
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
    if (last !== undefined && nowMs < last + ABILITIES[id].cooldownS * 1000 + ECHO_WINDOW_MS) return;
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
    if ((this.localCd.get(id) ?? 0) > 0) return false;
    const last = this.lastCastMs.get(id);
    if (last !== undefined && nowMs < last + ABILITIES[id].cooldownS * 1000 + ECHO_WINDOW_MS) return true;
    const s = this.server.get(id);
    return !s || s.cd - (nowMs - s.atMs) / 1000 <= EPS;
  }
}
