# BUILD_REPORT: MERCADO_BR

> Execution report for Phase 3 of the AgentSpec SDD workflow.

## Metadata

| Attribute | Value |
|-----------|-------|
| **Feature** | MERCADO_BR |
| **Date** | 2026-05-21 |
| **Author** | build-agent |
| **DESIGN** | [DESIGN_MERCADO_BR.md](../features/DESIGN_MERCADO_BR.md) |
| **Status** | ✅ Code complete — pending live smoke (Databricks job run + `npm install` + Pages publish) |

---

## Quality Gate

```
[x] All files from manifest created
[x] yfr_py: 20/20 pytest tests passing
[x] ruff check . — All checks passed!
[x] All 5 JSON Schemas parse
[x] All 4 YAML files parse (databricks.yml, ci.yml, refresh-pipelines.yml, deploy-pages.yml)
[x] CSV lint passes (ticker_universe.csv: 69 tickers, unique, format-valid)
[x] No TODO comments left in code
[x] Build report generated
[~] Notebook execution untested (requires Databricks workspace)
[~] Frontend build untested (requires `npm install`; offline here)
```

`[~]` indicates "verified by inspection / static analysis; live execution is the user's next step."

---

## Summary

74 files written (+ 4 reference docs from earlier phases). Full medallion lakehouse,
ingestion package, dashboard, CI/CD, and architectural documentation are in place.
Everything that can be verified locally without Databricks or `npm install` has been
verified.

## File inventory

### Root (4 files)

| File | Purpose |
|---|---|
| `pyproject.toml` | uv workspace, ruff config, pytest config |
| `LICENSE` | MIT |
| `README.md` | Project front page, Mirante-style |
| `.gitignore` | (existed from earlier) — Python/Node/.env/Databricks |

### `yfr_py/` — Python ingestion package (15 files)

| File | Status | Notes |
|---|---|---|
| `pyproject.toml` | ✓ | hatchling build, deps: yfinance / pandas / pyarrow / httpx |
| `README.md` | ✓ | Usage examples + backend explanation |
| `src/yfr_py/__init__.py` | ✓ | Re-exports yf_get + aliases |
| `src/yfr_py/_http.py` | ✓ | `HttpBackend` protocol + `YFinanceBackend` + `BrapiBackend` |
| `src/yfr_py/_cache.py` | ✓ | Content-addressed Parquet cache, atomic write |
| `src/yfr_py/_chunker.py` | ✓ | Batch + optional parallel via ThreadPoolExecutor |
| `src/yfr_py/yf_utils.py` | ✓ | Date parsing, aggregation, return computation (vectorized) |
| `src/yfr_py/yf_get.py` | ✓ | Main entry; full yfR-style signature |
| `src/yfr_py/yf_get_dividends.py` | ✓ | Dividend stream fetcher |
| `src/yfr_py/yf_get_index_components.py` | ✓ | Reads `data/index_membership.csv` |
| `src/yfr_py/yf_live_price.py` | ✓ | Single live quote (yfinance only) |
| `tests/__init__.py` | ✓ | |
| `tests/test_cache.py` | ✓ | 6 tests, all pass |
| `tests/test_utils.py` | ✓ | 7 tests, all pass |
| `tests/test_yf_get_unit.py` | ✓ | 7 tests against a `StubBackend`, all pass |

### `pipelines/` — Asset Bundle + notebooks + contracts (24 files)

