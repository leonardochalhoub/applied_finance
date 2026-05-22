import { describe, expect, it } from "vitest";

import { buildFrontier } from "./markowitz";
import { mulberry32 } from "./prng";

// Small canonical 3-asset universe for round-trip sanity checks.
const mu = [0.10, 0.15, 0.20];
const sigma = [
  [0.04, 0.01, 0.005],
  [0.01, 0.09, 0.015],
  [0.005, 0.015, 0.16],
];
const rf = 0.05;

describe("buildFrontier — basic shape", () => {
  it("returns min-variance, max-Sharpe, frontier, and cloud", () => {
    const fr = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 200 });
    expect(fr.minVariance.vol).toBeGreaterThan(0);
    expect(fr.maxSharpe.vol).toBeGreaterThan(0);
    expect(fr.frontier.length).toBeGreaterThan(0);
    expect(fr.cloud).toHaveLength(200);
  });

  it("min-variance.vol ≤ max-Sharpe.vol", () => {
    const fr = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 0 });
    expect(fr.minVariance.vol).toBeLessThanOrEqual(fr.maxSharpe.vol + 1e-9);
  });

  it("max-Sharpe.sharpe ≥ min-variance.sharpe (definition)", () => {
    const fr = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 0 });
    expect(fr.maxSharpe.sharpe).toBeGreaterThanOrEqual(fr.minVariance.sharpe - 1e-9);
  });

  it("long-only weights are all non-negative and sum to 1", () => {
    const fr = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 0 });
    for (const w of [fr.minVariance.weights, fr.maxSharpe.weights]) {
      const sum = w.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
      for (const wi of w) expect(wi).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("frontier vol-axis is monotone non-decreasing after sort", () => {
    const fr = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 0, frontierSteps: 40 });
    for (let i = 1; i < fr.frontier.length; i++) {
      expect(fr.frontier[i].vol).toBeGreaterThanOrEqual(fr.frontier[i - 1].vol - 1e-9);
    }
  });
});

describe("buildFrontier — reproducibility with seeded RNG", () => {
  it("same seed → identical cloud", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    const fr1 = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 50, rng: rng1 });
    const fr2 = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 50, rng: rng2 });
    for (let i = 0; i < fr1.cloud.length; i++) {
      expect(fr1.cloud[i].vol).toBe(fr2.cloud[i].vol);
      expect(fr1.cloud[i].ret).toBe(fr2.cloud[i].ret);
    }
  });

  it("different seeds → different clouds", () => {
    const fr1 = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 50, rng: mulberry32(1) });
    const fr2 = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 50, rng: mulberry32(2) });
    // Vanishingly small chance that two seeds produce identical clouds
    let differs = false;
    for (let i = 0; i < fr1.cloud.length; i++) {
      if (fr1.cloud[i].vol !== fr2.cloud[i].vol) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it("default RNG (no seed argument) is also deterministic", () => {
    const fr1 = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 30 });
    const fr2 = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 30 });
    expect(fr1.cloud[0].vol).toBe(fr2.cloud[0].vol);
    expect(fr1.cloud[29].vol).toBe(fr2.cloud[29].vol);
  });
});

describe("buildFrontier — degenerate weight fallback", () => {
  it("returns equal-weight portfolio (not zero) when greedy active-set fails", () => {
    // Construct a problem where every asset has μ below rf so unconstrained
    // max-Sharpe wants short everything — long-only must fall back gracefully.
    const muLow = [0.01, 0.005, 0.02]; // all below rf=0.05
    const fr = buildFrontier(muLow, sigma, 0.05, { longOnly: true, cloudSize: 0 });
    // Either we got a valid portfolio (>0 vol, sum=1) or the equal-weight fallback
    const sum = fr.maxSharpe.weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const w of fr.maxSharpe.weights) expect(w).toBeGreaterThanOrEqual(0);
    expect(fr.maxSharpe.vol).toBeGreaterThan(0);
  });
});

describe("buildFrontier — error contract", () => {
  it("throws when N < 2", () => {
    expect(() => buildFrontier([0.10], [[0.04]], rf)).toThrow();
  });

  it("throws when μ/Σ dimensions mismatch", () => {
    expect(() => buildFrontier([0.10, 0.15], [[0.04]], rf)).toThrow();
  });
});

describe("buildFrontier — greedy long-only matches analytical solution (2-asset diagonal Σ)", () => {
  // For 2 uncorrelated assets with μ_1, μ_2 > rf, the unconstrained tangency
  // portfolio weight on asset 1 is:
  //   w_1 = (μ_1 - rf) σ_2² / [ (μ_1 - rf) σ_2² + (μ_2 - rf) σ_1² ]
  // (when Σ is diagonal). The long-only optimum equals the unconstrained
  // optimum because both weights are already non-negative in this case. This
  // is the cleanest closed-form check that the greedy active-set is not
  // just returning something stable but actually returning the correct
  // analytical answer.
  it("max-Sharpe weights match the diagonal-Σ closed form within 1e-6", () => {
    const muA = 0.15;
    const muB = 0.20;
    const rfLocal = 0.05;
    const sigA = 0.04; // variance
    const sigB = 0.09;
    const muLocal = [muA, muB];
    const sigmaLocal = [
      [sigA, 0],
      [0, sigB],
    ];
    const fr = buildFrontier(muLocal, sigmaLocal, rfLocal, {
      longOnly: true,
      cloudSize: 0,
      frontierSteps: 20,
    });
    const num = (muA - rfLocal) * sigB;
    const den = (muA - rfLocal) * sigB + (muB - rfLocal) * sigA;
    const wAExpected = num / den;
    const wBExpected = 1 - wAExpected;
    expect(fr.maxSharpe.weights[0]).toBeCloseTo(wAExpected, 6);
    expect(fr.maxSharpe.weights[1]).toBeCloseTo(wBExpected, 6);
  });

  it("min-variance weights match the diagonal-Σ closed form within 1e-6", () => {
    // For diagonal Σ, the unconstrained min-variance allocation is
    //   w_i = (1/σ_i²) / Σ_j (1/σ_j²)
    const sigA = 0.04;
    const sigB = 0.09;
    const muLocal = [0.10, 0.15];
    const sigmaLocal = [
      [sigA, 0],
      [0, sigB],
    ];
    const fr = buildFrontier(muLocal, sigmaLocal, 0.05, {
      longOnly: true,
      cloudSize: 0,
      frontierSteps: 20,
    });
    const wAExpected = (1 / sigA) / (1 / sigA + 1 / sigB);
    const wBExpected = 1 - wAExpected;
    expect(fr.minVariance.weights[0]).toBeCloseTo(wAExpected, 6);
    expect(fr.minVariance.weights[1]).toBeCloseTo(wBExpected, 6);
  });
});
