import { describe, expect, it } from "vitest";

import { runIllusionExperiment } from "./illusion";
import { mulberry32 } from "./prng";

/** Synthetic Brazil-like daily log returns: one shared factor + idio, drifts
 *  spread between 8-20% a.a. so the optimizer has something to chase. */
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
  const start = new Date("2018-01-02").getTime();
  for (let t = 0; t < T; t++) {
    const d = new Date(start + t * 24 * 3600 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe("runIllusionExperiment — guards", () => {
  it("returns null when X.length < trainDays + testDays + 2", () => {
    const X = syntheticReturns(100, 4, 1);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D"],
      rf: 0.05,
      trainDays: 60,
      testDays: 50,
      nRandom: 100,
    });
    expect(r).toBeNull();
  });
});

describe("runIllusionExperiment — happy path", () => {
  it("produces a histogram and named portfolios on synthetic data", () => {
    const X = syntheticReturns(252 * 4, 5, 7);
    const tickers = ["A", "B", "C", "D", "E"];
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers,
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 500,
      histogramBins: 20,
    })!;
    expect(r).not.toBeNull();
    expect(r.tickers).toEqual(tickers);
    expect(r.randomSharpes.length).toBe(500);
    expect(r.histogram.length).toBe(20);
    expect(r.histogram.reduce((s, b) => s + b.count, 0)).toBe(500);
    expect(r.histogram.reduce((s, b) => s + b.freq, 0)).toBeCloseTo(1, 6);
  });

  it("randomSharpes is sorted ascending", () => {
    const X = syntheticReturns(252 * 4, 5, 11);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 300,
    })!;
    for (let i = 1; i < r.randomSharpes.length; i++) {
      expect(r.randomSharpes[i] >= r.randomSharpes[i - 1]).toBe(true);
    }
  });

  it("median random portfolio sits at percentile 0.5 (by construction)", () => {
    const X = syntheticReturns(252 * 4, 5, 13);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 1001,
    })!;
    expect(r.medianRandom.percentile).toBeCloseTo(0.5, 6);
  });

  it("Markowitz weights are long-only, sum to 1, and length = N", () => {
    const X = syntheticReturns(252 * 4, 6, 17);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 200,
    })!;
    expect(r.markowitzExAnte.weights.length).toBe(6);
    expect(r.markowitzExPost.weights.length).toBe(6);
    const s = r.markowitzExAnte.weights.reduce((a, b) => a + b, 0);
    expect(s).toBeCloseTo(1, 6);
    for (const w of r.markowitzExAnte.weights) {
      expect(w).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("1/N weights are exactly 1/N", () => {
    const X = syntheticReturns(252 * 4, 5, 19);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 200,
    })!;
    for (const w of r.equalWeight.weights) expect(w).toBeCloseTo(1 / 5, 10);
  });

  it("ex-ante Sharpe is ≥ ex-post Sharpe on synthetic IID data (regression to the mean)", () => {
    // The whole point of the exercise: when μ̂ is estimated, the optimizer
    // chases noise and the in-sample (ex-ante) Sharpe is upward-biased
    // relative to the out-of-sample (ex-post) Sharpe. On IID synthetics this
    // shouldn't be a strict inequality every time, but across runs it should
    // hold in the median; here a single seeded run is the regression target.
    const X = syntheticReturns(252 * 5, 8, 23);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F", "G", "H"],
      rf: 0.05,
      trainDays: 252 * 3,
      testDays: 252 * 2,
      nRandom: 300,
    })!;
    expect(r.markowitzExAnte.sharpe).toBeGreaterThanOrEqual(r.markowitzExPost.sharpe - 1e-9);
  });

  it("named percentiles are inside [0, 1]", () => {
    const X = syntheticReturns(252 * 4, 5, 29);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 500,
    })!;
    for (const p of [r.markowitzExAnte, r.markowitzExPost, r.equalWeight, r.medianRandom]) {
      expect(p.percentile).toBeGreaterThanOrEqual(0);
      expect(p.percentile).toBeLessThanOrEqual(1);
    }
  });

  it("determinism: same seed produces identical Sharpe distributions", () => {
    const X = syntheticReturns(252 * 4, 5, 31);
    const opts = {
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 200,
      seed: 12345,
    };
    const a = runIllusionExperiment(opts)!;
    const b = runIllusionExperiment(opts)!;
    expect(a.randomSharpes).toEqual(b.randomSharpes);
    expect(a.markowitzExPost.sharpe).toBe(b.markowitzExPost.sharpe);
  });
});

