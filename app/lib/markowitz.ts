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
  frontier: { vol: number; ret: number }[];        // smooth upper-branch hyperbola
  cloud: { vol: number; ret: number; sharpe: number }[]; // Monte Carlo points
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

/** Long-only iterative projection: drop most-negative weight, re-solve, repeat. */
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
    // map back to full vector
    for (let i = 0; i < n; i++) w[i] = 0;
    for (let k = 0; k < active.length; k++) w[active[k]] = sub[k];
    // find most-negative weight
    let minIdx = -1;
    let minVal = 0;
    for (const i of active) {
      if (w[i] < minVal) {
        minVal = w[i];
        minIdx = i;
      }
    }
    if (minIdx === -1) break; // all ≥ 0 → done
    active = active.filter((i) => i !== minIdx);
    if (active.length === 0) break;
  }
  // Numerical safety: clip tiny negatives, renormalize
  for (let i = 0; i < n; i++) if (w[i] < 0) w[i] = 0;
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum > 0) for (let i = 0; i < n; i++) w[i] /= sum;
  return w;
}

/** A random positive-weights portfolio summing to 1 (Dirichlet-flat). */
function _randomLongOnly(n: number): Vector {
  const r = Array.from({ length: n }, () => -Math.log(1 - Math.random()));
  const s = r.reduce((a, b) => a + b, 0);
  return r.map((x) => x / s);
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
  // Walk return targets from r_mv up to (and a bit past) r_ms
  const rMin = mv.ret;
  const rMax = Math.max(ms.ret, rMin + 1e-6);
  const span = rMax - rMin;
  const rTop = rMax + span * 0.25; // extend slightly past max-Sharpe

  const frontier: { vol: number; ret: number }[] = [];
  if (longOnly) {
    // For long-only, sweep targets and project; this is approximate but
    // produces a clean monotone curve in the relevant region
    for (let i = 0; i < steps; i++) {
      const target = rMin + (i / (steps - 1)) * (rTop - rMin);
      const w = _longOnlyForTarget(mu, sigma, rf, target);
      const p = _portfolio(w, mu, sigma, rf);
      frontier.push({ vol: p.vol, ret: p.ret });
    }
    // sort by vol and clip non-monotone points (rare numerical artifacts)
    frontier.sort((a, b) => a.vol - b.vol);
  } else {
    // Unconstrained closed-form hyperbola via target-return formula
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
        if (variance > 0) frontier.push({ vol: Math.sqrt(variance), ret: r });
      }
    }
  }

  // ── Monte Carlo cloud of random LONG-ONLY portfolios ───────────────────
  const cloud: { vol: number; ret: number; sharpe: number }[] = [];
  for (let i = 0; i < cloudSize; i++) {
    const w = _randomLongOnly(n);
    const p = _portfolio(w, mu, sigma, rf);
    cloud.push({ vol: p.vol, ret: p.ret, sharpe: p.sharpe });
  }

  const hasNegativeWeights =
    mv.weights.some((w) => w < -1e-9) || ms.weights.some((w) => w < -1e-9);

  return { minVariance: mv, maxSharpe: ms, frontier, cloud, hasNegativeWeights };
}

/** Long-only target-return projection: greedy KKT-style active-set. */
function _longOnlyForTarget(
  mu: Vector,
  sigma: Matrix,
  rf: number,
  targetReturn: number,
): Vector {
  const n = mu.length;
  let active = Array.from({ length: n }, (_, i) => i);
  const w = new Array(n).fill(0);
  for (let iter = 0; iter < n; iter++) {
    // Solve constrained min-variance s.t. sum=1 and w·μ = target on subset
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
