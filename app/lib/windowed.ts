/**
 * Client-side recomputation of KPIs over an arbitrary time window.
 *
 * The pipeline publishes snapshot KPIs as-of the latest refresh. When the user
 * picks a different window (1M / 3M / 6M / YTD / 1Y / MAX), we recompute the
 * same metrics from `prices_normalized.json` so every visualization on the
 * page reacts together.
 */

import type { KpiArtifact, KpiRow, PricesArtifact, SectorRow } from "./data";

export type WindowLabel =
  | "1M" | "3M" | "6M" | "YTD"
  | "1Y" | "5Y" | "10Y" | "15Y" | "20Y"
  | "MAX";

const RANGE_DAYS: Record<Exclude<WindowLabel, "YTD" | "MAX">, number> = {
  "1M": 22,
  "3M": 66,
  "6M": 132,
  "1Y": 252,
  "5Y": 1260,
  "10Y": 2520,
  "15Y": 3780,
  "20Y": 5040,
};

export function windowStartIndex(dates: readonly string[], window: WindowLabel): number {
  if (dates.length === 0) return 0;
  if (window === "MAX") return 0;
  if (window === "YTD") {
    const year = dates[dates.length - 1].slice(0, 4);
    const ymd = `${year}-01-01`;
    const idx = dates.findIndex((d) => d >= ymd);
    return idx === -1 ? 0 : idx;
  }
  const n = RANGE_DAYS[window];
  return Math.max(0, dates.length - n);
}

export type WindowedTickerStats = KpiRow & {
  return_window: number | null;
  vol_window: number | null;
  drawdown_window: number | null;
  sharpe_window: number | null;
  n_obs_window: number;
};

/**
 * Recompute per-ticker stats over the chosen window from prices_normalized.
 * Sharpe uses kpis.cdi_global_mean as a constant approximation (good enough
 * for relative ranking; the precise per-ticker CDI lives in the snapshot row).
 */
