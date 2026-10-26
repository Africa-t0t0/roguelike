import { ABILITIES, MAX_ACTIVE_ABILITIES, type AbilityId } from "@roguelike/shared";

/** Glifo de cada habilidad (texto, sin imágenes). */
export const ABILITY_GLYPHS: Record<AbilityId, string> = {
  whirlwind: "⟳",
  kick: "↯",
  warcry: "✶",
  slam: "◎",
  block: "⛨",
  cleave: "☽",
  thrust: "➶",
};

const MAX_RANK = 3;

/** Enfriamiento visible: segundos enteros hacia arriba ("3"); bajo 1 s, una décima ("0.5"); listo, "". */
export function formatCooldown(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s >= 1) return String(Math.ceil(s));
  const tenths = Math.ceil(s * 10 - 1e-9) / 10;
  return tenths >= 1 ? "1" : tenths.toFixed(1);
}

/** Puntos de rango: "●●○" para rango 2 de 3. */
export function rankPips(rank: number): string {
  const r = Math.max(0, Math.min(MAX_RANK, Math.floor(Number.isFinite(rank) ? rank : 0)));
  return "●".repeat(r) + "○".repeat(MAX_RANK - r);
}

export type AbilitySlotModel =
  | { key: string; empty: true }
  | {
      key: string;
      empty: false;
      id: AbilityId;
      glyph: string;
      name: string;
      pips: string;
      /** texto del enfriamiento ("" si está lista) */
      cooldownText: string;
      /** fracción del enfriamiento que queda (0..1), para el barrido */
      sweep: number;
      /** el Bloqueo mantenido */
      active: boolean;
      /** cargas disponibles y máximas (máximo 1: sin cargas); se pueden lanzar con `charges` ≥ 1 */
      charges: number;
      maxCharges: number;
      /** sin cargas para lanzarla: la casilla se atenúa */
      cooling: boolean;
    };

/**
 * Las 4 casillas de la barra (lógica pura): las habilidades en orden de casilla y el resto vacías.
 * `cooldownOf`: enfriamiento que queda (s; con cargas, el del ciclo de recarga en curso, 0 con el máximo); `blocking`: el Bloqueo está
 * activo; `cooldownMult`: el de Celeridad (denominador del barrido); `chargesOf`: cargas de cada habilidad (sin él, 1 de 1).
 * El barrido solo se dibuja mientras recarga (cargas < máximo); el número de segundos, solo sin cargas.
 */
export function abilityBarModel(
  slots: readonly { id: AbilityId; rank: number }[],
  cooldownOf: (id: AbilityId) => number,
  blocking: boolean,
  cooldownMult = 1,
  chargesOf: (id: AbilityId) => { charges: number; max: number } = () => ({ charges: 1, max: 1 }),
): AbilitySlotModel[] {
  const out: AbilitySlotModel[] = [];
  for (let i = 0; i < MAX_ACTIVE_ABILITIES; i++) {
    const key = String(i + 1);
    const s = slots[i];
    if (!s) {
      out.push({ key, empty: true });
      continue;
    }
    const def = ABILITIES[s.id];
    const cd = def.cooldownS > 0 ? Math.max(0, cooldownOf(s.id)) : 0;
    const have = chargesOf(s.id);
    const maxCharges = Math.max(1, have.max);
    // Sin cargas (máximo 1) manda el enfriamiento: lista cuando no queda nada por esperar.
    const charges = maxCharges > 1 ? Math.max(0, Math.min(maxCharges, have.charges)) : cd > 0 ? 0 : 1;
    out.push({
      key,
      empty: false,
      id: s.id,
      glyph: ABILITY_GLYPHS[s.id],
      name: def.name,
      pips: rankPips(s.rank),
      cooldownText: charges < 1 ? formatCooldown(cd) : "",
      sweep: def.cooldownS > 0 ? Math.min(1, cd / (def.cooldownS * cooldownMult)) : 0,
      active: def.kind === "held" && blocking,
      charges,
      maxCharges,
      cooling: charges < 1,
    });
  }
  return out;
}

function el(className: string, parent: HTMLElement, tag: "div" | "span" = "div"): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  parent.append(e);
  return e;
}

function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

interface SlotEls {
  root: HTMLElement;
  glyph: HTMLElement;
  sweep: HTMLElement;
  cd: HTMLElement;
  charges: HTMLElement;
  pips: HTMLElement;
}

/**
 * Barra de habilidades abajo a la derecha (solo DOM, con textContent): 4 casillas con la tecla, el glifo,
 * los puntos de rango y un barrido del enfriamiento; las vacías, atenuadas. La pasiva (Onda de corte) va al
 * lado, en un rombo pequeño con su rango.
 */
export class AbilityBar {
  private readonly root: HTMLDivElement;
  private readonly slots: SlotEls[] = [];
  private readonly passive: HTMLElement;
  private readonly passivePips: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement("div");
    this.root.className = "ability-bar";
    this.passive = el("ab-passive", this.root);
    this.passive.title = ABILITIES.cleave.name;
    el("ab-passive-glyph", this.passive).textContent = ABILITY_GLYPHS.cleave;
    this.passivePips = el("ab-pips", this.passive);
    for (let i = 0; i < MAX_ACTIVE_ABILITIES; i++) {
      const root = el("ab-slot", this.root);
      const glyph = el("ab-glyph", root);
      const sweep = el("ab-sweep", root);
      const cd = el("ab-cd", root);
      const charges = el("ab-charges", root);
      el("ab-key", root).textContent = String(i + 1);
      const pips = el("ab-pips", root);
      this.slots.push({ root, glyph, sweep, cd, charges, pips });
    }
    parent.append(this.root);
  }

  /** Una vez por frame, con el modelo de las casillas y el rango de la pasiva (0: no la tiene). */
  render(model: readonly AbilitySlotModel[], passiveRank: number): void {
    model.forEach((m, i) => {
      const s = this.slots[i];
      if (!s) return;
      s.root.classList.toggle("ab-empty", m.empty);
      if (m.empty) {
        setText(s.glyph, "");
        setText(s.cd, "");
        setText(s.charges, "");
        setText(s.pips, "");
        s.root.title = "";
        s.root.classList.remove("ab-cooling", "ab-active");
        s.sweep.style.setProperty("--cd", "0");
        return;
      }
      setText(s.glyph, m.glyph);
      setText(s.cd, m.cooldownText);
      setText(s.charges, m.maxCharges > 1 ? String(m.charges) : "");
      setText(s.pips, m.pips);
      s.root.title = m.name;
      s.root.classList.toggle("ab-cooling", m.cooling);
      s.root.classList.toggle("ab-active", m.active);
      s.sweep.style.setProperty("--cd", m.sweep.toFixed(3));
    });
    this.passive.hidden = passiveRank <= 0;
    if (passiveRank > 0) setText(this.passivePips, rankPips(passiveRank));
  }

  dispose(): void {
    this.root.remove();
  }
}
