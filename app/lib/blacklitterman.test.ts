import { describe, expect, it } from "vitest";

import { blackLitterman, impliedReturns, type View } from "./blacklitterman";

function diagSigma(diag: number[]): number[][] {
  return diag.map((v, i) => diag.map((_, j) => (i === j ? v : 0)));
}

describe("impliedReturns", () => {
  it("Π = δ Σ w_mkt for a diagonal Σ", () => {
    const sigma = diagSigma([0.04, 0.09, 0.16]);
    const w = [0.5, 0.3, 0.2];
    const delta = 2.5;
    const pi = impliedReturns(sigma, w, delta);
    // δ · diag(σ²ᵢ) · wᵢ
    expect(pi[0]).toBeCloseTo(2.5 * 0.04 * 0.5, 10);
    expect(pi[1]).toBeCloseTo(2.5 * 0.09 * 0.3, 10);
    expect(pi[2]).toBeCloseTo(2.5 * 0.16 * 0.2, 10);
  });

  it("throws on dimension mismatch", () => {
    expect(() => impliedReturns(diagSigma([1, 2]), [1, 2, 3], 2.5)).toThrow();
  });
});

describe("blackLitterman — no views", () => {
  it("posterior μ equals prior Π exactly", () => {
    const sigma = diagSigma([0.04, 0.09]);
    const w = [0.6, 0.4];
    const r = blackLitterman({ sigma, wMkt: w, delta: 2.5, tau: 0.05 });
    expect(r.muBL).toEqual(r.pi);
    expect(r.viewDiagnostics).toEqual([]);
  });

  it("posterior covariance of μ = τΣ", () => {
    const sigma = diagSigma([0.04, 0.09]);
    const w = [0.5, 0.5];
    const r = blackLitterman({ sigma, wMkt: w, delta: 2.5, tau: 0.05 });
    expect(r.muCov[0][0]).toBeCloseTo(0.05 * 0.04, 10);
    expect(r.muCov[1][1]).toBeCloseTo(0.05 * 0.09, 10);
  });

  it("Σ_BL = (1 + τ) Σ with no views", () => {
    const sigma = diagSigma([0.04, 0.09]);
    const w = [0.5, 0.5];
    const r = blackLitterman({ sigma, wMkt: w, delta: 2.5, tau: 0.05 });
    expect(r.sigmaBL[0][0]).toBeCloseTo(1.05 * 0.04, 10);
    expect(r.sigmaBL[1][1]).toBeCloseTo(1.05 * 0.09, 10);
  });
});

describe("blackLitterman — single absolute view", () => {
  it("view pulls posterior μ toward the view's expected return", () => {
    const sigma = diagSigma([0.04, 0.09, 0.16]);
    const w = [0.4, 0.4, 0.2];
    const pi = impliedReturns(sigma, w, 2.5);
    // View: "asset 0 will return 0.30" with high confidence
    const view: View = {
      tickerIndices: [0],
      coeffs: [1],
      expectedReturn: 0.30,
      confidence: 0.9,
      label: "asset 0 → 30%",
    };
    const r = blackLitterman({ sigma, wMkt: w, delta: 2.5, tau: 0.05, views: [view] });
    // Posterior on the viewed asset should sit BETWEEN the prior Π[0] and 0.30,
    // and STRICTLY MOVED toward 0.30.
    expect(r.muBL[0]).toBeGreaterThan(pi[0]);
    expect(r.muBL[0]).toBeLessThan(0.30);
  });

  it("higher confidence pulls posterior closer to the view", () => {
    const sigma = diagSigma([0.04, 0.09]);
    const w = [0.6, 0.4];
    const view = (conf: number): View => ({
      tickerIndices: [0],
      coeffs: [1],
      expectedReturn: 0.30,
      confidence: conf,
    });
    const lo = blackLitterman({ sigma, wMkt: w, delta: 2.5, tau: 0.05, views: [view(0.1)] });
    const hi = blackLitterman({ sigma, wMkt: w, delta: 2.5, tau: 0.05, views: [view(0.95)] });
    // High confidence ⇒ posterior closer to 0.30 (smaller residual)
    expect(Math.abs(0.30 - hi.muBL[0])).toBeLessThan(Math.abs(0.30 - lo.muBL[0]));
  });

  it("view diagnostics: residual = Q − P·Π", () => {
    const sigma = diagSigma([0.04, 0.09]);
    const w = [0.5, 0.5];
    const r = blackLitterman({
      sigma,
      wMkt: w,
      delta: 2.5,
      tau: 0.05,
      views: [{ tickerIndices: [1], coeffs: [1], expectedReturn: 0.20, confidence: 0.5, label: "v1" }],
    });
    expect(r.viewDiagnostics.length).toBe(1);
    const d = r.viewDiagnostics[0];
    expect(d.label).toBe("v1");
    expect(d.residual).toBeCloseTo(0.20 - r.pi[1], 10);
    expect(d.priorReturn).toBeCloseTo(r.pi[1], 10);
  });
});

describe("blackLitterman — relative view", () => {
  it("relative view 'A − B = 0.05' tilts posterior so μ_A − μ_B moves toward 0.05", () => {
    const sigma = diagSigma([0.04, 0.04, 0.09]);
    const w = [0.4, 0.4, 0.2];
    const pi = impliedReturns(sigma, w, 2.5);
    const priorSpread = pi[0] - pi[1];
    const r = blackLitterman({
      sigma,
      wMkt: w,
      delta: 2.5,
      tau: 0.05,
      views: [
        {
          tickerIndices: [0, 1],
          coeffs: [1, -1],
          expectedReturn: 0.05,
          confidence: 0.75,
          label: "A beats B by 5pp",
        },
      ],
    });
    const postSpread = r.muBL[0] - r.muBL[1];
    expect(postSpread).toBeGreaterThan(priorSpread);
    expect(postSpread).toBeLessThan(0.05);
  });
});

describe("blackLitterman — invariants", () => {
  it("Σ_BL stays symmetric and PD-ish (all diag > Σ_ii) with views", () => {
    const sigma = diagSigma([0.04, 0.09, 0.16]);
    const w = [0.4, 0.4, 0.2];
    const r = blackLitterman({
      sigma,
      wMkt: w,
      delta: 2.5,
      tau: 0.05,
      views: [{ tickerIndices: [1], coeffs: [1], expectedReturn: 0.18, confidence: 0.5 }],
    });
    for (let i = 0; i < 3; i++) {
      expect(r.sigmaBL[i][i]).toBeGreaterThan(sigma[i][i] - 1e-12);
      for (let j = 0; j < 3; j++) {
        expect(r.sigmaBL[i][j]).toBeCloseTo(r.sigmaBL[j][i], 10);
      }
    }
  });
});
