import { describe, expect, it } from "vitest";

import { walkForwardBacktest } from "./backtest";
import { mulberry32 } from "./prng";

/** Deterministic synthetic returns — same generator pattern as the integration
 *  test, kept local so this file is self-contained. */
function syntheticReturns(T: number, N: number, seed: number): number[][] {
  const rng = mulberry32(seed);
  const drifts: number[] = [];
  const vols: number[] = [];
  for (let i = 0; i < N; i++) {
    drifts.push((0.08 + (0.12 * i) / Math.max(N - 1, 1)) / 252);
    vols.push(0.015 + (0.010 * i) / Math.max(N - 1, 1));
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
  const start = new Date("2020-01-02").getTime();
  for (let t = 0; t < T; t++) {
    const d = new Date(start + t * 24 * 3600 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe("walkForwardBacktest — guards", () => {
  it("returns null when total days < trainDays + testDays", () => {
    const X = syntheticReturns(100, 3, 1);
    const dates = fakeDates(100);
    const r = walkForwardBacktest({ X, dates, rf: 0.05, trainDays: 60, testDays: 63 });
    expect(r).toBeNull();
  });

  it("degenerate Σ (2 identical assets): walk-forward survives via the equal-weight fallback inside _solveMaxSharpe", () => {
    // Two perfectly correlated assets force the inner Markowitz solver
    // into the singular-Σ path. We require:
    //   1. The backtest does NOT return null (T is plenty).
    //   2. Every cumulative point is finite (no NaN propagation).
    //   3. Summary stats are finite and well-formed.
    //   4. Markowitz path matches the 1/N path exactly — the proof that
    //      _solveMaxSharpe fell back to equal-weight rather than failing
    //      silently with zero weights or returning a degenerate concentrated
    //      portfolio.
    const T = 1500;
    const X: number[][] = [];
    for (let t = 0; t < T; t++) {
      const v = Math.sin(t * 0.13) * 0.01;
      X.push([v, v]);
    }
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(T),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
    });
    expect(r).not.toBeNull();
    for (const pt of r!.series) {
      expect(Number.isFinite(pt.markowitz)).toBe(true);
      expect(Number.isFinite(pt.equalWeight)).toBe(true);
      // Equal-weight fallback ⇒ Markowitz path coincides with 1/N path
      expect(pt.markowitz).toBeCloseTo(pt.equalWeight, 10);
    }
    expect(Number.isFinite(r!.markowitz.retAnn)).toBe(true);
    expect(Number.isFinite(r!.markowitz.volAnn)).toBe(true);
    expect(r!.markowitz.volAnn).toBeGreaterThanOrEqual(0);
  });
});

describe("walkForwardBacktest — happy path", () => {
  it("produces a non-empty series with monotone-progressing dates", () => {
    const X = syntheticReturns(252 * 3, 5, 7);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
    });
    expect(r).not.toBeNull();
    expect(r!.series.length).toBeGreaterThan(0);
    for (let i = 1; i < r!.series.length; i++) {
      expect(r!.series[i].date >= r!.series[i - 1].date).toBe(true);
    }
  });

  it("Markowitz and equal-weight cumulative paths both end finite", () => {
    const X = syntheticReturns(252 * 3, 5, 13);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
    })!;
    const last = r.series[r.series.length - 1];
    expect(Number.isFinite(last.markowitz)).toBe(true);
    expect(Number.isFinite(last.equalWeight)).toBe(true);
  });

  it("summaries are well-formed: retAnn finite, volAnn ≥ 0, sharpe finite, maxDD ≤ 0", () => {
    const X = syntheticReturns(252 * 4, 6, 21);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
    })!;
    for (const summary of [r.markowitz, r.equalWeight]) {
      expect(Number.isFinite(summary.retAnn)).toBe(true);
      expect(summary.volAnn).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(summary.sharpe)).toBe(true);
      expect(summary.maxDD).toBeLessThanOrEqual(0);
    }
  });

  it("benchmark series is null when no benchmark is provided", () => {
    const X = syntheticReturns(252 * 3, 4, 33);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
    })!;
    expect(r.benchmark).toBeNull();
    for (const pt of r.series) expect(pt.benchmark).toBeNull();
  });

  it("benchmark series populated when benchmark daily log returns are passed", () => {
    const X = syntheticReturns(252 * 3, 4, 41);
    const bm: number[] = [];
    for (let t = 0; t < X.length; t++) bm.push(0.10 / 252 + Math.sin(t * 0.07) * 0.005);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
      benchmark: bm,
    })!;
    expect(r.benchmark).not.toBeNull();
    expect(Number.isFinite(r.benchmark!.retAnn)).toBe(true);
    for (const pt of r.series) {
      expect(pt.benchmark).not.toBeNull();
      expect(Number.isFinite(pt.benchmark!)).toBe(true);
    }
  });
});

