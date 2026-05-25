import { describe, expect, it } from "vitest";

import { equalRiskContribution, inverseVolatilityWeights, riskContributions } from "./riskparity";

function diag(d: number[]): number[][] {
  return d.map((v, i) => d.map((_, j) => (i === j ? v : 0)));
}

function randCov(n: number, seed: number): number[][] {
  // Generate a random PD matrix as A·Aᵀ + diag(εI)
  let a = seed | 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n);
    for (let j = 0; j < n; j++) row[j] = rand() - 0.5;
    A.push(row);
  }
  // Σ = A Aᵀ / n + 0.05 I
  const sigma: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n);
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += A[i][k] * A[j][k];
      row[j] = s / n + (i === j ? 0.05 : 0);
    }
    sigma.push(row);
  }
  return sigma;
}

describe("riskContributions", () => {
  it("RC sums to 1 (long-only, normalised weights)", () => {
    const sigma = diag([0.04, 0.09, 0.16]);
    const w = [0.5, 0.3, 0.2];
    const { rc } = riskContributions(w, sigma);
    expect(rc.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("vol matches √(wᵀΣw)", () => {
    const sigma = diag([0.04, 0.09]);
    const w = [0.6, 0.4];
    const { vol } = riskContributions(w, sigma);
    expect(vol).toBeCloseTo(Math.sqrt(0.6 * 0.6 * 0.04 + 0.4 * 0.4 * 0.09), 10);
  });

  it("for a diagonal Σ, RC_i = w_i² σ_ii² / total — sanity on shape", () => {
    const sigma = diag([0.04, 0.16]);
    const w = [0.5, 0.5];
    const { rc } = riskContributions(w, sigma);
    // total = 0.25*0.04 + 0.25*0.16 = 0.05; RC_0 = 0.01/0.05 = 0.2; RC_1 = 0.04/0.05 = 0.8
    expect(rc[0]).toBeCloseTo(0.2, 10);
    expect(rc[1]).toBeCloseTo(0.8, 10);
  });
});

describe("inverseVolatilityWeights", () => {
  it("weights are proportional to 1/σ_i, sum to 1", () => {
    const sigma = diag([0.04, 0.16, 0.25]); // σ_i = 0.2, 0.4, 0.5
    const w = inverseVolatilityWeights(sigma);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    // Ratios: 1/0.2 : 1/0.4 : 1/0.5 = 5 : 2.5 : 2 — high-vol gets less weight
    expect(w[0] / w[1]).toBeCloseTo(5 / 2.5, 6);
    expect(w[0] / w[2]).toBeCloseTo(5 / 2, 6);
  });

  it("equal-volatility assets produce equal weights", () => {
    const sigma = diag([0.09, 0.09, 0.09, 0.09]);
    const w = inverseVolatilityWeights(sigma);
    for (const wi of w) expect(wi).toBeCloseTo(0.25, 10);
  });
});

describe("equalRiskContribution — closed-form sanity (diagonal Σ)", () => {
  it("ERC on diagonal Σ matches inverse-volatility weights closely", () => {
    // For diagonal Σ, ERC is exactly inverse-volatility.
    const sigma = diag([0.04, 0.09, 0.16, 0.25]);
    const erc = equalRiskContribution(sigma);
    const inv = inverseVolatilityWeights(sigma);
    for (let i = 0; i < erc.length; i++) {
      expect(erc[i]).toBeCloseTo(inv[i], 4);
    }
  });

  it("All risk contributions equal 1/N at convergence (diagonal)", () => {
    const sigma = diag([0.04, 0.09, 0.16]);
    const erc = equalRiskContribution(sigma, undefined, { tol: 1e-9 });
    const { rc } = riskContributions(erc, sigma);
    for (const r of rc) expect(r).toBeCloseTo(1 / 3, 4);
  });
});

describe("equalRiskContribution — random PD matrices", () => {
  it("All risk contributions equal 1/N at convergence (N=5, correlated)", () => {
    const sigma = randCov(5, 42);
    const erc = equalRiskContribution(sigma, undefined, { tol: 1e-9, maxSweeps: 500 });
    const { rc } = riskContributions(erc, sigma);
    for (const r of rc) expect(r).toBeCloseTo(1 / 5, 3);
  });

  it("Weights are non-negative and sum to 1", () => {
    const sigma = randCov(8, 77);
    const erc = equalRiskContribution(sigma);
    let s = 0;
    for (const w of erc) {
      expect(w).toBeGreaterThanOrEqual(0);
      s += w;
    }
    expect(s).toBeCloseTo(1, 8);
  });

  it("Custom target risk contributions are respected", () => {
    // Target = (0.5, 0.3, 0.2) — the first asset takes half the variance.
    const sigma = randCov(3, 99);
    const target = [0.5, 0.3, 0.2];
    const w = equalRiskContribution(sigma, target, { tol: 1e-9, maxSweeps: 500 });
    const { rc } = riskContributions(w, sigma);
    expect(rc[0]).toBeCloseTo(0.5, 3);
    expect(rc[1]).toBeCloseTo(0.3, 3);
    expect(rc[2]).toBeCloseTo(0.2, 3);
  });
});
