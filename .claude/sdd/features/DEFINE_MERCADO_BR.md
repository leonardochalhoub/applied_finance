# DEFINE: Mercado BR — Plataforma de Análise do Mercado Acionário Brasileiro

> Open lakehouse + static dashboard over the full B3 equities universe (~26y history), built free-tier-only, with `yfr_py` (a Python port of msperlin/yfR) as the canonical ingestion library.

## Metadata

| Attribute | Value |
|-----------|-------|
| **Feature** | MERCADO_BR |
| **Date** | 2026-05-21 |
| **Author** | define-agent |
| **Status** | Ready for Design |
| **Clarity Score** | 15/15 |

---

## Problem Statement

Brazilian retail investors, finance students, and amateur quants currently have no free, open, auditable analytics surface over the full B3 equities universe with enough history (20+ years) and explicit corporate-action handling to support honest sector analysis and Markowitz portfolio construction — every existing alternative is paywalled (Economatica, Refinitiv), shallow (third-party dashboards with no data provenance), or undisciplined (one-off Colab notebooks that break with the next yfinance update). **Mercado BR** closes that gap by shipping both the data pipeline and the dashboard open-source under MIT, deployed entirely on free-tier infrastructure (Databricks Free Edition + GitHub Pages + GitHub Actions).

---

## Target Users

| User | Role | Pain Point |
|------|------|------------|
| Brazilian retail investor (refresher) | Self-directed investor with finance background, returning to the market | Wants sector returns, correlations, and per-ticker history without a brokerage paywall; current free tools (TradingView free, brokerage dashboards) hide methodology and don't expose covariance |
| Quant student / hobbyist | Building finance projects in Python | Needs auditable returns + covariance over the full B3 universe with documented corporate-action handling; `yfinance` alone gives no provenance, no caching, and no portfolio-grade hygiene |
| Author (Leonardo Chalhoub) | Owner of `applied_finance`, MSc Finance | Wants a portfolio piece that demonstrates both data engineering discipline (Mirante-grade lakehouse) and product UX (Caixa-Forte-grade dashboard) on a domain he has formal training in |

---

## Goals

