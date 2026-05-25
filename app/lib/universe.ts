/**
 * Universe selection helpers shared across walk-forward backtests (/ingenuo)
 * and single-split experiments (/ilusao). The core problem is the same in both
 * places: the user picks "top 30 IBOV" but ALOS3 has only 2 years of history,
 * so the strictly-coterminal window across the whole top-30 is too short to
 * fit the requested train+test budget.
 *
 * `tightenUniverseForHistory` greedily drops the ticker with the latest
 * first-data point until the coterminal window is wide enough — preserving
 * the IBOV-weight ordering otherwise. This keeps the visualisation honest
 * about who got cut, without silently extending the universe with NaNs.
 */

import type { PricesArtifact } from "./data";

/** Index of the first row at which every selected ticker has a positive,
 *  non-null close. Returns `T` when no such row exists. */
export function firstCoterminalIndex(series: (number | null)[][]): number {
  const T = series[0]?.length ?? 0;
  for (let t = 0; t < T; t++) {
    let ok = true;
    for (const s of series) {
      const v = s[t];
      if (v == null || !(v > 0)) {
        ok = false;
        break;
      }
    }
    if (ok) return t;
  }
  return T;
}

export type TightenedUniverse = {
  /** Tickers kept after history-based pruning, in original ranking order. */
  tickers: string[];
  /** Aligned weights (renormalised to sum to 1, or null if input weights summed to 0). */
  weights: number[];
  /** First coterminal index in the prices artifact. */
  startIdx: number;
  /** Days available between startIdx and the end of the price history. */
  availableDays: number;
  /** Tickers dropped because they shortened the coterminal window. */
  droppedForHistory: string[];
};

/** Greedy auto-tightening: starting from `(rankedTickers, rankedWeights)`,
 *  drop the ticker with the LATEST first-data point until the coterminal
 *  window is at least `requiredDays` wide, or until only 2 tickers remain
 *  (preserving rank order otherwise).
 *
 *  Returns the kept tickers (with renormalised weights), the start index,
 *  the available days from that start, and the list of dropped tickers
 *  (in the order they were dropped — usually most-recent-IPO first). */
export function tightenUniverseForHistory(
  prices: PricesArtifact,
  rankedTickers: string[],
  rankedWeights: number[],
  requiredDays: number,
): TightenedUniverse {
  const T = prices.dates.length;
  const dropped: string[] = [];
  let kept = rankedTickers.slice();
  let weights = rankedWeights.slice();
  while (kept.length >= 2) {
    const series = kept.map((t) => prices.series[t]).filter((s): s is (number | null)[] => Boolean(s));
    if (series.length !== kept.length) {
      return { tickers: kept, weights, startIdx: 0, availableDays: 0, droppedForHistory: dropped };
    }
    const startIdx = firstCoterminalIndex(series);
    // One row lost to log-return diffs (we use p[t]/p[t-1]).
    const available = Math.max(0, T - startIdx - 1);
    if (available >= requiredDays || kept.length === 2) {
      return { tickers: kept, weights, startIdx, availableDays: available, droppedForHistory: dropped };
    }
    let worstI = 0;
    let worstStart = -1;
    for (let i = 0; i < kept.length; i++) {
      const s = series[i];
      let firstOk = T;
      for (let t = 0; t < T; t++) {
        const v = s[t];
        if (v != null && v > 0) {
          firstOk = t;
          break;
        }
      }
      if (firstOk > worstStart) {
        worstStart = firstOk;
        worstI = i;
      }
    }
    dropped.push(kept[worstI]);
    kept = kept.filter((_, i) => i !== worstI);
    weights = weights.filter((_, i) => i !== worstI);
  }
  return { tickers: kept, weights, startIdx: 0, availableDays: 0, droppedForHistory: dropped };
}

/** Build the T×N daily log-returns matrix starting at `startIdx` (one row
 *  past the first coterminal index). Rows where any ticker is missing a
 *  positive close are dropped — by construction this should be rare after
 *  `tightenUniverseForHistory`, but we guard anyway for split/dividend
 *  artifacts (silent corruption on bankruptcy survivors).
 *
 *  If `benchmarkWeights` is supplied, the benchmark log return per row is
 *  the weighted mean of the ticker log returns — a fixed-weight basket. */
export function buildCoterminalReturns(
  prices: PricesArtifact,
  tickers: string[],
  startIdx: number,
  benchmarkWeights: number[] | null = null,
): { X: number[][]; dates: string[]; benchmark: (number | null)[] } | null {
  const T = prices.dates.length;
  if (T < 60 || tickers.length < 2) return null;
  const series = tickers.map((t) => prices.series[t]);
  if (series.some((s) => !s)) return null;
  const X: number[][] = [];
  const dates: string[] = [];
  const benchmark: (number | null)[] = [];
  for (let t = Math.max(startIdx + 1, 1); t < T; t++) {
    const row: number[] = new Array(tickers.length);
    let allOk = true;
    for (let i = 0; i < tickers.length; i++) {
      const px = series[i]!;
      const p0 = px[t - 1];
      const p1 = px[t];
      if (p1 != null && p0 != null && p0 > 0 && p1 > 0) {
        row[i] = Math.log(p1 / p0);
      } else {
        allOk = false;
        break;
      }
    }
    if (!allOk) continue;
    X.push(row);
    dates.push(prices.dates[t]);
    if (benchmarkWeights) {
      let bm = 0;
      for (let i = 0; i < tickers.length; i++) bm += benchmarkWeights[i] * row[i];
      benchmark.push(bm);
    } else {
      benchmark.push(null);
    }
  }
  return { X, dates, benchmark };
}
