import { ABILITIES, cardText, cardTitle, type CardOffer } from "@roguelike/shared";

/** Una elección de carta tal como la manda el servidor (sin el `offerId`, que guarda la conexión). */
export interface LevelChoice {
  cards: CardOffer[];
  /** número de esta elección (desde 1) y cuántas hay en total */
  index: number;
  total: number;
  /** segundos para elegir; sin pausa se cuentan localmente desde que llegó */
  deadlineS: number;
}

/** Cuenta regresiva "m:ss", en segundos enteros hacia arriba y nunca negativa: "0:20". */
export function formatCountdown(s: number): string {
  const total = Number.isFinite(s) ? Math.max(0, Math.ceil(s)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "Ana ✓ · Bruno eligiendo…": ✓ quien ya eligió (o no tiene elección abierta). */
export function formatGroupStatus(players: readonly { name: string; choosing: boolean }[]): string {
  return players.map((p) => (p.choosing ? `${p.name} eligiendo…` : `${p.name} ✓`)).join(" · ");
}

/** Tipo de la carta, para la línea pequeña sobre el título. */
export function cardKindLabel(card: CardOffer): string {
  if (card.kind === "stat") return "Atributo";
  if (ABILITIES[card.id].kind === "passive") return "Pasiva";
  return card.rank === 1 ? "Habilidad nueva" : "Mejora de habilidad";
}

const WAITING = "Esperando al grupo…";

/**
 * Estado de la elección propia (lógica pura, sin DOM).
 * - `open` con cada `levelChoice` (también la siguiente de la misma pausa): desbloquea.
 * - `choose` deja elegir una sola vez por oferta; el servidor ignora un `offerId` viejo, así que tras el clic
 *   el panel queda bloqueado hasta la próxima oferta o hasta que se cierre.
 * - `sync` con el estado sincronizado: cuando el servidor deja de marcarlo `choosing` (eligió, o venció y le
 *   tocó una al azar) la oferta termina; en la pausa del grupo sigue a la vista, esperando al resto.
 */
export class CardChoice {
  offer: LevelChoice | undefined;
  /** índice elegido en la oferta actual */
  chosen: number | undefined;
  /** la oferta terminó en el servidor sin clic (venció) y no se puede elegir */
  locked = false;
  private deadlineMs = 0;
  /** el estado ya lo marcó `choosing` desde que llegó la oferta (un parche viejo no la cierra) */
  private sawChoosing = false;

  open(offer: LevelChoice, nowMs: number): void {
    this.offer = offer;
    this.chosen = undefined;
    this.locked = false;
    this.sawChoosing = false;
    this.deadlineMs = nowMs + offer.deadlineS * 1000;
  }

  /** true si hay que enviar esta elección (la primera válida de la oferta). */
  choose(index: number): boolean {
    const o = this.offer;
    if (!o || this.locked || this.chosen !== undefined) return false;
    if (!Number.isInteger(index) || index < 0 || index >= o.cards.length) return false;
    this.chosen = index;
    return true;
  }

  sync(s: { paused: boolean; choosing: boolean }): void {
    if (!this.offer) return;
    if (s.choosing) {
      this.sawChoosing = true;
      return;
    }
    if (!this.sawChoosing && this.chosen === undefined) return;
    if (s.paused) this.locked = this.chosen === undefined;
    else this.offer = undefined;
  }

  /** En la pausa se ve siempre (aunque no tenga elección propia); sin pausa, mientras haya oferta. */
  visible(paused: boolean): boolean {
    return paused || this.offer !== undefined;
  }

  /** Segundos que quedan: los de la pausa del grupo, o los de esta elección sin pausa. */
  secondsLeft(world: { paused: boolean; pauseLeft: number }, nowMs: number): number {
    if (world.paused) return world.pauseLeft;
    return Math.max(0, (this.deadlineMs - nowMs) / 1000);
  }

  heading(): string {
    const o = this.offer;
    return o ? `Elección ${o.index} de ${o.total}` : "El grupo está eligiendo";
  }

  status(paused: boolean): string {
    if (this.offer && this.chosen === undefined && !this.locked) return "Elige una carta";
    return paused ? WAITING : "Elegida";
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent.append(e);
  return e;
}

/**
 * Panel de cartas al subir de nivel (solo DOM, con textContent): tres cartas con tipo, título y texto, el
 * número de elección, la cuenta regresiva y, en la pausa, el estado del grupo. En la pausa un velo oscurece
 * la escena; en la elección sin pausa no hay velo y el juego sigue alrededor.
 */
export class CardPanel {
  readonly choice = new CardChoice();
  private readonly veil: HTMLDivElement;
  private readonly root: HTMLDivElement;
  private readonly heading: HTMLDivElement;
  private readonly clock: HTMLSpanElement;
  private readonly cardsEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly groupEl: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];
  private builtFor: LevelChoice | undefined;

  constructor(
    private readonly onChoose: (index: number) => void,
    parent: HTMLElement = document.body,
  ) {
    this.veil = el("div", "choice-veil", parent);
    this.veil.hidden = true;
    this.root = el("div", "choice", parent);
    this.root.hidden = true;
    const head = el("div", "choice-head", this.root);
    el("div", "choice-title", head).textContent = "Subiste de nivel";
    const meta = el("div", "choice-meta", head);
    this.heading = el("div", "choice-heading", meta);
    this.clock = el("span", "choice-clock", meta);
    this.cardsEl = el("div", "choice-cards", this.root);
    this.statusEl = el("div", "choice-status", this.root);
    this.groupEl = el("div", "choice-group", this.root);
  }

  open(offer: LevelChoice, nowMs: number): void {
    this.choice.open(offer, nowMs);
  }

  /**
   * Una vez por frame: sincroniza con el estado y actualiza el DOM. `group`: los jugadores conectados
   * (nombre y si eligen); `myChoosing`: el `choosing` propio según el servidor. Devuelve si está a la vista.
   */
  render(
    world: { paused: boolean; pauseLeft: number },
    group: readonly { name: string; choosing: boolean }[],
    myChoosing: boolean,
    nowMs: number,
  ): boolean {
    const c = this.choice;
    c.sync({ paused: world.paused, choosing: myChoosing });
    const visible = c.visible(world.paused);
    this.root.hidden = !visible;
    this.veil.hidden = !(visible && world.paused);
    if (!visible) return false;
    if (this.builtFor !== c.offer) this.build(c.offer);
    setText(this.heading, c.heading());
    setText(this.clock, formatCountdown(c.secondsLeft(world, nowMs)));
    setText(this.statusEl, c.status(world.paused));
    this.groupEl.hidden = !world.paused || group.length < 2;
    if (!this.groupEl.hidden) setText(this.groupEl, formatGroupStatus(group));
    this.paintCards();
    return true;
  }

  dispose(): void {
    this.veil.remove();
    this.root.remove();
  }

  private paintCards(): void {
    const c = this.choice;
    const open = c.chosen === undefined && !c.locked;
    this.root.classList.toggle("choice-done", !open);
    this.buttons.forEach((b, i) => {
      b.disabled = !open;
      b.classList.toggle("choice-picked", c.chosen === i);
    });
  }

  private build(offer: LevelChoice | undefined): void {
    this.builtFor = offer;
    this.cardsEl.replaceChildren();
    this.buttons = (offer?.cards ?? []).map((card, i) => {
      const b = el("button", `choice-card choice-${card.kind}`, this.cardsEl);
      b.type = "button";
      el("div", "choice-kind", b).textContent = cardKindLabel(card);
      el("div", "choice-name", b).textContent = cardTitle(card);
      el("div", "choice-text", b).textContent = cardText(card);
      b.addEventListener("click", () => {
        if (!this.choice.choose(i)) return;
        this.onChoose(i);
        this.paintCards(); // bloqueada ya, sin esperar al próximo frame
      });
      return b;
    });
  }
}

function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}
