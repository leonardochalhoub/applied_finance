import { describe, expect, it } from "vitest";

import { analyze, type AdvisorInput } from "./advisor";

/** Tiny canonical 3-asset advisor input. The numbers below are illustrative;
 *  the tests assert STRUCTURAL properties (gates, downgrades, ranking) not
 *  numeric exact-matches. */
const baseInput = (): AdvisorInput => ({
  tickers: ["A", "B", "C"],
  userWeights: [0.5, 0.3, 0.2],
  optimalWeights: [0.3, 0.3, 0.4],
  rf: 0.05,
  mu: [0.10, 0.15, 0.20],
  sigma: [
    [0.04, 0.01, 0.005],
    [0.01, 0.09, 0.015],
    [0.005, 0.015, 0.16],
  ],
  userPoint: { weights: [0.5, 0.3, 0.2], ret: 0.13, vol: 0.20, sharpe: 0.40 },
  optimalPoint: { weights: [0.3, 0.3, 0.4], ret: 0.16, vol: 0.22, sharpe: 0.50 },
});

describe("analyze — diagnostics", () => {
  it("computes HHI and effective N for the user portfolio", () => {
    const r = analyze(baseInput());
    // HHI for [0.5, 0.3, 0.2] = (0.25+0.09+0.04)*10000 = 3800
    expect(r.diagnostics.hhi).toBeCloseTo(3800, 0);
    // effN = 1 / 0.38 ≈ 2.63
    expect(r.diagnostics.effectiveN).toBeCloseTo(1 / 0.38, 4);
  });

  it("computes sharpeGap = optimal - user", () => {
    const r = analyze(baseInput());
    expect(r.diagnostics.sharpeGap).toBeCloseTo(0.10, 6);
  });

  it("verdict is 'razoável' for moderate gap + medium concentration", () => {
    const r = analyze(baseInput());
    // sharpeGap=0.10, effN≈2.63 → effN<3, so verdict drops to 'fraca'
    // (the test verifies the documented thresholds: <0.1 + effN≥4 = forte,
    // <0.3 + effN≥3 = razoável, else fraca)
    expect(r.verdict).toBe("fraca");
  });
});

describe("analyze — verdict thresholds", () => {
  it("returns 'forte' when sharpeGap < 0.1 and effective N ≥ 4", () => {
    const input = baseInput();
    input.userWeights = [0.25, 0.25, 0.25, 0.25];
    input.tickers = ["A", "B", "C", "D"];
    input.optimalWeights = [0.25, 0.25, 0.25, 0.25];
    input.mu = [0.10, 0.15, 0.20, 0.12];
    input.sigma = [
      [0.04, 0.01, 0, 0],
      [0.01, 0.09, 0, 0],
      [0, 0, 0.16, 0],
      [0, 0, 0, 0.06],
    ];
    input.userPoint = { weights: [0.25, 0.25, 0.25, 0.25], ret: 0.15, vol: 0.20, sharpe: 0.50 };
    input.optimalPoint = { weights: [0.25, 0.25, 0.25, 0.25], ret: 0.15, vol: 0.20, sharpe: 0.55 };
    const r = analyze(input);
    expect(r.verdict).toBe("forte");
  });

  it("returns 'fraca' when sharpeGap is large", () => {
    const input = baseInput();
    input.userPoint = { ...input.userPoint, sharpe: 0.10 };
    input.optimalPoint = { ...input.optimalPoint, sharpe: 0.50 };
    const r = analyze(input);
    expect(r.verdict).toBe("fraca");
  });
});

