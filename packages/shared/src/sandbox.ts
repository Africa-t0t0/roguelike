import { ABILITIES, STAT_CARDS, type AbilityId, type CardOffer, type StatCardId } from "./cards";
import { ENEMY_DEFS, type EnemyKind } from "./combat";
import { ELEMENTS, type Nature } from "./natures";
import { WEAPONS, type WeaponId, type WeaponTier } from "./weapons";
import type { CasterTier } from "./spells";

/** Más enemigos por comando no sirven para probar nada y solo ahogan el servidor. */
export const SANDBOX_MAX_SPAWN = 20;
/** Lo más que se adelanta el reloj del piso por comando (s). */
export const SANDBOX_MAX_CLOCK_STEP_S = 600;
/** Niveles por comando, como mucho. */
export const SANDBOX_MAX_LEVELS = 10;
/** Multiplicador de enfriamiento con "sin enfriamiento" (> 0: el cliente descarta 0). */
export const SANDBOX_COOLDOWN_MULT = 0.01;

/**
 * Comandos del panel de pruebas (`?sandbox=1`). El servidor solo los atiende en una sala creada en modo
 * sandbox y fuera de la pausa de elección.
 * - `levelUp`: sube `count` niveles; con `choose` se elige carta como siempre (con pausa), sin él no.
 * - `card`: aplica una carta (una habilidad nueva solo si queda casilla).
 * - `clearCards`: quita todas las cartas y habilidades.
 * - `god` / `noCooldown` / `waves`: interruptores (`waves` apaga oleadas y el llenado de salas para todos).
 * - `heal`: vida al máximo y enfriamientos a cero.
 * - `spawn`: `count` enemigos delante del jugador; `tier` 0 = desarmado (los magos siempre lo van). Con `elite`
 *   son élites (de la `nature` dada o sorteada) y los que pueden llevar arma la llevan siempre.
 * - `status`: aplica a quien lo pide quemadura, ralentización o aturdimiento, con los números de los élites.
 * - `killAll`: mata a todos los enemigos sin dejar orbes ni armas.
 * - `clock`: adelanta el reloj del piso `seconds`.
 * - `freeze`: congela a los enemigos que no preparan un ataque (proyectiles y peligros siguen).
 * - `castNow`: todos los hechiceros libres lanzan ya su hechizo sobre el jugador más cercano.
 * - `weapon`: equipa el arma con su tier y naturaleza (`"none"` si no se indica).
 */
export type DevCommand =
  | { cmd: "levelUp"; count: number; choose: boolean }
  | { cmd: "card"; card: CardOffer }
  | { cmd: "clearCards" }
  | { cmd: "god"; on: boolean }
  | { cmd: "noCooldown"; on: boolean }
  | { cmd: "waves"; on: boolean }
  | { cmd: "heal" }
  | { cmd: "spawn"; kind: EnemyKind; count: number; tier: 0 | CasterTier; elite?: boolean; nature?: Exclude<Nature, "none"> }
  | { cmd: "killAll" }
  | { cmd: "clock"; seconds: number }
  | { cmd: "freeze"; on: boolean }
  | { cmd: "castNow" }
  | { cmd: "status"; kind: "burn" | "slow" | "stun" }
  | { cmd: "weapon"; weaponId: WeaponId; tier: WeaponTier; nature: Nature };

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isTier = (v: unknown): v is 1 | 2 | 3 => isInt(v, 1, 3);
const isNature = (v: unknown): v is Nature => v === "none" || (ELEMENTS as readonly unknown[]).includes(v);
const has = <T extends object>(o: T, k: unknown): k is keyof T => typeof k === "string" && Object.hasOwn(o, k);

/** Valida un mensaje del cliente; null si no es un comando conocido y bien formado. */
export function parseDevCommand(raw: unknown): DevCommand | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.cmd) {
    case "levelUp":
      return isInt(m.count, 1, SANDBOX_MAX_LEVELS) && typeof m.choose === "boolean"
        ? { cmd: "levelUp", count: m.count, choose: m.choose }
        : null;
    case "card": {
      const c = m.card as Record<string, unknown> | null;
      if (typeof c !== "object" || c === null) return null;
      if (c.kind === "stat" && has(STAT_CARDS, c.id)) return { cmd: "card", card: { kind: "stat", id: c.id as StatCardId } };
      if (c.kind === "ability" && has(ABILITIES, c.id) && isTier(c.rank)) {
        return { cmd: "card", card: { kind: "ability", id: c.id as AbilityId, rank: c.rank } };
      }
      return null;
    }
    case "god":
    case "noCooldown":
    case "waves":
    case "freeze":
      return typeof m.on === "boolean" ? { cmd: m.cmd, on: m.on } : null;
    case "clearCards":
    case "heal":
    case "killAll":
    case "castNow":
      return { cmd: m.cmd };
    case "spawn": {
      if (!has(ENEMY_DEFS, m.kind) || !isInt(m.count, 1, SANDBOX_MAX_SPAWN) || !isInt(m.tier, 0, 3)) return null;
      const spawn: DevCommand = { cmd: "spawn", kind: m.kind as EnemyKind, count: m.count, tier: m.tier as 0 | CasterTier };
      if (m.elite !== undefined) {
        if (typeof m.elite !== "boolean") return null;
        spawn.elite = m.elite;
      }
      if (m.nature !== undefined && m.nature !== "none") {
        if (!(ELEMENTS as readonly unknown[]).includes(m.nature)) return null;
        spawn.nature = m.nature as Exclude<Nature, "none">;
      }
      return spawn;
    }
    case "status":
      return m.kind === "burn" || m.kind === "slow" || m.kind === "stun" ? { cmd: "status", kind: m.kind } : null;
    case "clock":
      return typeof m.seconds === "number" && Number.isFinite(m.seconds) && m.seconds > 0 && m.seconds <= SANDBOX_MAX_CLOCK_STEP_S
        ? { cmd: "clock", seconds: m.seconds }
        : null;
    case "weapon": {
      const nature = m.nature ?? "none";
      return has(WEAPONS, m.weaponId) && isTier(m.tier) && isNature(nature)
        ? { cmd: "weapon", weaponId: m.weaponId as WeaponId, tier: m.tier, nature }
        : null;
    }
    default:
      return null;
  }
}
