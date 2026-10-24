/** Buffer de snapshots con interpolación; nunca extrapola. */
export class SnapshotBuffer<T> {
  private items: { t: number; snap: T }[] = [];

  constructor(
    private readonly lerp: (a: T, b: T, t: number) => T,
    private readonly keepMs = 1000,
  ) {}

  push(timeMs: number, snap: T): void {
    this.items.push({ t: timeMs, snap });
    const cutoff = timeMs - this.keepMs;
    let drop = 0;
    while (this.items.length - drop > 2 && this.items[drop]!.t < cutoff) drop++;
    if (drop > 0) this.items.splice(0, drop);
  }

  sample(renderTimeMs: number): T | undefined {
    const items = this.items;
    const first = items[0];
    if (!first) return undefined;
    if (renderTimeMs <= first.t) return first.snap;
    const last = items[items.length - 1]!;
    if (renderTimeMs >= last.t) return last.snap;
    for (let i = 1; i < items.length; i++) {
      const b = items[i]!;
      if (renderTimeMs <= b.t) {
        const a = items[i - 1]!;
        const span = b.t - a.t;
        return span <= 0 ? b.snap : this.lerp(a.snap, b.snap, (renderTimeMs - a.t) / span);
      }
    }
    return last.snap;
  }
}
