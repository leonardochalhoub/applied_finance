/**
 * Black-Litterman (1992) Bayesian portfolio model.
 *
 * The classical Markowitz failure mode is that the sample mean μ̂ is a
 * statistically terrible estimate of true expected returns (Michaud 1989,
 * "error maximization"; DeMiguel-Garlappi-Uppal 2009). The optimizer puts
 * huge weight on the asset whose μ̂ overshot by chance; the realised Sharpe
 * collapses out-of-sample.
 *
 * Black & Litterman propose a Bayesian fix:
 *   1. Start from the **market-equilibrium** prior: Π = δ Σ w_mkt. This is the
 *      vector of expected returns that, under classical MV equilibrium, makes
 *      the observed market portfolio optimal. It's the answer to "what would
 *      μ have to be for the market portfolio to be the right one?".
 *   2. Treat Π as the prior mean of the *true* μ, with covariance τΣ
 *      (τ small — typically 0.01-0.05 — encoding "the prior is fairly
 *      precise but not certain").
 *   3. Let the user add **views** (linear forecasts on portfolios of assets)
 *      with explicit confidence. Combine prior and views via Bayes' rule.
 *   4. Use the posterior mean μ_BL in the standard MV optimizer.
 *
 * The result: weights that are sensible at the market portfolio when no
 * views are provided, and tilt smoothly toward the user's views as they
 * are added — no more 90% concentrations on whichever ticker happened to
 * have the noisy μ̂.
 *
 * Reference:
 *   Black, F. & Litterman, R. (1992). Global Portfolio Optimization.
 *   Financial Analysts Journal, 48(5), 28-43.
 *   https://www.tandfonline.com/doi/abs/10.2469/faj.v48.n5.28
 */

import { dot, inv, matVec, type Matrix, type Vector } from "./matrix";

/** A linear view on a portfolio. `tickerIndices` and `coeffs` together
 *  define the row vector P_k of the view matrix; `expectedReturn` is Q_k. */
export type View = {
  /** Ticker positions in the universe vector that this view touches. */
  tickerIndices: number[];
  /** Coefficients aligned with `tickerIndices`. For an absolute view on a
   *  single asset use `[1]`; for a relative view "A beats B by X%" use
   *  `[+1, -1]`. */
  coeffs: number[];
  /** Annualised return predicted by the view: Q_k. For an absolute view
   *  this is "I expect E[r_A] = 0.18". For a relative view, "I expect
   *  E[r_A − r_B] = 0.03". */
  expectedReturn: number;
  /** Confidence ∈ (0, 1]. 0.5 is the canonical BL default (Ω_k equals the
   *  view's prior variance, τ P_k Σ P_kᵀ); higher = more confident (smaller
   *  Ω_k, view tilts μ more); lower = less confident. */
  confidence: number;
  /** Optional human-readable label (for the UI table). */
  label?: string;
};

export type BlackLittermanResult = {
  /** N × 1 vector of implied (equilibrium) returns Π = δ Σ w_mkt. */
  pi: Vector;
  /** Posterior mean returns μ_BL after combining Π with the views via Bayes. */
  muBL: Vector;
  /** Posterior covariance of μ: M = [(τΣ)⁻¹ + PᵀΩ⁻¹P]⁻¹.
   *  When no views: M = τΣ. */
  muCov: Matrix;
  /** Effective Σ for portfolio optimization: Σ + M. Slightly inflated vs
   *  the sample Σ to account for parameter uncertainty in μ. */
  sigmaBL: Matrix;
  /** Diagnostic copies of the inputs that drove the result. */
  delta: number;
  tau: number;
  /** Per-view: prior-implied portfolio return (P_k Π), posterior portfolio
   *  return (P_k μ_BL), residual (Q_k − P_k Π). Surfaces how strongly each
   *  view moves the posterior. */
  viewDiagnostics: {
    label: string;
    priorReturn: number;
    posteriorReturn: number;
    residual: number;
    omegaK: number;
  }[];
};

/** Equilibrium-implied returns Π = δ Σ w_mkt. Throws if dimensions mismatch. */
export function impliedReturns(sigma: Matrix, wMkt: Vector, delta: number): Vector {
  const n = wMkt.length;
  if (sigma.length !== n || sigma[0].length !== n) {
    throw new Error("impliedReturns: Σ e w_mkt incompatíveis.");
  }
  const sw = matVec(sigma, wMkt);
  return sw.map((v) => delta * v);
}

/** Build the K × N view matrix P from a list of views. */
function _buildP(views: View[], N: number): Matrix {
  const P: Matrix = [];
  for (const v of views) {
    const row = new Array(N).fill(0);
    for (let i = 0; i < v.tickerIndices.length; i++) {
      row[v.tickerIndices[i]] = v.coeffs[i];
    }
    P.push(row);
  }
  return P;
}

/** Build the diagonal Ω of view uncertainties. The canonical "He-Litterman"
 *  default is Ω_kk = τ · P_k Σ P_kᵀ. We scale by a confidence-dependent
 *  factor so higher confidence shrinks Ω_kk (tighter view distribution):
 *      Ω_kk = τ · P_k Σ P_kᵀ · (1 − c) / c
 *  c = 0.5 gives the canonical default. c → 1 ⇒ Ω → 0 (view is law). */
