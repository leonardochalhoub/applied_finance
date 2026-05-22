/**
 * Typed loaders for Gold artifacts (read via node:fs at build time).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export type KpiRow = {
  ticker: string;
  company_name?: string;
  sector_b3?: string;
  return_ytd: number | null;
  vol_annual: number | null;
  max_drawdown: number | null;
  sharpe_vs_cdi: number | null;
  cdi_annual_used?: number | null;
  n_obs?: number | null;
  last_close?: number;
  last_close_date?: string;
};

export type KpiArtifact = {
  as_of: string;
  source_run_id: string;
  bronze_max_trading_date: string;
  cdi_global_mean?: number;
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

export type PricesArtifact = {
  as_of: string;
  rebase: number;
  dates: string[];
  series: Record<string, (number | null)[]>;
};

export type PricesCloseArtifact = {
  as_of: string;
  currency: string;
  dates: string[];
  series: Record<string, (number | null)[]>;
};

export type CdiArtifact = {
  source: string;
  fetched_at: string;
  global_mean_annual?: number;
  rows: { date: string; rate_daily_pct: number; rate_annual_pct: number }[];
};

// ── McLean (2011) replication ──────────────────────────────────────────────
export type McLeanStat = { mean: number | null; std: number | null; p25: number | null; median: number | null; p75: number | null; n: number };
export type McLeanCoef = { coef: number; tstat: number; p?: number; sig: string };
export type McLeanPooled = {
  n: number;
  r2: number;
  r2_adj?: number;
  const: McLeanCoef;
  dIssue: McLeanCoef;
  dDebt: McLeanCoef;
  Cashflow: McLeanCoef;
  Other: McLeanCoef;
  Assets: McLeanCoef;
};
export type McLeanAnnualRow = {
  year: number;
  n: number;
  r2: number;
  dIssue: { coef: number; tstat: number; sig: string };
  dDebt: { coef: number; tstat: number; sig: string };
  Cashflow: { coef: number; tstat: number; sig: string };
  Other: { coef: number; tstat: number; sig: string };
  Assets: { coef: number; tstat: number; sig: string };
};
export type McLeanWindowBlock = {
  window: [number, number];
  n_firms: number;
  n_obs: number;
  desc: {
    full: Record<string, McLeanStat>;
    unconstrained: Record<string, McLeanStat>;
    constrained: Record<string, McLeanStat>;
  };
  pooled: {
    full: McLeanPooled;
    unconstrained: McLeanPooled;
    constrained: McLeanPooled;
  };
  annual: {
    full: McLeanAnnualRow[];
    unconstrained: McLeanAnnualRow[];
    constrained: McLeanAnnualRow[];
  };
};

export type McLeanArtifact = {
  meta: {
    paper: string;
    paper_window: [number, number];
    paper_n_firms: number;
    paper_n_obs: number;
    data_source: string;
  };
  windows: {
    full:     McLeanWindowBlock;  // 2010–2024 (max range)
    original: McLeanWindowBlock;  // 2010–2013 (overlap with paper's 1995–2013)
  };
  paper_ref: {
    desc_full: Record<string, McLeanStat>;
    pooled_model1_full: Record<string, McLeanCoef | number> & { r2: number; n: number };
  };
};

async function _load<T>(name: string): Promise<T | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", `${name}.json`);
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const loadKpis = () => _load<KpiArtifact>("kpis_per_ticker");
export const loadSectors = () => _load<SectorArtifact>("sector_aggregates");
export const loadCorrelations = () => _load<CorrelationArtifact>("correlation_heatmap");
export const loadIbov = () => _load<IbovArtifact>("ibov_overview");
export const loadPrices = () => _load<PricesArtifact>("prices_normalized");
export const loadPricesClose = () => _load<PricesCloseArtifact>("prices_close");
export const loadCdi = () => _load<CdiArtifact>("cdi");
export const loadMcLean = () => _load<McLeanArtifact>("mclean_results");
