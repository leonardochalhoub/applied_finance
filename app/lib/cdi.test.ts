import { describe, expect, it } from "vitest";

import { cdiLatest, cdiMeanForWindow } from "./cdi";
import type { CdiArtifact } from "./data";

const mkCdi = (
  rows: { date: string; rate_annual_pct: number }[],
  globalMean?: number,
): CdiArtifact => ({
  source: "test",
  fetched_at: "2024-01-01",
  rows: rows.map((r) => ({ ...r, rate_daily_pct: r.rate_annual_pct / 252 })),
  global_mean_annual: globalMean ?? 0,
});

describe("cdiMeanForWindow", () => {
  it("returns the fallback when cdi is null/undefined or empty", () => {
    expect(cdiMeanForWindow(null, "2024-01-01", "2024-12-31", 0.111)).toBe(0.111);
    expect(cdiMeanForWindow(undefined, "2024-01-01", "2024-12-31", 0.222)).toBe(0.222);
    expect(cdiMeanForWindow(mkCdi([]), "2024-01-01", "2024-12-31", 0.333)).toBe(0.333);
  });

  it("averages rates inside the window in annual decimals", () => {
    const cdi = mkCdi([
      { date: "2024-01-15", rate_annual_pct: 11.0 },
      { date: "2024-06-15", rate_annual_pct: 12.0 },
      { date: "2024-11-15", rate_annual_pct: 13.0 },
    ]);
    const out = cdiMeanForWindow(cdi, "2024-01-01", "2024-12-31");
    // (11+12+13)/3 = 12 → 0.12 decimal
    expect(out).toBeCloseTo(0.12, 6);
  });

  it("excludes rows outside the window", () => {
    const cdi = mkCdi([
      { date: "2023-12-31", rate_annual_pct: 5.0 }, // out
      { date: "2024-06-15", rate_annual_pct: 13.0 }, // in
      { date: "2025-01-02", rate_annual_pct: 100.0 }, // out
    ]);
    const out = cdiMeanForWindow(cdi, "2024-01-01", "2024-12-31");
    expect(out).toBeCloseTo(0.13, 6);
  });

  it("falls back to global_mean_annual when the window has no rows", () => {
    const cdi = mkCdi(
      [{ date: "2020-01-01", rate_annual_pct: 5.0 }],
      0.0875,
    );
    const out = cdiMeanForWindow(cdi, "2024-01-01", "2024-12-31");
    expect(out).toBe(0.0875);
  });

  it("falls back to the provided default when window empty and no global", () => {
    const cdi = mkCdi(
      [{ date: "2020-01-01", rate_annual_pct: 5.0 }],
      0,
    );
    const out = cdiMeanForWindow(cdi, "2024-01-01", "2024-12-31", 0.42);
    expect(out).toBe(0.42);
  });
});

describe("cdiLatest", () => {
  it("returns the fallback when cdi is null or empty", () => {
    expect(cdiLatest(null, 0.1)).toBe(0.1);
    expect(cdiLatest(mkCdi([]), 0.2)).toBe(0.2);
  });

  it("returns the last row's annualized rate as a decimal", () => {
    const cdi = mkCdi([
      { date: "2024-01-15", rate_annual_pct: 11.0 },
      { date: "2024-06-15", rate_annual_pct: 12.0 },
      { date: "2024-11-15", rate_annual_pct: 13.5 },
    ]);
    expect(cdiLatest(cdi)).toBeCloseTo(0.135, 6);
  });
});
