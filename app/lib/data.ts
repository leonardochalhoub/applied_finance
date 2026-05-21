/**
 * Typed fetchers for artifacts published to /data/* on gh-pages.
 *
 * In Next.js static export, fetch() at build time uses the basePath; at runtime
 * we use a relative path so the same code works locally and on Pages.
 */

const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE ?? "/data";

export type KpiRow = {
  ticker: string;
  company_name?: string;
  sector_b3?: string;
  return_ytd: number | null;
  vol_annual: number | null;
  max_drawdown: number | null;
  sharpe_vs_cdi: number | null;
  last_close?: number;
  last_close_date?: string;
};

export type KpiArtifact = {
  as_of: string;
  source_run_id: string;
  bronze_max_trading_date: string;
  tickers: KpiRow[];
};

export type SectorRow = {
  sector_b3: string;
  member_count: number;
  return_ytd_mean: number;
  return_ytd_median?: number;
  vol_annual_mean: number;
  members?: string[];
};

export type SectorArtifact = {
  as_of: string;
  source_run_id: string;
  sectors: SectorRow[];
};

export type CorrelationPair = {
  ticker_i: string;
  ticker_j: string;
  correlation: number;
  sector_i?: string;
  sector_j?: string;
};

export type CorrelationArtifact = {
  as_of: string;
  source_run_id: string;
  window_label: "1y" | "5y" | "full";
  top_correlated: CorrelationPair[];
  top_anti_correlated: CorrelationPair[];
};

export type IbovMember = {
  ticker: string;
  company_name?: string;
  sector_b3?: string;
  weight: number;
  return_ytd: number | null;
  contribution_to_ytd: number | null;
};

export type IbovArtifact = {
  as_of: string;
  source_run_id: string;
  index_level: number;
  index_return_ytd?: number;
  members: IbovMember[];
};

async function _load<T>(name: string): Promise<T> {
  const url = `${DATA_BASE}/${name}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const loadKpis = () => _load<KpiArtifact>("kpis_per_ticker");
export const loadSectors = () => _load<SectorArtifact>("sector_aggregates");
export const loadCorrelations = () => _load<CorrelationArtifact>("correlation_heatmap");
export const loadIbov = () => _load<IbovArtifact>("ibov_overview");
