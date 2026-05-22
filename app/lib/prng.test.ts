import { describe, expect, it } from "vitest";

import { defaultRng, DEFAULT_SEED, mulberry32 } from "./prng";

describe("mulberry32", () => {
  it("produces values in [0, 1)", () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("is deterministic with the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("produces different sequences with different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let diffs = 0;
    for (let i = 0; i < 100; i++) {
      if (a() !== b()) diffs++;
    }
    expect(diffs).toBeGreaterThan(95); // overwhelming majority differ
  });

  it("has a reasonable uniform distribution over many draws", () => {
    const rng = mulberry32(7);
    let sum = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) sum += rng();
    const mean = sum / N;
    // E[U(0,1)] = 0.5, std ≈ 1/sqrt(12)/√N ≈ 0.003 — 4 sigma band is generous
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});

describe("defaultRng", () => {
  it("returns a fresh RNG seeded with DEFAULT_SEED", () => {
    const a = defaultRng();
    const b = mulberry32(DEFAULT_SEED);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });
});