describe("runIllusionExperiment — concentrated null (Kahneman-friendly)", () => {
  it("emits dirichletNull and concentratedNull both with full structure", () => {
    const X = syntheticReturns(252 * 4, 8, 41);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F", "G", "H"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 300,
    })!;
    expect(r.dirichletNull).toBeDefined();
    expect(r.concentratedNull).toBeDefined();
    expect(r.dirichletNull.sharpes.length).toBe(300);
    expect(r.concentratedNull.sharpes.length).toBe(300);
    expect(r.dirichletNull.label).toContain("Dirichlet");
    expect(r.concentratedNull.label).toContain("Concentrada");
    // concentrationK falls into the documented range [2, floor(N/2)]
    expect(r.concentrationK).toBeGreaterThanOrEqual(2);
    expect(r.concentrationK).toBeLessThanOrEqual(Math.floor(8 / 2));
  });

  it("backwards compatibility: dirichletNull data matches the legacy randomSharpes/histogram", () => {
    const X = syntheticReturns(252 * 4, 5, 43);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 200,
    })!;
    expect(r.dirichletNull.sharpes).toEqual(r.randomSharpes);
    expect(r.dirichletNull.histogram).toEqual(r.histogram);
    expect(r.dirichletNull.markowitzExPostPercentile).toBe(
      r.markowitzExPost.percentile,
    );
  });

  it("concentrated null produces FATTER-TAILED Sharpe distribution than Dirichlet(1)", () => {
    // Concentrated K-bets carry higher idiosyncratic vol than diversified
    // Dirichlet(1) samples; the realized-Sharpe distribution should have a
    // wider range (more negative min, more positive max) under the
    // concentrated null. Tests on synthetic IID returns.
    const X = syntheticReturns(252 * 4, 10, 47);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252 * 2,
      nRandom: 1000,
    })!;
    const dirSpan =
      r.dirichletNull.sharpes[r.dirichletNull.sharpes.length - 1] -
      r.dirichletNull.sharpes[0];
    const conSpan =
      r.concentratedNull.sharpes[r.concentratedNull.sharpes.length - 1] -
      r.concentratedNull.sharpes[0];
    expect(conSpan).toBeGreaterThan(dirSpan);
  });

  it("markowitz percentile under concentrated null is materially DIFFERENT from Dirichlet percentile", () => {
    // The whole point of having two nulls is that they answer different
    // questions and yield different percentile rankings for the same
    // Markowitz Sharpe. We only assert that the two percentiles aren't
    // numerically identical (within tolerance) — direction depends on
    // data regime. On real B3 bull windows, concentrated < dirichlet;
    // on adversarial regimes the opposite can happen.
    const X = syntheticReturns(252 * 5, 12, 53);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: Array.from({ length: 12 }, (_, i) => `A${i}`),
      rf: 0.05,
      trainDays: 252 * 3,
      testDays: 252 * 2,
      nRandom: 1000,
    })!;
    const delta = Math.abs(
      r.concentratedNull.markowitzExPostPercentile -
        r.dirichletNull.markowitzExPostPercentile,
    );
    expect(delta).toBeGreaterThan(0.01);
  });

  it("concentrated null has all percentiles in [0,1] and median is the median", () => {
    const X = syntheticReturns(252 * 3, 6, 59);
    const r = runIllusionExperiment({
      X,
      dates: fakeDates(X.length),
      tickers: ["A", "B", "C", "D", "E", "F"],
      rf: 0.05,
      trainDays: 252 * 2,
      testDays: 252,
      nRandom: 500,
    })!;
    for (const p of [
      r.concentratedNull.markowitzExAntePercentile,
      r.concentratedNull.markowitzExPostPercentile,
      r.concentratedNull.equalWeightPercentile,
    ]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    const sorted = r.concentratedNull.sharpes;
    expect(r.concentratedNull.median).toBe(sorted[Math.floor(sorted.length / 2)]);
  });
});
