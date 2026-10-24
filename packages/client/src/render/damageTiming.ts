import { INTERP_DELAY_MS, type CombatEvent } from "@roguelike/shared";

type DamageEvent = Extract<CombatEvent, { type: "damage" }>;

/**
 * Cuándo dibujar un evento de daño recibido en `nowMs`. Lo propio (daño recibido o golpe dado) se ve ya;
 * lo de los demás, INTERP_DELAY_MS después, cuando el render interpolado llega a ese momento.
 * - `numberAt`: arranque del número flotante (reloj del presente).
 * - `hitAt`: para `RecentHits`, en el reloj con que se dibuja el blanco (presente para el propio
 *   jugador; `now − INTERP_DELAY_MS` para enemigos y jugadores remotos).
 */
export function damageTiming(
  event: DamageEvent,
  myKey: string,
  nowMs: number,
): { numberAt: number; hitAt: number; hurtMe: boolean } {
  if (event.targetKind === "player" && event.targetId === myKey) return { numberAt: nowMs, hitAt: nowMs, hurtMe: true };
  if (event.targetKind === "enemy" && event.sourceKey === myKey) {
    return { numberAt: nowMs, hitAt: nowMs - INTERP_DELAY_MS, hurtMe: false };
  }
  return { numberAt: nowMs + INTERP_DELAY_MS, hitAt: nowMs, hurtMe: false };
}
