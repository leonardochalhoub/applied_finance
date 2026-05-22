import { describe, expect, it } from "vitest";

import { windowLabelPt, windowStartIndex } from "./windowed";

describe("windowStartIndex", () => {
  it("returns 0 for an empty date array regardless of window", () => {
    expect(windowStartIndex([], "1M")).toBe(0);
    expect(windowStartIndex([], "MAX")).toBe(0);
    expect(windowStartIndex([], "YTD")).toBe(0);
  });

  it("returns 0 for MAX (always start at the beginning)", () => {
    const dates = ["2020-01-02", "2020-01-03", "2024-12-30"];
    expect(windowStartIndex(dates, "MAX")).toBe(0);
  });

  it("returns dates.length - 252 for a 1Y window with > 252 dates", () => {
    const N = 500;
    const dates = Array.from({ length: N }, (_, i) => `2024-${String(i + 1).padStart(3, "0")}`);
    expect(windowStartIndex(dates, "1Y")).toBe(N - 252);
  });

  it("clamps at 0 when the requested window exceeds available history", () => {
    const dates = ["2024-01-02", "2024-01-03", "2024-01-04"];
    expect(windowStartIndex(dates, "1Y")).toBe(0);
    expect(windowStartIndex(dates, "5Y")).toBe(0);
  });

  it("YTD returns the first date with year >= the latest date's year", () => {
    const dates = ["2023-12-31", "2024-01-02", "2024-06-15", "2024-12-30"];
    // Latest year is 2024 → first index where date starts with 2024 is 1
    expect(windowStartIndex(dates, "YTD")).toBe(1);
  });

  it("uses the documented day count per window label", () => {
    const N = 6000;
    const dates = Array.from({ length: N }, (_, i) => `D${i}`);
    expect(windowStartIndex(dates, "1M")).toBe(N - 22);
    expect(windowStartIndex(dates, "3M")).toBe(N - 66);
    expect(windowStartIndex(dates, "6M")).toBe(N - 132);
    expect(windowStartIndex(dates, "1Y")).toBe(N - 252);
    expect(windowStartIndex(dates, "5Y")).toBe(N - 1260);
    expect(windowStartIndex(dates, "10Y")).toBe(N - 2520);
    expect(windowStartIndex(dates, "15Y")).toBe(N - 3780);
    expect(windowStartIndex(dates, "20Y")).toBe(N - 5040);
  });
});

describe("windowLabelPt", () => {
  it("returns a pt-BR label for every window value", () => {
    for (const w of ["1M", "3M", "6M", "YTD", "1Y", "5Y", "10Y", "15Y", "20Y", "MAX"] as const) {
      expect(typeof windowLabelPt(w)).toBe("string");
      expect(windowLabelPt(w).length).toBeGreaterThan(0);
    }
  });
});
