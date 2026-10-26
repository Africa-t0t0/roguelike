import {
  ABILITIES,
  GEAR_SLOTS,
  LEGENDARY_ABILITY,
  LEGENDARY_TEXT,
  RELICS,
  TIERS,
  gearName,
  gearStatText,
  weaponDisplayName,
  type AbilityId,
  type GearItem,
  type GearSlot,
  type GearStat,
  type Nature,
  type RelicId,
  type WeaponId,
  type WeaponTier,
} from "@roguelike/shared";
import type { EquippedGear, FloorItem } from "../net/connection";

/** "96/120" (la vida se muestra entera, redondeando hacia arriba, nunca negativa). */
export function formatHp(hp: number, maxHp: number): string {
  return `${Math.max(0, Math.ceil(hp))}/${Math.ceil(maxHp)}`;
}

/** "14/30 XP" (el nivel va aparte, en su insignia). */
export function formatXp(xp: number, toNext: number): string {
  return `${Math.floor(xp)}/${toNext} XP`; // la XP puede ser fraccionaria (Aprendizaje)
}

/** Nombre visible del arma con su tier y naturaleza: "Mandoble templado", "Mandoble legendario de fuego". */
export function formatWeapon(weaponId: WeaponId, tier: WeaponTier, nature: Nature = "none"): string {
  return weaponDisplayName(weaponId, tier, nature);
}

export type StatusKind = "burn" | "slow" | "stun";

/** Estados activos del jugador con los segundos que les quedan, en el orden fijo quemadura, ralentización, aturdimiento. */
export function formatStatus(s: { burnLeft: number; slowLeft: number; stunLeft: number }): { kind: StatusKind; left: number }[] {
  const all: { kind: StatusKind; left: number }[] = [
    { kind: "burn", left: s.burnLeft },
    { kind: "slow", left: s.slowLeft },
    { kind: "stun", left: s.stunLeft },
  ];
  return all.filter((e) => e.left > 0);
}

/** Glifo de cada estado (texto, sin imágenes); el color va en el CSS (`hud-st-*`). */
const STATUS_GLYPH: Record<StatusKind, string> = { burn: "♨", slow: "❄", stun: "ϟ" };

