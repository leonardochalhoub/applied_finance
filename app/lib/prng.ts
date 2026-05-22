/**
 * Seedable pseudo-random number generator (mulberry32) for reproducible
 * Monte Carlo / bootstrap operations.
 *
 * Why this exists: the bootstrap envelope and the random portfolio cloud
 * are visualisations that users will screenshot, share, and compare. With
 * `Math.random()` every page reload produces a different cloud and a
 * different bootstrap confidence interval — same data, different chart.
 * That breaks reproducibility and (worse) can flip advisor recommendations
 * across reloads when a weight is near the 2·σ_bootstrap gate.
 *
 * mulberry32 is a tiny (one-line) PRNG with a 32-bit state, period 2³² ≈
 * 4·10⁹, and passes most randomness tests fine for our use case. We use a
 * FIXED default seed so every page load produces the same chart. Callers
 * who want session-level non-determinism (e.g. unit tests that need fresh
 * draws) can pass an explicit seed.
 *
 * Reference: https://stackoverflow.com/a/47593316 (Tommy Ettinger 2017)
 */

export type Rng = () => number;

/** Build a deterministic Math.random()-compatible RNG seeded with `seed`. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Default deterministic RNG shared by the bootstrap and the frontier cloud.
 * Fixed seed = stable visualisation across page reloads with identical
 * inputs.
 *
 * Chosen seed (`0xCAFEFEED`) is arbitrary but documented so a reviewer can
 * verify a chart by re-deriving the cloud manually.
 */
export const DEFAULT_SEED = 0xcafefeed;

/** Convenience: a fresh default-seeded RNG instance. */
export function defaultRng(): Rng {
  return mulberry32(DEFAULT_SEED);
}
