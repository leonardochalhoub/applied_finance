/**
 * Bootstrap resampling for Markowitz portfolio weights and frontier points.
 *
 * Markowitz mean-variance is famously sensitive to estimation error in μ and Σ.
 * Resampling (Michaud 1998) and statistical bootstrap (Efron 1979) give a
 * principled way to quantify how much of a portfolio's "optimality" is
 * actually statistical noise.
 *
 * Pipeline per bootstrap sample:
 *   1. Resample T daily observations with replacement from the original X
 *      (T × N matrix of daily log returns).
 *   2. Apply the SAME estimation chain as the main pipeline:
 *      Ledoit-Wolf on Σ, Jensen correction on μ, annualize, Jorion shrink μ.
 *   3. Solve the SAME optimization problem (long-only max-Sharpe or target).
 *   4. Store the resulting weight vector + portfolio (vol, ret, sharpe).
 *
 * After B samples we get:
 *   - per-weight distribution (mean, std, quantiles) — for advisor significance.
 *   - per-frontier-point envelope — for shaded confidence bands on the chart.
 */

import { evaluatePortfolio } from "./markowitz";
import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "./mvEstimators";
import { solveLongOnlyMV } from "./qp";

export type BootstrapWeightStats = {
  /** Mean weight across resamples. */
  mean: number;
  /** Std-dev of weight across resamples. */
  std: number;
  /** 5th percentile. */
  q05: number;
  /** 95th percentile. */
  q95: number;
};

export type BootstrapResult = {
  /** Number of resamples actually run. */
  B: number;
  /** Per-ticker weight distribution summaries (length = N). */
  weights: BootstrapWeightStats[];
  /** Per-frontier-target return envelope (lower/upper bound on vol). */
  frontierBand?: { ret: number; volLo: number; volHi: number; volMean: number }[];
};

function _resample(X: number[][]): number[][] {
  const T = X.length;
  const out: number[][] = new Array(T);
  for (let i = 0; i < T; i++) {
    const idx = Math.floor(Math.random() * T);
    out[i] = X[idx];
  }
  return out;
}

function _estimate(X: number[][]): { mu: number[]; sigma: number[][] } {
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
  return { mu: js.mu, sigma: sigmaAnnual };
}

function _percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx];
}

/**
 * Bootstrap the long-only MAX-SHARPE portfolio over the same window.
 * Returns per-ticker weight distributions usable for significance testing
 * in the advisor.
 */
export function bootstrapMaxSharpe(
  X: number[][],
  rf: number,
  B = 200,
): BootstrapResult {
  const T = X.length;
  const n = X[0].length;
  if (T < 30 || n < 2) {
    return { B: 0, weights: Array.from({ length: n }, () => ({ mean: 0, std: 0, q05: 0, q95: 0 })) };
  }
  const allWeights: number[][] = [];
  for (let b = 0; b < B; b++) {
    const Xb = _resample(X);
    const { mu, sigma } = _estimate(Xb);
    // Find max-Sharpe by sweeping target returns over the long-only frontier
    const muMin = Math.min(...mu);
    const muMax = Math.max(...mu);
    if (muMax <= muMin + 1e-6) {
      allWeights.push(new Array(n).fill(1 / n));
      continue;
    }
    let bestSharpe = -Infinity;
    let bestW: number[] = new Array(n).fill(1 / n);
    const sweep = 12;
    for (let i = 0; i < sweep; i++) {
      const r = muMin + (i / (sweep - 1)) * (muMax - muMin);
      const w = solveLongOnlyMV(mu, sigma, { targetReturn: r });
      const pt = evaluatePortfolio(w, mu, sigma, rf);
      if (Number.isFinite(pt.sharpe) && pt.sharpe > bestSharpe) {
        bestSharpe = pt.sharpe;
        bestW = w;
      }
    }
    allWeights.push(bestW);
  }
  // Aggregate per-ticker stats
  const stats: BootstrapWeightStats[] = [];
  for (let i = 0; i < n; i++) {
    const col = allWeights.map((w) => w[i]);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const variance = col.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(col.length - 1, 1);
    const std = Math.sqrt(variance);
    const sorted = [...col].sort((a, b) => a - b);
    stats.push({ mean, std, q05: _percentile(sorted, 0.05), q95: _percentile(sorted, 0.95) });
  }
  return { B, weights: stats };
}

/**
 * Bootstrap the FRONTIER ENVELOPE: for each target return, sample many σ's
 * and return min/max/mean vol. Output is a band that visualizes how much
 * the frontier itself shifts under estimation noise.
 */
export function bootstrapFrontierBand(
  X: number[][],
  targetRets: number[],
  rf: number,
  B = 100,
): { ret: number; volLo: number; volHi: number; volMean: number }[] {
  const T = X.length;
  const n = X[0].length;
  if (T < 30 || n < 2) return [];
  const collected: { ret: number; vols: number[] }[] = targetRets.map((r) => ({ ret: r, vols: [] }));
  for (let b = 0; b < B; b++) {
    const Xb = _resample(X);
    const { mu, sigma } = _estimate(Xb);
    for (const point of collected) {
      const w = solveLongOnlyMV(mu, sigma, { targetReturn: point.ret });
      const pt = evaluatePortfolio(w, mu, sigma, rf);
      if (Number.isFinite(pt.vol) && pt.vol > 0) point.vols.push(pt.vol);
    }
  }
  return collected.map((p) => {
    const sorted = [...p.vols].sort((a, b) => a - b);
    const mean = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    return {
      ret: p.ret,
      volLo: _percentile(sorted, 0.10),
      volHi: _percentile(sorted, 0.90),
      volMean: mean,
    };
  });
}
