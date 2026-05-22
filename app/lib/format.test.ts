import { describe, expect, it } from "vitest";

import {
  cellColor,
  fmtAxisPct,
  fmtBRL,
  fmtInt,
  fmtNum,
  fmtNum2,
  fmtPct,
  fmtPctSigned,
  returnIntensity,
  signedClass,
} from "./format";

describe("formatters — null / undefined / NaN handling", () => {
  it.each([
    ["fmtBRL", fmtBRL],
    ["fmtPct", fmtPct],
    ["fmtPctSigned", fmtPctSigned],
    ["fmtNum", fmtNum],
    ["fmtNum2", fmtNum2],
    ["fmtInt", fmtInt],
  ])("%s returns em-dash for null/undefined/NaN/Infinity", (_name, fn) => {
    for (const bad of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(fn(bad as never)).toBe("—");
    }
  });
});

describe("fmtPctSigned", () => {
  it("always shows a sign", () => {
    expect(fmtPctSigned(0.1234)).toMatch(/^\+/);
    expect(fmtPctSigned(-0.05)).toMatch(/^-/);
  });

  it("0 is rendered with a leading + (Intl convention)", () => {
    expect(fmtPctSigned(0)).toMatch(/0/);
  });
});

describe("fmtAxisPct", () => {
  it("falls through for non-numeric input", () => {
    expect(fmtAxisPct("abc")).toBe("abc");
    expect(fmtAxisPct(NaN)).toBe(String(NaN));
  });

  it("formats numbers as pt-BR percent without decimals", () => {
    // 0.12 → "12%" in pt-BR
    expect(fmtAxisPct(0.12)).toBe("12%");
  });
});

describe("signedClass", () => {
  it("returns positive class for non-negative, negative class for negative", () => {
    expect(signedClass(0)).toBe("kpi-positive");
    expect(signedClass(0.05)).toBe("kpi-positive");
    expect(signedClass(-0.05)).toBe("kpi-negative");
  });

  it("returns muted class for non-finite", () => {
    expect(signedClass(null)).toBe("text-muted");
    expect(signedClass(undefined)).toBe("text-muted");
    expect(signedClass(NaN)).toBe("text-muted");
  });
});

describe("returnIntensity", () => {
  it("returns 0 for non-finite input", () => {
    expect(returnIntensity(null)).toBe(0);
    expect(returnIntensity(NaN)).toBe(0);
  });

  it("saturates at ±15% — magnitudes above 0.15 cap at intensity 1", () => {
    expect(returnIntensity(0.30)).toBe(1);
    expect(returnIntensity(-0.50)).toBe(1);
    expect(returnIntensity(0.15)).toBeCloseTo(1, 6);
  });

  it("is monotone in |v| for v in [0, 0.15]", () => {
    expect(returnIntensity(0.02)).toBeLessThan(returnIntensity(0.05));
    expect(returnIntensity(0.05)).toBeLessThan(returnIntensity(0.10));
  });

  it("symmetric: |v| → same intensity", () => {
    expect(returnIntensity(0.07)).toBeCloseTo(returnIntensity(-0.07), 12);
  });
});

describe("cellColor", () => {
  it("returns neutral cell color for non-finite", () => {
    expect(cellColor(null)).toBe("var(--neutral-cell)");
    expect(cellColor(undefined)).toBe("var(--neutral-cell)");
    expect(cellColor(NaN)).toBe("var(--neutral-cell)");
  });

  it("returns a gain mix for non-negative numbers", () => {
    expect(cellColor(0.05)).toMatch(/var\(--gain\)/);
  });

  it("returns a loss mix for negative numbers", () => {
    expect(cellColor(-0.05)).toMatch(/var\(--loss\)/);
  });
});