export function recomputeStatsForWindow(
  prices: PricesArtifact,
  kpis: KpiArtifact,
  window: WindowLabel,
): WindowedTickerStats[] {
  const dates = prices.dates;
  const start = windowStartIndex(dates, window);
  const cdi = kpis.cdi_global_mean ?? 0.1;
  const kpiByTicker = new Map(kpis.tickers.map((r) => [r.ticker, r]));

  const out: WindowedTickerStats[] = [];
  for (const ticker of Object.keys(prices.series)) {
    const arr = prices.series[ticker];
    if (!arr) continue;
    const segment = arr.slice(start);
    const cleanIdx: number[] = [];
    for (let i = 0; i < segment.length; i++) if (segment[i] != null) cleanIdx.push(i);
    if (cleanIdx.length < 2) continue;
    const firstIdx = cleanIdx[0];
    const lastIdx = cleanIdx[cleanIdx.length - 1];
    const first = segment[firstIdx]!;
    const last = segment[lastIdx]!;
    // Compute window log return.
    //
    // Require BOTH endpoints positive: silver.b3_ohlcv_adjusted occasionally
    // ships negative normalized closes for bankruptcy survivors (e.g. OIBR4
    // ends at ~-0.0015 in the deployed snapshot — a Yahoo split-adjustment
    // artifact). Math.log(negative) returns NaN which silently propagates
    // through every downstream guard and renders as "—" without warning.
    //
    // Cap only the POSITIVE tail: legitimate -99% losses (bankrupt issuers
    // like OIBR3: 100 → 0.0025 over 24y, log return = -10.6) must survive
    // since they're real performance, not data corruption. The old
    // symmetric `Math.abs > 3` guard was wiping every catastrophic-loss
    // ticker from sector detail panels. The positive side keeps a generous
    // > 8 ceiling (~3000x gain) to still trap obvious data errors like
    // UGPA3's spurious R$3.3M close artifact, while passing through
    // legitimate biotech / IPO multibaggers.
    let retWindow: number | null =
      first > 0 && last > 0 ? Math.log(last / first) : null;
    if (retWindow != null && retWindow > 8) retWindow = null;

    // Daily log returns over the window. Drop |daily log ret| > 0.5
    // (~65% one-day change) as data artifacts: real splits/dividends are
    // adjusted upstream and any remaining spike is corruption.
    const logRet: number[] = [];
    for (let i = 1; i < segment.length; i++) {
      const p = segment[i];
      const q = segment[i - 1];
      if (p != null && q != null && p > 0 && q > 0) {
        const r = Math.log(p / q);
        if (Math.abs(r) <= 0.5) logRet.push(r);
      }
    }
    const n = logRet.length;
    let vol: number | null = null;
    let sharpe: number | null = null;
    if (n >= 5) {
      const mean = logRet.reduce((a, b) => a + b, 0) / n;
      const variance = logRet.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
      vol = Math.sqrt(variance) * Math.sqrt(252);
      const meanAnn = mean * 252;
      sharpe = vol > 0 ? (meanAnn - cdi) / vol : null;
    }

    // Max drawdown over window
    let peak = -Infinity;
    let worst = 0;
    for (const v of segment) {
      if (v == null) continue;
      if (v > peak) peak = v;
      if (peak > 0) {
        const dd = (v - peak) / peak;
        if (dd < worst) worst = dd;
      }
    }

    const snap = kpiByTicker.get(ticker);
    out.push({
      ticker,
      company_name: snap?.company_name,
      sector_b3: snap?.sector_b3,
      return_ytd: snap?.return_ytd ?? null,
      vol_annual: snap?.vol_annual ?? null,
      max_drawdown: snap?.max_drawdown ?? null,
      sharpe_vs_cdi: snap?.sharpe_vs_cdi ?? null,
      cdi_annual_used: snap?.cdi_annual_used,
      n_obs: snap?.n_obs,
      last_close: snap?.last_close,
      last_close_date: snap?.last_close_date,
      return_window: retWindow,
      vol_window: vol,
      drawdown_window: worst,
      sharpe_window: sharpe,
      n_obs_window: n,
    });
  }
  return out;
}

/**
 * Aggregate per-ticker windowed stats into per-sector summaries.
 */
export function aggregateSectorsForWindow(
  rows: WindowedTickerStats[],
  _sectorsArtifact: SectorRow[],
): SectorRow[] {
  const bySector = new Map<string, WindowedTickerStats[]>();
  for (const r of rows) {
    if (!r.sector_b3) continue;
    const arr = bySector.get(r.sector_b3) ?? [];
    arr.push(r);
    bySector.set(r.sector_b3, arr);
  }
  const out: SectorRow[] = [];
  for (const [sector, members] of bySector) {
    const validRet = members
      .map((m) => m.return_window)
      .filter((v): v is number => v != null);
    if (validRet.length === 0) continue;
    const mean = validRet.reduce((a, b) => a + b, 0) / validRet.length;
    const sorted = [...validRet].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const vols = members
      .map((m) => m.vol_window)
      .filter((v): v is number => v != null);
    const volMean = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
    out.push({
      sector_b3: sector,
      member_count: members.length,
      return_ytd_mean: mean,
      return_ytd_median: median,
      vol_annual_mean: volMean,
      members: members.map((m) => m.ticker).sort(),
    });
  }
  // Preserve the alphabetical order of original sectors as the secondary sort
  out.sort((a, b) => b.return_ytd_mean - a.return_ytd_mean);
  return out;
}

export function windowLabelPt(window: WindowLabel): string {
  return (
    {
      "1M": "último mês",
      "3M": "últimos 3 meses",
      "6M": "últimos 6 meses",
      "YTD": "no ano",
      "1Y": "últimos 12 meses",
      "5Y": "últimos 5 anos",
      "10Y": "últimos 10 anos",
      "15Y": "últimos 15 anos",
      "20Y": "últimos 20 anos",
      "MAX": "histórico completo",
    } as const
  )[window];
}
