/**
 * CDI window-mean helper.
 *
 * Reads BCB SGS série 12 (CDI Over, daily annualized) and returns the mean
 * annualized rate over the given date window. Falls back to global_mean_annual
 * or kpis.cdi_global_mean if the series isn't loaded yet.
 */

import type { CdiArtifact } from "./data";

/** Returns the mean CDI (annualized, decimal) over [startDate, endDate]. */
export function cdiMeanForWindow(
  cdi: CdiArtifact | null | undefined,
  startDate: string,
  endDate: string,
  fallback = 0.13,
): number {
  if (!cdi || !cdi.rows || cdi.rows.length === 0) return fallback;
  const slice = cdi.rows.filter((r) => r.date >= startDate && r.date <= endDate);
  if (slice.length === 0) {
    if (cdi.global_mean_annual && cdi.global_mean_annual > 0) return cdi.global_mean_annual;
    return fallback;
  }
  const mean = slice.reduce((a, b) => a + b.rate_annual_pct, 0) / slice.length;
  return mean / 100;
}

/** Latest available annual CDI rate (decimal). */
export function cdiLatest(cdi: CdiArtifact | null | undefined, fallback = 0.13): number {
  if (!cdi || !cdi.rows || cdi.rows.length === 0) return fallback;
  return cdi.rows[cdi.rows.length - 1].rate_annual_pct / 100;
}