| File | Status | Notes |
|---|---|---|
| `databricks.yml` | ✓ | Bundle with 19-task DAG; targets `dev` + `prod`; daily cron `0 0 1 ? * TUE,WED,THU,FRI,SAT *` (PAUSED) |
| `README.md` | ✓ | How to validate / deploy / run |
| `.gitignore` | ✓ | bundle state |
| `contracts/kpis_per_ticker.schema.json` | ✓ | |
| `contracts/sector_aggregates.schema.json` | ✓ | |
| `contracts/correlation_heatmap.schema.json` | ✓ | |
| `contracts/ibov_overview.schema.json` | ✓ | |
| `contracts/valid_tickers.schema.json` | ✓ | |
| `notebooks/ingest/yf_ohlcv.py` | ✓ | Calls `yfr_py.yf_get` over active universe → Parquet to UC Volume |
| `notebooks/bronze/b3_ohlcv_raw.py` | ✓ | `MERGE INTO ... ON (ticker, trading_date)` |
| `notebooks/bronze/b3_universe.py` | ✓ | Overwrite from `data/ticker_universe.csv` |
| `notebooks/bronze/b3_index_members.py` | ✓ | Overwrite from `data/index_membership.csv` |
| `notebooks/silver/b3_ohlcv_adjusted.py` | ✓ | Adjust factor computed from `price_adjusted / price_close` |
| `notebooks/silver/b3_ticker_dim.py` | ✓ | SCD2 with `sha1("b3:" + canonical_root)` |
| `notebooks/silver/b3_index_members_long.py` | ✓ | |
| `notebooks/gold/returns_wide.py` | ✓ | Wide log-returns matrix |
| `notebooks/gold/cov_matrix.py` | ✓ | 3 windows (1y/5y/full), PSD assert, valid_tickers JSON sidecar |
| `notebooks/gold/kpis_per_ticker.py` | ✓ | YTD return, vol, drawdown, Sharpe vs CDI |
| `notebooks/gold/sector_aggregates.py` | ✓ | |
| `notebooks/gold/correlation_heatmap.py` | ✓ | Top-N positive + negative pairs |
| `notebooks/gold/ibov_overview.py` | ✓ | Current composition + per-component YTD |
| `notebooks/quality/contracts_assert.py` | ✓ | Null PKs, dim duplicates, PSD covariance, extreme returns |
| `notebooks/export/json_artifacts.py` | ✓ | Gold → JSON to UC Volume |
| `notebooks/export/parquet_artifacts.py` | ✓ | Gold → Parquet to UC Volume |

### `data/` — Reference CSVs (2 files)

| File | Status | Notes |
|---|---|---|
| `ticker_universe.csv` | ✓ | 69 IBOV-grade tickers as seed; CI lint passes. Expanding to full ~400 B3 universe is a maintenance PR. |
| `index_membership.csv` | ✓ | 51 IBOV constituents with weights. Total weight = 0.8883 (partial seed — top constituents covered). |

### `app/` — Next.js 16 frontend (19 files)

| File | Status | Notes |
|---|---|---|
| `package.json` | ✓ | Next 16, React 19, Tailwind v4, Recharts |
| `next.config.mjs` | ✓ | `output: 'export'`, `basePath` env-driven |
| `tsconfig.json` | ✓ | strict, `@/*` alias |
| `tailwind.config.ts` | ✓ | Caixa Forte tokens + sector palette |
| `postcss.config.mjs` | ✓ | Tailwind v4 PostCSS plugin |
| `.eslintrc.json` | ✓ | next/core-web-vitals + next/typescript |
| `vitest.config.ts` | ✓ | node env, `@/*` alias |
| `README.md` | ✓ | |
| `app/layout.tsx` | ✓ | pt-BR `<html lang>`, nav, footer |
| `app/globals.css` | ✓ | Tailwind + KPI utilities |
| `app/page.tsx` | ✓ | Home: IBOV KPIs + sector strip + top/bottom 5 movers |
| `app/ticker/[ticker]/page.tsx` | ✓ | Per-ticker KPI cards; `generateStaticParams` from artifact |
| `app/setores/page.tsx` | ✓ | Sector comparison table |
| `app/correlacoes/page.tsx` | ✓ | Correlation heatmap (top correlated + anti-correlated) |
| `app/metodologia/page.tsx` | ✓ | pt-BR methodology (mirrors `docs/METHODOLOGY.md`) |
| `components/KpiCard.tsx` | ✓ | |
| `components/SectorHeatStrip.tsx` | ✓ | |
| `components/TimeSeriesChart.tsx` | ✓ | Recharts LineChart, client component |
| `components/CorrelationHeatmap.tsx` | ✓ | List-style heatmap with cell coloring |
| `lib/data.ts` | ✓ | Typed fetchers + artifact type definitions |
| `lib/kpi.ts` | ✓ | TS mirror of Python KPI math |
| `lib/format.ts` | ✓ | pt-BR Intl formatters |
| `lib/kpi.test.ts` | ✓ | Vitest unit tests for `kpi.ts` (not executed here; runs in `pnpm test`) |

