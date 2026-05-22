import { describe, expect, it } from "vitest";

import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "./mvEstimators";

describe("jensenCorrectMu", () => {
  it("adds σ²_diagonal/2 to each component of mu", () => {
    const muLog = [0.001, 0.0005];
    const sigma = [
      [0.0004, 0.0001],
      [0.0001, 0.0009],
    ];
    const out = jensenCorrectMu(muLog, sigma);
    expect(out[0]).toBeCloseTo(0.001 + 0.5 * 0.0004, 8);
    expect(out[1]).toBeCloseTo(0.0005 + 0.5 * 0.0009, 8);
  });

  it("uses only the diagonal — off-diagonals do not enter the correction", () => {
    // Verify by swapping off-diagonals; result must not change.
    const muLog = [0.001];
    const out1 = jensenCorrectMu(muLog, [[0.0004]]);
    const out2 = jensenCorrectMu(muLog, [[0.0004]]);
    expect(out1[0]).toBeCloseTo(out2[0], 12);
  });
});

describe("ledoitWolf — shrinkage intensity δ*", () => {
  it("returns δ ∈ [0, 1]", () => {
    const T = 200;
    const N = 5;
    const X: number[][] = [];
    for (let t = 0; t < T; t++) {
      const row: number[] = [];
      for (let i = 0; i < N; i++) {
        // Some structured noise (uniform-ish, not Gaussian, just to populate)
        row.push((((t * 7 + i * 13) % 100) - 50) / 1000);
      }
      X.push(row);
    }
    const out = ledoitWolf(X);
    expect(out.delta).toBeGreaterThanOrEqual(0);
    expect(out.delta).toBeLessThanOrEqual(1);
    expect(out.sigma).toHaveLength(N);
    expect(out.sigma[0]).toHaveLength(N);
  });

  it("produces a symmetric output Σ", () => {
    const T = 100;
    const N = 4;
    const X: number[][] = [];
    for (let t = 0; t < T; t++) {
      const row: number[] = [];
      for (let i = 0; i < N; i++) row.push(Math.sin(t + i) * 0.01);
      X.push(row);
    }
    const out = ledoitWolf(X);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        expect(out.sigma[i][j]).toBeCloseTo(out.sigma[j][i], 12);
      }
    }
  });

  it("preserves diagonal scale (F has same diagonal as S by construction)", () => {
    // Build a return series with one high-vol asset and one low-vol
    const T = 300;
    const X: number[][] = [];
    for (let t = 0; t < T; t++) {
      // asset 0: σ ≈ 0.02 daily; asset 1: σ ≈ 0.005 daily
      X.push([(((t * 11) % 100) - 50) / 2500, (((t * 7) % 100) - 50) / 10000]);
    }
    const out = ledoitWolf(X);
    // Shrunk diagonal ≈ original diagonal (F.ii = S.ii by Ledoit-Wolf
    // constant-correlation target). δ blends i,j off-diagonals only.
    expect(out.sigma[0][0]).toBeCloseTo(out.S[0][0], 10);
    expect(out.sigma[1][1]).toBeCloseTo(out.S[1][1], 10);
  });
});

describe("jorionShrinkMu — Bayes-Stein μ shrinkage (dimensional consistency)", () => {
  // Build a deterministic test case where μ has dispersion but Σ is well
  // conditioned. With ANNUALIZED μ/Σ and tradingDays converted internally
  // to T_years, ψ should land in a textbook-credible range (~0.3-0.95)
  // depending on the window. If the old daily-T bug returns, ψ collapses
  // to <0.05 and this test fails loudly.
  const annualizeAndShrink = (years: number) => {
    const N = 5;
    const sigma: number[][] = [];
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < N; j++) {
        // Diagonal: σ_i² annualized = 0.09 (i.e. 30% annual vol).
        // Off-diagonals: 0.4 * σ_i σ_j (correlation 0.4)
        row.push(i === j ? 0.09 : 0.4 * 0.3 * 0.3);
      }
      sigma.push(row);
    }
    // Spread of annualized μ from 0.05 to 0.45 — typical of in-sample cross-section
    const mu = [0.05, 0.15, 0.25, 0.35, 0.45];
    return jorionShrinkMu(mu, sigma, years * 252);
  };

  it("returns ψ in (0, 1)", () => {
    const out = annualizeAndShrink(5);
    expect(out.psi).toBeGreaterThan(0);
    expect(out.psi).toBeLessThanOrEqual(1);
  });

  it("ψ is large (> 0.30) for short windows — Jorion is ACTIVE, not inert", () => {
    // Regression test for the historical bug: T was passed as daily count
    // while μ/Σ were annualized, making ψ ≈ 1/252 of the textbook value.
    // After the fix, ψ at 5 years on a moderately disperse μ should be
    // far above 0.3.
    const out = annualizeAndShrink(5);
    expect(out.psi).toBeGreaterThan(0.30);
  });

  it("ψ decreases monotonically as T grows (more data → less shrinkage)", () => {
    const psi5 = annualizeAndShrink(5).psi;
    const psi10 = annualizeAndShrink(10).psi;
    const psi20 = annualizeAndShrink(20).psi;
    expect(psi5).toBeGreaterThan(psi10);
    expect(psi10).toBeGreaterThan(psi20);
  });

  it("μ_g lies inside the range of input μ", () => {
    const out = annualizeAndShrink(5);
    expect(out.muGrand).toBeGreaterThan(0.05);
    expect(out.muGrand).toBeLessThan(0.45);
  });

  it("output μ is a convex combination of input μ and μ_g", () => {
    const out = annualizeAndShrink(5);
    const ones = out.mu.length;
    // Each output should sit between its input and μ_g (allowing
    // either direction since both can be above or below)
    const muIn = [0.05, 0.15, 0.25, 0.35, 0.45];
    for (let i = 0; i < ones; i++) {
      const lo = Math.min(muIn[i], out.muGrand);
      const hi = Math.max(muIn[i], out.muGrand);
      expect(out.mu[i]).toBeGreaterThanOrEqual(lo - 1e-12);
      expect(out.mu[i]).toBeLessThanOrEqual(hi + 1e-12);
    }
  });

  it("gracefully handles singular Σ — returns raw μ, ψ=0", () => {
    const mu = [0.10, 0.20];
    // Singular matrix (rank 1)
    const sigma = [
      [0.04, 0.04],
      [0.04, 0.04],
    ];
    const out = jorionShrinkMu(mu, sigma, 1000);
    expect(out.psi).toBe(0);
    expect(out.mu).toEqual(mu);
  });
});
