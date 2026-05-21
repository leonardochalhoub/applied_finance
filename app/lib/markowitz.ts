/**
 * Markowitz mean-variance optimization — analytic (unconstrained) closed form
 * via the two-fund theorem (Black, 1972).
 *
 * Given μ (expected returns, annualized) and Σ (covariance, annualized):
 *   - Global minimum-variance portfolio: w_mv = Σ⁻¹ 1 / (1ᵀ Σ⁻¹ 1)
 *   - Maximum-Sharpe portfolio: w_ms = Σ⁻¹ (μ − r_f·1) / (1ᵀ Σ⁻¹ (μ − r_f·1))
 *   - Efficient frontier: any portfolio on the line through these two satisfies
 *     the efficient locus in (return, variance) space. We sweep λ ∈ [0, 1] for
 *     convex combinations and project (ret, vol) of each.
 *
 * Constraints: long-only (w ≥ 0) is NOT enforced here — pure analytic version
 * may include short positions. Long-only requires QP; we surface a warning
 * when negative weights appear and let the user see them.
 */

import { add, dot, inv, matVec, scale, type Matrix, type Vector } from "./matrix";

export type PortfolioPoint = {
  weights: number[];
  ret: number;       // annualized expected return (decimal)
  vol: number;       // annualized volatility (decimal)
  sharpe: number;    // (ret - rf) / vol
};

export type FrontierResult = {
  minVariance: PortfolioPoint;
  maxSharpe: PortfolioPoint;
  frontier: PortfolioPoint[];
  hasNegativeWeights: boolean;
};

function _ones(n: number): Vector {
  return new Array(n).fill(1);
}

function _portfolio(weights: Vector, mu: Vector, sigma: Matrix, rf: number): PortfolioPoint {
  const ret = dot(weights, mu);
  const v = matVec(sigma, weights);
  const variance = Math.max(0, dot(weights, v));
  const vol = Math.sqrt(variance);
  const sharpe = vol > 1e-12 ? (ret - rf) / vol : 0;
  return { weights, ret, vol, sharpe };
}

export function buildFrontier(
  mu: Vector,
  sigma: Matrix,
  rf: number,
  options: { steps?: number } = {},
): FrontierResult {
  const n = mu.length;
  if (n < 2) throw new Error("Markowitz precisa de ≥ 2 ativos.");
  if (sigma.length !== n || sigma[0].length !== n) {
    throw new Error("Tamanhos de μ e Σ incompatíveis.");
  }

  const sigmaInv = inv(sigma);
  const ones = _ones(n);

  // Global minimum-variance: w_mv = Σ⁻¹ 1 / (1ᵀ Σ⁻¹ 1)
  const sigInvOnes = matVec(sigmaInv, ones);
  const denomMv = dot(ones, sigInvOnes);
  const w_mv = scale(sigInvOnes, 1 / denomMv);

  // Maximum-Sharpe (tangency): w_ms = Σ⁻¹ (μ − rf·1) / (1ᵀ Σ⁻¹ (μ − rf·1))
  const excess: Vector = mu.map((m) => m - rf);
  const sigInvExcess = matVec(sigmaInv, excess);
  const denomMs = dot(ones, sigInvExcess);
  if (Math.abs(denomMs) < 1e-12) {
    throw new Error("Carteira de máximo Sharpe é indefinida (todos os excessos próximos de zero).");
  }
  const w_ms = scale(sigInvExcess, 1 / denomMs);

  // Sweep λ ∈ [0, 1] for convex combinations of the two funds.
  // Extends symmetrically a little beyond [0, 1] to draw the full efficient
  // hyperbola without going off into nonsense territory.
  const steps = options.steps ?? 41;
  const frontier: PortfolioPoint[] = [];
  const lambdaMin = -0.5;
  const lambdaMax = 1.5;
  for (let i = 0; i < steps; i++) {
    const lambda = lambdaMin + (i / (steps - 1)) * (lambdaMax - lambdaMin);
    const w: Vector = add(scale(w_mv, 1 - lambda), scale(w_ms, lambda));
    // Renormalize to sum=1 (numerical safety)
    const s = w.reduce((a, b) => a + b, 0);
    if (Math.abs(s) > 1e-12) {
      for (let k = 0; k < w.length; k++) w[k] /= s;
    }
    frontier.push(_portfolio(w, mu, sigma, rf));
  }
  // Sort by volatility for plotting
  frontier.sort((a, b) => a.vol - b.vol);

  const mv = _portfolio(w_mv, mu, sigma, rf);
  const ms = _portfolio(w_ms, mu, sigma, rf);
  const hasNegativeWeights = ms.weights.some((w) => w < 0) || mv.weights.some((w) => w < 0);

  return {
    minVariance: mv,
    maxSharpe: ms,
    frontier,
    hasNegativeWeights,
  };
}

/**
 * Given a user portfolio (weights, summing to 1), compute its (return, vol)
 * point in the same coordinate frame as the frontier.
 */
export function evaluatePortfolio(
  weights: Vector,
  mu: Vector,
  sigma: Matrix,
  rf: number,
): PortfolioPoint {
  return _portfolio(weights, mu, sigma, rf);
}