function _buildOmega(P: Matrix, sigma: Matrix, tau: number, confidences: number[]): Matrix {
  const K = P.length;
  const omega: Matrix = [];
  for (let k = 0; k < K; k++) {
    const row = new Array(K).fill(0);
    const Pk = P[k];
    const SigmaPk = matVec(sigma, Pk);
    const PSPk = dot(Pk, SigmaPk);
    const c = Math.min(Math.max(confidences[k], 1e-6), 0.999999);
    row[k] = tau * PSPk * ((1 - c) / c);
    omega.push(row);
  }
  return omega;
}

/** N × N × scalar element-wise. */
function _scaleM(m: Matrix, k: number): Matrix {
  return m.map((r) => r.map((x) => x * k));
}

/** A + B element-wise (assumes same shape). */
function _addM(a: Matrix, b: Matrix): Matrix {
  return a.map((r, i) => r.map((x, j) => x + b[i][j]));
}

/** A · B (matrix × matrix). */
function _matMat(a: Matrix, b: Matrix): Matrix {
  const r = a.length;
  const cInner = b.length;
  const c = b[0].length;
  const out: Matrix = [];
  for (let i = 0; i < r; i++) {
    const row = new Array(c).fill(0);
    for (let k = 0; k < cInner; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < c; j++) row[j] += aik * b[k][j];
    }
    out.push(row);
  }
  return out;
}

/** Aᵀ. */
function _T(a: Matrix): Matrix {
  const r = a.length;
  const c = a[0].length;
  const out: Matrix = [];
  for (let j = 0; j < c; j++) {
    const row = new Array(r);
    for (let i = 0; i < r; i++) row[i] = a[i][j];
    out.push(row);
  }
  return out;
}

/**
 * Run Black-Litterman.
 *
 * Inputs:
 *   - `sigma`: N × N annualised covariance matrix (use the same Σ̂ as the
 *     classical Markowitz pipeline — Ledoit-Wolf shrinkage is fine here).
 *   - `wMkt`: market weight vector, length N, sums to 1. Typically the
 *     current IBOV-constituent weights restricted to your universe.
 *   - `delta`: market risk aversion. Standard textbook value is 2.5; can
 *     also be reverse-engineered from market Sharpe / Σ.
 *   - `tau`: prior scaling. Standard values 0.01-0.05 — controls how much
 *     the views can move μ vs Π. Smaller τ ⇒ posterior closer to Π.
 *   - `views`: list of views (empty list ⇒ posterior = prior = Π).
 *
 * Output: `BlackLittermanResult` with Π, μ_BL, M, Σ_BL, and per-view
 * diagnostics.
 */
export function blackLitterman(opts: {
  sigma: Matrix;
  wMkt: Vector;
  delta?: number;
  tau?: number;
  views?: View[];
}): BlackLittermanResult {
  const sigma = opts.sigma;
  const wMkt = opts.wMkt;
  const N = wMkt.length;
  if (sigma.length !== N || sigma[0].length !== N) {
    throw new Error("blackLitterman: Σ e w_mkt incompatíveis.");
  }
  const delta = opts.delta ?? 2.5;
  const tau = opts.tau ?? 0.05;
  const views = opts.views ?? [];

  const pi = impliedReturns(sigma, wMkt, delta);

  if (views.length === 0) {
    // No views ⇒ posterior = prior, M = τΣ, Σ_BL = Σ + τΣ = (1+τ)Σ.
    const tauSigma = _scaleM(sigma, tau);
    return {
      pi,
      muBL: pi.slice(),
      muCov: tauSigma,
      sigmaBL: _addM(sigma, tauSigma),
      delta,
      tau,
      viewDiagnostics: [],
    };
  }

  const P = _buildP(views, N);
  const Q = views.map((v) => v.expectedReturn);
  const confidences = views.map((v) => v.confidence);
  const Omega = _buildOmega(P, sigma, tau, confidences);

  // M = [ (τΣ)⁻¹ + Pᵀ Ω⁻¹ P ]⁻¹
  const tauSigmaInv = inv(_scaleM(sigma, tau));
  const OmegaInv = inv(Omega);
  const PT = _T(P);
  const PTOmegaInv = _matMat(PT, OmegaInv);
  const PTOmegaInvP = _matMat(PTOmegaInv, P);
  const M = inv(_addM(tauSigmaInv, PTOmegaInvP));

  // μ_BL = M · [ (τΣ)⁻¹ Π + Pᵀ Ω⁻¹ Q ]
  const term1 = matVec(tauSigmaInv, pi);
  const term2 = matVec(PTOmegaInv, Q);
  const bracket = term1.map((v, i) => v + term2[i]);
  const muBL = matVec(M, bracket);

  // Σ_BL = Σ + M
  const sigmaBL = _addM(sigma, M);

  // Per-view diagnostics
  const priorPortfolio = matVec(P, pi);
  const postPortfolio = matVec(P, muBL);
  const viewDiagnostics = views.map((v, k) => ({
    label: v.label ?? `view ${k + 1}`,
    priorReturn: priorPortfolio[k],
    posteriorReturn: postPortfolio[k],
    residual: Q[k] - priorPortfolio[k],
    omegaK: Omega[k][k],
  }));

  return { pi, muBL, muCov: M, sigmaBL, delta, tau, viewDiagnostics };
}
