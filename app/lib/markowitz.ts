/**
 * Markowitz mean-variance optimization — closed-form efficient frontier
 * + Monte Carlo cloud (the textbook "scatter cloud capped by hyperbola").
 *
 * Closed form (Merton 1972 / Black 1972):
 *   Let e = 1, z = Σ⁻¹ e, y = Σ⁻¹ μ
 *       A = e'z       (= 1' Σ⁻¹ 1)
 *       B = e'y       (= 1' Σ⁻¹ μ)
 *       C = μ'y       (= μ' Σ⁻¹ μ)
 *       D = A·C − B²
 *
 *   For any target return r:
 *       λ = (C − r·B) / D
 *       γ = (r·A − B) / D
 *       w(r) = λ·z + γ·y
 *       σ²(r) = (A·r² − 2·B·r + C) / D
 *
 *   The min-variance portfolio has r_mv = B/A, σ²_mv = 1/A.
 *   The tangency (max Sharpe vs rf) portfolio is:
 *       w_t = Σ⁻¹ (μ − rf·1) / (B − A·rf)
 *
 * Long-only constraint: enforced by an iterative projection — drop the
 * asset with the most-negative weight, re-solve on the remaining set,
 * repeat until all weights ≥ 0. This is a standard greedy approximation
 * to the long-only QP and gives clean labels (max-Sharpe is actually max).
 */

import { dot, inv, matVec, scale, type Matrix, type Vector } from "./matrix";

export type PortfolioPoint = {
  weights: number[];  // aligned with the input universe
  ret: number;
  vol: number;
  sharpe: number;
};

export type FrontierResult = {
  minVariance: PortfolioPoint;
  maxSharpe: PortfolioPoint;
  frontier: { vol: number; ret: number; weights: number[] }[];
  cloud: { vol: number; ret: number; sharpe: number; weights: number[] }[];
  hasNegativeWeights: boolean;
};

function _portfolio(weights: Vector, mu: Vector, sigma: Matrix, rf: number): PortfolioPoint {
  const ret = dot(weights, mu);
  const variance = Math.max(0, dot(weights, matVec(sigma, weights)));
  const vol = Math.sqrt(variance);
  const sharpe = vol > 1e-12 ? (ret - rf) / vol : 0;
  return { weights, ret, vol, sharpe };
}

function _ones(n: number): Vector {
  return new Array(n).fill(1);
}

/** Submatrix selecting rows/cols at `idx`. */
function _submat(m: Matrix, idx: number[]): Matrix {
  return idx.map((i) => idx.map((j) => m[i][j]));
}

/** Sub-vector at `idx`. */
function _subvec(v: Vector, idx: number[]): Vector {
  return idx.map((i) => v[i]);
}

/** Unconstrained min-variance and max-Sharpe on the SUBSET of indices. */
function _solveSubset(
  mu: Vector,
  sigma: Matrix,
  rf: number,
  idx: number[],
): { mv: Vector; ms: Vector } | null {
  if (idx.length < 1) return null;
  const muSub = _subvec(mu, idx);
  const sigSub = _submat(sigma, idx);
  let sigInv: Matrix;
  try {
    sigInv = inv(sigSub);
  } catch {
    return null;
  }
  const e = _ones(idx.length);
  const z = matVec(sigInv, e);
  const A = dot(e, z);
  if (A <= 0) return null;
  const mv = scale(z, 1 / A);

  const excess = muSub.map((m) => m - rf);
  const y = matVec(sigInv, excess);
  const denom = dot(e, y);
  if (Math.abs(denom) < 1e-12) return { mv, ms: mv };
  const ms = scale(y, 1 / denom);
  return { mv, ms };
}

/** Long-only iterative projection: drop most-negative weight, re-solve, repeat.
 *  This is a greedy active-set heuristic — correct when the unconstrained
 *  solution's negative weights are dropped monotonically (the common case
 *  for well-conditioned Σ on small N). The previous attempt at a "proper"
 *  active-set QP solver was suboptimal in practice; the random cloud was
 *  finding lower-variance portfolios than the QP's claimed min-var. */
function _longOnly(
  mu: Vector,
  sigma: Matrix,
  rf: number,
  target: "mv" | "ms",
): Vector {
  const n = mu.length;
  let active = Array.from({ length: n }, (_, i) => i);
  const w = new Array(n).fill(0);
  for (let iter = 0; iter < n; iter++) {
    const solved = _solveSubset(mu, sigma, rf, active);
    if (!solved) break;
    const sub = target === "mv" ? solved.mv : solved.ms;
    for (let i = 0; i < n; i++) w[i] = 0;
    for (let k = 0; k < active.length; k++) w[active[k]] = sub[k];
    let minIdx = -1;
    let minVal = 0;
    for (const i of active) {
      if (w[i] < minVal) {
        minVal = w[i];
        minIdx = i;
      }
    }
    if (minIdx === -1) break;
    active = active.filter((i) => i !== minIdx);
    if (active.length === 0) break;
  }
  for (let i = 0; i < n; i++) if (w[i] < 0) w[i] = 0;
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum > 0) for (let i = 0; i < n; i++) w[i] /= sum;
  return w;
}