describe("walkForwardBacktest — weight history, turnover, HHI, per-period returns", () => {
  it("emits weightHistory with one snapshot per rebalance period, aligned with tickers", () => {
    const X = syntheticReturns(252 * 3, 4, 51);
    const tickers = ["A", "B", "C", "D"];
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
      tickers,
    })!;
    expect(r.tickers).toEqual(tickers);
    expect(r.weightHistory.length).toBe(r.periods);
    for (const snap of r.weightHistory) {
      expect(snap.markowitz.length).toBe(4);
      expect(snap.equalWeight.length).toBe(4);
      // Each set of weights sums to 1 (long-only, normalised) modulo numeric slop
      const sMV = snap.markowitz.reduce((a, b) => a + b, 0);
      const sEW = snap.equalWeight.reduce((a, b) => a + b, 0);
      expect(sMV).toBeCloseTo(1, 6);
      expect(sEW).toBeCloseTo(1, 6);
      // 1/N weights are literally 1/N
      for (const w of snap.equalWeight) expect(w).toBeCloseTo(0.25, 10);
    }
  });

  it("1/N strategy has zero turnover by construction; Markowitz turnover is non-negative", () => {
    const X = syntheticReturns(252 * 4, 5, 71);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
    })!;
    expect(r.equalWeight.turnoverAnn).toBeCloseTo(0, 10);
    expect(r.markowitz.turnoverAnn).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.markowitz.turnoverAnn)).toBe(true);
  });

  it("1/N HHI equals 1/N exactly; Markowitz HHI is between 1/N and 1", () => {
    const N = 5;
    const X = syntheticReturns(252 * 4, N, 79);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
    })!;
    expect(r.equalWeight.meanHHI).toBeCloseTo(1 / N, 10);
    expect(r.markowitz.meanHHI).toBeGreaterThanOrEqual(1 / N - 1e-9);
    expect(r.markowitz.meanHHI).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("per-period simple returns are populated and consistent with cumulative path", () => {
    const X = syntheticReturns(252 * 3, 4, 83);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
    })!;
    // Compounding the per-period simple returns must reconstruct the cumulative
    // (1 + cum) series within float tolerance.
    let cumMV = 1;
    let cumEW = 1;
    for (const pt of r.series) {
      cumMV *= 1 + pt.markowitzPeriodReturn;
      cumEW *= 1 + pt.equalWeightPeriodReturn;
      expect(cumMV - 1).toBeCloseTo(pt.markowitz, 8);
      expect(cumEW - 1).toBeCloseTo(pt.equalWeight, 8);
      expect(Number.isFinite(pt.markowitzPeriodReturn)).toBe(true);
      expect(Number.isFinite(pt.equalWeightPeriodReturn)).toBe(true);
    }
  });

  it("default tickers are synthesised when none are passed", () => {
    const X = syntheticReturns(252 * 3, 3, 89);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.05,
      trainDays: 252,
      testDays: 63,
    })!;
    expect(r.tickers).toEqual(["A0", "A1", "A2"]);
  });
});

describe("walkForwardBacktest — three-stage shrinkage is applied at each rebalance", () => {
  it("Markowitz retAnn stays within a realistic band [-30%, +30%]", () => {
    // With the full Stages 1+2+3 shrinkage stack baked into _solveMaxSharpe,
    // the walk-forward cannot produce cartoon returns even on a deliberately
    // unfair synthetic. This is a regression test that the methodology page's
    // promised band is enforced by the backtest as well.
    const X = syntheticReturns(252 * 5, 8, 99);
    const r = walkForwardBacktest({
      X,
      dates: fakeDates(X.length),
      rf: 0.13,
      trainDays: 252 * 2,
      testDays: 63,
    })!;
    expect(r.markowitz.retAnn).toBeGreaterThan(-0.30);
    expect(r.markowitz.retAnn).toBeLessThan(0.30);
  });
});
