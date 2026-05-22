/**
 * Statistical estimators that sit upstream of Markowitz mean-variance.
 *
 * - jensenCorrectMu:    log-return mean → simple-return mean via μ + σ²/2.
 * - ledoitWolf:         Ledoit-Wolf (2004) shrinkage of the sample covariance
 *                       toward a constant-correlation target, with closed-form
 *                       data-driven optimal intensity δ*.
 * - jorionShrinkMu:     Bayes-Stein shrinkage of μ toward the grand mean to
 *                       counter Markowitz's notorious sensitivity to mean
 *                       estimation noise (Jorion 1986, James-Stein 1961).
 *
 * All functions operate on UNANNUALIZED daily log returns unless noted.
 */

import type { Matrix, Vector } from "./matrix";

// ── Jensen correction ──────────────────────────────────────────────────────
//
// Markowitz is defined on SIMPLE returns r_simp = P_t/P_{t-1} - 1.
// We estimate μ and Σ from LOG returns r_log = ln(P_t/P_{t-1}) because they
// are (a) approximately Gaussian and (b) time-additive. Converting back to
// simple returns under approximate log-normality:
//
//     E[r_simp] ≈ E[r_log] + Var[r_log] / 2
//
// Without this, with σ ≈ 30% annualized, μ is biased downward by σ²/2 ≈ 4.5%
// — larger than typical equity risk premia and larger than typical shrinkage.
//
// Applied to the diagonal of Σ_log (unannualized), per ticker.
export function jensenCorrectMu(muLog: Vector, sigmaLog: Matrix): Vector {
  return muLog.map((m, i) => m + 0.5 * sigmaLog[i][i]);
}

// ── Ledoit-Wolf 2004 (constant-correlation target) ─────────────────────────
//
// Reference: Ledoit, O. & Wolf, M. (2004). "Honey, I Shrunk the Sample
// Covariance Matrix." Journal of Portfolio Management.
//
// Returns Σ̂ = δ·F + (1−δ)·S, where:
//   S = sample covariance (T-1 normalized)
//   F = constant-correlation target: F_ii = s_ii,
//                                    F_ij = ρ̄ · √(s_ii · s_jj)
//   ρ̄ = average sample correlation across off-diagonals
//   δ* = closed-form optimal intensity from finite-sample MSE minimization
//
// `returns` is a T×N matrix of daily log returns. Returns { sigma, delta }.
export function ledoitWolf(returns: Matrix): { sigma: Matrix; delta: number; F: Matrix; S: Matrix } {
  const T = returns.length;
  const N = returns[0].length;

  // ── 1. De-mean ──
  const mean: Vector = new Array(N).fill(0);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < N; i++) mean[i] += returns[t][i];
  }
  for (let i = 0; i < N; i++) mean[i] /= T;
  const X: Matrix = returns.map((row) => row.map((v, i) => v - mean[i]));

  // ── 2. Sample covariance S (1/T normalization per Ledoit-Wolf paper) ──
  // (NB: the 1/T vs 1/(T-1) distinction does not affect δ* materially)
  const S: Matrix = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let t = 0; t < T; t++) {
    const xt = X[t];
    for (let i = 0; i < N; i++) {
      const xi = xt[i];
      for (let j = i; j < N; j++) {
        S[i][j] += xi * xt[j];
      }
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      S[i][j] /= T;
      if (i !== j) S[j][i] = S[i][j];
    }
  }

  // ── 3. Sample correlation matrix R and average off-diagonal ρ̄ ──
  const sd: Vector = new Array(N);
  for (let i = 0; i < N; i++) sd[i] = Math.sqrt(Math.max(S[i][i], 1e-18));
  let rBar = 0;
  let count = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      rBar += S[i][j] / (sd[i] * sd[j]);
      count++;
    }
  }
  rBar = count > 0 ? rBar / count : 0;

  // ── 4. Target F (constant correlation) ──
  const F: Matrix = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let i = 0; i < N; i++) {
    F[i][i] = S[i][i];
    for (let j = i + 1; j < N; j++) {
      F[i][j] = rBar * sd[i] * sd[j];
      F[j][i] = F[i][j];
    }
  }

  // ── 5. π̂: sum of asymptotic variances of sqrt(T) · (s_ij − σ_ij)
  // π̂_ij = (1/T) Σ_t [ x_ti·x_tj − s_ij ]²
  let piHat = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let acc = 0;
      const sij = S[i][j];
      for (let t = 0; t < T; t++) {
        const v = X[t][i] * X[t][j] - sij;
        acc += v * v;
      }
      piHat += acc / T;
    }
  }

  // ── 6. ρ̂: sum of asymptotic covariances between sqrt(T) · (s_ij − σ_ij)
  // and sqrt(T) · (f_ij − φ_ij). The constant-correlation derivative gives:
  //
  //   ρ̂ = Σ_i π̂_ii + Σ_{i≠j} (ρ̄ / 2) · (√(s_jj/s_ii) · ϑ_ii,ij + √(s_ii/s_jj) · ϑ_jj,ij)
  //
  // where ϑ_kk,ij = (1/T) Σ_t (x_tk² − s_kk)(x_ti·x_tj − s_ij).
  let rhoHat = 0;
  for (let i = 0; i < N; i++) {
    // diagonal contribution: π̂_ii (already in piHat indirectly, but accumulate
    // again here following the Ledoit-Wolf decomposition exactly)
    let piDiag = 0;
    const sii = S[i][i];
    for (let t = 0; t < T; t++) {
      const v = X[t][i] * X[t][i] - sii;
      piDiag += v * v;
    }
    rhoHat += piDiag / T;
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const sii = S[i][i];
      const sjj = S[j][j];
      const sij = S[i][j];
      // ϑ_ii,ij
      let theta1 = 0;
      let theta2 = 0;
      for (let t = 0; t < T; t++) {
        const xi = X[t][i];
        const xj = X[t][j];
        theta1 += (xi * xi - sii) * (xi * xj - sij);
        theta2 += (xj * xj - sjj) * (xi * xj - sij);
      }
      theta1 /= T;
      theta2 /= T;
      rhoHat += (rBar / 2) * (Math.sqrt(sjj / Math.max(sii, 1e-18)) * theta1 + Math.sqrt(sii / Math.max(sjj, 1e-18)) * theta2);
    }
  }

  // ── 7. γ̂: squared Frobenius distance between F and S ──
  let gammaHat = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const d = F[i][j] - S[i][j];
      gammaHat += d * d;
    }
  }

  // ── 8. δ* = max(0, min(1, (π̂ − ρ̂) / (T · γ̂))) ──
  const kappa = (piHat - rhoHat) / Math.max(gammaHat, 1e-18);
  const delta = Math.max(0, Math.min(1, kappa / T));

  // ── 9. Shrunk Σ̂ = δ·F + (1 − δ)·S ──
  const sigma: Matrix = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      sigma[i][j] = delta * F[i][j] + (1 - delta) * S[i][j];
    }
  }
  return { sigma, delta, F, S };
}

