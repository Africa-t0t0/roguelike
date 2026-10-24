import { createRng, type Rng } from "@roguelike/shared";

export interface LagConfig {
  delayMs: number;
  jitterMs: number;
  loss: number;
}

function parseNonNegative(raw: string | null): number {
  if (raw === null || raw.trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Lee `?lag=150&jitter=20&loss=0.02`; todo 0 si falta o es inválido. */
export function parseLagParams(search: string): LagConfig {
  const params = new URLSearchParams(search);
  return {
    delayMs: parseNonNegative(params.get("lag")),
    jitterMs: parseNonNegative(params.get("jitter")),
    loss: Math.min(0.5, parseNonNegative(params.get("loss"))),
  };
}

/** Simula latencia, jitter y pérdida, conservando el orden de cada dirección. */
export class LagSimulator {
  private lastOutbound = 0;
  private lastInbound = 0;

  constructor(
    private readonly cfg: LagConfig,
    private readonly rng: Rng = createRng(Date.now()),
  ) {}

  outbound(send: () => void): void {
    if (this.cfg.loss > 0 && this.rng.next() < this.cfg.loss) return;
    this.lastOutbound = this.schedule(send, this.lastOutbound);
  }

  inbound(deliver: () => void): void {
    this.lastInbound = this.schedule(deliver, this.lastInbound);
  }

  /** Programa `fn` y devuelve su instante de ejecución. */
  private schedule(fn: () => void, lastFireAt: number): number {
    const { delayMs, jitterMs } = this.cfg;
    if (delayMs === 0 && jitterMs === 0) {
      fn();
      return lastFireAt;
    }
    const now = Date.now();
    const jitter = (this.rng.next() - 0.5) * jitterMs;
    const delay = Math.max(0, delayMs / 2 + jitter);
    const fireAt = Math.max(now + delay, lastFireAt);
    setTimeout(fn, fireAt - now);
    return fireAt;
  }
}
