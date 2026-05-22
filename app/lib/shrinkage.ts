/**
 * Macro-anchor shrinkage of μ — Stage 2 (anchor toward rf + ERP) and Stage 3
 * (per-asset ceiling at rf + K·ERP). Single source of truth for the U-shape
 * α(T), the equity-risk-premium prior, and the per-asset μ ceiling — consumed
 * identically by PortfolioSuggestions, PortfolioBuilder, and the bootstrap
 * pipeline so that the displayed frontier and the bootstrap envelope are
 * built on the *same* μ.
 *
 * Full derivation and empirical calibration in /metodologia → "Calibração
 * empírica — benchmarks e decisões".
 */

/** Equity risk premium prior (Damodaran 2026, Brazil emerging). */
export const ERP_PRIOR = 0.06;

/** Per-asset μ ceiling multiplier: no asset is allowed to expect more than
 *  rf + K·ERP. K=3 ⇒ ceiling ≈ 31% under current CDI regime. */
export const MU_CEILING_K = 3;

/**
 * Macro-prior intensity α(T) — U-shaped in T_years.
 *
 *   noiseLeg     = 0.60 − 0.04·(T − 0.5)₊    — short-T estimation noise
 *   sparsityLeg  = 0.30 + 0.020·(T − 10)₊    — long-T sparse-universe bias
 *   α(T)         = clip[max(noiseLeg, sparsityLeg), 0.30, 0.60]
 *
 * `Tn` is the number of daily log-return observations in the window
 * (years = Tn / 252). For an exactly 5-year window of 1260 prices this is
 * 1259, but the /252 division absorbs the one-off.
 *
 * Calibration history:
 *
 *   - Original: ceiling 0.95 / floor 0.55. Designed when Stage 1 (Jorion)
 *     was effectively inert due to a dimensional bug — α(T) had to do
 *     all the regularisation alone. With Stage 1 fixed and capped at
 *     ψ ≤ 0.50, the old α(T) became excessive: μ ≈ anchor for every
 *     asset and the window selector produced visually identical
 *     portfolios across 5y/10y/15y/20y/MAX. Stage 3's per-asset ceiling
 *     (rf + 3·ERP ≈ 31%) catches the outlier tails Stage 2 used to
 *     guard against.
 *   - Current: ceiling 0.60 / floor 0.30. Lets 40–70% of the in-sample
 *     signal pass through (after Jorion's 50% Stage-1 shrinkage), so
 *     window changes produce visibly different portfolios. Stage 3's
 *     hard cap remains the safety net against cartoon individual μ_i.
 */
export function macroPriorAlpha(Tn: number): number {
  const years = Math.max(0.05, Tn / 252);
  const noiseLeg = 0.60 - 0.04 * Math.max(years - 0.5, 0);
  const sparsityLeg = 0.30 + 0.020 * Math.max(years - 10, 0);
  return Math.min(0.60, Math.max(0.30, Math.max(noiseLeg, sparsityLeg)));
}

/**
 * Apply Stages 2 + 3 of the displayed shrinkage pipeline on top of the
 * Stage-1 (Jorion / Bayes-Stein) shrunken μ vector.
 *
 *   Stage 2 (macro-anchor):  μ_blended_i = (1 − α(Tn)) · μ_BS_i + α(Tn) · (rf + ERP)
 *   Stage 3 (per-asset cap): μ_final_i   = min(μ_blended_i, rf + MU_CEILING_K · ERP)
 *
 * Pure function — no side effects. Used identically by `PortfolioSuggestions`,
 * `PortfolioBuilder`, `bootstrap._estimate`, and `backtest._solveMaxSharpe`,
 * which guarantees the displayed frontier and the bootstrap/backtest
 * envelopes are computed on the SAME μ. Any future change to the
 * shrinkage stack should happen here.
 *
 * @param mu  Annualised, Stage-1-shrunken μ (Jorion output). Length N.
 * @param rf  Annualised risk-free rate. The anchor (rf + ERP) and the
 *            ceiling (rf + K·ERP) both move with rf.
 * @param Tn  Number of daily log-return observations in the training
 *            window. Converted internally to T_years for the α(T) U-shape.
 *
 * @returns The shrunken μ plus the diagnostic intensities (α, anchor,
 *          ceiling) — exposed so the UI can display them in tooltips.
 */
export function applyMacroAnchor(mu: number[], rf: number, Tn: number): {
  mu: number[];
  alpha: number;
  anchor: number;
  ceiling: number;
} {
  const alpha = macroPriorAlpha(Tn);
  const anchor = rf + ERP_PRIOR;
  const ceiling = rf + MU_CEILING_K * ERP_PRIOR;
  const muOut = mu.map((m) => {
    const blended = (1 - alpha) * m + alpha * anchor;
    return Math.min(blended, ceiling);
  });
  return { mu: muOut, alpha, anchor, ceiling };
}