// ── Bayes-Stein / Jorion (1986) shrinkage of μ ─────────────────────────────
//
// Reference: Jorion, P. (1986). "Bayes-Stein Estimation for Portfolio
// Analysis." Journal of Financial and Quantitative Analysis, 21(3), 279-292.
//
// Shrinks μ̂ toward the grand mean μ_g (minimum-variance portfolio's return)
// with intensity ψ that depends on the dispersion of μ̂ around μ_g relative
// to the noise in Σ̂. For small N or short windows, ψ is large → estimate
// looks much like the prior. This is essentially James-Stein shrinkage in
// finance dress.
//
//     μ_BS = (1 − ψ) μ̂ + ψ μ_g · 𝟙
//
// where:
//     μ_g = (𝟙ᵀ Σ̂⁻¹ μ̂) / (𝟙ᵀ Σ̂⁻¹ 𝟙)
//     λ   = (N + 2) / ( (μ̂ − μ_g𝟙)ᵀ Σ̂⁻¹ (μ̂ − μ_g𝟙) · T )
//     ψ   = λ / (1 + λ)
//
// Dimensional convention: μ and Σ are passed ANNUALIZED. T must therefore
// be in YEARS (T_anos = tradingDays / 252) for λ to be dimensionally
// correct. Earlier versions of this codebase passed T = tradingDays with
// annualized μ/Σ, producing ψ ~ 1/252 of the textbook value and silently
// rendering Stage 1 inert. To prevent that ambiguity from recurring, this
// function now takes `tradingDays` explicitly and performs the conversion
// internally — callers don't need to know.
import { inv, matVec, dot } from "./matrix";

export function jorionShrinkMu(
  mu: Vector,
  sigma: Matrix,
  tradingDays: number,
): { mu: Vector; psi: number; muGrand: number } {
  const n = mu.length;
  let sigInv: Matrix;
  try {
    sigInv = inv(sigma);
  } catch {
    return { mu: mu.slice(), psi: 0, muGrand: mu.reduce((a, b) => a + b, 0) / Math.max(n, 1) };
  }
  const ones = new Array(n).fill(1);
  const sInvOnes = matVec(sigInv, ones);
  const a = dot(ones, sInvOnes);
  const sInvMu = matVec(sigInv, mu);
  const b = dot(ones, sInvMu);
  const muGrand = b / Math.max(a, 1e-18);
  const diff = mu.map((m) => m - muGrand);
  const sInvDiff = matVec(sigInv, diff);
  const quad = Math.max(dot(diff, sInvDiff), 1e-18);
  // Convert tradingDays → T_years. Floor at 1/252 (one day) to avoid
  // division-by-zero for empty windows.
  const T_years = Math.max(tradingDays / 252, 1 / 252);
  const lam = (n + 2) / (quad * T_years);
  const psiRaw = lam / (1 + lam);
  // For our typical universe (N ≈ 25–80 tickers) the textbook Jorion formula
  // saturates at ψ ≈ 1 across all window lengths (the (N+2) numerator
  // dominates T·quad for realistic Brazilian-equity covariance). Saturation
  // collapses every μ to the grand mean μ_g, kills the cross-sectional
  // signal, and makes max-Sharpe ≡ min-variance regardless of window — the
  // 5y/10y/15y/20y/MAX selector then produces identical portfolios in the
  // UI. Capping ψ at 0.50 keeps half of the in-sample μ̂ alive so the
  // window selector actually changes the answer, while still extracting
  // meaningful James-Stein shrinkage. The cap binds for all realistic
  // (N, T) in this app; smaller universes with longer windows recover the
  // natural Jorion ψ < 0.50.
  const PSI_CAP = 0.50;
  const psi = Math.min(PSI_CAP, psiRaw);
  const muOut = mu.map((m) => (1 - psi) * m + psi * muGrand);
  return { mu: muOut, psi, muGrand };
}