/** Box-Muller standard normal. */
function _randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Sample Gamma(α, 1) for α > 0 (Marsaglia–Tsang for α ≥ 1, boost for α < 1). */
function _gamma(alpha: number): number {
  if (alpha < 1) {
    // Boosted: Gamma(α) = Gamma(α + 1) * U^(1/α)
    const u = Math.random();
    return _gamma(alpha + 1) * Math.pow(u, 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = _randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Sample a Dirichlet(alpha) on R^n. Low α concentrates samples near corners
 *  (single-asset portfolios); α = 1 is uniform on the simplex; high α
 *  concentrates near equal-weight. */
function _dirichlet(n: number, alpha: number): Vector {
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = _gamma(alpha);
  const s = x.reduce((a, b) => a + b, 0);
  return x.map((v) => v / s);
}

/** Cloud sampler mixing concentration levels AND explicit small-k portfolios
 *  so the cloud densely covers the achievable region — from equal-weight
 *  center all the way to single-asset corners. Without the corner samples
 *  the cloud's upper boundary never touches the frontier (Dirichlet samples
 *  in high dimensions cluster around equal-weight). */
function _randomLongOnly(n: number): Vector {
  const r = Math.random();
  if (r < 0.10) {
    // 10% single-asset portfolios (one asset gets 100%)
    const w = new Array(n).fill(0);
    w[Math.floor(Math.random() * n)] = 1;
    return w;
  }
  if (r < 0.25) {
    // 15% small-k portfolios (2-4 assets, random weights)
    const k = 2 + Math.floor(Math.random() * 3);
    const idx = new Set<number>();
    while (idx.size < k) idx.add(Math.floor(Math.random() * n));
    const subW = _dirichlet(k, 0.7);
    const w = new Array(n).fill(0);
    let j = 0;
    for (const i of idx) w[i] = subW[j++];
    return w;
  }
  if (r < 0.55) {
    // 30% concentrated Dirichlet (lower α → more concentration)
    return _dirichlet(n, 0.2);
  }
  if (r < 0.80) {
    // 25% uniform on the simplex
    return _dirichlet(n, 1.0);
  }
  // 20% diversified (closer to equal-weight)
  return _dirichlet(n, 3.0);
}

export function buildFrontier(
  mu: Vector,
  sigma: Matrix,
  rf: number,
  options: {
    longOnly?: boolean;
    frontierSteps?: number;
    cloudSize?: number;
  } = {},
): FrontierResult {
  const n = mu.length;
  if (n < 2) throw new Error("Markowitz precisa de ≥ 2 ativos.");
  if (sigma.length !== n || sigma[0].length !== n) {
    throw new Error("Tamanhos de μ e Σ incompatíveis.");
  }

  const longOnly = options.longOnly ?? false;
  const cloudSize = options.cloudSize ?? 1500;
  const steps = options.frontierSteps ?? 60;

  // Compute min-variance and max-Sharpe portfolios (full or long-only)
  let mv: PortfolioPoint;
  let ms: PortfolioPoint;
  if (longOnly) {
    mv = _portfolio(_longOnly(mu, sigma, rf, "mv"), mu, sigma, rf);
    ms = _portfolio(_longOnly(mu, sigma, rf, "ms"), mu, sigma, rf);
  } else {
    const sigInv = inv(sigma);
    const e = _ones(n);
    const z = matVec(sigInv, e);
    const A = dot(e, z);
    const mvw = scale(z, 1 / A);
    mv = _portfolio(mvw, mu, sigma, rf);

    const excess = mu.map((m) => m - rf);
    const y = matVec(sigInv, excess);
    const denom = dot(e, y);
    if (Math.abs(denom) < 1e-12) {
      ms = mv;
    } else {
      const msw = scale(y, 1 / denom);
      ms = _portfolio(msw, mu, sigma, rf);
    }
  }

  // ── Build the smooth efficient upper-branch frontier ────────────────────
  // The efficient frontier should extend ALL the way from min-variance up to
  // the highest achievable expected return — NOT stop at the max-Sharpe
  // tangency point. Max-Sharpe is the optimal *risk-adjusted* point, but
  // investors who want more return (at more risk) should still see the curve
  // continuing past it. Otherwise the chart looks visually truncated relative
  // to the random Dirichlet cloud.
  const rMin = mv.ret;
  // For long-only: max achievable return = put 100% in the single highest-μ asset.
  // For unconstrained: theoretically unbounded, so extend at least 1.5× the
  // mv→ms span past ms.ret to give the curve room to breathe.
  const muMax = Math.max(...mu);
  const span = Math.max(ms.ret - rMin, 1e-6);
  const rTop = longOnly
    ? Math.max(muMax, ms.ret + span * 0.25)
    : ms.ret + span * 1.5;

  const frontier: { vol: number; ret: number; weights: number[] }[] = [];
  if (longOnly) {
    for (let i = 0; i < steps; i++) {
      const target = rMin + (i / (steps - 1)) * (rTop - rMin);
      const w = _longOnlyForTarget(mu, sigma, rf, target);
      const p = _portfolio(w, mu, sigma, rf);
      // Drop degenerate/infeasible iterations (active-set didn't converge)
      if (Number.isFinite(p.vol) && Number.isFinite(p.ret) && p.vol > 0) {
        frontier.push({ vol: p.vol, ret: p.ret, weights: w });
      }
    }
    frontier.sort((a, b) => a.vol - b.vol);
  } else {
    const sigInv = inv(sigma);
    const e = _ones(n);
    const z = matVec(sigInv, e);
    const y = matVec(sigInv, mu);
    const A = dot(e, z);
    const B = dot(e, y);
    const C = dot(mu, y);
    const D = A * C - B * B;
    if (Math.abs(D) > 1e-12) {
      for (let i = 0; i < steps; i++) {
        const r = rMin + (i / (steps - 1)) * (rTop - rMin);
        const variance = (A * r * r - 2 * B * r + C) / D;
        if (variance > 0) {
          const lambda = (C - r * B) / D;
          const gamma = (r * A - B) / D;
          const w: number[] = new Array(n);
          for (let k = 0; k < n; k++) w[k] = lambda * z[k] + gamma * y[k];
          frontier.push({ vol: Math.sqrt(variance), ret: r, weights: w });
        }
      }
    }
  }

  const cloud: { vol: number; ret: number; sharpe: number; weights: number[] }[] = [];
  for (let i = 0; i < cloudSize; i++) {
    const w = _randomLongOnly(n);
    const p = _portfolio(w, mu, sigma, rf);
    cloud.push({ vol: p.vol, ret: p.ret, sharpe: p.sharpe, weights: w });
  }

  const hasNegativeWeights =
    mv.weights.some((w) => w < -1e-9) || ms.weights.some((w) => w < -1e-9);

  return { minVariance: mv, maxSharpe: ms, frontier, cloud, hasNegativeWeights };
}

/** Long-only target-return projection: greedy KKT-style active-set.
 *  Solves min wᵀΣw s.t. 𝟙ᵀw=1, μᵀw=target, w_i≥0 by repeatedly dropping the
 *  most-negative weight from the unconstrained solution. */
function _longOnlyForTarget(
  mu: Vector,
  sigma: Matrix,
  _rf: number,
  targetReturn: number,
): Vector {
  const n = mu.length;
  let active = Array.from({ length: n }, (_, i) => i);
  const w = new Array(n).fill(0);
  for (let iter = 0; iter < n; iter++) {
    try {
      const subMu = _subvec(mu, active);
      const subSig = _submat(sigma, active);
      const subInv = inv(subSig);
      const e = _ones(active.length);
      const z = matVec(subInv, e);
      const yvec = matVec(subInv, subMu);
      const A = dot(e, z);
      const B = dot(e, yvec);
      const C = dot(subMu, yvec);
      const D = A * C - B * B;
      if (Math.abs(D) < 1e-12) break;
      const lambda = (C - targetReturn * B) / D;
      const gamma = (targetReturn * A - B) / D;
      const subW: number[] = [];
      for (let i = 0; i < active.length; i++) subW.push(lambda * z[i] + gamma * yvec[i]);
      for (let i = 0; i < n; i++) w[i] = 0;
      for (let k = 0; k < active.length; k++) w[active[k]] = subW[k];

      let minIdx = -1;
      let minVal = -1e-9;
      for (const i of active) {
        if (w[i] < minVal) {
          minVal = w[i];
          minIdx = i;
        }
      }
      if (minIdx === -1) break;
      active = active.filter((i) => i !== minIdx);
      if (active.length === 0) break;
    } catch {
      break;
    }
  }
  for (let i = 0; i < n; i++) if (w[i] < 0) w[i] = 0;
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum > 0) for (let i = 0; i < n; i++) w[i] /= sum;
  return w;
}

export function evaluatePortfolio(
  weights: Vector,
  mu: Vector,
  sigma: Matrix,
  rf: number,
): PortfolioPoint {
  return _portfolio(weights, mu, sigma, rf);
}