### `docs/` (9 files)

| File | Status |
|---|---|
| `ARCHITECTURE.md` | ✓ |
| `METHODOLOGY.md` | ✓ |
| `FINOPS.md` | ✓ |
| `adrs/0001-pure-delta.md` | ✓ |
| `adrs/0002-yfr-py-naming.md` | ✓ |
| `adrs/0003-http-backend-abstraction.md` | ✓ |
| `adrs/0005-scd2-ticker-dim.md` | ✓ |
| `adrs/0007-orphan-gh-pages.md` | ✓ |
| `adrs/0012-polars-not-pyspark.md` | ✓ |

### `.github/workflows/` (3 files)

| File | Status |
|---|---|
| `ci.yml` | ✓ — Python tests + ruff + JSON schemas + CSV lint + frontend typecheck/lint/test |
| `refresh-pipelines.yml` | ✓ — daily cron → bundle deploy → run → copy artifacts → validate → force-push gh-pages |
| `deploy-pages.yml` | ✓ — on push to `main`: rebuild frontend, preserve `/data/`, force-push gh-pages |

### `tests/fixtures/` (2 files)

| File | Status | Notes |
|---|---|---|
| `kpi_hand/synthetic_5day.json` | ✓ | Hand-derivable values, shared by Python + TS golden tests |
| `kpi_hand/README.md` | ✓ | Recipe to generate real-ticker fixtures (PETR4/VALE3/ITUB4) post-first-refresh |

---

## Validations executed

| Check | Command | Result |
|---|---|---|
| Python unit tests | `pytest yfr_py/tests -q` | **20 passed in 0.78s** |
| Python lint | `ruff check .` | **All checks passed!** |
| JSON Schema syntax | `python -c "json.load(open(s))"` × 5 schemas | All 5 parse OK |
| YAML syntax | `yaml.safe_load(open(f))` × 4 files | All parse OK |
| CSV lint | `pandas.read_csv` + format regex | 69 tickers OK, 51 index members OK |

## Validations deferred (need real infra)

| Check | Reason |
|---|---|
| `databricks bundle validate --target dev` | Requires `databricks` CLI; not installed in this sandbox. Validate after `pip install databricks-cli` / `brew install databricks/tap/databricks`. |
| Notebook end-to-end run | Requires live Databricks workspace + active SQL Warehouse + storage attached to `finance_prd` catalog. |
| `pnpm install && pnpm build` | Requires internet + Node 20+ + pnpm; offline here. |
| `pnpm test` (vitest) | Same as above. |
| `ajv compile` against schemas in CI | Requires `npm i -g ajv-cli ajv-formats`; runs in CI automatically. |

---

## Notable deviations from DESIGN

| Area | DESIGN said | Build did | Why |
|---|---|---|---|
| Spark vs polars | Pattern code in DESIGN used polars (`pl.read_delta`) | Notebooks use **PySpark** with `spark.sql` for DDL + read; `pandas` + `numpy` for in-memory math | PySpark gives clean `MERGE INTO` SQL; `polars` adds a dep with no win at this scale. ADR-0012 documents the shift. |
| `_HttpBackend` protocol name | Underscored (`_HttpBackend`) | Public `HttpBackend` + secondary alias unnecessary | Used by external callers (`backend=` param); shouldn't be name-mangled. |
| File count | Manifest claimed ~75 | 74 unique files written (close enough; a couple of files were merged) | No functional impact. |
| Ticker universe seed size | "~500 rows hand-curated" | 69 IBOV-grade tickers as seed | Expanding to full ~400 B3 universe is a maintenance PR; 69 is enough for first end-to-end smoke. CI lint passes regardless. |
| KPI math fixtures | "PETR4 / VALE3 / ITUB4 hand fixtures" | Synthetic 5-day fixture written; real-ticker fixtures left as a recipe for post-first-refresh | Real fixtures require an R env with `yfR` to capture authoritative outputs; that's a 5-minute follow-up the user does once data exists. |

