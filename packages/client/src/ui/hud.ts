import { WEAPONS, type WeaponId } from "@roguelike/shared";

/** "Vida 96/120" (la vida se muestra entera, redondeando hacia arriba, nunca negativa). */
export function formatHp(hp: number, maxHp: number): string {
  return `Vida ${Math.max(0, Math.ceil(hp))}/${Math.ceil(maxHp)}`;
}

/** "Nivel 2 · 14/30 XP" */
export function formatXp(level: number, xp: number, toNext: number): string {
  return `Nivel ${level} · ${xp}/${toNext} XP`;
}

/** Nombre visible del arma: "Mandoble". */
export function formatWeapon(weaponId: WeaponId): string {
  return WEAPONS[weaponId].name;
}

/** "Caíste — reapareces en N…", con N en segundos enteros hacia arriba (mínimo 1). */
export function formatRespawn(respawnIn: number): string {
  return `Caíste — reapareces en ${Math.max(1, Math.ceil(respawnIn))}…`;
}

const LEVEL_BANNER_MS = 2000;

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
 * HUD de la partida (solo DOM, con textContent): arma equipada, vida y XP abajo a la izquierda, "¡Nivel N!" en el
 * centro y el aviso de muerte con la cuenta regresiva.
 */
export class Hud {
  private readonly root = document.createElement("div");
  private readonly weapon: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpText: HTMLDivElement;
  private readonly xpFill: HTMLDivElement;
  private readonly xpText: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly death: HTMLDivElement;
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(parent: HTMLElement = document.body) {
    this.root.className = "combat-hud";
    const bars = div("hud-bars", this.root);
    this.weapon = div("hud-weapon", bars);
    const hp = div("hud-bar hud-hp", bars);
    this.hpFill = div("hud-fill", hp);
    this.hpText = div("hud-text", hp);
    const xp = div("hud-bar hud-xp", bars);
    this.xpFill = div("hud-fill", xp);
    this.xpText = div("hud-text", xp);
    this.banner = div("hud-banner", this.root);
    this.banner.hidden = true;
    this.death = div("hud-death", this.root);
    this.death.hidden = true;
    parent.append(this.root);
  }

  setPlayer(p: { hp: number; maxHp: number; dead: boolean; respawnIn: number; weaponId: WeaponId }): void {
    this.weapon.textContent = formatWeapon(p.weaponId);
    this.hpFill.style.width = `${clamp01(p.hp / p.maxHp) * 100}%`;
    this.hpText.textContent = formatHp(p.hp, p.maxHp);
    this.death.hidden = !p.dead;
    if (p.dead) this.death.textContent = formatRespawn(p.respawnIn);
  }

  setWorld(w: { level: number; xp: number; xpToNext: number }): void {
    this.xpFill.style.width = `${clamp01(w.xp / w.xpToNext) * 100}%`;
    this.xpText.textContent = formatXp(w.level, w.xp, w.xpToNext);
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
