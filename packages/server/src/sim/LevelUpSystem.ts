import { applyCard, CHOICE_TIME_S, rollOffer, type CardOffer, type Progress, type Rng } from "@roguelike/shared";

/** Lo que el sistema necesita de un registro de jugador (PlayerRecord lo cumple). */
export interface ChoiceRecord {
  key: string;
  progress: Progress;
  /** elecciones de carta que le faltan; se conservan al desconectarse */
  pendingChoices: number;
}

export type ChoiceEvent =
  | { type: "offer"; key: string; cards: CardOffer[]; index: number; total: number; deadlineS: number }
  | { type: "applied"; key: string; card: CardOffer };

/** Oferta abierta de un jugador. `left` solo la usa la elección sin pausa; en la pausa manda `pauseLeft`. */
interface OpenOffer {
  record: ChoiceRecord;
  cards: CardOffer[];
  solo: boolean;
  left: number;
  /** solo sin pausa: número de esta elección y total al abrirla */
  index: number;
  total: number;
}

// Margen para que 600 pasos de 1/30 s cuenten como 20 s pese al redondeo.
const EPS = 1e-6;

/**
 * Elecciones de carta al subir de nivel.
 * - Pausa del grupo: al mismo paso; la elección N se resuelve cuando eligieron todos los conectados que
 *   participan o se acaban los 20 s (carta al azar), y recién entonces se abre la N+1.
 * - Sin pausa (quien vuelve o entra tarde): cada elección con sus 20 s y carta al azar al vencer.
 * Un desconectado deja de bloquear: su oferta se cierra y la elección queda pendiente.
 */
export class LevelUpSystem {
  private readonly offers = new Map<string, OpenOffer>();
  /** eventos producidos fuera de step (onLevelsGained); salen en el siguiente step */
  private queued: ChoiceEvent[] = [];
  private pausedFlag = false;
  private left = 0;
  private round = 0;
  private rounds = 0;
  /** participantes de la elección en curso de la pausa */
  private participants = new Set<string>();
  /** conectados según el último step u onLevelsGained */
  private roster: ChoiceRecord[] = [];

  constructor(private readonly rng: Rng) {}

  get paused(): boolean {
    return this.pausedFlag;
  }

  get pauseLeft(): number {
    return this.pausedFlag ? Math.max(0, this.left) : 0;
  }

  /** Tiene una oferta abierta sin elegir. */
  isChoosing(key: string): boolean {
    return this.offers.has(key);
  }

  /** Suma `n` elecciones a todos los registros y, si hay alguien conectado, abre (o alarga) la pausa. */
  onLevelsGained(n: number, connected: ChoiceRecord[], all: ChoiceRecord[]): void {
    if (n <= 0) return;
    for (const r of all) r.pendingChoices += n;
    if (connected.length === 0) return;
    if (this.pausedFlag) {
      this.rounds += n;
      return;
    }
    // Las elecciones sin pausa abiertas se cierran sin aplicar: entran en la pausa del grupo.
    for (const [key, o] of this.offers) if (o.solo) this.offers.delete(key);
    this.pausedFlag = true;
    this.round = 0;
    this.rounds = n;
    this.roster = connected;
    this.queued.push(...this.openRound(connected));
  }

  /**
   * Corre en la pausa y fuera de ella: cuenta el tiempo y asigna al azar al vencer. Fuera de la pausa,
   * además, da sus elecciones pendientes sin pausa a los conectados que no tengan una abierta.
   */
  step(dt: number, connected: ChoiceRecord[]): ChoiceEvent[] {
    const events = this.queued;
    this.queued = [];
    this.roster = connected;
    const online = new Set(connected.map((r) => r.key));
    // Los desconectados dejan de bloquear; su elección queda pendiente.
    for (const key of [...this.offers.keys()]) if (!online.has(key)) this.offers.delete(key);

    if (this.pausedFlag) {
      this.left -= dt;
      if (this.left <= EPS) {
        for (const o of [...this.offers.values()]) if (!o.solo) events.push(...this.apply(o, this.rng.pick(o.cards)));
      }
      events.push(...this.advance());
    } else {
      for (const o of [...this.offers.values()]) {
        o.left -= dt;
        if (o.left <= EPS) events.push(...this.apply(o, this.rng.pick(o.cards)));
      }
    }
    if (!this.pausedFlag) for (const r of connected) events.push(...this.offerSolo(r));
    return events;
  }

  /** Aplica la carta elegida si hay oferta abierta y el índice es válido; si no, se ignora. */
  choose(record: ChoiceRecord, cardIndex: number): ChoiceEvent[] {
    const o = this.offers.get(record.key);
    if (!o || o.record !== record || !Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= o.cards.length) {
      return [];
    }
    const events = this.apply(o, o.cards[cardIndex]!);
    if (this.pausedFlag && !o.solo) events.push(...this.advance());
    return events;
  }

  /** La oferta abierta de `key` con el tiempo que le queda (p. ej., para reenviarla tras un takeover). */
  openOffer(key: string): ChoiceEvent[] {
    const o = this.offers.get(key);
    if (!o) return [];
    const index = o.solo ? o.index : this.round;
    const total = o.solo ? o.total : this.rounds;
    const deadlineS = Math.max(0, o.solo ? o.left : this.left);
    return [{ type: "offer", key, cards: o.cards, index, total, deadlineS }];
  }

  /** Elección sin pausa para quien vuelve o entra tarde con elecciones pendientes. */
  offerSolo(record: ChoiceRecord): ChoiceEvent[] {
    if (this.pausedFlag || record.pendingChoices <= 0 || this.offers.has(record.key)) return [];
    return [this.open(record, true, 1, record.pendingChoices)];
  }

  private apply(o: OpenOffer, card: CardOffer): ChoiceEvent[] {
    this.offers.delete(o.record.key);
    applyCard(o.record.progress, card);
    o.record.pendingChoices = Math.max(0, o.record.pendingChoices - 1);
    const events: ChoiceEvent[] = [{ type: "applied", key: o.record.key, card }];
    if (o.solo && o.record.pendingChoices > 0) events.push(this.open(o.record, true, o.index + 1, o.total));
    return events;
  }

  private open(record: ChoiceRecord, solo: boolean, index: number, total: number): ChoiceEvent {
    const cards = rollOffer(this.rng, record.progress);
    this.offers.set(record.key, { record, cards, solo, left: CHOICE_TIME_S, index, total });
    return { type: "offer", key: record.key, cards, index, total, deadlineS: CHOICE_TIME_S };
  }

  /** Abre la siguiente elección del grupo para los conectados con elecciones pendientes. */
  private openRound(connected: ChoiceRecord[]): ChoiceEvent[] {
    this.round++;
    this.left = CHOICE_TIME_S;
    this.participants = new Set();
    const events: ChoiceEvent[] = [];
    for (const r of connected) {
      if (r.pendingChoices <= 0) continue;
      this.participants.add(r.key);
      events.push(this.open(r, false, this.round, this.rounds));
    }
    return events;
  }

  private roundOpen(): boolean {
    for (const key of this.participants) if (this.offers.has(key)) return true;
    return false;
  }

  /**
   * Si la elección en curso terminó, abre la siguiente o cierra la pausa. Usa los conectados del último
   * step; las sobrantes de quien no participó se dan sin pausa en el siguiente step.
   */
  private advance(): ChoiceEvent[] {
    if (this.roundOpen()) return [];
    if (this.round < this.rounds) {
      const events = this.openRound(this.roster);
      if (events.length > 0) return events;
    }
    this.pausedFlag = false;
    this.participants.clear();
    this.left = 0;
    return [];
  }
}
