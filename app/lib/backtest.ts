/**
 * Walk-forward out-of-sample backtest of the Markowitz max-Sharpe portfolio
 * against 1/N (equal-weighted) and a user-supplied benchmark (e.g. IBOV).
 *
 * For each step:
 *   1. Estimate μ/Σ on a TRAINING window (e.g. last 5 years of daily returns
 *      ending at time t — strictly excluding the test period). The full
 *      three-stage μ pipeline is applied: Ledoit-Wolf Σ + Jensen + annualize
 *      (Stage 0) → Jorion shrinkage (Stage 1) → macro-anchor + per-asset
 *      ceiling via `applyMacroAnchor` (Stages 2 + 3). Same pipeline as the
 *      displayed frontier and the bootstrap envelope.
 *   2. Solve the long-only max-Sharpe portfolio under that μ/Σ.
 *   3. Hold those weights through the next TEST window (e.g. next quarter).
 *   4. Roll forward by the test window length and repeat.
 *
 * Output: cumulative return time series for (Markowitz, 1/N, benchmark), plus
 * summary stats (annualized return, vol, Sharpe, max drawdown).
 *
 * Reference: DeMiguel, Garlappi & Uppal (2009) "Optimal Versus Naive
 * Diversification" — uses this exact setup to show 1/N often beats sample-
 * based Markowitz out-of-sample. We give the user the actual chart so they
 * can see whether the platform's "optimal" suggestions would have actually
 * outperformed naive diversification on their universe.
 */

import { buildFrontier } from "./markowitz";
import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "./mvEstimators";
import { applyMacroAnchor } from "./shrinkage";

export type BacktestPoint = {
  /** Date string (YYYY-MM-DD) at the END of this test window. */
  date: string;
  /** Cumulative return of Markowitz portfolio from start of backtest. */
  markowitz: number;
  /** Cumulative return of 1/N portfolio. */
  equalWeight: number;
  /** Cumulative return of benchmark (e.g. IBOV). null if not provided. */
  benchmark: number | null;
  /** Per-period simple return realised IN THIS WINDOW (not cumulative). */
  markowitzPeriodReturn: number;
  /** Per-period simple return realised IN THIS WINDOW (not cumulative). */
  equalWeightPeriodReturn: number;
  /** Per-period simple return of the benchmark for this window. */
  benchmarkPeriodReturn: number | null;
};

export type BacktestSummary = {
  /** Annualized return (geometric). */
  retAnn: number;
  /** Annualized vol of period returns. */
  volAnn: number;
  /** Sharpe = (retAnn - rf) / volAnn. */
  sharpe: number;
  /** Maximum drawdown (negative number). */
  maxDD: number;
  /** Annualized one-way turnover: average per-rebalance L1 weight change ÷ 2,
   *  multiplied by rebalances per year. Equal-weight has turnover ≈ 0 by
   *  construction. Markowitz typically ranges 1-3× per year on noisy μ̂. */
  turnoverAnn: number;
  /** Average Herfindahl-Hirschman Index of the held weights across rebalances.
   *  HHI = Σ w_i². 1/N has HHI = 1/N (minimum diversification index for a
   *  long-only book); concentrated MV solutions push HHI toward 1. */
  meanHHI: number;
};

export type WeightSnapshot = {
  /** Date stamp at the END of the holding window in which these weights were active. */
  date: string;
  markowitz: number[];
  equalWeight: number[];
};

export type BacktestResult = {
  series: BacktestPoint[];
  markowitz: BacktestSummary;
  equalWeight: BacktestSummary;
  benchmark: BacktestSummary | null;
  /** Number of rebalance periods covered. */
  periods: number;
  /** Training window length in days. */
  trainDays: number;
  /** Test window length in days. */
  testDays: number;
  /** Per-rebalance weight snapshots, aligned with `tickers`. */
  weightHistory: WeightSnapshot[];
  /** Ticker labels aligned with the columns of every weight vector. */
  tickers: string[];
};

function _solveMaxSharpe(X: number[][], rf: number): number[] {
  const lw = ledoitWolf(X);
  const Tn = X.length;
  const n = X[0].length;
  const meanLog = new Array(n).fill(0);
  for (const row of X) {
    for (let i = 0; i < n; i++) meanLog[i] += row[i];
  }
  for (let i = 0; i < n; i++) meanLog[i] /= Tn;
  const meanSimple = jensenCorrectMu(meanLog, lw.sigma);
  const muAnnual = meanSimple.map((m) => m * 252);
  const sigmaAnnual = lw.sigma.map((row) => row.map((v) => v * 252));
  const js = jorionShrinkMu(muAnnual, sigmaAnnual, Tn);
  // Stage 2 (macro-anchor) + Stage 3 (per-asset ceiling). Same helper used by
  // the displayed frontier and the bootstrap envelope — without it the walk-
  // forward optimisation would re-introduce the very 60-100% in-sample μ that
  // the rest of the pipeline is engineered to neutralise.
  const { mu } = applyMacroAnchor(js.mu, rf, Tn);
  try {
    const fr = buildFrontier(mu, sigmaAnnual, rf, {
      longOnly: true,
      cloudSize: 0,
      frontierSteps: 12,
    });
    return fr.maxSharpe.weights;
  } catch {
    return new Array(n).fill(1 / n);
  }
}

