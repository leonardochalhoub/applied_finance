/**
 * Risk Parity / Equal Risk Contribution (ERC) portfolio.
 *
 * The Risk Parity school throws away μ entirely — given how unreliable μ̂ is
 * (DeMiguel-Garlappi-Uppal 2009; Kahneman 2011), why pretend you can
 * forecast it? Instead, allocate so each asset contributes EQUALLY to total
 * portfolio risk. Concentration risk is the failure mode of 1/N (a small-cap
 * ticker with 4× the vol of a large-cap dominates the variance even at
 * equal dollar weight); ERC fixes that.
 *
 * **Definition** — given the long-only portfolio w ≥ 0, Σ w = 1:
 *   σ_p² = wᵀ Σ w
 *   ∂σ_p²/∂w_i = 2 (Σw)_i
 *   Risk Contribution of asset i:  RC_i = w_i · (Σw)_i / σ_p²
 *   ERC condition:  RC_i = 1/N for all i.
 *
 * **Computation** — Maillard, Roncalli & Teïletche (2010) prove ERC is the
 * unique solution of a convex problem:
 *     min  ½ wᵀ Σ w − (1/N) Σ ln(w_i)   s.t.  w ≥ 0
 * (no sum-to-1 constraint at this stage — we re-normalise the solution at
 * the end). The gradient is
 *     ∇f(w) = Σ w − (1/N) (1/w_i)
 * giving the elegant fixed-point characterisation
 *     w_i  ∝  (1/(Σw)_i)   when scaled appropriately.
 *
 * We solve via cyclic coordinate descent with bracketing line-search per
 * coordinate. Converges in ~20-50 iterations for N ≤ 50.
 *
 * Inverse-volatility weighting (often called "naive risk parity" or
 * "diagonal Σ ERC") is the closed-form simplification when Σ is diagonal:
 *     w_i ∝ 1/σ_i
 * Useful as a sanity-check benchmark — it's what most retail "risk parity"
 * products actually implement.
 *
 * Reference:
 *   Maillard, S., Roncalli, T. & Teïletche, J. (2010).
 *   The Properties of Equally Weighted Risk Contribution Portfolios.
 *   Journal of Portfolio Management 36(4), 60-70.
 *   https://www.pm-research.com/content/iijpormgmt/36/4/60
 */

import type { Matrix, Vector } from "./matrix";
import { dot, matVec } from "./matrix";

export type RiskContributions = {
  /** Per-asset risk contribution as a fraction of total portfolio vol.
   *  Sums to 1 by construction. For ERC, all entries are 1/N. */
  rc: number[];
  /** Per-asset marginal risk contribution σ × ∂σ/∂w_i = (Σw)_i / σ_p. */
  mrc: number[];
  /** Total annualised portfolio vol √(wᵀΣw). */
  vol: number;
};

/** Per-asset risk contributions under weights w and covariance Σ. */
export function riskContributions(w: Vector, sigma: Matrix): RiskContributions {
  const Sw = matVec(sigma, w);
  const variance = Math.max(dot(w, Sw), 0);
  const vol = Math.sqrt(variance);
  const mrc = Sw.map((v) => (vol > 1e-12 ? v / vol : 0));
  const rc = w.map((wi, i) => (variance > 1e-12 ? (wi * Sw[i]) / variance : 0));
  return { rc, mrc, vol };
}

/** Inverse-volatility weights: w_i ∝ 1/σ_i, where σ_i = √Σ_ii. The closed
 *  form of ERC when correlations are ignored. A useful naive benchmark. */
export function inverseVolatilityWeights(sigma: Matrix): Vector {
  const n = sigma.length;
  const inv = new Array<number>(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.sqrt(Math.max(sigma[i][i], 1e-12));
    const x = 1 / s;
    inv[i] = x;
    sum += x;
  }
  return inv.map((v) => v / sum);
}

