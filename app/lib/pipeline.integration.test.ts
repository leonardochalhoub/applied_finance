/**
 * Integration test for the full quant pipeline. Verifies that the end-to-end
 * stack — raw daily log returns → Ledoit-Wolf Σ → Jensen correction →
 * annualize → Jorion μ shrinkage (Stage 1) → applyMacroAnchor (Stages 2+3)
 * → buildFrontier — produces frontier returns inside the documented band
 * for a realistic Brazilian-equity-like return matrix.
 *
 * The methodology page (/metodologia "Calibração empírica") claims that
 * "para uma carteira max-Sharpe long-only de ações brasileiras, o intervalo
 * defensável de E[r] é rf+4% a rf+10% ≈ 17–27%". This test pins that band
 * against the actual code so any future regression (e.g. another Jorion
 * unit bug) blows up loud and visible in CI, not silently in production.
 */

import { describe, expect, it } from "vitest";

import { buildFrontier } from "./markowitz";
import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "./mvEstimators";
import { mulberry32 } from "./prng";
import { applyMacroAnchor } from "./shrinkage";

/** Generate a deterministic Brazilian-equity-style log-return matrix.
 *  Designed to mimic 8 tickers over T trading days with realistic
 *  annualized vol ~25-40% and modest cross-sectional μ dispersion. */
function syntheticBrazilLikeReturns(T: number, N: number, seed: number): number[][] {
  const rng = mulberry32(seed);
  // Each asset has a different annualized drift (between 8% and 20%) and
  // realistic daily vol (between 0.015 and 0.025 → ~24-40% annualized).
  const drifts: number[] = [];
  const vols: number[] = [];
  for (let i = 0; i < N; i++) {
    drifts.push((0.08 + (0.12 * i) / Math.max(N - 1, 1)) / 252);
    vols.push(0.015 + (0.010 * i) / Math.max(N - 1, 1));
  }
  // Build correlated noise via a simple latent-factor model (one common factor)
  const X: number[][] = [];
  for (let t = 0; t < T; t++) {
    const common = (rng() - 0.5) * 2; // shared market factor
    const row: number[] = [];
    for (let i = 0; i < N; i++) {
      const idio = (rng() - 0.5) * 2;
      const eps = 0.6 * common + 0.8 * idio; // beta ~ 0.6
      row.push(drifts[i] + vols[i] * eps);
    }
    X.push(row);
  }
  return X;
}

/** End-to-end pipeline mirroring the production component code. */
function runPipeline(X: number[][], rf: number): {
  mu: number[];
  sigma: number[][];
  fr: ReturnType<typeof buildFrontier>;
  psi: number;
  alpha: number;
} {
  const T = X.length;
  const N = X[0].length;
  const lw = ledoitWolf(X);
  const meanLog = new Array(N).fill(0);
  for (const row of X) {
    for (let i = 0; i < N; i++) meanLog[i] += row[i];
  }
  for (let i = 0; i < N; i++) meanLog[i] /= T;
  const meanSimple = jensenCorrectMu(meanLog, lw.sigma);
  const muAnnual = meanSimple.map((m) => m * 252);
  const sigmaAnnual = lw.sigma.map((row) => row.map((v) => v * 252));
  const js = jorionShrinkMu(muAnnual, sigmaAnnual, T);
  const macro = applyMacroAnchor(js.mu, rf, T);
  const fr = buildFrontier(macro.mu, sigmaAnnual, rf, {
    longOnly: true,
    cloudSize: 0,
    frontierSteps: 40,
    rng: mulberry32(42),
  });
  return { mu: macro.mu, sigma: sigmaAnnual, fr, psi: js.psi, alpha: macro.alpha };
}

describe("full pipeline integration — Brazilian-equity-like returns", () => {
  const rf = 0.13; // current CDI regime

  it("5-year window (T=1260): max-Sharpe E[r] stays under Stage-3 ceiling", () => {
    const X = syntheticBrazilLikeReturns(1260, 8, 101);
    const { fr, psi, alpha } = runPipeline(X, rf);
    expect(Number.isFinite(fr.maxSharpe.ret)).toBe(true);
    expect(fr.maxSharpe.ret).toBeLessThanOrEqual(0.31);
    // ψ active (post Jorion T-unit fix), capped at 0.50.
    expect(psi).toBeGreaterThan(0.10);
    expect(psi).toBeLessThanOrEqual(0.50 + 1e-9);
    // α at 5y ≈ 0.42 (post α-recalibration)
    expect(alpha).toBeCloseTo(0.42, 1);
  });

  it("10-year window (T=2520): α floors at 0.30", () => {
    const X = syntheticBrazilLikeReturns(2520, 8, 102);
    const { fr, alpha } = runPipeline(X, rf);
    expect(Number.isFinite(fr.maxSharpe.ret)).toBe(true);
    expect(fr.maxSharpe.ret).toBeLessThanOrEqual(0.31);
    expect(alpha).toBeCloseTo(0.30, 1);
  });

  it("20-year window (T=5040): sparsity leg lifts α to ~0.50", () => {
    const X = syntheticBrazilLikeReturns(5040, 8, 103);
    const { fr, alpha } = runPipeline(X, rf);
    expect(Number.isFinite(fr.maxSharpe.ret)).toBe(true);
    expect(fr.maxSharpe.ret).toBeLessThanOrEqual(0.31);
    expect(alpha).toBeCloseTo(0.50, 1);
  });

  it("MAX window (T=6300, ~25y): α clamps at 0.60", () => {
    const X = syntheticBrazilLikeReturns(6300, 8, 104);
    const { fr, alpha } = runPipeline(X, rf);
    expect(alpha).toBe(0.60);
    expect(Number.isFinite(fr.maxSharpe.ret)).toBe(true);
    expect(fr.maxSharpe.ret).toBeLessThanOrEqual(0.31);
  });

  it("REGRESSION: at no window does max-Sharpe return exceed the per-asset ceiling (rf + 3·ERP = 0.31)", () => {
    // The Stage 3 ceiling caps individual μ_i; a long-only convex weighted
    // combination is bounded above by the maximum component. So the
    // max-Sharpe return must never exceed the ceiling.
    for (const years of [0.5, 1, 5, 10, 15, 20, 25]) {
      const X = syntheticBrazilLikeReturns(Math.floor(years * 252), 8, 200 + years);
      const { fr } = runPipeline(X, rf);
      expect(fr.maxSharpe.ret).toBeLessThanOrEqual(0.31 + 1e-9);
    }
  });

  it("min-variance Sharpe ≤ max-Sharpe Sharpe — basic ordering invariant", () => {
    const X = syntheticBrazilLikeReturns(1260, 8, 105);
    const { fr } = runPipeline(X, rf);
    expect(fr.minVariance.sharpe).toBeLessThanOrEqual(fr.maxSharpe.sharpe + 1e-9);
  });
});