| Priority | Goal |
|----------|------|
| **MUST** | Ship `yfr_py` — an installable Python package porting msperlin/yfR's API ergonomics (cache, batch, parallel, frequency dial), parity-tested against yfR on a fixture set |
| **MUST** | Ingest the **full B3 universe** (~400 tickers, including delisted) at **maximum available history** (~since 2000) into a Databricks Delta medallion: Bronze (raw + Yahoo-adjusted) → Silver (cleaned, SCD2 ticker dim) → Gold (returns + covariance + KPIs) |
| **MUST** | Publish versioned JSON + Parquet artifacts to a `gh-pages` orphan branch and serve a Next.js 16 static-export dashboard from the same branch (IBOV overview, ticker explorer, KPI cards, correlation heatmap, sector comparison, time-series viewer) |
| **MUST** | Stay free-tier-only (Databricks Free, GH Pages, GH Actions) with documented lifetime cost ≤ US$ 50 over the first 12 months |
| **MUST** | Phase 2 architecture accommodation: Gold publishes 3 covariance-matrix variants (1y / 5y / full window) sized for a client-side Markowitz QP solver, without requiring rework |
| **SHOULD** | KPI math (return YTD, annualized vol, max drawdown, Sharpe vs CDI) is unit-tested against hand-computed fixtures for PETR4, VALE3, ITUB4 |
| **SHOULD** | README mirrors Mirante's FinOps badge story (lifetime cost, refresh cadence, test count) and includes an `ARCHITECTURE.md` with ADRs in Mirante's style |
| **COULD** | Lighthouse score ≥ 90 on Performance, Accessibility, and Best Practices for the deployed dashboard |
| **COULD** | A "compartilhe esta visualização" feature that serializes filters into the URL query string (precursor to Phase 2's portfolio URL state) |

---

## Success Criteria

Measurable outcomes (must include numbers):

- [ ] `yfr_py` installs via `uv add` / `pip install` from the GitHub repo with zero non-stdlib runtime dependencies beyond `yfinance`, `pandas`/`polars`, `httpx`, `pyarrow`
- [ ] `yfr_py` golden-file parity tests pass for **≥ 10 tickers × 2 frequencies (daily, monthly) × 2 date windows** against captured yfR output, with **≤ 0.01% relative numerical drift** on Adj Close
- [ ] Databricks Asset Bundle deploys cleanly to Databricks Free Edition; full Bronze→Silver→Gold runs end-to-end in **≤ 30 minutes** on a single small cluster
- [ ] Gold publishes **≥ 5 JSON artifacts** (per-ticker KPIs, sector aggregates, correlation heatmap, IBOV overview, ticker universe) and **≥ 3 Parquet artifacts** (returns wide, cov matrix 1y / 5y / full)
- [ ] **100%** of published JSON artifacts conform to versioned JSON-Schema files committed under `pipelines/contracts/`
- [ ] Dashboard surfaces all four KPI types (return YTD, annualized vol, max drawdown, Sharpe vs CDI) for **every ticker** in the universe that has ≥ 1 year of trading history
- [ ] KPI math passes unit tests against hand-computed fixtures for **PETR4, VALE3, ITUB4** with relative error ≤ 1e-6
- [ ] Site is publicly reachable at `https://<github-username>.github.io/applied_finance/` (or chosen Pages URL) with a working dashboard and at least one Recharts visualization on first paint
- [ ] Lifetime cloud cost ≤ **US$ 50** across Databricks Free + GH Actions + GH Pages over the first 12 months, tracked in `docs/FINOPS.md` with monthly snapshots
- [ ] All KPI definitions documented in `docs/METHODOLOGY.md` (pt-BR) with formula, lookback window, and reference price column

---

## Acceptance Tests

| ID | Scenario | Given | When | Then |
|----|----------|-------|------|------|
| AT-001 | yfR ↔ yfr_py daily-OHLCV parity | A fixture set of 10 tickers (mix of large/mid/small cap) with date range 2020-01-01 → 2024-12-31, daily freq, and pre-captured yfR output stored under `tests/fixtures/yfr_golden/` | `yfr_py.yf_get(tickers, first_date, last_date, freq_data="daily")` is invoked with identical arguments | Resulting DataFrame matches the yfR golden file on shape, column dtypes, ticker order (post-sort), and numerical values within 1e-4 relative tolerance on every numeric column |
| AT-002 | Cache hit behavior | A local cache folder pre-populated by a previous `yf_get` call for `PETR4.SA` | A second `yf_get(["PETR4.SA"], ..., do_cache=True)` call is made for the same date range | The function returns within ≤ 200 ms (no HTTP call), Yahoo is not contacted (mock asserts zero calls), and the data is byte-identical to the cached fixture |
| AT-003 | Bronze ingest idempotency | A Bronze Delta table already contains 5 trading days of PETR4.SA OHLCV | The daily refresh job runs against the same source date range | No duplicate rows are produced, `MERGE` is used on `(ticker, trading_date)`, and row count is unchanged |
| AT-004 | Silver SCD2 captures a ticker rename | A test fixture marks `BRDT3 → VBBR3` rename effective 2023-08-09 in `data/ticker_universe.csv` | The Silver job processes a date range spanning the rename | `silver.b3_ticker_dim` contains two rows for the same underlying entity with disjoint `valid_from` / `valid_to` ranges, and `silver.b3_ohlcv_adjusted` carries the historical series under its prior symbol |
| AT-005 | Gold covariance excludes incomplete tickers | The 5-year lookback window starts at T-5y; ticker XYZW3 has only 2y of history | The Gold cov-matrix job builds `gold.cov_matrix_5y` | XYZW3 is absent from the matrix; XYZW3 appears in `valid_tickers_5y.json` with status `excluded_insufficient_history` and the matrix is positive semi-definite (all eigenvalues ≥ -1e-10) |
| AT-006 | KPI parity against hand fixtures | Hand-computed YTD return, annualized vol, max drawdown, and Sharpe vs CDI for PETR4 over 2023-01-01 → 2023-12-29 stored as JSON under `tests/fixtures/kpi_hand/petr4_2023.json` | `gold.kpis_per_ticker` is generated for the same window | Each KPI matches the hand fixture within 1e-6 relative tolerance |
| AT-007 | JSON artifact schema conformance | `pipelines/contracts/kpi_per_ticker.schema.json` exists and describes the artifact shape | The post-Gold validation step runs over `gh-pages/data/kpis_per_ticker.json` | All records validate; one synthetic record with a missing field is rejected with a clear error path |
| AT-008 | Static export deploys to gh-pages | `app/` builds via `next build && next export` (or `output: 'export'`) and `pipelines/` has published `/data/*.json` and `/data/*.parquet` | The `deploy-pages.yml` GH Actions workflow runs on `main` | `gh-pages` branch contains both `/app/*` and `/data/*`, GH Pages serves the dashboard at the configured URL, and the home page renders the IBOV overview within 3 seconds on a desktop cold load |
| AT-009 | Dashboard renders KPI cards for a sampled ticker | Pages is live, artifacts are current | Playwright opens the ticker-detail page for `PETR4` | All four KPI cards (return YTD, vol, max drawdown, Sharpe vs CDI) render with non-null numeric values that match the published `kpis_per_ticker.json` |
| AT-010 | Correlation heatmap loads under bandwidth budget | Pages is live with full universe data | Browser loads `/dashboard/correlations` cold | Cumulative network transfer for the page is ≤ 3 MB gzipped (no Parquet covariance loaded on this view); covariance Parquet is only loaded on the Phase-2 portfolio page |
| AT-011 | Daily refresh job is fully unattended | GH Actions cron is configured for `0 1 * * 2-6` UTC (≈ 22:00 BRT Mon-Fri after close) | A scheduled run executes without manual intervention | Bronze, Silver, and Gold tasks all succeed; the gh-pages artifact branch is updated; cost ledger increments by < US$ 0.50 |
| AT-012 | FinOps badges reflect reality | `docs/FINOPS.md` and README badges exist | Monthly snapshot script runs | Badge values (lifetime cost, runs, test count) match the data in `docs/FINOPS.md` for the current month |

---

## Out of Scope

Explicitly NOT included in this feature:

- Real-time / intraday quotes — daily close cadence only
- Backtesting framework — separate feature, not built here
- User accounts, server-side persistence, authentication of any kind
- Paid market data feeds (B3 Datawise, Economatica, Refinitiv, etc.)
- LaTeX working papers (Mirante-style) — deferred to a later feature
- Multi-language UI — pt-BR only in v1 (en-US deferred)
- DuckDB-WASM client query layer — precomputed JSON wins for Phase 1's fixed dashboard
- Charting libraries beyond Recharts (Visx, lightweight-charts, etc.) — design-system consistency with Caixa Forte
- Streaming / Kafka / CDC architecture — daily batch is sufficient
- **Phase 2 build:** CVM fundamentals (`GetDFPData2`-port), BCB macro (`GetBCBData`-port), portfolio builder UI, client-side Markowitz QP solver — **architecture is accommodated; implementation is deferred to a separate feature (`MERCADO_BR_PORTFOLIO`)**

---

## Constraints

| Type | Constraint | Impact |
|------|------------|--------|
| Technical | Static export only (`output: 'export'` on Next.js 16); no SSR, no ISR, no API routes | All interactivity must run client-side against precomputed artifacts |
| Technical | No database, no backend server, no auth (by user decree) | Filters / KPIs / time-series all consume static JSON or Parquet from the same origin |
| Technical | GitHub Pages as the only hosting target (matches Mirante; rejects Vercel for this project) | Single artifact + app deploy target; uses `gh-pages` orphan branch to keep history thin |
| Technical | yfR API parity is the design north-star, not yfinance ergonomics | `yfr_py` reimplements yfR's cache + batch + parallel + frequency-dial semantics; `yfinance` is used only as the HTTP backend |
| Technical | Databricks Free Edition (single small cluster, time-bound jobs) | Pipelines must complete inside Free Edition's job duration limits; no auto-scaling assumed |
| Technical | GH Pages soft cap ~1 GB per repo and 100 MB per file | Artifacts are aggressively pruned; orphan `gh-pages` branch is force-pushed each refresh; large Parquet artifacts must stay < 100 MB each (current covariance ~6 MB is well within limit) |
| Resource | Free-tier-only; no paid SaaS in critical path | Documented lifetime cost cap of US$ 50 over the first 12 months; FinOps tracked in `docs/FINOPS.md` |
| Process | Reuse Mirante's Asset Bundle / GH Actions / ADR patterns | Faster bootstrap, consistent house style; copy `databricks.yml` skeleton, not paste raw resource names |
| Process | Reuse Caixa Forte's design tokens + Recharts patterns + `vitest` + `playwright` test setup | Visual consistency, low cost to adopt |
| Legal | MIT license, fully open source | Compatible with yfR's MIT license and yfinance's Apache 2.0 |
| Localization | pt-BR copy in v1, en-US deferred | All UI strings, error messages, methodology doc, README in pt-BR |
| Data Quality | Both raw and Yahoo-adjusted prices stored in Silver | Auditability across 26 years of corporate actions |

---

## Technical Context

> Essential context for Design phase — prevents misplaced files and missed infrastructure needs.

| Aspect | Value | Notes |
|--------|-------|-------|
| **Deployment Location** | Monorepo under `~/applied_finance/`: `yfr_py/` (package), `pipelines/` (Databricks bundle + notebooks + JSON-Schema contracts), `app/` (Next.js static export), `data/` (`ticker_universe.csv` + reference CSVs), `docs/` (ARCHITECTURE.md, FINOPS.md, METHODOLOGY.md, ADRs), `tests/` (pytest + playwright + vitest), `.github/workflows/` (refresh-pipelines.yml, deploy-pages.yml) | Mirrors Mirante's structure; swaps Vite→Next.js |
| **KB Domains** | `medallion`, `spark`, `lakeflow`, `python`, `testing`, `cloud-platforms` (Databricks), `terraform` (light — Asset Bundles), `modern-stack`, `data-quality`, `sql-patterns`. Phase 2 will add: `ai-data-engineering` (if any embedding work), `data-modeling` (fundamentals) | Pull patterns from each before Design |
| **IaC Impact** | New resources via Databricks Asset Bundle: 1 job (`mercado_br_daily_refresh`), 1 schedule, 1 cluster (small, ephemeral), N Delta tables (Bronze/Silver/Gold). No Terraform. GH Actions workflows are version-controlled YAML — no infra registry. | Asset Bundles encode all Databricks resources; no Terraform layer needed |

**Why This Matters:**

- **Location** → Mirante's layout is proven; copying it lets the user navigate this repo with muscle memory
- **KB Domains** → `medallion`, `spark`, `python`, `testing` are the load-bearing four; `lakeflow` informs DLT-or-vanilla-job decision in Design
- **IaC Impact** → Single Asset Bundle; no Terraform; means Design phase doesn't owe us a Terraform plan

---

## Data Contract

### Source Inventory

| Source | Type | Volume | Freshness | Owner |
|--------|------|--------|-----------|-------|
| Yahoo Finance (B3 `.SA`) via `yfr_py` | HTTPS (unofficial endpoints, behind `yfinance`) | ~400 tickers × ~26y × ~250 trading days ≈ ~2.6M OHLCV rows | Daily after B3 close (~22:00 BRT) | Project (this repo) |
| `data/ticker_universe.csv` | Hand-curated CSV in repo | ~500 rows (active + delisted) | Updated quarterly or on corporate-action event | Author |
| IBOV / IBrA / IBrX composition history | Static CSV under `data/index_membership.csv` | ~quarterly snapshots since 2000 | Quarterly | Author |
| **Phase 2:** CVM DFPs via `GetDFPData2`-py port | HTTPS to dados.cvm.gov.br | Hundreds of MB historical, then incremental | Quarterly | (deferred) |
| **Phase 2:** BCB SGS via `GetBCBData`-py port | HTTPS to api.bcb.gov.br/dados/serie | MB scale | Daily/monthly per series | (deferred) |

### Schema Contract — Bronze

**`bronze.b3_ohlcv_raw`** — append-only, raw Yahoo response

| Column | Type | Constraints | PII? |
|--------|------|-------------|------|
| `ticker` | STRING | NOT NULL | No |
| `trading_date` | DATE | NOT NULL | No |
| `open_raw` | DOUBLE | | No |
| `high_raw` | DOUBLE | | No |
| `low_raw` | DOUBLE | | No |
| `close_raw` | DOUBLE | NOT NULL | No |
| `adj_close_yahoo` | DOUBLE | | No |
| `volume` | BIGINT | | No |
| `ingested_at` | TIMESTAMP | NOT NULL (default `current_timestamp()`) | No |
| `source_run_id` | STRING | NOT NULL | No |

Partition: `year(trading_date)`. Primary natural key: `(ticker, trading_date)`. Append-only; no overwrite except via explicit replay.

**`bronze.b3_universe`** — landed copy of `data/ticker_universe.csv` per run

| Column | Type | Constraints | PII? |
|--------|------|-------------|------|
| `ticker` | STRING | NOT NULL | No |
| `company_name` | STRING | NOT NULL | No |
| `sector_b3` | STRING | NOT NULL | No |
| `subsector_b3` | STRING | | No |
| `listed_from` | DATE | NOT NULL | No |
| `listed_to` | DATE | NULL means still active | No |
| `prior_tickers` | ARRAY<STRING> | empty array allowed | No |
| `ingested_at` | TIMESTAMP | NOT NULL | No |

### Schema Contract — Silver

**`silver.b3_ohlcv_adjusted`** — splits/dividends applied; raw preserved alongside

| Column | Type | Constraints | PII? |
|--------|------|-------------|------|
| `ticker` | STRING | NOT NULL | No |
| `trading_date` | DATE | NOT NULL | No |
| `open` | DOUBLE | adjusted | No |
| `high` | DOUBLE | adjusted | No |
| `low` | DOUBLE | adjusted | No |
| `close` | DOUBLE | adjusted, NOT NULL | No |
| `close_raw` | DOUBLE | unadjusted, NOT NULL | No |
| `adj_factor` | DOUBLE | NOT NULL, > 0 | No |
| `volume` | BIGINT | | No |
| `is_imputed` | BOOLEAN | NOT NULL DEFAULT false | No |

Partition: `year(trading_date)`. Primary key: `(ticker, trading_date)`. Gap-filled across non-trading days only when explicitly requested by the consumer (default: trading-days only).

**`silver.b3_ticker_dim`** — SCD2 on rename / corporate-event changes

| Column | Type | Constraints | PII? |
|--------|------|-------------|------|
| `ticker_key` | STRING | NOT NULL (surrogate, hash of canonical entity id) | No |
| `ticker` | STRING | NOT NULL | No |
| `company_name` | STRING | NOT NULL | No |
| `sector_b3` | STRING | NOT NULL | No |
| `subsector_b3` | STRING | | No |
| `valid_from` | DATE | NOT NULL | No |
| `valid_to` | DATE | NULL means current | No |
| `is_current` | BOOLEAN | NOT NULL | No |

### Schema Contract — Gold

**`gold.returns_wide`** — published as Parquet

| Column | Type | Constraints | PII? |
|--------|------|-------------|------|
| `trading_date` | DATE | NOT NULL, PK | No |
| `<TICKER_1>` ... `<TICKER_N>` | FLOAT32 | log returns, NULL for non-trading | No |

Wide schema (one column per ticker); single Parquet file partitioned by year for streaming reads.

**`gold.cov_matrix_{1y, 5y, full}`** — published as Parquet (long form for portability)

| Column | Type | Constraints | PII? |
|--------|------|-------------|------|
| `ticker_i` | STRING | NOT NULL | No |
| `ticker_j` | STRING | NOT NULL | No |
| `cov` | FLOAT32 | NOT NULL | No |
| `window_label` | STRING | NOT NULL (`1y` / `5y` / `full`) | No |
| `valid_through` | DATE | NOT NULL | No |

Accompanied by `valid_tickers_{1y,5y,full}.json` listing tickers with sufficient history for that window.

**`gold.kpis_per_ticker`** — published as JSON

```jsonc
{
  "as_of": "2026-05-21",
  "tickers": [
    {
      "ticker": "PETR4.SA",
      "return_ytd": 0.1234,        // log return, YTD
      "vol_annual": 0.32,          // annualized realized vol, 252-day window
      "max_drawdown": -0.47,       // peak-to-trough, full window
      "sharpe_vs_cdi": 0.84        // Sharpe ratio using CDI as risk-free
    }
    // ...
  ]
}
```

**`gold.sector_aggregates`** — published as JSON: per-sector return YTD, vol, member count.

**`gold.correlation_heatmap`** — published as JSON: top-N most-correlated and least-correlated pairs (precomputed for the heatmap UI).

**`gold.ibov_overview`** — published as JSON: current IBOV composition + weights + per-component YTD return.

### Freshness SLAs

| Layer | Target | Measurement |
|-------|--------|-------------|
| Bronze | Within 60 min of B3 close (22:00 BRT) on trading days | GH Actions job timestamp vs Bronze max(`trading_date`) |
| Silver | Within 90 min of B3 close on trading days | Same workflow, downstream task |
| Gold + artifacts on `gh-pages` | Within 120 min of B3 close on trading days | GH Pages last-deploy timestamp |

### Completeness Metrics

- ≥ 99.5% of expected `(ticker, trading_date)` pairs present in Bronze for the active universe (tolerance for Yahoo outages)
- Zero null primary keys (`ticker`, `trading_date`) across all Silver + Gold tables
- 100% of tickers in `data/ticker_universe.csv` with `listed_to IS NULL` appear in the most recent Bronze trading day
- Covariance matrices are positive semi-definite (all eigenvalues ≥ -1e-10 after symmetrization)

### Lineage Requirements

- Each Gold artifact JSON includes `source_run_id` (GitHub Actions run id) and `bronze_max_trading_date` for traceability
- `pipelines/contracts/*.schema.json` declares each artifact's shape; schema validation runs after Gold and blocks `gh-pages` deploy on failure
- ADR-style note in `docs/ARCHITECTURE.md` describes any schema change with version bump

---

## Assumptions

| ID | Assumption | If Wrong, Impact | Validated? |
|----|------------|------------------|------------|
| A-001 | `yfinance` continues to access Yahoo's B3 endpoints reliably for the foreseeable future | If Yahoo blocks `yfinance` or changes its endpoints, ingestion breaks. Mitigation: design `yfr_py` to allow a swappable HTTP backend (Brapi.dev or B3 direct) without changing the public API | [ ] (validate in Design via backend-interface ADR) |
| A-002 | Databricks Free Edition's job duration + compute quota is sufficient for daily Bronze→Silver→Gold over ~2.6M rows | If quota is hit, refresh fails silently or stalls. Mitigation: keep cluster small, profile each task, document fallback to GH-Actions-only Python compute (Approach C from BRAINSTORM) as a recovery path | [ ] (validate in Design via profiling the first end-to-end run) |
| A-003 | `gh-pages` orphan branch with force-push every refresh fits comfortably within GH's 1 GB repo soft cap, even with ~26y of accumulated Parquet artifacts | If the branch bloats, deploys slow down and GH may complain. Mitigation: orphan branch + force-push so history is always shallow; total live artifact size targeted < 100 MB | [ ] (estimate before first refresh; monitor via badge) |
| A-004 | yfR's behavior (cache layout, parallel chunking, frequency-dial semantics) at v1.1.3 is stable enough to port without chasing a moving target | If yfR releases a 2.x with breaking semantics, the port becomes a maintenance burden. Mitigation: pin parity tests to yfR 1.1.3; treat yfR drift as a future Phase 2 concern | [ ] (verify yfR latest tag at start of Design) |
| A-005 | Modern browsers (desktop Chrome/Firefox/Safari current versions, mobile Safari/Chrome current) can load and display ≤ 3 MB compressed JSON artifacts without UX issues | If mobile cold loads are unacceptably slow on Brazilian 3G, dashboard UX suffers. Mitigation: lazy-load heavy artifacts (correlation heatmap, full ticker explorer) on route entry; defer covariance Parquet to Phase 2 only | [ ] (Lighthouse run on first deployed page) |
| A-006 | 400 tickers × ~250 trading days × 26y of OHLCV is small enough that Bronze fits comfortably in a single Delta partition strategy keyed on `year(trading_date)` | If partitions become uneven (e.g., a flood of penny-stock IPOs in one year), small-file problems emerge. Mitigation: enable Delta auto-optimize and z-order on `ticker` | [ ] (validate after first historical backfill) |
| A-007 | Hand-curating `data/ticker_universe.csv` (~500 rows) covering active + delisted B3 issues is tractable for one person | If it isn't, the SCD2 ticker dim becomes the project's bottleneck. Mitigation: seed from a one-time scrape of B3 + InfoMoney + bovespa archive; subsequent updates are event-driven | [ ] (estimate effort before Design closes) |
| A-008 | Recharts handles 400-ticker filterable views without performance degradation when paired with virtualization for long lists | If Recharts struggles, swap specific charts (not the whole library) for lightweight alternatives | [ ] (prototype during Design) |

**Validation discipline:** Each unvalidated assumption must be checked at the start of Design or before its dependent code lands. Unvalidated assumptions become explicit risks in the DESIGN risk register.

---

## Clarity Score Breakdown

| Element | Score (0-3) | Notes |
|---------|-------------|-------|
| Problem | 3 | Crystal-clear gap stated: free, open, auditable B3 analytics with 20+y history doesn't exist; alternatives explicitly enumerated (Economatica, Refinitiv, brokerage dashboards, Colab notebooks); user impact tied to specific user types |
| Users | 3 | Three distinct personas with concrete pain points each; user #3 is the author themselves, which grounds the success criteria in lived needs |
| Goals | 3 | MUST/SHOULD/COULD prioritized; each MUST is observable and tied to a specific artifact (package on PyPI, Asset Bundle deploys, 5+ JSON artifacts, lifetime cost cap, Phase 2 architecture accommodation) |
| Success | 3 | Every criterion has a number (≤ 30 min runtime, ≥ 5 JSON artifacts, ≤ 1e-6 KPI error, ≤ US$ 50 cost, ≥ 10 fixture tickers, etc.); 12 Acceptance Tests with Given/When/Then |
| Scope | 3 | Out-of-scope list is long and specific; Phase 2 is explicitly architecture-accommodation-only with deferred implementation pointed to a separate future feature slug (`MERCADO_BR_PORTFOLIO`) |
| **Total** | **15/15** | |

**Minimum to proceed: 12/15 ✅ Gate cleared.**

---

## Open Questions

None — ready for Design.

Items marked as "validate in Design" in the Assumptions table are not gating; they are explicit checkpoints for the Design phase to schedule (typically as ADRs or risk-register entries).

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-05-21 | define-agent | Initial version extracted from `BRAINSTORM_MERCADO_BR.md` |

---

## Next Step

**Ready for:** `/agentspec:design .claude/sdd/features/DEFINE_MERCADO_BR.md`

**Suggested Design focus areas (preview):**

1. **`yfr_py` API surface lock** — function-by-function R→Python mapping table (`yf_get` / `yf_get_dividends` / `yf_get_index_components` / `yf_live_price` / cache layer / parallel chunker), with an ADR for the HTTP-backend abstraction (yfinance default, swappable to Brapi.dev or B3 direct).
2. **Silver SCD2 design** — exact `b3_ticker_dim` mutation logic for renames vs delistings vs new listings; deterministic `ticker_key` surrogate function.
3. **Gold artifact contracts** — finalized JSON Schemas committed under `pipelines/contracts/`; one ADR per artifact explaining the consumer contract.
4. **Asset Bundle topology** — single job vs DAG of tasks; cluster sizing; failure-isolation strategy across Bronze / Silver / Gold.
5. **GH Pages artifact pruning + size budget** — orphan-branch force-push protocol and bandwidth/size monitoring.
6. **Phase 1 vs Phase 2 split decision** — confirm in Design whether to keep one feature (`MERCADO_BR`) or split (`MERCADO_BR_DASHBOARD` + `MERCADO_BR_PORTFOLIO`).
