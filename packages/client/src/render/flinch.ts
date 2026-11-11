/** Respingo del enemigo al recibir un golpe: se inclina alejándose de quien le pegó y vuelve. Solo visual. */
export const FLINCH_S = 0.28;
/** Destello claro sobre el cuerpo, más corto que el respingo. */
export const FLASH_S = 0.12;
export const FLASH_ALPHA = 0.55;
/** Fracción de `FLINCH_S` en que llega al máximo: sube de golpe y vuelve despacio. */
const PEAK_AT = 0.18;
const BASE_LEAN = 0.2; // rad (≈ 11°): golpe mínimo a un enemigo de la altura de referencia
const REF_HEIGHT = 1.7; // m
/** El golpe pesa según la vida que quita: de 1× (casi nada) a `MAX_WEIGHT`× (`HEAVY_FRAC` de la vida o más). */
const MAX_WEIGHT = 1.9;
const HEAVY_FRAC = 0.35;

/** Cuánto del respingo queda a `elapsedS` del golpe: 0 → 1 → 0. */
export function flinchEnvelope(elapsedS: number): number {
  const t = elapsedS / FLINCH_S;
  if (t <= 0 || t >= 1) return 0;
  if (t < PEAK_AT) return Math.sin(((t / PEAK_AT) * Math.PI) / 2);
  const back = (t - PEAK_AT) / (1 - PEAK_AT);
  return (1 - back) ** 2;
}

/** Inclinación máxima (rad) de un golpe de `amount` a un enemigo de `maxHp` de vida y `height` m de alto. */
export function flinchStrength(amount: number, maxHp: number, height: number): number {
  const frac = maxHp > 0 ? Math.min(1, Math.max(0, amount / maxHp) / HEAVY_FRAC) : 0;
  const size = height > 0 ? REF_HEIGHT / height : 1;
  return BASE_LEAN * (1 + (MAX_WEIGHT - 1) * frac) * size;
}

/**
 * Rotación (x, z) de un nodo para inclinarlo `angle` rad hacia `localDir`: la dirección medida desde su
 * propio frente (0 adelante, π/2 a su derecha).
 */
export function leanRotation(localDir: number, angle: number): { x: number; z: number } {
  return { x: Math.cos(localDir) * angle, z: -Math.sin(localDir) * angle };
}

/** Último golpe de cada enemigo: hacia dónde lo empuja (rad de mundo, 0 = +Z) y con qué fuerza. */
export class Flinches {
  private readonly hits = new Map<string, { atMs: number; dir: number; strength: number }>();

  hit(id: string, atMs: number, dir: number, strength: number): void {
    this.hits.set(id, { atMs, dir, strength });
  }

  /** Inclinación (rad) y opacidad del destello en `nowMs`; undefined si no hay respingo en curso. */
  sample(id: string, nowMs: number): { dir: number; lean: number; flash: number } | undefined {
    const h = this.hits.get(id);
    if (!h) return undefined;
    const elapsedS = (nowMs - h.atMs) / 1000;
    if (elapsedS < 0) return undefined;
    if (elapsedS >= FLINCH_S) {
      this.hits.delete(id);
      return undefined;
    }
    const flash = elapsedS < FLASH_S ? FLASH_ALPHA * (1 - elapsedS / FLASH_S) : 0;
    return { dir: h.dir, lean: h.strength * flinchEnvelope(elapsedS), flash };
  }

  forget(id: string): void {
    this.hits.delete(id);
  }
}