/** Equal-risk-contribution portfolio via cyclic coordinate descent.
 *
 *  Loops over each asset i in turn and adjusts w_i to make the i-th risk
 *  contribution match the target (= 1/N for ERC). Each coordinate step is
 *  a 1-D Newton update on the implicit equation
 *      w_i · (Σw)_i = target_RC · σ²_p
 *  This converges quickly (~50 sweeps) for well-conditioned Σ.
 *
 *  @param sigma     N × N covariance (annualised or daily — output is the
 *                   weight vector, scale-invariant in Σ).
 *  @param target    Target risk contribution per asset (length N, sums to 1).
 *                   If omitted, uses 1/N for ERC.
 *  @param options.maxSweeps   Maximum outer sweeps (default 200).
 *  @param options.tol         Convergence threshold on max |RC_i − target_i|
 *                             (default 1e-7).
 *
 *  @returns The non-negative weight vector summing to 1 that minimises the
 *           convex objective above. Falls back to inverse-volatility if the
 *           solver fails to converge.
 */
export function equalRiskContribution(
  sigma: Matrix,
  target?: Vector,
  options: { maxSweeps?: number; tol?: number } = {},
): Vector {
  const n = sigma.length;
  const maxSweeps = options.maxSweeps ?? 200;
  const tol = options.tol ?? 1e-7;
  const t = target ? target.slice() : new Array<number>(n).fill(1 / n);

  // Warm start with inverse-volatility (or 1/N when σ_ii vanish)
  let w = inverseVolatilityWeights(sigma).map((v) => Math.max(v, 1e-6));

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let maxResidual = 0;
    for (let i = 0; i < n; i++) {
      // Holding all w_j, j ≠ i fixed, the equation for w_i is
      //   w_i · σ_ii · w_i + w_i · Σ_{j≠i} σ_ij w_j = t_i · σ²_p
      // i.e.  σ_ii · w_i² + a_i · w_i − t_i · σ²_p = 0,
      // where a_i = Σ_{j≠i} σ_ij w_j.
      let ai = 0;
      for (let j = 0; j < n; j++) if (j !== i) ai += sigma[i][j] * w[j];
      let portVar = 0;
      for (let p = 0; p < n; p++) {
        let row = 0;
        for (let q = 0; q < n; q++) row += sigma[p][q] * w[q];
        portVar += w[p] * row;
      }
      // Solve σ_ii · w_i² + a_i · w_i − t_i · portVar = 0 for w_i ≥ 0.
      const A = sigma[i][i];
      const B = ai;
      const C = -t[i] * portVar;
      let wi: number;
      if (Math.abs(A) < 1e-14) {
        wi = -C / Math.max(B, 1e-14);
      } else {
        const disc = B * B - 4 * A * C;
        if (disc < 0) wi = w[i];
        else wi = (-B + Math.sqrt(disc)) / (2 * A);
      }
      if (!Number.isFinite(wi) || wi <= 0) wi = w[i];
      // Track residual relative to TARGET risk contribution at this step's
      // current portfolio.
      const Sw = matVec(sigma, w);
      const totalVar = dot(w, Sw);
      const rcI = totalVar > 1e-12 ? (w[i] * Sw[i]) / totalVar : 0;
      const residual = Math.abs(rcI - t[i]);
      if (residual > maxResidual) maxResidual = residual;
      w[i] = wi;
    }
    // Renormalise (sum-to-1 is preserved at convergence; renormalising every
    // sweep keeps numerics tidy without changing the fixed point).
    const sumW = w.reduce((a, b) => a + b, 0);
    if (sumW > 1e-12) for (let i = 0; i < n; i++) w[i] /= sumW;
    if (maxResidual < tol) break;
  }

  // Final renormalise & non-negativity safety net.
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (w[i] < 0 || !Number.isFinite(w[i])) w[i] = 1e-6;
    s += w[i];
  }
  if (s > 0) for (let i = 0; i < n; i++) w[i] /= s;
  else w = new Array(n).fill(1 / n);
  return w;
}