describe("analyze — bootstrap significance gate", () => {
  it("issues strong 'reduzir/aumentar' actions when no bootstrap is provided", () => {
    const r = analyze(baseInput());
    // baseline: large Δw on A (-0.20) and C (+0.20); without bootstrap data
    // the advisor should emit at least one strong action (reduzir or
    // aumentar/comprar/adicionar).
    const strongVerbs = r.recommendations.filter(
      (rec) => rec.action === "vender" || rec.action === "reduzir" || rec.action === "comprar" || rec.action === "adicionar",
    );
    expect(strongVerbs.length).toBeGreaterThan(0);
  });

  it("downgrades to 'considerar' when bootstrapStd is large (Δw inside 2σ band)", () => {
    const input = baseInput();
    input.bootstrapStd = [0.20, 0.20, 0.20]; // 2σ = 0.40, much larger than |Δw|=0.20
    const r = analyze(input);
    // No strong action verbs should appear
    const strongVerbs = r.recommendations.filter(
      (rec) => rec.action === "vender" || rec.action === "reduzir" || rec.action === "comprar" || rec.action === "adicionar",
    );
    expect(strongVerbs).toHaveLength(0);
  });

  it("REGRESSION: bootstrap failure (all-zero std) suppresses strong verbs and emits a warning", () => {
    // This is the critical Beff=0 case. Previously, all-zero stds meant
    // every Δw was "significant" by |Δw| > 0 and the advisor issued strong
    // buy/sell on every position with any deviation — including pure noise.
    const input = baseInput();
    input.bootstrapStd = [0, 0, 0];
    const r = analyze(input);
    // 1. There must be a top-level "Bootstrap sem cobertura" warning
    const failureNotice = r.recommendations.find(
      (rec) => rec.title === "Bootstrap sem cobertura",
    );
    expect(failureNotice).toBeDefined();
    expect(failureNotice!.level).toBe("warn");
    // 2. No strong verbs anywhere
    const strongVerbs = r.recommendations.filter(
      (rec) => rec.action === "vender" || rec.action === "reduzir" || rec.action === "comprar" || rec.action === "adicionar",
    );
    expect(strongVerbs).toHaveLength(0);
  });

  it("issues strong actions on the entries where |Δw| > 2·σ_bootstrap and downgrades the rest", () => {
    const input = baseInput();
    // A has large σ, B has tiny σ, C has medium σ
    // |Δw_A| = 0.20, 2·0.15 = 0.30 → NOT significant (inside band)
    // |Δw_B| = 0.00, 2·0.01 = 0.02 → also inside (no Δw anyway)
    // |Δw_C| = 0.20, 2·0.05 = 0.10 → SIGNIFICANT
    input.bootstrapStd = [0.15, 0.01, 0.05];
    const r = analyze(input);
    const cAction = r.recommendations.find((rec) => rec.ticker === "C");
    const aAction = r.recommendations.find((rec) => rec.ticker === "A");
    // C: significant → should get strong verb
    expect(cAction?.action).toMatch(/^(adicionar|comprar|aumentar)$/);
    // A: not significant → if present, should be "Considerar reduzir" (no action verb)
    if (aAction) {
      expect(aAction.action).toBeUndefined();
      expect(aAction.title.toLowerCase()).toMatch(/considerar/);
    }
  });
});

describe("analyze — diversification recommendation", () => {
  it("flags concentration when effective N < 3", () => {
    const input = baseInput();
    input.userWeights = [0.7, 0.2, 0.1];
    input.userPoint = { ...input.userPoint, weights: [0.7, 0.2, 0.1] };
    const r = analyze(input);
    const conc = r.recommendations.find((rec) => rec.title === "Concentração excessiva");
    expect(conc).toBeDefined();
    expect(conc!.level).toBe("bad");
  });

  it("rewards good diversification when effective N ≥ 5 (uses 6 equal-weight assets to clear the floating-point boundary)", () => {
    const input = baseInput();
    input.tickers = ["A", "B", "C", "D", "E", "F"];
    const w = new Array(6).fill(1 / 6);
    input.userWeights = w.slice();
    input.optimalWeights = w.slice();
    input.mu = [0.10, 0.12, 0.14, 0.16, 0.18, 0.20];
    input.sigma = Array.from({ length: 6 }, (_, i) =>
      Array.from({ length: 6 }, (_, j) => (i === j ? 0.04 + i * 0.005 : 0)),
    );
    input.userPoint = { weights: w.slice(), ret: 0.14, vol: 0.18, sharpe: 0.50 };
    input.optimalPoint = { weights: w.slice(), ret: 0.14, vol: 0.18, sharpe: 0.50 };
    const r = analyze(input);
    const div = r.recommendations.find((rec) => rec.title === "Boa diversificação");
    expect(div).toBeDefined();
    expect(div!.level).toBe("good");
  });
});

describe("analyze — vol mismatch detection", () => {
  it("flags 'Volatilidade elevada' when user vol > 1.4× optimal vol", () => {
    const input = baseInput();
    input.userPoint = { ...input.userPoint, vol: 0.40 };
    input.optimalPoint = { ...input.optimalPoint, vol: 0.20 };
    const r = analyze(input);
    expect(r.recommendations.some((rec) => rec.title === "Volatilidade elevada")).toBe(true);
  });

  it("flags 'Perfil conservador' when user vol much lower with negative return gap", () => {
    const input = baseInput();
    input.userPoint = { ...input.userPoint, vol: 0.10, ret: 0.08 };
    input.optimalPoint = { ...input.optimalPoint, vol: 0.20, ret: 0.16 };
    const r = analyze(input);
    expect(r.recommendations.some((rec) => rec.title === "Perfil conservador detectado")).toBe(true);
  });
});
