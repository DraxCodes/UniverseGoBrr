/**
 * A small seeded PRNG. Content must be reproducible from `(seed, address)` alone (ADR-0005), so
 * nothing may reach for `Math.random`. mulberry32 is used because it is 5 lines, identical on
 * every platform, and good enough for choosing a planet's axis — this is not cryptography.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** One element, uniformly. Throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick<T>(items: readonly T[]): T {
      const index = Math.floor(next() * items.length);
      const item = items[index];
      if (item === undefined) throw new Error('pick() received an empty list');
      return item;
    },
    chance: (p) => next() < p,
  };
}