import { describe, expect, it } from "vitest";

import { runRollingPersistenceExperiment } from "./persistence";
import { mulberry32 } from "./prng";

function syntheticReturns(T: number, N: number, seed: number): number[][] {
  const rng = mulberry32(seed);
  const drifts: number[] = [];
  const vols: number[] = [];
  for (let i = 0; i < N; i++) {
    drifts.push((0.08 + (0.12 * i) / Math.max(N - 1, 1)) / 252);
    vols.push(0.015 + (0.01 * i) / Math.max(N - 1, 1));
  }
  const X: number[][] = [];
  for (let t = 0; t < T; t++) {
    const common = (rng() - 0.5) * 2;
    const row: number[] = [];
    for (let i = 0; i < N; i++) {
      const idio = (rng() - 0.5) * 2;
      const eps = 0.6 * common + 0.8 * idio;
      row.push(drifts[i] + vols[i] * eps);
    }
    X.push(row);
  }
  return X;
}

function fakeDates(T: number): string[] {
  const out: string[] = [];
  const start = new Date("2010-01-04").getTime();
  for (let t = 0; t < T; t++) {
    const d = new Date(start + t * 24 * 3600 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe("runRollingPersistenceExperiment — guards", () => {
  it("returns null when total length < trainDays + testDays", () => {
    const X = syntheticReturns(100, 5, 1);
    const r = runRollingPersistenceExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E"],
      rf: 0.05,
      trainDays: 60,
      testDays: 60,
    });
    expect(r).toBeNull();
  });

  it("returns null when N < 2", () => {
    const X = syntheticReturns(252 * 5, 1, 3);
    const r = runRollingPersistenceExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A"],
      rf: 0.05,
    });
    expect(r).toBeNull();
  });
});

describe("runRollingPersistenceExperiment — happy path", () => {
  it("produces multiple windows with monotone-progressing test starts", () => {
    const X = syntheticReturns(252 * 8, 8, 7);
    const r = runRollingPersistenceExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F", "G", "H"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      stepDays: 252,
      nRandom: 300,
    });
    expect(r).not.toBeNull();
    expect(r!.windows.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < r!.windows.length; i++) {
      expect(r!.windows[i].testStart >= r!.windows[i - 1].testStart).toBe(true);
    }
  });

  it("ex-ante ≥ ex-post on synthetic data in each window (Kan-Smith bias)", () => {
    const X = syntheticReturns(252 * 8, 10, 11);
    const r = runRollingPersistenceExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: Array.from({ length: 10 }, (_, i) => `A${i}`),
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      stepDays: 252 * 2,
      nRandom: 200,
    })!;
    // On IID synthetic data with no real regime persistence, ex-ante
    // should systematically exceed ex-post (the classical bias).
    let countAnteAtLeastPost = 0;
    for (const w of r.windows) {
      if (w.sharpeExAnte >= w.sharpeExPost - 1e-9) countAnteAtLeastPost++;
    }
    expect(countAnteAtLeastPost).toBeGreaterThanOrEqual(
      Math.floor(r.windows.length * 0.6),
    );
  });

  it("percentile autocorrelation is finite and in [-1, 1]", () => {
    const X = syntheticReturns(252 * 10, 8, 13);
    const r = runRollingPersistenceExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F", "G", "H"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      stepDays: 252,
      nRandom: 200,
    })!;
    expect(Number.isFinite(r.percentileLag1Autocorr)).toBe(true);
    expect(r.percentileLag1Autocorr).toBeGreaterThanOrEqual(-1);
    expect(r.percentileLag1Autocorr).toBeLessThanOrEqual(1);
  });

  it("Jaccard adjacency mean is in [0, 1]", () => {
    const X = syntheticReturns(252 * 8, 6, 17);
    const r = runRollingPersistenceExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      stepDays: 252,
      nRandom: 200,
    })!;
    expect(r.jaccardAdjacentMean).toBeGreaterThanOrEqual(0);
    expect(r.jaccardAdjacentMean).toBeLessThanOrEqual(1);
  });

  it("topKTickers in each window is non-empty and bounded by effectiveK", () => {
    const X = syntheticReturns(252 * 8, 12, 19);
    const r = runRollingPersistenceExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: Array.from({ length: 12 }, (_, i) => `A${i}`),
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      stepDays: 252 * 2,
      nRandom: 200,
    })!;
    for (const w of r.windows) {
      expect(w.topKTickers.length).toBeGreaterThan(0);
      expect(w.topKTickers.length).toBe(w.effectiveK);
      // effectiveK in [2, floor(N/2)] = [2, 6]
      expect(w.effectiveK).toBeGreaterThanOrEqual(2);
      expect(w.effectiveK).toBeLessThanOrEqual(6);
    }
  });

  it("mvBeatsEqWeightFrac is in [0, 1]", () => {
    const X = syntheticReturns(252 * 8, 6, 23);
    const r = runRollingPersistenceExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      stepDays: 252 * 2,
      nRandom: 200,
    })!;
    expect(r.mvBeatsEqWeightFrac).toBeGreaterThanOrEqual(0);
    expect(r.mvBeatsEqWeightFrac).toBeLessThanOrEqual(1);
  });

  it("determinism: same seed produces identical windows array", () => {
    const X = syntheticReturns(252 * 6, 6, 29);
    const opts = {
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      stepDays: 252,
      nRandom: 150,
      seed: 42,
    };
    const a = runRollingPersistenceExperiment(opts)!;
    const b = runRollingPersistenceExperiment(opts)!;
    expect(a.windows.length).toBe(b.windows.length);
    for (let i = 0; i < a.windows.length; i++) {
      expect(a.windows[i].sharpeExPost).toBe(b.windows[i].sharpeExPost);
      expect(a.windows[i].percentileConcentrated).toBe(
        b.windows[i].percentileConcentrated,
      );
    }
  });
});
