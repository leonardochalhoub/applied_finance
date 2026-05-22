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
 *      Ledoit-Wolf on Σ, Jensen correction on μ, annualize, Jorion shrink μ
 *      (Stage 1), macro-anchor toward rf+ERP with U-shape α(T) (Stage 2),
 *      per-asset ceiling at rf+K·ERP (Stage 3) — Stages 2/3 via the shared
 *      `applyMacroAnchor` helper so the bootstrap operates on the same μ
 *      as the displayed frontier.
 *   3. Solve the SAME optimization problem (long-only max-Sharpe or target).
 *   4. Store the resulting weight vector + portfolio (vol, ret, sharpe).
 *
 * After B samples we get:
 *   - per-weight distribution (mean, std, quantiles) — for advisor significance.
 *   - per-frontier-point envelope — for shaded confidence bands on the chart.
 */

import { buildFrontier } from "./markowitz";
import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "./mvEstimators";
import { defaultRng, type Rng } from "./prng";
import { applyMacroAnchor } from "./shrinkage";

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
  /** Effective number of resamples that produced a valid weight vector (≤
   *  requested B). A low ratio indicates the optimisation is fragile under
   *  resampling and downstream consumers (e.g. advisor significance gate)
   *  should widen tolerances or refuse to issue strong recommendations. */
  B: number;
  /** Per-ticker weight distribution summaries (length = N). */
  weights: BootstrapWeightStats[];
};

function _resample(X: number[][], rng: Rng): number[][] {
  const T = X.length;
  const out: number[][] = new Array(T);
  for (let i = 0; i < T; i++) {
    const idx = Math.floor(rng() * T);
    out[i] = X[idx];
  }
  return out;
}

function _estimate(X: number[][], rf: number): { mu: number[]; sigma: number[][] } {
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
  // Stage 2 (macro-anchor) + Stage 3 (per-asset ceiling). Same helper that
  // PortfolioSuggestions and PortfolioBuilder consume — guarantees the
  // bootstrap envelope is built on the same μ as the displayed frontier,
  // so the advisor's |Δw| > 2·σ_bootstrap threshold is calibrated against
  // the right distribution.
  const { mu } = applyMacroAnchor(js.mu, rf, Tn);
  return { mu, sigma: sigmaAnnual };
}

function _percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx];
}

/**
 * Bootstrap the long-only max-Sharpe portfolio over the input return matrix.
 *
 * For each of `B` iterations, draws a T-with-replacement resample of the
 * daily-return matrix, runs the full three-stage shrinkage pipeline +
 * `buildFrontier`, and records the resulting max-Sharpe weight vector.
 * Failed iterations (singular Σ, optimisation throws) are SKIPPED rather
 * than substituted with 1/N — substituting would systematically pull the
 * bootstrap mean toward equal-weight and shrink σ_bootstrap, which would
 * relax the advisor's significance gate (`|Δw| > 2·σ_bootstrap`).
 *
 * @param X    Daily log-return matrix (T rows × N cols).
 * @param rf   Annualised risk-free rate, threaded into the per-resample
 *             shrinkage so each bootstrap operates on the SAME μ as the
 *             displayed frontier.
 * @param B    Requested number of bootstrap iterations (default 200).
 * @param rng  Deterministic RNG. Defaults to the shared fixed-seed PRNG
 *             (`defaultRng()`) for reproducibility.
 *
 * @returns `BootstrapResult` with per-ticker weight distribution stats
 *          and `B = Beff` (the EFFECTIVE count of successful iterations,
 *          which may be < requested B). Callers should check `Beff` and
 *          refuse to issue strong recommendations when coverage is low —
 *          `lib/advisor.ts` does this automatically via an all-zero-σ
 *          check.
 */
export function bootstrapMaxSharpe(
  X: number[][],
  rf: number,
  B = 200,
  rng: Rng = defaultRng(),
): BootstrapResult {
  const T = X.length;
  const n = X[0].length;
  if (T < 30 || n < 2) {
    return { B: 0, weights: Array.from({ length: n }, () => ({ mean: 0, std: 0, q05: 0, q95: 0 })) };
  }
  const allWeights: number[][] = [];
  for (let b = 0; b < B; b++) {
    const Xb = _resample(X, rng);
    const { mu, sigma } = _estimate(Xb, rf);
    try {
      const fr = buildFrontier(mu, sigma, rf, { longOnly: true, cloudSize: 0, frontierSteps: 12 });
      // Only count iterations that produced a valid weight vector. Substituting
      // 1/N on failure would systematically pull the bootstrap mean toward
      // equal-weight and SHRINK σ_bootstrap, weakening the advisor's
      // |Δw| > 2·σ_bootstrap significance gate.
      if (fr.maxSharpe.weights.every(Number.isFinite)) {
        allWeights.push(fr.maxSharpe.weights);
      }
    } catch {
      // Skip — don't substitute. Reported coverage = allWeights.length below.
    }
  }
  // Aggregate per-ticker stats. If no iterations succeeded, return zeros
  // explicitly so callers can detect the failure (B === 0 in the return).
  const Beff = allWeights.length;
  const stats: BootstrapWeightStats[] = [];
  for (let i = 0; i < n; i++) {
    if (Beff === 0) {
      stats.push({ mean: 0, std: 0, q05: 0, q95: 0 });
      continue;
    }
    const col = allWeights.map((w) => w[i]);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const variance = col.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(col.length - 1, 1);
    const std = Math.sqrt(variance);
    const sorted = [...col].sort((a, b) => a - b);
    stats.push({ mean, std, q05: _percentile(sorted, 0.05), q95: _percentile(sorted, 0.95) });
  }
  return { B: Beff, weights: stats };
}

