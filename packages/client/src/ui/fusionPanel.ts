import { ABILITIES, type AbilityId } from "@roguelike/shared";
import { ABILITY_GLYPHS } from "./abilityBar";

/** Tecla que abre (o cierra) el panel de fusión. */
export const FUSION_KEY = "KeyF";

type SlotLike = { id: AbilityId; partners?: readonly { id: AbilityId }[] };

/** La fusión que ya tiene (todas sus habilidades), o [] si aún no fusionó. */
export function currentFusion(slots: readonly SlotLike[]): AbilityId[] {
  const s = slots.find((x) => (x.partners?.length ?? 0) > 0);
  return s ? [s.id, ...s.partners!.map((p) => p.id)] : [];
}

/** Habilidades que se pueden sumar a la fusión: las activas de sus casillas que aún no están dentro. */
export function fusableAbilities(slots: readonly SlotLike[]): AbilityId[] {
  return slots.filter((s) => !s.partners?.length && ABILITIES[s.id].kind === "active").map((s) => s.id);
}

/** Cuántas hay que elegir: dos para empezar la fusión, una para sumarle. */
export function fusionNeed(fusion: readonly AbilityId[]): number {
  return fusion.length === 0 ? 2 : 1;
}

/** Texto del aviso del panel: la fusión como quedaría con lo elegido. */
export function fusionHint(fusion: readonly AbilityId[], picked: readonly AbilityId[]): string {
  const need = fusionNeed(fusion);
  if (picked.length === 0) {
    return fusion.length === 0
      ? "Elige dos habilidades: se lanzarán juntas con una sola tecla y pegarán un 25 % más."
      : `Elige una habilidad para sumarla a tu fusión (${fusion.map((id) => ABILITIES[id].name).join(" + ")}).`;
  }
  const names = [...fusion, ...picked].map((id) => ABILITIES[id].name);
  return picked.length < need ? `${names.join(" + ")} + …` : names.join(" + ");
}

/**
 * Panel para gastar una fusión ganada (no pausa el juego): se elige dos habilidades y «Fusionar». Se abre solo
 * al ganar una (si hay al menos dos que fusionar) y con F; «Más tarde» lo cierra y queda un aviso.
 */
export class FusionPanel {
  private readonly root = document.createElement("div");
  private readonly list = document.createElement("div");
  private readonly hint = document.createElement("div");
  private readonly confirm = document.createElement("button");
  private readonly badge = document.createElement("div");
  private picked: AbilityId[] = [];
  private options: AbilityId[] = [];
  /** la fusión que ya tiene ([] si aún no fusionó) */
  private fusion: AbilityId[] = [];
  private tokens = 0;
  /** el jugador lo cerró: no se reabre solo hasta ganar otra fusión */
  private dismissed = false;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== FUSION_KEY || e.repeat || !this.can()) return;
    if (this.root.hidden) this.open();
    else this.close();
  };

  constructor(
    private readonly onFuse: (ids: AbilityId[]) => void,
    parent: HTMLElement = document.body,
  ) {
    this.root.className = "fusion-panel";
    const title = document.createElement("div");
    title.className = "fusion-title";
    title.textContent = "Fusión de habilidades";
    this.hint.className = "fusion-hint";
    this.list.className = "fusion-list";
    const actions = document.createElement("div");
    actions.className = "fusion-actions";
    this.confirm.textContent = "Fusionar";
    this.confirm.addEventListener("click", () => {
      if (this.picked.length !== fusionNeed(this.fusion)) return;
      this.onFuse(this.picked);
      this.picked = [];
      this.close();
    });
    const later = document.createElement("button");
    later.textContent = "Más tarde";
    later.addEventListener("click", () => this.close());
    actions.append(this.confirm, later);
    this.root.append(title, this.hint, this.list, actions);
    this.root.hidden = true;
    this.badge.className = "fusion-badge";
    this.badge.textContent = "F · Fusión disponible";
    this.badge.hidden = true;
    parent.append(this.root, this.badge);
    window.addEventListener("keydown", this.onKey);
  }

  /** Con lo último del servidor: fusiones sin gastar y sus casillas. */
  update(tokens: number, slots: readonly SlotLike[]): void {
    const gained = tokens > this.tokens;
    this.tokens = tokens;
    const options = fusableAbilities(slots);
    const fusion = currentFusion(slots);
    if (options.join() !== this.options.join() || fusion.join() !== this.fusion.join()) {
      this.options = options;
      this.fusion = fusion;
      this.picked = this.picked.filter((id) => options.includes(id)).slice(0, fusionNeed(fusion));
      this.renderList();
    }
    if (gained) this.dismissed = false;
    const can = this.can();
    if (!can) this.root.hidden = true;
    else if (!this.dismissed && this.root.hidden) this.open();
    this.badge.hidden = !can || !this.root.hidden;
  }

  /** Tiene una fusión para gastar y con qué. */
  private can(): boolean {
    return this.tokens > 0 && this.options.length >= fusionNeed(this.fusion);
  }

  private open(): void {
    this.root.hidden = false;
    this.badge.hidden = true;
    this.renderList();
  }

  private close(): void {
    this.root.hidden = true;
    this.dismissed = true;
    this.badge.hidden = !this.can();
  }

  private renderList(): void {
    this.list.replaceChildren(
      ...this.options.map((id) => {
        const b = document.createElement("button");
        b.className = this.picked.includes(id) ? "fusion-option picked" : "fusion-option";
        const glyph = document.createElement("span");
        glyph.className = "fusion-glyph";
        glyph.textContent = ABILITY_GLYPHS[id];
        const name = document.createElement("span");
        name.textContent = ABILITIES[id].name;
        b.append(glyph, name);
        b.addEventListener("click", () => {
          this.picked = this.picked.includes(id) ? this.picked.filter((x) => x !== id) : [...this.picked, id].slice(-fusionNeed(this.fusion));
          this.renderList();
        });
        return b;
      }),
    );
    this.hint.textContent = fusionHint(this.fusion, this.picked);
    this.confirm.textContent = this.fusion.length === 0 ? "Fusionar" : "Sumar a la fusión";
    this.confirm.disabled = this.picked.length !== fusionNeed(this.fusion);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
    this.badge.remove();
  }
}
