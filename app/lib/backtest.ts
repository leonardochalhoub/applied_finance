/**
 * Walk-forward out-of-sample backtest of the Markowitz max-Sharpe portfolio
 * against 1/N (equal-weighted) and a user-supplied benchmark (e.g. IBOV).
 *
 * For each step:
 *   1. Estimate μ/Σ on a TRAINING window (e.g. last 5 years of daily returns
 *      ending at time t — strictly excluding the test period).
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

import { evaluatePortfolio } from "./markowitz";
import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "./mvEstimators";
import { solveLongOnlyMV } from "./qp";

export type BacktestPoint = {
  /** Date string (YYYY-MM-DD) at the END of this test window. */
  date: string;
  /** Cumulative return of Markowitz portfolio from start of backtest. */
  markowitz: number;
  /** Cumulative return of 1/N portfolio. */
  equalWeight: number;
  /** Cumulative return of benchmark (e.g. IBOV). null if not provided. */
  benchmark: number | null;
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
  const mu = js.mu;
  const muMin = Math.min(...mu);
  const muMax = Math.max(...mu);
  if (muMax <= muMin + 1e-6) return new Array(n).fill(1 / n);
  let bestSharpe = -Infinity;
  let bestW: number[] = new Array(n).fill(1 / n);
  const sweep = 10;
  for (let i = 0; i < sweep; i++) {
    const r = muMin + (i / (sweep - 1)) * (muMax - muMin);
    const w = solveLongOnlyMV(mu, sigmaAnnual, { targetReturn: r });
    const pt = evaluatePortfolio(w, mu, sigmaAnnual, rf);
    if (Number.isFinite(pt.sharpe) && pt.sharpe > bestSharpe) {
      bestSharpe = pt.sharpe;
      bestW = w;
    }
  }
  return bestW;
}

/** Compute summary stats from a series of period log returns. */
function _summary(periodLogReturns: number[], periodsPerYear: number, rf: number): BacktestSummary {
  if (periodLogReturns.length === 0) {
    return { retAnn: 0, volAnn: 0, sharpe: 0, maxDD: 0 };
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
  return { retAnn, volAnn, sharpe, maxDD };
}

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
  },
): BacktestResult | null {
  const trainDays = options.trainDays ?? 1260;
  const testDays = options.testDays ?? 63;
  const { X, dates, rf, benchmark } = options;
  const T = X.length;
  if (T < trainDays + testDays) return null;

  const series: BacktestPoint[] = [];
  let cumMV = 1;
  let cumEW = 1;
  let cumBM = 1;
  const periodMV: number[] = [];
  const periodEW: number[] = [];
  const periodBM: number[] = [];

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

    series.push({
      date: dates[start + testDays - 1] ?? dates[dates.length - 1],
      markowitz: cumMV - 1,
      equalWeight: cumEW - 1,
      benchmark: benchmark ? cumBM - 1 : null,
    });
  }

  const periodsPerYear = 252 / testDays;
  return {
    series,
    markowitz: _summary(periodMV, periodsPerYear, rf),
    equalWeight: _summary(periodEW, periodsPerYear, rf),
    benchmark: benchmark && periodBM.length > 0 ? _summary(periodBM, periodsPerYear, rf) : null,
    periods: series.length,
    trainDays,
    testDays,
  };
}