/** Average one-way turnover per rebalance × rebalances per year.
 *  At each step t we compute Σ_i |w_i(t) − w_i(t−1)| / 2 — the "one-way"
 *  convention (a 50% rotation counts as 50%, not 100%). The first rebalance
 *  is excluded since there is no prior holding to compare against. */
function _turnoverAnnualized(weights: number[][], periodsPerYear: number): number {
  if (weights.length < 2) return 0;
  let total = 0;
  for (let t = 1; t < weights.length; t++) {
    let oneWay = 0;
    const prev = weights[t - 1];
    const cur = weights[t];
    const n = Math.max(prev.length, cur.length);
    for (let i = 0; i < n; i++) {
      const a = prev[i] ?? 0;
      const b = cur[i] ?? 0;
      oneWay += Math.abs(b - a);
    }
    total += oneWay / 2;
  }
  const avgPerRebalance = total / (weights.length - 1);
  return avgPerRebalance * periodsPerYear;
}

/** Mean Herfindahl-Hirschman concentration index across rebalances. */
function _meanHHI(weights: number[][]): number {
  if (weights.length === 0) return 0;
  let acc = 0;
  for (const w of weights) {
    let h = 0;
    for (const wi of w) h += wi * wi;
    acc += h;
  }
  return acc / weights.length;
}

/** Compute summary stats from a series of period log returns. */
function _summary(periodLogReturns: number[], periodsPerYear: number, rf: number): BacktestSummary {
  if (periodLogReturns.length === 0) {
    return { retAnn: 0, volAnn: 0, sharpe: 0, maxDD: 0, turnoverAnn: 0, meanHHI: 0 };
  }
  const cumulative: number[] = [1];
  for (const r of periodLogReturns) {
    cumulative.push(cumulative[cumulative.length - 1] * Math.exp(r));
  }
  const totalLog = cumulative[cumulative.length - 1] / cumulative[0];
  const years = periodLogReturns.length / periodsPerYear;
  const retAnn = years > 0 ? Math.pow(totalLog, 1 / years) - 1 : 0;
  const mean = periodLogReturns.reduce((a, b) => a + b, 0) / periodLogReturns.length;
  const variance =
    periodLogReturns.reduce((s, r) => s + (r - mean) * (r - mean), 0) /
    Math.max(periodLogReturns.length - 1, 1);
  const volAnn = Math.sqrt(variance * periodsPerYear);
  const sharpe = volAnn > 0 ? (retAnn - rf) / volAnn : 0;
  // Max drawdown over cumulative path
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of cumulative) {
    if (v > peak) peak = v;
    const dd = (v - peak) / Math.max(peak, 1e-12);
    if (dd < maxDD) maxDD = dd;
  }
  return { retAnn, volAnn, sharpe, maxDD, turnoverAnn: 0, meanHHI: 0 };
}

/**
 * Run a walk-forward out-of-sample backtest of the long-only max-Sharpe
 * Markowitz portfolio against the 1/N benchmark (and optionally a market
 * index like IBOV).
 *
 * The function slides a `trainDays`-wide window through `X`, re-fits the
 * full three-stage shrinkage pipeline (Ledoit-Wolf Σ + Jensen + Jorion +
 * macro-anchor + per-asset ceiling) at every step, picks the resulting
 * max-Sharpe weights, holds them through the next `testDays`-wide test
 * window, then rolls forward. Mirrors the production frontier exactly so
 * the displayed backtest result is comparable with the live recommendation.
 *
 * @param options.X            T × N matrix of daily log returns (rows = days, cols = tickers).
 * @param options.dates        Aligned date strings (length T), used to stamp the output series.
 * @param options.benchmark    Optional daily log-returns of a comparison index (length T). Pass `null` for any missing days.
 * @param options.trainDays    Length of the training window. Default 1260 (5 years).
 * @param options.testDays     Length of the test (holding) window. Default 63 (~1 quarter).
 * @param options.rf           Annualised risk-free rate for the Sharpe in summaries.
 *
 * @returns A `BacktestResult` with the cumulative-return time series and
 *          summary stats for Markowitz, 1/N, and the optional benchmark.
 *          Returns `null` when `X.length < trainDays + testDays` (not
 *          enough data for at least one walk-forward step).
 */
