/**
 * Deterministic seeded PRNG for the `noise_m` mutation (E02-T4). We need
 * reproducible "randomness" (same seed -> byte-identical fix sequence) so
 * noise-mutated replays stay usable in CI; `Math.random()` cannot give us
 * that. mulberry32 is a small, well-known, dependency-free 32-bit PRNG
 * (public domain, widely used for exactly this kind of deterministic-fixture
 * need) -- no need to pull in a seeded-RNG package for one generator.
 */

export type Rng = () => number;

/** mulberry32: returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal (mean 0, stddev 1) sample via the Box-Muller transform,
 * drawing from `rng`. Deterministic for a deterministic `rng`.
 */
export function gaussianSample(rng: Rng): number {
  let u = 0;
  let v = 0;
  // rng() is in [0, 1); avoid log(0).
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
