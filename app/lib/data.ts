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

// ── FinOps (Databricks spend) ──────────────────────────────────────────────
export type FinopsKpis = {
  total_cost_usd_lifetime: number;
  total_cost_usd_30d: number;
  total_cost_usd_7d: number;
  total_dbus_lifetime: number;
  n_runs_lifetime: number;
  n_runs_30d: number;
  n_runs_7d: number;
  wasted_cost_usd_lifetime: number;
  wasted_pct_lifetime: number;
  avg_cost_per_run_usd: number;
  p95_cost_per_run_usd: number;
  chargeable_share_pct: number;
  overhead_share_pct: number;
  most_expensive_run: {
    job_id: string | null;
    run_id: string | null;
    job_name: string;
    result_state: string;
    cost_usd: number;
    billed_minutes: number;
    day: string | null;
  } | null;
};

export type FinopsStorage = {
  total_usd_lifetime: number;
  total_usd_30d: number;
  days_with_storage: number;
  per_day_avg_lifetime: number;
  per_day_current: number;
  per_month_run_rate: number;
  per_year_run_rate: number;
  share_of_total_pct: number;
};

export type FinopsDailyRow = {
  usage_date: string;
  cost_jobs: number;
  cost_sql: number;
  cost_interactive: number;
  cost_dlt: number;
  cost_networking: number;
  cost_storage: number;
  cost_pred_opt: number;
  cost_chargeable_total: number;
  cost_overhead_total: number;
  cost_total: number;
  cost_total_cumulative: number;
  dbus_total: number;
};

export type FinopsProductRow = {
  product: string;
  workload_class: "chargeable" | "overhead";
  cost_usd: number;
  share_pct: number;
};

export type FinopsOutcomeRow = {
  result_state: "SUCCEEDED" | "ERROR" | "CANCELLED" | "UNKNOWN" | string;
  n_runs: number;
  cost_usd: number;
  share_pct: number;
  avg_per_run: number;
  avg_minutes: number;
};

export type FinopsJobRow = {
  job_name: string;
  n_runs: number;
  cost_usd: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  avg_per_run: number;
  wasted_cost: number;
  avg_minutes: number;
};

export type FinopsRunRow = {
  job_id: string | null;
  run_id: string | null;
  job_name: string;
  result_state: string;
  is_wasted: boolean;
  cost_usd: number;
  dbus: number;
  billed_minutes: number;
  day: string | null;
};

export type FinopsAttributionCatalog = {
  catalog: string;
  is_target: boolean;
  n_tables: number;
  tables_bytes: number;
  tables_rows: number;
  volumes_bytes: number;
  total_bytes: number;
  share_pct: number;
  formats: string[];
  has_iceberg: boolean;
  volumes_by_ext: Record<string, { bytes: number; files: number }>;
};

export type FinopsAttribution = {
  snapshot_at: string;
  target_catalog: string;
  target_bytes: number;
  workspace_bytes: number;
  storage_share_pct: number;
  catalogs: FinopsAttributionCatalog[];
};

export type FinopsLayerTable = {
  table: string;
  bytes: number;
  rows: number | null;
  num_files: number;
  format: string;
  has_iceberg: boolean;
};

export type FinopsLayer = {
  schema: string;
  n_tables: number;
  total_bytes: number;
  total_rows: number;
  total_files: number;
  formats: string[];
  has_iceberg: boolean;
  tables: FinopsLayerTable[];
};

export type FinopsLayers = {
  catalog: string;
  snapshot_at: string;
  layers: FinopsLayer[];
};

export type FinopsArtifact = {
  generated_at_utc: string;
  catalog: string;
  team_tag: string;
  window: { first_day: string; last_day: string; n_days: number };
  kpis: FinopsKpis;
  storage: FinopsStorage;
  attribution: FinopsAttribution | null;
  layers: FinopsLayers | null;
  daily: FinopsDailyRow[];
  by_product: FinopsProductRow[];
  by_outcome: FinopsOutcomeRow[];
  by_job: FinopsJobRow[];
  top_runs: FinopsRunRow[];
};

export const loadKpis = () => _load<KpiArtifact>("kpis_per_ticker");
export const loadSectors = () => _load<SectorArtifact>("sector_aggregates");
export const loadCorrelations = () => _load<CorrelationArtifact>("correlation_heatmap");
export const loadIbov = () => _load<IbovArtifact>("ibov_overview");
export const loadPrices = () => _load<PricesArtifact>("prices_normalized");
export const loadPricesClose = () => _load<PricesCloseArtifact>("prices_close");
export const loadCdi = () => _load<CdiArtifact>("cdi");
export const loadMcLean = () => _load<McLeanArtifact>("mclean_results");
export const loadFinops = () => _load<FinopsArtifact>("finops_summary");