export function walkForwardBacktest(
  options: {
    /** T × N matrix of daily log returns (rows = days, cols = tickers). */
    X: number[][];
    /** Aligned date strings (length T). */
    dates: string[];
    /** Benchmark daily log returns (length T) — e.g. IBOV. Optional. */
    benchmark?: (number | null)[];
    /** Training window in trading days. Default 1260 (5 years). */
    trainDays?: number;
    /** Test window in trading days. Default 63 (1 quarter). */
    testDays?: number;
    /** Risk-free rate (annualized) for Sharpe. */
    rf: number;
    /** Optional ticker labels (length N), copied into `BacktestResult.tickers`
     *  so the UI can label weight history without holding a parallel array.
     *  Defaults to ["A0", "A1", ..., "A(N-1)"] when not provided. */
    tickers?: string[];
  },
): BacktestResult | null {
  const trainDays = options.trainDays ?? 1260;
  const testDays = options.testDays ?? 63;
  const { X, dates, rf, benchmark } = options;
  const T = X.length;
  if (T < trainDays + testDays) return null;
  const N = X[0]?.length ?? 0;
  const tickers =
    options.tickers && options.tickers.length === N
      ? options.tickers.slice()
      : Array.from({ length: N }, (_, i) => `A${i}`);

  const series: BacktestPoint[] = [];
  const weightHistory: WeightSnapshot[] = [];
  let cumMV = 1;
  let cumEW = 1;
  let cumBM = 1;
  const periodMV: number[] = [];
  const periodEW: number[] = [];
  const periodBM: number[] = [];
  const mvWeightsByPeriod: number[][] = [];
  const ewWeightsByPeriod: number[][] = [];

  for (let start = trainDays; start + testDays <= T; start += testDays) {
    const trainX = X.slice(start - trainDays, start);
    const testX = X.slice(start, start + testDays);
    if (trainX.length < 60) continue;
    const n = trainX[0].length;

    const wMV = _solveMaxSharpe(trainX, rf);
    const wEW = new Array(n).fill(1 / n);

    // Realized portfolio log return over the test window:
    // simple-return version: r_p = Σ w_i · (exp(sum_t r_log_it) - 1), then ln(1 + r_p).
    // We compute each ticker's cumulative log over test then go to simple, blend, log back.
    const tickerCumLog = new Array(n).fill(0);
    for (let t = 0; t < testX.length; t++) {
      for (let i = 0; i < n; i++) {
        const r = testX[t][i];
        if (Number.isFinite(r)) tickerCumLog[i] += r;
      }
    }
    const tickerSimple = tickerCumLog.map((c) => Math.exp(c) - 1);
    let pMV = 0;
    let pEW = 0;
    for (let i = 0; i < n; i++) {
      pMV += wMV[i] * tickerSimple[i];
      pEW += wEW[i] * tickerSimple[i];
    }
    const logMV = Math.log(1 + Math.max(pMV, -0.99));
    const logEW = Math.log(1 + Math.max(pEW, -0.99));

    let logBM: number | null = null;
    if (benchmark) {
      let cum = 0;
      let any = false;
      for (let t = 0; t < testX.length; t++) {
        const v = benchmark[start + t];
        if (v != null && Number.isFinite(v)) {
          cum += v;
          any = true;
        }
      }
      if (any) logBM = cum;
    }

    cumMV *= Math.exp(logMV);
    cumEW *= Math.exp(logEW);
    if (logBM != null) cumBM *= Math.exp(logBM);
    periodMV.push(logMV);
    periodEW.push(logEW);
    if (logBM != null) periodBM.push(logBM);

    const periodDate = dates[start + testDays - 1] ?? dates[dates.length - 1];
    series.push({
      date: periodDate,
      markowitz: cumMV - 1,
      equalWeight: cumEW - 1,
      benchmark: benchmark ? cumBM - 1 : null,
      markowitzPeriodReturn: pMV,
      equalWeightPeriodReturn: pEW,
      benchmarkPeriodReturn: logBM != null ? Math.exp(logBM) - 1 : null,
    });
    mvWeightsByPeriod.push(wMV.slice());
    ewWeightsByPeriod.push(wEW.slice());
    weightHistory.push({ date: periodDate, markowitz: wMV.slice(), equalWeight: wEW.slice() });
  }

  const periodsPerYear = 252 / testDays;
  const mvSummary = _summary(periodMV, periodsPerYear, rf);
  const ewSummary = _summary(periodEW, periodsPerYear, rf);
  mvSummary.turnoverAnn = _turnoverAnnualized(mvWeightsByPeriod, periodsPerYear);
  ewSummary.turnoverAnn = _turnoverAnnualized(ewWeightsByPeriod, periodsPerYear);
  mvSummary.meanHHI = _meanHHI(mvWeightsByPeriod);
  ewSummary.meanHHI = _meanHHI(ewWeightsByPeriod);
  return {
    series,
    markowitz: mvSummary,
    equalWeight: ewSummary,
    benchmark: benchmark && periodBM.length > 0 ? _summary(periodBM, periodsPerYear, rf) : null,
    periods: series.length,
    trainDays,
    testDays,
    weightHistory,
    tickers,
  };
}
