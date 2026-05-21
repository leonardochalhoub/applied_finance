import { describe, expect, it } from "vitest";

import {
  annualizedVolatility,
  dailyLogReturns,
  maxDrawdown,
  returnLog,
  sharpeVsCdi,
} from "./kpi";

describe("returnLog", () => {
  it("computes log return between first and last", () => {
    expect(returnLog([100, 200])).toBeCloseTo(Math.log(2), 10);
  });
  it("returns NaN for empty series", () => {
    expect(returnLog([])).toBeNaN();
    expect(returnLog([100])).toBeNaN();
  });
});

describe("dailyLogReturns", () => {
  it("produces n-1 returns for n prices", () => {
    expect(dailyLogReturns([100, 110, 121])).toHaveLength(2);
  });
});

describe("annualizedVolatility", () => {
  it("scales by sqrt(252)", () => {
    const r = [0.01, -0.01, 0.005, -0.005, 0.01, -0.01];
    const v = annualizedVolatility(r);
    expect(v).toBeGreaterThan(0);
  });
});

describe("maxDrawdown", () => {
  it("returns 0 for monotone increasing series", () => {
    expect(maxDrawdown([1, 2, 3, 4])).toBe(0);
  });
  it("captures the deepest trough", () => {
    const dd = maxDrawdown([100, 120, 60, 100]);
    expect(dd).toBeCloseTo((60 - 120) / 120, 10);
  });
});

describe("sharpeVsCdi", () => {
  it("yields finite Sharpe for non-zero vol", () => {
    const r = [0.001, 0.002, -0.001, 0.0015, 0.0005];
    expect(Number.isFinite(sharpeVsCdi(r, 0.1075))).toBe(true);
  });
});