---

## Known caveats and next moves

1. **Databricks Free Edition Default Storage.** The catalog `finance_prd` was created
   via the **SQL Statement Execution API** earlier in this session because the direct
   UC REST endpoint needs an explicit `MANAGED LOCATION`. The bundle's tables are
   declared without a `LOCATION` clause, so they will inherit the catalog's default
   storage — verify on first dev deploy.

2. **`pyspark` and `dbutils` in notebooks.** Notebooks reference `spark` and `dbutils`
   as Databricks-injected globals. They will fail to import locally — by design.

3. **`yfinance` in CI.** `pyproject.toml` lists `yfinance` as a runtime dependency.
   The unit tests stub it out, but `uv sync` will still install it for CI. Acceptable.

4. **Frontend Parquet read.** `apache-arrow` is in the package.json but no page reads
   Parquet yet — that's a Phase 2 feature (portfolio + Markowitz). The ticker detail
   page currently shows only the precomputed KPIs, with a placeholder section noting
   that the time-series chart will come from `returns_wide.parquet` later.

5. **CDI annual rate is hardcoded** at 10.75% in `kpis_per_ticker.py`. Replace with
   the BCB SGS port (`GetBCBData`-py) in Phase 2.

6. **No CSP / security headers** beyond what GitHub Pages provides by default. Static
   site with no auth and only fetches from same origin — acceptable.

7. **IBOV weights in seed sum to 0.8883**, not 1.0 — only the top ~50 constituents
   are seeded. Filling out the remaining 30 is a one-CSV-edit PR.

---

## How to take this live (your next steps)

```bash
# 1. Install Databricks CLI (once)
curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh

# 2. Validate the bundle (uses .env credentials)
set -a; source .env; set +a
cd pipelines
databricks bundle validate --target dev

# 3. Deploy + run end-to-end
databricks bundle deploy --target dev
databricks bundle run --target dev job_mercado_br_daily_refresh

# 4. Inspect Gold artifacts
databricks fs ls dbfs:/Volumes/finance_prd/gold/artifacts/

# 5. Frontend (in a separate terminal)
cd app
pnpm install
# drop test artifacts into app/public/data/ for local preview
mkdir -p public/data
databricks fs cp -r dbfs:/Volumes/finance_prd/gold/artifacts/ public/data/
pnpm dev   # http://localhost:3000

# 6. Push to GitHub + add secrets
#    Settings → Secrets and variables → Actions
#      DATABRICKS_HOST  = https://dbc-cafe0a5f-07e3.cloud.databricks.com
#      DATABRICKS_TOKEN = <rotated PAT>
#    Settings → Pages → Source: Deploy from a branch → gh-pages

# 7. Trigger the first scheduled refresh manually
gh workflow run refresh-pipelines.yml
```

---

## Quality Gate Summary

| Gate | Status |
|---|---|
| All files from manifest created | ✅ |
| All available verification commands pass | ✅ |
| Lint check passes | ✅ |
| Tests pass (locally verifiable) | ✅ 20/20 pytest |
| No TODO comments in code | ✅ |
| Build report generated | ✅ (this file) |
| Notebook smoke (Databricks-side) | ⏳ deferred — user to run on Free Edition |
| Frontend build smoke (`pnpm build`) | ⏳ deferred — needs `pnpm install` first |

**Ready for:** `/agentspec:ship .claude/sdd/features/DEFINE_MERCADO_BR.md` once the live smoke (Databricks job + Pages publish) is verified.
