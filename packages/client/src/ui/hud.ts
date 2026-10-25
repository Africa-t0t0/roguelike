import { TIERS, weaponDisplayName, type WeaponId, type WeaponTier } from "@roguelike/shared";

/** "96/120" (la vida se muestra entera, redondeando hacia arriba, nunca negativa). */
export function formatHp(hp: number, maxHp: number): string {
  return `${Math.max(0, Math.ceil(hp))}/${Math.ceil(maxHp)}`;
}

/** "14/30 XP" (el nivel va aparte, en su insignia). */
export function formatXp(xp: number, toNext: number): string {
  return `${xp}/${toNext} XP`;
}

/** Nombre visible del arma con su tier: "Mandoble templado". */
export function formatWeapon(weaponId: WeaponId, tier: WeaponTier): string {
  return weaponDisplayName(weaponId, tier);
}

/** Color CSS del nombre de un arma: dorado viejo para tier 1, el brillo del tier (aclarado) para 2 y 3. */
export function tierColor(tier: WeaponTier): string {
  const glow = TIERS[tier].glow;
  if (!glow) return "#d9b46a";
  const c = glow.map((v) => Math.round(255 * Math.min(1, 0.35 + v * 0.65)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
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

/**
 * HUD de la partida (solo DOM, con textContent). Abajo a la izquierda: retrato en un rombo, arma equipada con el
 * color de su tier, barra de vida y barra de XP con la insignia del nivel. "¡Nivel N!" en el centro y el aviso de
 * muerte con la cuenta regresiva. El reloj del piso lo muestra la brújula (`Compass`).
 */
export class Hud {
  private readonly root = document.createElement("div");
  private readonly weapon: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpText: HTMLSpanElement;
  private readonly xpFill: HTMLDivElement;
  private readonly xpText: HTMLDivElement;
  private readonly level: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly death: HTMLDivElement;
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(parent: HTMLElement = document.body) {
    this.root.className = "combat-hud";
    const card = div("hud-card", this.root);
    const frame = div("hud-portrait", card);
    const img = document.createElement("img");
    img.src = PORTRAIT_URL;
    img.alt = "";
    frame.append(img);
    this.level = div("hud-level", frame);
    const bars = div("hud-bars", card);
    this.weapon = div("hud-weapon", bars);
    const hp = div("hud-bar hud-hp", bars);
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
  }): void {
    const name = formatWeapon(p.weaponId, p.weaponTier);
    if (this.weapon.textContent !== name) {
      this.weapon.textContent = name;
      this.weapon.style.color = tierColor(p.weaponTier);
    }
    this.hpFill.style.width = `${clamp01(p.hp / p.maxHp) * 100}%`;
    this.hpText.textContent = formatHp(p.hp, p.maxHp);
    this.death.hidden = !p.dead;
    if (p.dead) this.death.textContent = formatRespawn(p.respawnIn);
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

  dispose(): void {
    clearTimeout(this.bannerTimer);
    this.root.remove();
  }
}
