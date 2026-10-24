import { HISTORY_TICKS } from "@roguelike/shared";

interface Snapshot {
  tick: number;
  pos: Map<string, { x: number; z: number }>;
}

/** Posiciones de enemigos de los últimos HISTORY_TICKS ticks (para el rebobinado). */
export class PositionHistory {
  private snaps: Snapshot[] = [];

  record(tick: number, enemies: readonly { id: string; x: number; z: number }[]): void {
    const pos = new Map<string, { x: number; z: number }>();
    for (const e of enemies) pos.set(e.id, { x: e.x, z: e.z });
    this.snaps.push({ tick, pos });
    while (this.snaps.length > HISTORY_TICKS) this.snaps.shift();
  }

  at(tick: number, id: string): { x: number; z: number } | undefined {
    const t = Math.round(tick);
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      const s = this.snaps[i]!;
      if (s.tick === t) return s.pos.get(id);
    }
    return undefined;
  }
}
