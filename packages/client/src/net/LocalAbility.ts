import { ABILITIES, ABILITY_BUFFER_S, MAGE_LEGENDARY, SIM_DT, abilityAnimS, abilityCooldownS, type AbilityId, type LegendaryId } from "@roguelike/shared";

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
  /** rango (1..3): algunos hechizos cambian de enfriamiento y de duración con él; sin dato, 1 */
  rank?: number;
  /** la fusión: las compañeras que salen a la vez, con su rango */
  partners?: { id: AbilityId; rank: number }[];
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
 * tecla sin esperar al servidor. Solo es visual: el daño, los
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
  /** teclas apretadas a destiempo que siguen en espera y segundos que les quedan (como en el servidor) */
  private queuedMask = 0;
  private queuedLeft = 0;
  /** animación en curso según los inputs (lo que bloquea otras habilidades y el ataque) */
  private anim: { id: AbilityId; left: number } | null = null;
  /** lo que le queda a la compañera de una fusión: mientras corre no empieza otra habilidad (sí se puede atacar) */
  private partnerLeft = 0;
  /** animación a dibujar (`startMs` en el reloj de `tick`) */
  private shown: { id: AbilityId; startMs: number } | null = null;
  /** multiplicador de enfriamiento (Celeridad), el sincronizado del servidor */
  private cooldownMult = 1;

  setCooldownMult(m: number): void {
    this.cooldownMult = Number.isFinite(m) && m > 0 ? m : 1;
  }

  /** Efectos legendarios del equipo puesto (el máximo de cargas sale de `whirlCharges`). */
  setLegendaries(l: readonly LegendaryId[]): void {
    this.legendaries = l;
  }

  /** Cargas máximas de la habilidad (lo mismo que `abilityMaxCharges` del servidor). */
  maxCharges(id: AbilityId): number {
    if (id === "thrust") return Math.max(1, ABILITIES.thrust.ranks[this.rankOf(id) - 1]?.count ?? 1);
    if (id === "throw" && this.legendaries.includes("throwCharges")) return 2;
    if (id === "mine" && this.legendaries.includes("mineCharges")) return MAGE_LEGENDARY.mineCharges;
    return id === "whirlwind" && this.legendaries.includes("whirlCharges") ? WHIRL_CHARGES : 1;
  }

  /** Las habilidades de una casilla con su rango: la suya y, si es la fusión, sus compañeras. */
  private members(slot: AbilitySlotView): { id: AbilityId; rank: number }[] {
    return [{ id: slot.id, rank: slot.rank ?? 1 }, ...(slot.partners ?? [])];
  }

  private slotOf(id: AbilityId): AbilitySlotView | undefined {
    return this.slots.find((s) => s.id === id || s.partners?.some((p) => p.id === id));
  }

  private rankOf(id: AbilityId): number {
    const slot = this.slotOf(id);
    return (slot && this.members(slot).find((m) => m.id === id)?.rank) ?? 1;
  }

  /** Ciclo de recarga de `id`; si está en la fusión, el de la más lenta de todas (como el servidor). */
  private cycle(id: AbilityId): number {
    const slot = this.slotOf(id);
    const all = slot ? this.members(slot) : [{ id, rank: 1 }];
    return Math.max(...all.map((m) => abilityCooldownS(m.id, m.rank))) * this.cooldownMult;
  }

  /** La que lleva las cargas de la casilla: la suya o, en la fusión, la que más tiene (como el servidor). */
  private holderOf(slot: AbilitySlotView): AbilityId {
    return this.members(slot).reduce((best, m) => (this.maxCharges(m.id) > this.maxCharges(best.id) ? m : best)).id;
  }

  /** Las compañeras de `id` si es la casilla de la fusión. */
  partnersOf(id: AbilityId): { id: AbilityId; rank: number }[] {
    return this.slots.find((s) => s.id === id)?.partners ?? [];
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
      for (const { id } of this.members(s)) {
        this.server.set(id, { cd: s.cooldown, atMs: nowMs });
        this.serverCharges.set(id, { charges: s.charges ?? 1, cd: s.cooldown, atMs: nowMs });
      }
    }
  }

  /**
   * Un input: después de avanzar el combo y antes del ataque, como el servidor. `mask`: teclas 1-4
   * mantenidas; `swingTimer`: el del combo ya avanzado. `stunned`: aturdido, no puede empezar habilidades
   * nuevas, pero la animación en curso sigue (como en el servidor, donde el aturdimiento no la corta).
   * Devuelve la habilidad que arrancó, si alguna.
   */
  tick(mask: number, ctx: { dead: boolean; swingTimer: number; stunned?: boolean }, nowMs: number): AbilityId | undefined {
    for (const [id, cd] of this.localCd) this.localCd.set(id, countDown(cd, SIM_DT));
    for (const [id, st] of this.localCharges) this.localCharges.set(id, advanceCharges(st, SIM_DT, this.maxCharges(id), this.cycle(id)));
    const pressed = mask & ~this.heldMask;
    this.heldMask = mask;
    if (ctx.dead) {
      this.anim = null;
      this.partnerLeft = 0;
      this.shown = null;
      this.queuedMask = 0;
      return undefined;
    }
    this.queuedLeft = countDown(this.queuedLeft, SIM_DT);
    if (this.queuedLeft === 0) this.queuedMask = 0;
    if (pressed !== 0) {
      this.queuedMask = pressed;
      this.queuedLeft = ABILITY_BUFFER_S;
    }
    if (this.anim) {
      this.anim.left = countDown(this.anim.left, SIM_DT);
      if (this.anim.left === 0) this.anim = null;
    }
    this.partnerLeft = countDown(this.partnerLeft, SIM_DT);

    let started: AbilityId | undefined;
    for (let i = 0; i < this.slots.length; i++) {
      if ((this.queuedMask & (1 << i)) === 0) continue;
      const { id } = this.slots[i]!;
      const partners = this.slots[i]!.partners ?? [];
      const holder = this.holderOf(this.slots[i]!);
      const def = ABILITIES[id];
      if (def.kind !== "active" || ctx.stunned || !this.ready(holder, nowMs)) {
        this.queuedMask &= ~(1 << i);
        continue;
      }
      if (ctx.swingTimer > 0 || this.anim || this.partnerLeft > 0) continue;
      this.queuedMask = 0;
      // Solo gasta la que lleva las cargas; las demás de la fusión salen gratis.
      this.spend(holder, nowMs);
      this.lastCastMs.set(holder, nowMs);
      this.lastCastMs.set(id, nowMs);
      for (const p of partners) this.partnerLeft = Math.max(this.partnerLeft, abilityAnimS(p.id, p.rank));
      this.anim = { id, left: abilityAnimS(id, this.rankOf(id)) };
      this.shown = { id, startMs: nowMs };
      started = id;
      break;
    }

    return started;
  }

  /** No se puede atacar: hay una habilidad en curso. */
  locked(): boolean {
    return this.anim !== null;
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
  heroAbility(nowMs: number): { id: AbilityId; elapsed: number; rank: number } | null {
    const s = this.shown;
    if (!s) return null;
    const elapsed = (nowMs - s.startMs) / 1000;
    const rank = this.rankOf(s.id);
    if (elapsed >= abilityAnimS(s.id, rank)) {
      this.shown = null;
      return null;
    }
    return { id: s.id, elapsed: Math.max(0, elapsed), rank };
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
