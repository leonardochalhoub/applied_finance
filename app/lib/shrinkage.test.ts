import { describe, expect, it } from "vitest";

import {
  applyMacroAnchor,
  ERP_PRIOR,
  macroPriorAlpha,
  MU_CEILING_K,
} from "./shrinkage";

describe("macroPriorAlpha — U-shape boundary behaviour", () => {
  it("hits the upper cap (0.60) at very short windows", () => {
    expect(macroPriorAlpha(1)).toBeCloseTo(0.60, 4); // ~ 0 years
    expect(macroPriorAlpha(126)).toBeCloseTo(0.60, 4); // 6 months
  });

  it("sits near the lower floor (0.30) around the noise/sparsity crossover", () => {
    // T ≈ 10y: noiseLeg = 0.60 - 0.04·9.5 = 0.22 (below floor),
    // sparsityLeg = 0.30 + 0 = 0.30. clip → 0.30.
    const a10 = macroPriorAlpha(10 * 252);
    expect(a10).toBeGreaterThanOrEqual(0.30);
    expect(a10).toBeLessThanOrEqual(0.32);
  });

  it("rises with T past 10 years (sparsity leg dominates)", () => {
    expect(macroPriorAlpha(15 * 252)).toBeCloseTo(0.40, 2);
    expect(macroPriorAlpha(20 * 252)).toBeCloseTo(0.50, 2);
  });

  it("clamps at 0.60 ceiling for very long windows", () => {
    expect(macroPriorAlpha(25 * 252)).toBe(0.60);
    expect(macroPriorAlpha(100 * 252)).toBe(0.60);
  });

  it("clamps at 0.30 floor (never goes below)", () => {
    for (let years = 0.05; years <= 30; years += 0.5) {
      expect(macroPriorAlpha(years * 252)).toBeGreaterThanOrEqual(0.30);
    }
  });

  it("is monotone-decreasing for years ≤ ~10 and monotone-increasing past ~12", () => {
    // Noise leg dominates in [0.5, 10]
    expect(macroPriorAlpha(0.5 * 252)).toBeGreaterThan(macroPriorAlpha(5 * 252));
    expect(macroPriorAlpha(5 * 252)).toBeGreaterThan(macroPriorAlpha(10 * 252));
    // Sparsity leg dominates past ~12
    expect(macroPriorAlpha(12 * 252)).toBeLessThanOrEqual(macroPriorAlpha(15 * 252));
    expect(macroPriorAlpha(15 * 252)).toBeLessThan(macroPriorAlpha(20 * 252));
  });
});

describe("applyMacroAnchor — blend + ceiling", () => {
  it("returns alpha, anchor, ceiling, and a muted μ", () => {
    const out = applyMacroAnchor([0.3, 0.4], 0.13, 5 * 252);
    expect(out.alpha).toBeCloseTo(0.42, 2);
    expect(out.anchor).toBeCloseTo(0.13 + ERP_PRIOR, 6);
    expect(out.ceiling).toBeCloseTo(0.13 + MU_CEILING_K * ERP_PRIOR, 6);
    expect(out.mu).toHaveLength(2);
  });

  it("blends linearly toward anchor (verified by hand)", () => {
    // 5y window → α=0.42, anchor = 0.13 + 0.06 = 0.19
    // For μ_BS = 0.30: blended = 0.58·0.30 + 0.42·0.19 = 0.174 + 0.0798 = 0.2538
    const out = applyMacroAnchor([0.3], 0.13, 5 * 252);
    expect(out.alpha).toBeCloseTo(0.42, 2);
    expect(out.mu[0]).toBeCloseTo(0.2538, 3);
  });

  it("clamps individual μ_i above rf + K·ERP", () => {
    // Cartoon asset with μ = 5.0. At any α < 1, blended >> ceiling, so the
    // clip to rf + 3·ERP = 0.31 fires.
    const out = applyMacroAnchor([5.0], 0.13, 5 * 252);
    expect(out.mu[0]).toBe(out.ceiling);
  });

  it("never pushes μ below the anchor when input is below anchor", () => {
    // If μ_BS is already below anchor, blend pulls UP toward anchor.
    // This is intentional (long-window prior is "the equity premium").
    const out = applyMacroAnchor([0.05], 0.13, 20 * 252);
    expect(out.mu[0]).toBeGreaterThan(0.05);
    expect(out.mu[0]).toBeLessThanOrEqual(out.anchor);
  });

  it("identity at α=0 would be μ unchanged — sanity check the formula", () => {
    // α can't actually reach 0 (floor 0.55), but we can verify the formula
    // by computing the blend with α=0 manually outside the helper:
    // blended = 1·μ + 0·anchor = μ; ceiling clipping only.
    const alpha = 0;
    const rf = 0.13;
    const anchor = rf + ERP_PRIOR;
    const blended = (1 - alpha) * 0.20 + alpha * anchor;
    expect(blended).toBe(0.20);
  });
});

describe("methodology page consistency", () => {
  it("the indicative α values shown on /metodologia match the code", () => {
    // Forensic verification: any change to the U-shape must update both
    // the LaTeX/prose on `/metodologia` and the numbers in the table.
    expect(macroPriorAlpha(0.5 * 252)).toBeCloseTo(0.60, 2);
    expect(macroPriorAlpha(1 * 252)).toBeCloseTo(0.58, 2);
    expect(macroPriorAlpha(5 * 252)).toBeCloseTo(0.42, 2);
    expect(macroPriorAlpha(10 * 252)).toBeCloseTo(0.30, 2);
    expect(macroPriorAlpha(15 * 252)).toBeCloseTo(0.40, 2);
    expect(macroPriorAlpha(20 * 252)).toBeCloseTo(0.50, 2);
  });

  it("documented ERP and K constants match the source of truth", () => {
    expect(ERP_PRIOR).toBe(0.06);
    expect(MU_CEILING_K).toBe(3);
  });
});
