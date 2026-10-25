import { MAX_ORBS, ORB_MAGNET_RADIUS, ORB_PICKUP_RADIUS, ORB_SPEED, splitXp, type Rng } from "@roguelike/shared";
import type { SimPlayer } from "./EnemySystem";

/** Radio (m) en que se reparten los orbes alrededor del enemigo muerto. */
const ORB_SPREAD = 0.6;

export interface Orb {
  id: string;
  x: number;
  z: number;
  value: number;
  bornTick: number;
}

/** Orbes de XP compartidos por el grupo: cualquier jugador vivo los atrae y los recoge. */
export class OrbSystem {
  private list: Orb[] = [];
  private nextOrb = 1;

  constructor(private readonly rng: Rng) {}

  get orbs(): readonly Orb[] {
    return this.list;
  }

  /** Reparte `xp` en orbes de 1 a 4 dentro de ORB_SPREAD m de (x, z); respeta el tope fusionando. */
  spawn(x: number, z: number, xp: number, tick: number): void {
    for (const value of splitXp(xp, this.rng)) {
      const angle = this.rng.next() * 2 * Math.PI;
      const r = this.rng.next() * ORB_SPREAD;
      this.list.push({ id: `o${this.nextOrb++}`, x: x + Math.sin(angle) * r, z: z + Math.cos(angle) * r, value, bornTick: tick });
    }
    while (this.list.length > MAX_ORBS) this.mergeOldest();
  }

  /**
   * Cada orbe avanza ORB_SPEED × dt hacia el jugador vivo más cercano que lo tenga a ≤ ORB_MAGNET_RADIUS ×
   * su `magnetMult` (1 por defecto) y se recoge si queda a ≤ ORB_PICKUP_RADIUS. Devuelve la XP recogida.
   */
  step(alive: readonly SimPlayer[], dt: number): number {
    if (alive.length === 0) return 0;
    let gained = 0;
    const keep: Orb[] = [];
    for (const o of this.list) {
      let best: SimPlayer | undefined;
      let bestD = Infinity;
      for (const p of alive) {
        const d = Math.hypot(p.x - o.x, p.z - o.z);
        if (d <= ORB_MAGNET_RADIUS * (p.magnetMult ?? 1) && d < bestD) [best, bestD] = [p, d];
      }
      if (best) {
        const move = Math.min(ORB_SPEED * dt, bestD);
        if (bestD > 0) {
          o.x += ((best.x - o.x) / bestD) * move;
          o.z += ((best.z - o.z) / bestD) * move;
        }
        if (bestD - move <= ORB_PICKUP_RADIUS) {
          gained += o.value;
          continue;
        }
      }
      keep.push(o);
    }
    this.list = keep;
    return gained;
  }

  /** El orbe más viejo (a igual tick, el primero creado) suma su valor a su vecino más cercano y desaparece. */
  private mergeOldest(): void {
    let oldest = 0;
    for (let i = 1; i < this.list.length; i++) if (this.list[i]!.bornTick < this.list[oldest]!.bornTick) oldest = i;
    const o = this.list[oldest]!;
    let near = -1;
    let nearD2 = Infinity;
    this.list.forEach((n, i) => {
      if (i === oldest) return;
      const d2 = (n.x - o.x) ** 2 + (n.z - o.z) ** 2;
      if (d2 < nearD2) [near, nearD2] = [i, d2];
    });
    this.list[near]!.value += o.value;
    this.list.splice(oldest, 1);
  }
}
