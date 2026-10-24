export type Rng = {
  next(): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(arr: readonly T[]): T;
};

/** mulberry32: PRNG determinista con semilla de 32 bits. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    pick: <T>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error("pick: arreglo vacío");
      return arr[Math.floor(next() * arr.length)] as T;
    },
  };
}