/** Color CSS del nombre de un arma: dorado viejo para tier 1, el brillo del tier (aclarado) para 2 y 3. */
export function tierColor(tier: WeaponTier): string {
  const glow = TIERS[tier].glow;
  if (!glow) return "#d9b46a";
  const c = glow.map((v) => Math.round(255 * Math.min(1, 0.35 + v * 0.65)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Color CSS de las reliquias (no tienen tier) y de las que traen un precio. */
export const RELIC_COLOR = "#c9a0ff";
export const RELIC_TRADEOFF_COLOR = "#e8896f";

/** Número con coma decimal y a lo más un decimal (igual que `gearStatText`). */
const num = (v: number): string => String(Math.round(v * 10) / 10).replace(".", ",");
/** Stats que son cantidades planas (no fracciones): se comparan sin "%". */
const FLAT_STATS: readonly GearStat[] = ["maxHp", "regen", "lifeOnKill"];

/** Diferencia "+2,5 %" / "-2,5" entre dos valores de la misma stat; "" si no cambia. */
function statDelta(stat: string, from: number, to: number): string {
  const d = Math.round((to - from) * 10000) / 10000;
  if (d === 0) return "";
  const sign = d > 0 ? "+" : "-";
  return FLAT_STATS.includes(stat as GearStat) ? `${sign}${num(Math.abs(d))}` : `${sign}${num(Math.abs(d) * 100)} %`;
}

/**
 * Una línea por stat de `next` ("+7,5 % velocidad de movimiento") con la diferencia contra la misma stat de `current`
 * entre paréntesis ("(+2,5 %)"); sin pieza actual, o si ella no tiene esa stat, o si no cambia, sin diferencia.
 */
export function gearCompare(current: GearItem | undefined, next: GearItem): string[] {
  return next.stats.map((e) => {
    const text = gearStatText(e.stat, e.value);
    const cur = current?.stats.find((c) => c.stat === e.stat);
    const delta = cur ? statDelta(e.stat, cur.value, e.value) : "";
    return delta ? `${text} (${delta})` : text;
  });
}

/** Efecto legendario con su marca de inactivo: falta la habilidad que lo hace servir (`LEGENDARY_ABILITY`). */
function legendaryEffect(item: GearItem, abilities: readonly AbilityId[]): { text: string; inactive: boolean } | undefined {
  if (!item.legendary) return undefined;
  const needs = LEGENDARY_ABILITY[item.legendary];
  return { text: LEGENDARY_TEXT[item.legendary], inactive: needs !== undefined && !abilities.includes(needs) };
}

export interface GearTooltip {
  name: string;
  color: string;
  stats: string[];
  effect?: { text: string; inactive: boolean };
  /** el efecto está inactivo: la habilidad que necesita falta */
  needs?: string;
}

/** Contenido del tooltip de una pieza puesta; `abilities`: las que tiene el jugador. */
export function gearTooltip(item: GearItem, abilities: readonly AbilityId[]): GearTooltip {
  const effect = legendaryEffect(item, abilities);
  const needs = item.legendary && effect?.inactive ? ABILITIES[LEGENDARY_ABILITY[item.legendary]!].name : undefined;
  return { name: gearName(item), color: tierColor(item.tier), stats: item.stats.map((e) => gearStatText(e.stat, e.value)), effect, needs };
}

/** Contenido del tooltip de una reliquia. */
export function relicTooltip(id: RelicId): { name: string; color: string; text: string; tradeoff: boolean } {
  const r = RELICS[id];
  return { name: r.name, color: r.tradeoff ? RELIC_TRADEOFF_COLOR : RELIC_COLOR, text: r.text, tradeoff: r.tradeoff };
}

export interface PickupInfo {
  verb: "Recoger" | "Equipar" | "Tomar";
  name: string;
  color: string;
  /** detalle bajo el nombre: stats con su comparación, texto de la reliquia o efecto legendario (`inactive`: en gris) */
  lines: { text: string; inactive?: boolean }[];
}

/**
 * Aviso de E para un ítem del suelo: el verbo, el nombre con su color y el detalle. `gear`: lo que el jugador tiene
 * puesto (para comparar); `abilities`: sus habilidades (para marcar un legendario sin la suya).
 */
export function pickupInfo(item: FloorItem, gear: Partial<Record<GearSlot, GearItem>>, abilities: readonly AbilityId[]): PickupInfo {
  if (item.kind === "weapon") {
    return { verb: "Recoger", name: formatWeapon(item.weaponId, item.tier, item.nature), color: tierColor(item.tier), lines: [] };
  }
  if (item.kind === "relic") {
    const r = relicTooltip(item.id);
    return { verb: "Tomar", name: r.name, color: r.color, lines: [{ text: r.text }] };
  }
  const lines: PickupInfo["lines"] = gearCompare(gear[item.item.slot], item.item).map((text) => ({ text }));
  const effect = legendaryEffect(item.item, abilities);
  if (effect) lines.push(effect);
  return { verb: "Equipar", name: gearName(item.item), color: tierColor(item.item.tier), lines };
}

/** Reloj del piso "mm:ss" (segundos enteros hacia abajo; los minutos siguen pasado 59: "61:00"). */
export function formatFloorTime(s: number): string {
  const total = Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** "Caíste — reapareces en N…", con N en segundos enteros hacia arriba (mínimo 1). */
export function formatRespawn(respawnIn: number): string {
  return `Caíste — reapareces en ${Math.max(1, Math.ceil(respawnIn))}…`;
}

const LEVEL_BANNER_MS = 2000;
const PORTRAIT_URL = "/assets/ui/portrait-kingslayer.webp";

function div(className: string, parent: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  parent.append(el);
  return el;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/** Letra de cada ranura en su icono (el borde lleva el color del tier). */
const GEAR_GLYPH: Record<GearSlot, string> = { helmet: "Y", chest: "P", gloves: "G", boots: "B" };
const RELIC_GLYPH = "✦";
const TIP_KEY = "Tab";

/**
 * HUD de la partida (solo DOM, con textContent). Abajo a la izquierda: retrato en un rombo, arma equipada con el
 * color de su tier, barra de vida y barra de XP con la insignia del nivel. "¡Nivel N!" en el centro y el aviso de
 * muerte con la cuenta regresiva. Bajo las barras, 5 iconos de equipo (casco, pechera, guantes, botas y reliquia) con el borde
 * del color del tier: los vacíos tenues; el tooltip (nombre, stats y efecto) sale al pasar el mouse o con Tab mantenido. El reloj del piso lo muestra la brújula (`Compass`).
 */
export class Hud {
  private readonly root = document.createElement("div");
  private readonly weapon: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpText: HTMLSpanElement;
  private readonly statusIcons: Record<StatusKind, HTMLDivElement>;
  private readonly xpFill: HTMLDivElement;
  private readonly xpText: HTMLDivElement;
  private readonly level: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly death: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly equip: HTMLDivElement;
  /** Tab mantenido: copias de todos los tooltips, apiladas sobre los iconos */
  private readonly tipBox: HTMLDivElement;
  private tipsShown = false;
  private readonly gearIcons: Record<GearSlot, HTMLDivElement>;
  private readonly relicIcon: HTMLDivElement;
  private equipKey = "";
  private readonly onTipKey = (e: KeyboardEvent): void => {
    if (e.key !== TIP_KEY) return;
    e.preventDefault(); // Tab no mueve el foco por la página
    this.showAllTips(e.type === "keydown");
  };
  private readonly onBlur = (): void => this.showAllTips(false);

  constructor(parent: HTMLElement = document.body) {
    this.root.className = "combat-hud";
    const card = div("hud-card", this.root);
    this.card = card;
    const frame = div("hud-portrait", card);
    const img = document.createElement("img");
    img.src = PORTRAIT_URL;
    img.alt = "";
    frame.append(img);
    this.level = div("hud-level", frame);
    const bars = div("hud-bars", card);
    this.weapon = div("hud-weapon", bars);
    const hpRow = div("hud-hprow", bars);
    const hp = div("hud-bar hud-hp", hpRow);
    const status = div("hud-status", hpRow);
    this.statusIcons = { burn: div("hud-st hud-st-burn", status), slow: div("hud-st hud-st-slow", status), stun: div("hud-st hud-st-stun", status) };
    for (const icon of Object.values(this.statusIcons)) icon.hidden = true;
    this.hpFill = div("hud-fill", hp);
    const hpLabel = div("hud-text", hp);
    const heart = document.createElement("span");
    heart.className = "hud-heart";
    heart.textContent = "♥";
    this.hpText = document.createElement("span");
    hpLabel.append(heart, this.hpText);
    const xp = div("hud-bar hud-xp", bars);
    this.xpFill = div("hud-fill", xp);
    this.xpText = div("hud-text", xp);
    this.equip = div("hud-equip", bars);
    this.tipBox = div("hud-tipbox", this.equip);
    this.tipBox.hidden = true;
    this.gearIcons = Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, div("hud-gear hud-gear-empty", this.equip)])) as Record<GearSlot, HTMLDivElement>;
    this.relicIcon = div("hud-gear hud-gear-empty", this.equip);
    this.renderEquip({}, null, []);
    window.addEventListener("keydown", this.onTipKey);
    window.addEventListener("keyup", this.onTipKey);
    window.addEventListener("blur", this.onBlur);
    this.banner = div("hud-banner", this.root);
    this.banner.hidden = true;
    this.death = div("hud-death", this.root);
    this.death.hidden = true;
    parent.append(this.root);
  }

  setPlayer(p: {
    hp: number;
    maxHp: number;
    dead: boolean;
    respawnIn: number;
    weaponId: WeaponId;
    weaponTier: WeaponTier;
    weaponNature: Nature;
    burnLeft: number;
    slowLeft: number;
    stunLeft: number;
    buffDamage: number;
    gear: Partial<Record<GearSlot, EquippedGear>>;
    relic: RelicId | null;
    abilities: readonly { id: AbilityId }[];
  }): void {
    // Grito de guerra activo: brillo dorado alrededor de la tarjeta.
    this.card.classList.toggle("hud-buffed", p.buffDamage > 0);
    const name = formatWeapon(p.weaponId, p.weaponTier, p.weaponNature);
    if (this.weapon.textContent !== name) {
      this.weapon.textContent = name;
      this.weapon.style.color = tierColor(p.weaponTier);
    }
    const abilityIds = p.abilities.map((a) => a.id);
    const key = JSON.stringify([GEAR_SLOTS.map((slot) => p.gear[slot]?.item ?? null), p.relic, abilityIds]);
    if (key !== this.equipKey) {
      this.equipKey = key;
      this.renderEquip(p.gear, p.relic, abilityIds);
    }
    this.hpFill.style.width = `${clamp01(p.hp / p.maxHp) * 100}%`;
    this.hpText.textContent = formatHp(p.hp, p.maxHp);
    const active = new Map(formatStatus(p).map((e) => [e.kind, e.left]));
    for (const kind of Object.keys(this.statusIcons) as StatusKind[]) {
      const icon = this.statusIcons[kind];
      const left = active.get(kind);
      icon.hidden = left === undefined;
      if (left !== undefined) {
        const text = `${STATUS_GLYPH[kind]} ${Math.ceil(left)}`; // segundos enteros hacia arriba
        if (icon.textContent !== text) icon.textContent = text;
      }
    }
    this.death.hidden = !p.dead;
    if (p.dead) this.death.textContent = formatRespawn(p.respawnIn);
  }

  /** Rehace los 5 iconos (solo cuando cambia el equipo, la reliquia o las habilidades). */
  private renderEquip(gear: Partial<Record<GearSlot, EquippedGear>>, relic: RelicId | null, abilities: readonly AbilityId[]): void {
    for (const slot of GEAR_SLOTS) {
      const item = gear[slot]?.item;
      const icon = this.gearIcons[slot];
      icon.replaceChildren();
      icon.classList.toggle("hud-gear-empty", !item);
      icon.style.borderColor = item ? tierColor(item.tier) : "";
      icon.append(this.glyph(GEAR_GLYPH[slot]));
      if (!item) continue;
      const t = gearTooltip(item, abilities);
      const lines = [...t.stats.map((text) => ({ text, cls: "hud-tip-stat" })), ...(t.effect ? [{ text: t.effect.text, cls: t.effect.inactive ? "hud-tip-fx hud-tip-inactive" : "hud-tip-fx" }] : [])];
      if (t.needs) lines.push({ text: `Inactivo: te falta ${t.needs}`, cls: "hud-tip-inactive" });
      icon.append(this.tip(t.name, t.color, lines));
    }
    this.relicIcon.replaceChildren(this.glyph(RELIC_GLYPH));
    this.relicIcon.classList.toggle("hud-gear-empty", !relic);
    this.relicIcon.style.borderColor = relic ? relicTooltip(relic).color : "";
    if (relic) {
      const r = relicTooltip(relic);
      this.relicIcon.append(this.tip(r.name, r.color, [{ text: r.text, cls: r.tradeoff ? "hud-tip-tradeoff" : "hud-tip-fx" }]));
    }
    this.fillTipBox(); // si Tab está mantenido mientras cambia el equipo
  }

  /** Con Tab mantenido muestra juntos los tooltips de todo lo puesto (copias de los de cada icono). */
  private showAllTips(on: boolean): void {
    this.tipsShown = on;
    this.fillTipBox();
  }

  private fillTipBox(): void {
    this.tipBox.replaceChildren(...(this.tipsShown ? [...this.equip.querySelectorAll(".hud-gear > .hud-tip")].map((t) => t.cloneNode(true)) : []));
    this.tipBox.hidden = this.tipBox.childElementCount === 0;
  }

  private glyph(text: string): HTMLSpanElement {
    const g = document.createElement("span");
    g.className = "hud-gear-glyph";
    g.textContent = text;
    return g;
  }

  private tip(name: string, color: string, lines: { text: string; cls: string }[]): HTMLDivElement {
    const tip = document.createElement("div");
    tip.className = "hud-tip";
    const title = div("hud-tip-name", tip);
    title.textContent = name;
    title.style.color = color;
    for (const l of lines) div(l.cls, tip).textContent = l.text;
    return tip;
  }

  setWorld(w: { level: number; xp: number; xpToNext: number }): void {
    this.xpFill.style.width = `${clamp01(w.xp / w.xpToNext) * 100}%`;
    this.xpText.textContent = formatXp(w.xp, w.xpToNext);
    this.level.textContent = String(w.level);
  }

  levelUp(level: number): void {
    this.banner.textContent = `¡Nivel ${level}!`;
    this.banner.hidden = false;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (this.banner.hidden = true), LEVEL_BANNER_MS);
  }

  /** Con el panel de cartas a la vista, el aviso "¡Nivel N!" no se le encima (ni asoma detrás). */
  setChoiceOpen(open: boolean): void {
    this.root.classList.toggle("hud-choosing", open);
  }

  dispose(): void {
    clearTimeout(this.bannerTimer);
    window.removeEventListener("keydown", this.onTipKey);
    window.removeEventListener("keyup", this.onTipKey);
    window.removeEventListener("blur", this.onBlur);
    this.root.remove();
  }
}
