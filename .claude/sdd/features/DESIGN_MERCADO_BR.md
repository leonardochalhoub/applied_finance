# DESIGN: Mercado BR — Plataforma de Análise do Mercado Acionário Brasileiro

> Technical design for `MERCADO_BR`. Locks the `yfr_py` API surface, the medallion schema with SCD2 ticker dim, the JSON/Parquet artifact contracts, the Databricks Asset Bundle topology, and the Next.js static-export dashboard structure.

## Metadata

| Attribute | Value |
|-----------|-------|
| **Feature** | MERCADO_BR |
| **Date** | 2026-05-21 |
| **Author** | design-agent |
| **DEFINE** | [DEFINE_MERCADO_BR.md](./DEFINE_MERCADO_BR.md) |
| **Status** | Ready for Build |

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MERCADO BR — DATA + APP                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────┐    ┌──────────────────────────────────────────────────┐  │
│  │ data/         │    │  Databricks Free Edition (catalog: finance_prd)   │  │
│  │ ticker_       │───►│                                                   │  │
│  │ universe.csv  │    │  ┌──────────┐  ┌──────────┐  ┌──────────┐         │  │
│  │ index_        │    │  │  INGEST  │  │  BRONZE  │  │  SILVER  │         │  │
│  │ membership.csv│    │  │ yfr_py   │─►│ delta    │─►│ adjusted │         │  │
│  └───────────────┘    │  │ → Volume │  │ append   │  │ + SCD2   │         │  │
│                       │  └──────────┘  └──────────┘  └────┬─────┘         │  │
│  ┌───────────────┐    │                                    │              │  │
│  │ Yahoo Finance │───►│                                    ▼              │  │
│  │ (B3 .SA)      │    │                          ┌──────────────────┐     │  │
│  │ via yfr_py    │    │                          │      GOLD        │     │  │
│  │ (HTTPS)       │    │                          │ returns_wide     │     │  │
│  └───────────────┘    │                          │ cov_{1y,5y,full} │     │  │
│                       │                          │ kpis_per_ticker  │     │  │
│                       │                          │ sector_aggs      │     │  │
│                       │                          │ correlation_heat │     │  │
│                       │                          │ ibov_overview    │     │  │
│                       │                          └────────┬─────────┘     │  │
│                       │                                   │               │  │
│                       │                          ┌────────▼─────────┐     │  │
│                       │                          │ EXPORT notebook  │     │  │
│                       │                          │ → UC Volume      │     │  │
│                       │                          │ → /artifacts/*   │     │  │
│                       │                          └────────┬─────────┘     │  │
│                       └───────────────────────────────────┼───────────────┘  │
│                                                           │                  │
│  ┌────────────────────────────────────────────────────────▼────────────┐    │
│  │  GitHub Actions (.github/workflows/refresh-pipelines.yml)            │    │
│  │  cron: 0 1 * * 2-6 UTC  (~22:00 BRT, after B3 close)                 │    │
│  │  steps:                                                              │    │
│  │   1. databricks bundle run --target prod  (triggers full DAG)        │    │
│  │   2. databricks fs cp /Volumes/.../artifacts/ ./_artifacts/          │    │
│  │   3. validate schemas (jsonschema CLI against contracts/*.json)      │    │
│  │   4. orphan-branch force-push to gh-pages                            │    │
│  └─────────────────────────────────────────────────┬────────────────────┘    │
│                                                    │                         │
│  ┌─────────────────────────────────────────────────▼────────────────────┐    │
│  │  GitHub Pages (gh-pages branch, orphan)                              │    │
│  │  /app/  ← Next.js static export (output: 'export')                   │    │
│  │  /data/ ← JSON artifacts (small, ≤ 500 KB each)                      │    │
│  │  /data/ ← Parquet artifacts (returns_wide, cov_*, ≤ 100 MB total)    │    │
│  └─────────────────────────────────────────────────┬────────────────────┘    │
│                                                    │                         │
│  ┌─────────────────────────────────────────────────▼────────────────────┐    │
│  │  Browser (Recharts + Tailwind v4 + Next.js 16 static export)         │    │
│  │  - Home: IBOV overview, top movers, sector heat strip                │    │
│  │  - /ticker/[T]: KPI cards, time series, dividends                    │    │
│  │  - /setores: sector-level comparison                                 │    │
│  │  - /correlacoes: correlation heatmap                                 │    │
│  │  - Phase 2 (deferred): /portfolio with client-side WASM QP solver    │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| `yfr_py` (Python package) | Canonical ingestion library — typed port of msperlin/yfR with cache, batch, parallel, frequency dial | Python 3.11+, `yfinance`, `httpx`, `pandas`/`polars`, `pyarrow` |
| Ingest notebook | Calls `yfr_py.yf_get` over the full B3 universe and lands raw OHLCV to a UC Volume | Databricks notebook (Python), Asset Bundle resource |
| Bronze layer (Delta) | Append-only landing of raw + Yahoo-adjusted prices; immutable record of every refresh | Delta Lake on Databricks Free; UC catalog `finance_prd.bronze.*` |
| Silver layer (Delta) | Cleaned, adjusted, gap-filled prices + SCD2 ticker dimension + IBOV/IBrA/IBrX membership long table | Delta Lake; UC catalog `finance_prd.silver.*` |
| Gold layer (Delta) | Returns matrix, 3 covariance matrices (1y/5y/full), per-ticker KPIs, sector aggregates, correlation heatmap data, IBOV overview | Delta Lake + materialized Parquet/JSON; UC catalog `finance_prd.gold.*` |
| Export notebook | Writes Gold tables to UC Volume `/Volumes/finance_prd/gold/artifacts/` as versioned JSON + Parquet | Databricks notebook; reads Gold → writes Volume |
| Schema validator | Validates published JSON against `pipelines/contracts/*.schema.json` before deploy | `jsonschema` (Python CLI) inside GH Actions |
| Refresh workflow | Daily cron, triggers full Databricks DAG, copies artifacts out, validates, force-pushes to `gh-pages` | GitHub Actions YAML |
| Frontend (`app/`) | Static-exported Next.js 16 dashboard with Recharts and Tailwind v4; consumes only what's published to `gh-pages` | Next.js 16 (`output: 'export'`), React 19, Tailwind v4, Recharts, TypeScript |
| Design tokens | Caixa Forte's monochrome base + finance-specific accent palette (sector colors, gains/losses) | `app/tailwind.config.ts` + `app/globals.css` |
| Docs + ADRs | Architecture, methodology, FinOps, decision records | Markdown under `docs/` |

---

## Key Decisions

### Decision 1: Pure Delta (no DLT, no Materialized Views)

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** Databricks offers Delta Live Tables (DLT) and Materialized Views for declarative pipelines. Mirante deliberately chose pure Delta. We must align or diverge.

**Choice:** Pure Delta. Bronze = `MERGE INTO ... USING ... WHEN MATCHED` (idempotent); Silver / Gold = `INSERT OVERWRITE` (full refresh of small tables).

**Rationale:**
- Mirante's identical workspace, same Free Edition, same FinOps story already validated pure-Delta works inside Free Edition quotas; DLT adds opaque scheduling and licensing surface area for zero observable benefit on this data volume.
- 2.6M Bronze rows + sub-million Silver/Gold = tiny by Spark standards; overwrites are seconds, not minutes.
- Notebooks-as-source make debugging trivial (run cell-by-cell); DLT obscures the runtime graph.
- Keeps the project portable — these notebooks can run on any Spark distribution, not only Databricks.

**Alternatives Rejected:**
1. **DLT (Delta Live Tables)** — Rejected because of opaque scheduling, Free-Edition feature uncertainty, and zero benefit on this volume.
2. **Materialized Views** — Rejected because Gold artifacts are file-published, not query-served. MVs would add a layer we never read from.

**Consequences:**
- Idempotency is our responsibility (Bronze uses MERGE on `(ticker, trading_date)`; Silver/Gold use full overwrite of small tables).
- Expectations / data-quality become explicit Python asserts in notebooks (not DLT `EXPECT`), with violations raising and failing the task.

---

### Decision 2: `yfr_py` keeps yfR's R-style function names as the primary API, with Pythonic aliases as secondary exports

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** yfR exports `yf_get`, `yf_get_dividends`, `yf_get_index_components`, `yf_live_price`. Python idiom prefers `get_market_data`. The DEFINE goal is "yfR API parity, not a thin yfinance wrapper".

**Choice:** Primary public API is `yfr_py.yf_get(...)`, `yfr_py.yf_get_dividends(...)`, etc. — verbatim names from yfR. Secondary aliases (`yfr_py.get_market_data = yf_get`) are exported for users who prefer Python idioms.

**Rationale:**
- Parity is the explicit value proposition. Anyone porting an R script reads the function name and finds it 1:1.
- Aliases are cheap and discoverable via IDE autocomplete.
- The goldenfile parity tests reference yfR function names — keeping the same identifier makes diffs trivial.

**Alternatives Rejected:**
1. **Rename everything to Python idioms** — Rejected because it severs the "this is the Python yfR" message.
2. **Snake-case yfR's CamelCase** — yfR is already snake_case; non-issue.

**Consequences:**
- Linters may flag `yf_*` as non-Pythonic; we configure `ruff` to allow it for this package only.
- README documents both forms.

---

### Decision 3: HTTP backend is abstracted behind a `_HttpBackend` protocol; `yfinance` is the default, `Brapi.dev` is a registered fallback

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** Assumption A-001 from DEFINE flagged Yahoo endpoint risk. `yfinance` is the lowest-friction default but historically Yahoo has rate-limited or briefly blocked it.

**Choice:** All HTTP-bound code in `yfr_py` calls a `_HttpBackend` protocol. Ship two implementations: `_YFinanceBackend` (default) and `_BrapiBackend` (fallback). Backend is selectable via `yf_get(..., backend="yfinance" | "brapi" | _HttpBackend)`.

**Rationale:**
- Insulates production from upstream blocks.
- Brapi.dev's free tier is small but enough for tail-of-emergency.
- The protocol surface is small (`fetch_ohlcv(ticker, start, end, freq) -> pd.DataFrame`), so writing a third backend later is hours, not days.

**Alternatives Rejected:**
1. **Hardcode `yfinance`** — Rejected because Assumption A-001 explicitly warned of this risk.
2. **Write our own HTTP client against Yahoo's unofficial endpoints** — Rejected because `yfinance` already does the reverse-engineering.

**Consequences:**
- Tests stub `_HttpBackend` instead of network-mocking; cleaner.
- One extra dependency (`httpx` for the Brapi backend).

---

### Decision 4: Local cache is Parquet keyed on `(ticker, first_date, last_date, freq, type_return)` under a content-addressed path

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** yfR uses `.rds` files. We can't read `.rds` in Python natively. We must define our equivalent.

**Choice:** `~/.cache/yfr_py/{sha1(ticker|first_date|last_date|freq|type_return)}.parquet`. Atomic write via `*.tmp` + `os.replace`. Read-on-hit, no TTL by default (yfR uses session tempdir; we make persistent the default but expose `do_cache=False` and `cache_folder=None`).

**Rationale:**
- Parquet is faster + smaller than CSV + native to the rest of our stack.
- Content-addressed paths sidestep filename-encoding bugs.
- Atomic writes prevent half-cache poisoning across crashes.

**Alternatives Rejected:**
1. **SQLite / DuckDB cache** — Rejected as overkill for sub-million-row blobs and adds a dependency.
2. **Pickle** — Rejected because of Python version coupling and security implications.

**Consequences:**
- Cache files are portable across machines (same Parquet schema).
- A `yfr_py.yf_cache_clear()` helper is required (mirroring yfR's `yf_cachefolder_get` + helpers).

---

### Decision 5: Silver `b3_ticker_dim` SCD2 surrogate key is `sha1(canonical_entity_id)`, where `canonical_entity_id` is the prior-symbol chain root

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** B3 has many ticker renames (e.g., `BRDT3 → VBBR3`, `ECT3 → multiplos`, share-class consolidations). Across 26 years, ~50 renames matter. Treating renamed tickers as new entities would split returns series and break covariance.

**Choice:** `data/ticker_universe.csv` has a `prior_tickers` column (array of strings). The Silver job walks the chain to find the **canonical root** (oldest ticker the entity ever used) and sets `ticker_key = sha1("b3:" + canonical_root)`. SCD2 rows track every visible symbol the entity has had with `valid_from` / `valid_to` ranges.

**Rationale:**
- Deterministic, reproducible across runs.
- Returns series for the same business entity stay continuous even across renames.
- Adding a new rename is a one-line edit in `ticker_universe.csv`.

**Alternatives Rejected:**
1. **CNPJ as natural key** — Rejected because many tickers (FIIs, ETFs) have no CNPJ in our source.
2. **Monotonic integer surrogate** — Rejected because deterministic keys allow reproducible joins across forks/clones of this repo.

**Consequences:**
- `silver.b3_ohlcv_adjusted` joins to `b3_ticker_dim` via `(ticker, trading_date BETWEEN valid_from AND COALESCE(valid_to, '9999-12-31'))`.
- Operators must keep `prior_tickers` accurate; we add an acceptance test that fails if any rename produces overlapping windows.

---

### Decision 6: Gold publishes **3** precomputed covariance matrices (1y / 5y / full), each with a `valid_tickers_*.json` companion

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** Phase 2's client-side Markowitz solver needs covariance, but lookback window is a user choice. Computing covariance in the browser from log returns is feasible but costly for 400 tickers × 5y × 252 days.

**Choice:** Precompute 3 windows at Gold time. Each window publishes a Parquet long-form covariance file + a JSON list of tickers that have full history in that window. The frontend lazy-loads only the window the user picks.

**Rationale:**
- Browser stays light; matrix math is the heavy bit, not the QP itself.
- 3 windows × ~6 MB Parquet = ~18 MB total — fits comfortably in GH Pages bandwidth.
- Decouples Gold compute from frontend code.

**Alternatives Rejected:**
1. **Single full-window covariance, recompute slices in browser** — Rejected because slice + recompute on 400×400 in JS is slow and error-prone.
2. **Compute on demand server-side** — Rejected because we said no backend.

**Consequences:**
- Phase 2's solver receives a fixed matrix per window choice; no client-side covariance code needed.
- Adding a new window (e.g., 3y) is one notebook edit.

---

### Decision 7: Each refresh creates a new `gh-pages` orphan branch and force-pushes; no Pages history retained

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** GH Pages serves from one branch. Mirante uses orphan + force-push. With 26y of historical Parquet + daily refresh, retaining branch history would balloon the repo.

**Choice:** `refresh-pipelines.yml` runs `git checkout --orphan gh-pages-new && git add -A && git commit && git push --force origin gh-pages-new:gh-pages`. No artifact history on the branch. Provenance lives in:
- Bronze Delta tables (immutable append log) inside Databricks
- The `gold.*` Delta tables (overwritten but with Delta time-travel for 7 days)
- The `source_run_id` field embedded in every published JSON artifact

**Rationale:**
- Pages stays under GH's 1 GB soft cap forever.
- Deploy time is bounded (no growing diff).
- Authoritative provenance is in Databricks; Pages is a publishing surface, not a log.

**Alternatives Rejected:**
1. **Append commits to `gh-pages`** — Rejected because repo bloats unbounded.
2. **Use GH Releases for artifacts** — Rejected because releases aren't CDN-served the way Pages is.

**Consequences:**
- "Time-travel the public dashboard" is not a feature. Acceptable: dashboard always reflects "as of last refresh".
- The `gh-pages` branch tip changes on every refresh; consumers that pin SHAs need to use the Delta tables, not Pages URLs.

---

### Decision 8: Hand-curated `data/ticker_universe.csv` is the source of truth for the active + delisted B3 universe; never scraped at runtime

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** B3's official listing data is not free + complete. InfoMoney + Brapi don't expose delisted history. Scraping is fragile.

**Choice:** Maintain `data/ticker_universe.csv` (~500 rows) by hand. Columns: `ticker, company_name, sector_b3, subsector_b3, listed_from, listed_to, prior_tickers (array, |-sep), cnpj (optional), notes`. Seeded once via a one-off scrape + manual review; thereafter updated event-driven (new listings, M&As, renames) as a single PR.

**Rationale:**
- Small enough to be tractable (~500 rows).
- Git history becomes the audit trail of universe changes.
- Removes a runtime failure mode (scraper breaks → ingest fails).

**Alternatives Rejected:**
1. **Live scrape every refresh** — Rejected: fragile + slow + no provenance.
2. **Paid feed** — Rejected: FinOps cap.

**Consequences:**
- Operator burden: ~1 PR/month to keep current.
- A CI lint validates the CSV (no duplicate tickers, valid dates, sector enum membership).

---

### Decision 9: Frontend is Next.js 16 with `output: 'export'`; **no shadcn/ui** in v1 — stay closer to Recharts + raw Tailwind

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** Caixa Forte uses shadcn/ui + Radix primitives. Bringing them in adds bundle weight + design coupling. Our dashboard is read-only — no dialogs, no popovers, no auth UX.

**Choice:** Plain Next.js + Tailwind v4 + Recharts. Adapt Caixa Forte's tailwind color tokens but extend with sector palette and gains/losses semantics. Defer shadcn to whenever we actually need a `<Dialog>` or `<Combobox>` (probably Phase 2 portfolio builder).

**Rationale:**
- Smaller bundle = better Lighthouse on mobile cold loads on Brazilian 3G.
- Lower abstraction = junior contributors read the code easily.
- We can adopt shadcn surgically in Phase 2 without rework.

**Alternatives Rejected:**
1. **Full Caixa-Forte-clone (shadcn/ui everywhere)** — Rejected: heavy + zero functional gain.
2. **Visx or lightweight-charts** — Rejected: design-system divergence from Caixa Forte's Recharts story.

**Consequences:**
- Filter UX is built with native `<select>` + headless logic, not shadcn `<Combobox>`. Less polish, more performance.
- Phase 2 introduces shadcn for the portfolio builder.

---

### Decision 10: KPI math, return computation, and covariance math are duplicated across (a) Python in Gold notebooks and (b) TypeScript in the frontend, for KPI cards that need on-the-fly variants. Both paths share a single fixture set as ground truth.

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** Frontend may want to show "return since selected date" interactively. Server-side precomputing every possible (ticker, start, end) is infeasible.

**Choice:** Precompute the published KPIs (return YTD, vol, max DD, Sharpe vs CDI) in Python. For interactive "since-X" recomputation in the browser, ship a small TypeScript module (`app/lib/kpi.ts`) that re-implements the same formulas, validated against the same JSON fixtures as the Python tests.

**Rationale:**
- Honest: identical math regardless of language.
- The fixture file is the contract; if either implementation drifts, CI fails.

**Alternatives Rejected:**
1. **Precompute every possible start date** — Rejected: combinatorial explosion.
2. **Server-side compute on demand** — Rejected: no backend.

**Consequences:**
- Two implementations to maintain. Mitigated by both being short (~50 lines each) and golden-tested.

---

### Decision 11: One feature slug (`MERCADO_BR`) covers Phase 1 + Phase 2 architecture, but Phase 2 implementation is gated behind a separate future feature (`MERCADO_BR_PORTFOLIO`); no Phase-2 frontend routes exist in v1

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** DEFINE flagged this as an open question. Two paths: one big feature, or split now.

**Choice:** Keep one feature for the platform; **but** Phase-2 frontend code does not exist in v1. The architecture (covariance matrix windows, valid_tickers JSONs, ticker dim joins) is in place; the `/portfolio` route is created **only** when `MERCADO_BR_PORTFOLIO` ships.

**Rationale:**
- One ADR set, one architecture doc, less duplication.
- Frontend routes that don't exist can't drift; we won't ship 404s.
- Clean cut-line for `/build` Phase 3.

**Alternatives Rejected:**
1. **Split into `MERCADO_BR_DASHBOARD` + `MERCADO_BR_PORTFOLIO` now** — Rejected because architectural decisions are shared; splitting docs adds maintenance burden.
2. **Build Phase 2 frontend now even without solver** — Rejected as YAGNI per BRAINSTORM.

**Consequences:**
- Phase 2's first task is to add `/app/portfolio/page.tsx` + the WASM QP integration. No Gold work needed at that time.

---

### Decision 12: Pipeline tasks use **single-node small clusters** with `polars` for in-task transforms; Spark is used **only** where polars hits memory limits (currently never)

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-21 |

**Context:** 2.6M Bronze rows + sub-million Silver/Gold is comfortably single-machine. Spark adds JVM startup time (~30s) per task; polars starts instantly.

**Choice:** Cluster type: single-node, smallest available on Databricks Free. Notebooks use `polars` + `deltalake` (Python) instead of PySpark for transforms. `deltalake` writes Delta tables natively; Databricks reads them transparently.

**Rationale:**
- Faster iteration during dev.
- Lower compute consumption inside Free Edition quotas.
- Same Delta artifacts; downstream consumers (notebooks, SQL queries) don't notice.

**Alternatives Rejected:**
1. **PySpark for everything** — Rejected: JVM startup tax, slower iteration, zero benefit at this scale.
2. **Pandas** — Rejected: 5-10x slower than polars, less memory-efficient.

**Consequences:**
- Notebooks read Bronze via `deltalake.DeltaTable("/Volumes/.../bronze.b3_ohlcv_raw").to_pandas()` (or polars).
- If volume ever crosses ~100M rows (e.g., we add intraday), revisit with PySpark.

---

## File Manifest

> Total: **~75 files** across `yfr_py/`, `pipelines/`, `app/`, `data/`, `docs/`, `tests/`, `.github/workflows/`.

### `yfr_py/` — Python ingestion package (12 files)

| # | File | Action | Purpose | Agent | Dependencies |
|---|------|--------|---------|-------|--------------|
| 1 | `yfr_py/__init__.py` | Create | Public re-exports (`yf_get`, aliases) | @python-developer | None |
| 2 | `yfr_py/pyproject.toml` | Create | uv/PEP-621 metadata, deps, ruff config | @python-developer | None |
| 3 | `yfr_py/_http.py` | Create | `_HttpBackend` protocol + `_YFinanceBackend` + `_BrapiBackend` | @python-developer | 2 |
| 4 | `yfr_py/_cache.py` | Create | Parquet-backed content-addressed cache | @python-developer | 2 |
| 5 | `yfr_py/_chunker.py` | Create | Ticker batching + optional parallel via `concurrent.futures` | @python-developer | 3 |
| 6 | `yfr_py/yf_get.py` | Create | Main entry — yfR's `yf_get` ported, with all keyword args | @python-developer | 3,4,5 |
| 7 | `yfr_py/yf_get_dividends.py` | Create | Dividend stream fetcher | @python-developer | 3,4 |
| 8 | `yfr_py/yf_get_index_components.py` | Create | IBOV / IBrA / IBrX composition fetch (uses static CSV + supplements) | @python-developer | 3 |
| 9 | `yfr_py/yf_live_price.py` | Create | Single live quote (used sparingly; Phase 1 surfaces this in a "última cotação" badge) | @python-developer | 3 |
| 10 | `yfr_py/yf_utils.py` | Create | Date parsing, frequency aggregation, return computation | @python-developer | 2 |
| 11 | `yfr_py/tests/test_*.py` | Create | Unit + golden-file parity tests against yfR captured fixtures | @test-generator | 1-10 |
| 12 | `yfr_py/tests/fixtures/yfr_golden/*.parquet` | Create | Captured yfR output for parity comparison | @test-generator | 11 |

### `pipelines/` — Databricks Asset Bundle + notebooks (24 files)

| # | File | Action | Purpose | Agent | Dependencies |
|---|------|--------|---------|-------|--------------|
| 13 | `pipelines/databricks.yml` | Create | Asset Bundle — single `job_mercado_br_daily_refresh` with task DAG | @pipeline-architect | None |
| 14 | `pipelines/notebooks/ingest/yf_ohlcv.py` | Create | Calls `yfr_py.yf_get` over full universe → writes Parquet to `/Volumes/finance_prd/bronze/raw/yf/{run_id}/` | @lakeflow-pipeline-builder | 6, 13 |
| 15 | `pipelines/notebooks/bronze/b3_ohlcv_raw.py` | Create | Auto-Loader-style read of `/Volumes/finance_prd/bronze/raw/yf/**.parquet` → MERGE INTO `bronze.b3_ohlcv_raw` | @lakeflow-pipeline-builder | 14 |
| 16 | `pipelines/notebooks/bronze/b3_universe.py` | Create | Read `data/ticker_universe.csv` → overwrite `bronze.b3_universe` | @lakeflow-pipeline-builder | None |
| 17 | `pipelines/notebooks/bronze/b3_index_members.py` | Create | Read `data/index_membership.csv` → overwrite `bronze.b3_index_members` | @lakeflow-pipeline-builder | None |
| 18 | `pipelines/notebooks/silver/b3_ohlcv_adjusted.py` | Create | Apply splits/dividends from yfinance metadata → overwrite `silver.b3_ohlcv_adjusted` | @lakeflow-pipeline-builder | 15 |
| 19 | `pipelines/notebooks/silver/b3_ticker_dim.py` | Create | SCD2 over `bronze.b3_universe` with surrogate `ticker_key` | @schema-designer | 16 |
| 20 | `pipelines/notebooks/silver/b3_index_members_long.py` | Create | Pivot membership snapshots to long form `(ticker, index, valid_from, valid_to)` | @lakeflow-pipeline-builder | 17 |
| 21 | `pipelines/notebooks/gold/returns_wide.py` | Create | Build wide returns matrix (one column per ticker, log returns) | @spark-engineer | 18 |
| 22 | `pipelines/notebooks/gold/cov_matrix.py` | Create | Compute 3 covariance matrices (1y, 5y, full) + emit `valid_tickers_*` lists | @spark-engineer | 21 |
| 23 | `pipelines/notebooks/gold/kpis_per_ticker.py` | Create | Return YTD, annualized vol, max drawdown, Sharpe vs CDI per ticker | @spark-engineer | 18 |
| 24 | `pipelines/notebooks/gold/sector_aggregates.py` | Create | Per-sector return & vol, join via SCD2 ticker dim | @spark-engineer | 18, 19 |
| 25 | `pipelines/notebooks/gold/correlation_heatmap.py` | Create | Top-N correlated + anti-correlated pairs for the heatmap UI | @spark-engineer | 21 |
| 26 | `pipelines/notebooks/gold/ibov_overview.py` | Create | Current IBOV composition + weights + per-component YTD | @spark-engineer | 18, 20 |
| 27 | `pipelines/notebooks/export/json_artifacts.py` | Create | Read Gold tables → write JSON to `/Volumes/finance_prd/gold/artifacts/` | @lakeflow-pipeline-builder | 23,24,25,26 |
| 28 | `pipelines/notebooks/export/parquet_artifacts.py` | Create | Read returns_wide + cov_matrix → write Parquet to UC Volume | @lakeflow-pipeline-builder | 21, 22 |
| 29 | `pipelines/notebooks/quality/contracts_assert.py` | Create | After Gold: validate row counts, no-null PKs, PSD covariance | @data-quality-analyst | 21-26 |
| 30 | `pipelines/contracts/kpis_per_ticker.schema.json` | Create | JSON-Schema for the per-ticker KPI artifact | @data-contracts-engineer | None |
| 31 | `pipelines/contracts/sector_aggregates.schema.json` | Create | JSON-Schema | @data-contracts-engineer | None |
| 32 | `pipelines/contracts/correlation_heatmap.schema.json` | Create | JSON-Schema | @data-contracts-engineer | None |
| 33 | `pipelines/contracts/ibov_overview.schema.json` | Create | JSON-Schema | @data-contracts-engineer | None |
| 34 | `pipelines/contracts/valid_tickers.schema.json` | Create | JSON-Schema for the cov-matrix valid_tickers companion | @data-contracts-engineer | None |
| 35 | `pipelines/README.md` | Create | Bundle-level README — how to run locally, deploy, debug | @code-documenter | 13 |
| 36 | `pipelines/.gitignore` | Create | Ignore `.bundle/`, local caches | @python-developer | None |

### `app/` — Next.js 16 static-export dashboard (18 files)

| # | File | Action | Purpose | Agent | Dependencies |
|---|------|--------|---------|-------|--------------|
| 37 | `app/package.json` | Create | Next.js 16 + React 19 + Recharts + Tailwind v4 + vitest + playwright | (no specialist; generalist) | None |
| 38 | `app/next.config.mjs` | Create | `output: 'export'`, basePath for GH Pages | (generalist) | 37 |
| 39 | `app/tsconfig.json` | Create | Strict TS config matching Caixa Forte | (generalist) | None |
| 40 | `app/tailwind.config.ts` | Create | Caixa Forte tokens + sector palette extension | (generalist) | None |
| 41 | `app/app/layout.tsx` | Create | Root layout, pt-BR `<html lang>`, fonts | (generalist) | 38-40 |
| 42 | `app/app/globals.css` | Create | Tailwind base + finance-specific utilities (`.kpi-positive`, `.kpi-negative`) | (generalist) | 40 |
| 43 | `app/app/page.tsx` | Create | Home — IBOV overview, top movers, sector heat strip | (generalist) | 41, 42, 44 |
| 44 | `app/lib/data.ts` | Create | Typed fetchers for `/data/*.json` + `/data/*.parquet` (parquet read via `apache-arrow`) | (generalist) | None |
| 45 | `app/lib/kpi.ts` | Create | TS mirror of Python KPI math, golden-tested vs same fixtures | (generalist) | None |
| 46 | `app/lib/format.ts` | Create | pt-BR number / date / percentage formatters | (generalist) | None |
| 47 | `app/components/KpiCard.tsx` | Create | KPI card component | (generalist) | 40, 46 |
| 48 | `app/components/SectorHeatStrip.tsx` | Create | Sector-level heat strip on home | (generalist) | 47 |
| 49 | `app/components/TimeSeriesChart.tsx` | Create | Recharts time series with brush + log-scale toggle | (generalist) | None |
| 50 | `app/components/CorrelationHeatmap.tsx` | Create | Heatmap component using Recharts ScatterChart with cell rendering | (generalist) | None |
| 51 | `app/app/ticker/[ticker]/page.tsx` | Create | Per-ticker page — KPIs, time series, dividends | (generalist) | 47, 49 |
| 52 | `app/app/setores/page.tsx` | Create | Sector comparison | (generalist) | 47 |
| 53 | `app/app/correlacoes/page.tsx` | Create | Correlation heatmap (lazy-loads heatmap JSON only) | (generalist) | 50 |
| 54 | `app/app/metodologia/page.tsx` | Create | pt-BR methodology doc rendered as MDX | (generalist) | None |

### `data/` — Reference CSVs (2 files)

| # | File | Action | Purpose | Agent | Dependencies |
|---|------|--------|---------|-------|--------------|
| 55 | `data/ticker_universe.csv` | Create | Hand-curated B3 universe (~500 rows) | (manual; @python-developer scaffold) | None |
| 56 | `data/index_membership.csv` | Create | IBOV/IBrA/IBrX composition snapshots | (manual) | None |

### `docs/` — Architecture, methodology, FinOps (9 files)

| # | File | Action | Purpose | Agent | Dependencies |
|---|------|--------|---------|-------|--------------|
| 57 | `docs/ARCHITECTURE.md` | Create | High-level architecture + diagram, links ADRs | @code-documenter | All |
| 58 | `docs/METHODOLOGY.md` | Create | pt-BR — formulas for return, vol, drawdown, Sharpe | @code-documenter | 23, 45 |
| 59 | `docs/FINOPS.md` | Create | Cost tracking, monthly snapshots, badge data | @code-documenter | None |
| 60 | `docs/adrs/0001-pure-delta.md` | Create | Extracted from Decision 1 | @code-documenter | This file |
| 61 | `docs/adrs/0002-yfr-py-naming.md` | Create | Extracted from Decision 2 | @code-documenter | This file |
| 62 | `docs/adrs/0003-http-backend-abstraction.md` | Create | Extracted from Decision 3 | @code-documenter | This file |
| 63 | `docs/adrs/0005-scd2-ticker-dim.md` | Create | Extracted from Decision 5 | @code-documenter | This file |
| 64 | `docs/adrs/0007-orphan-gh-pages.md` | Create | Extracted from Decision 7 | @code-documenter | This file |
| 65 | `docs/adrs/0012-polars-not-pyspark.md` | Create | Extracted from Decision 12 | @code-documenter | This file |

### `tests/` — Cross-language fixtures (3 files)

| # | File | Action | Purpose | Agent | Dependencies |
|---|------|--------|---------|-------|--------------|
| 66 | `tests/fixtures/kpi_hand/petr4_2023.json` | Create | Hand-computed KPIs for PETR4 2023 | @test-generator | None |
| 67 | `tests/fixtures/kpi_hand/vale3_2023.json` | Create | Hand-computed KPIs for VALE3 2023 | @test-generator | None |
| 68 | `tests/fixtures/kpi_hand/itub4_2023.json` | Create | Hand-computed KPIs for ITUB4 2023 | @test-generator | None |

### `.github/workflows/` — CI (3 files)

| # | File | Action | Purpose | Agent | Dependencies |
|---|------|--------|---------|-------|--------------|
| 69 | `.github/workflows/refresh-pipelines.yml` | Create | Daily cron → Databricks bundle run → copy artifacts → validate → force-push gh-pages | @ci-cd-specialist | 13 |
| 70 | `.github/workflows/deploy-pages.yml` | Create | On `main`: build `app/` static export, merge with `/data/`, force-push gh-pages | @ci-cd-specialist | 38 |
| 71 | `.github/workflows/ci.yml` | Create | PR: run pytest (yfr_py), vitest (app), schema validation, ruff, type-check | @ci-cd-specialist | All |

### Root (4 files; some already exist)

| # | File | Action | Purpose | Agent | Dependencies |
|---|------|--------|---------|-------|--------------|
| 72 | `README.md` | Modify | Mirante-style front page with badges + quick start | @code-documenter | All |
| 73 | `LICENSE` | Create | MIT | (generalist) | None |
| 74 | `.gitignore` | (exists) | Already covers Python, Node, .env, Databricks | — | — |
| 75 | `pyproject.toml` (root) | Create | uv workspace root pointing to `yfr_py/` | @python-developer | 2 |

**Total Files: 75 (74 create + 1 modify; 3 existing left untouched: `.env`, `.env.example`, `.gitignore`)**

---

## Agent Assignment Rationale

> Agents discovered from `${CLAUDE_PLUGIN_ROOT}/agents/` — Build phase invokes matched specialists.

| Agent | Files Assigned | Why This Agent |
|-------|----------------|----------------|
| `@python-developer` | 1-10, 12, 36, 75 | Pure-Python package authoring; types, dataclasses, async/sync HTTP, deterministic caching |
| `@test-generator` | 11, 12, 66-68 | Pytest fixtures + golden-file parity tests; hand-computed KPI fixtures |
| `@pipeline-architect` | 13 | Asset Bundle topology + task DAG; Mirante's pattern is the template |
| `@lakeflow-pipeline-builder` | 14-18, 20, 27, 28, 35 | Notebook authoring against Delta + UC Volumes; ingest + bronze + silver + export |
| `@schema-designer` | 19 | SCD2 surrogate-key + temporal-join semantics on b3_ticker_dim |
| `@spark-engineer` | 21-26 | Heavy numeric / matrix work; covariance, KPI math, returns; polars-first per Decision 12 |
| `@data-quality-analyst` | 29 | DQ asserts: PK nulls, PSD covariance, row-count deltas |
| `@data-contracts-engineer` | 30-34 | JSON Schemas as the publisher↔consumer contract |
| `@code-documenter` | 35, 57-65, 72 | ARCHITECTURE.md, METHODOLOGY.md, FINOPS.md, 6 ADRs, README |
| `@ci-cd-specialist` | 69-71 | GH Actions workflows + secrets handling |
| _generalist_ | 37-54, 73 | Next.js / TypeScript / Recharts work — no Next.js specialist exists in AgentSpec; lambda-builder / supabase-specialist are wrong-fit |

**Agent Discovery:**
- Scanned: `${CLAUDE_PLUGIN_ROOT}/agents/**/*.md`
- Matched by file type (`.py` for python-developer, `.yml` notebooks for lakeflow-pipeline-builder), purpose keywords (covariance/returns → spark-engineer, SCD2 → schema-designer), KB domains (medallion, spark, python, testing, modern-stack)
- No-match: Next.js / TypeScript / Recharts work has no specialist — generalist handles it

---

## Code Patterns

### Pattern 1: `yfr_py.yf_get` signature (R-style fidelity)

```python
# yfr_py/yf_get.py

from __future__ import annotations
import datetime as _dt
from typing import Iterable, Literal, Sequence
import pandas as pd

from ._http import _HttpBackend, _YFinanceBackend
from ._cache import _Cache
from ._chunker import _batch_fetch

Frequency = Literal["daily", "weekly", "monthly", "yearly"]
ReturnType = Literal["arit", "log"]
AggregationMode = Literal["first", "last"]


def yf_get(
    tickers: str | Sequence[str],
    first_date: _dt.date | str | None = None,
    last_date: _dt.date | str | None = None,
    *,
    thresh_bad_data: float = 0.75,
    bench_ticker: str = "^BVSP",          # ← B3-friendly default (yfR uses ^GSPC)
    type_return: ReturnType = "arit",
    freq_data: Frequency = "daily",
    how_to_aggregate: AggregationMode = "last",
    do_complete_data: bool = False,
    do_cache: bool = True,
    cache_folder: str | None = None,
    do_parallel: bool = False,
    be_quiet: bool = False,
    backend: _HttpBackend | str = "yfinance",
) -> pd.DataFrame:
    """Download financial data from Yahoo Finance — Python port of yfR::yf_get.

    Returns a long-format DataFrame with columns matching yfR's contract:
    ticker, ref_date, price_open, price_high, price_low, price_close,
    volume, price_adjusted, ret_adjusted_prices, ret_closing_prices,
    cumret_adjusted_prices.
    """
    ...

# Pythonic alias for ergonomics; identical behavior
get_market_data = yf_get
```

### Pattern 2: `_HttpBackend` protocol

```python
# yfr_py/_http.py

from __future__ import annotations
import datetime as _dt
from typing import Protocol, runtime_checkable
import pandas as pd


@runtime_checkable
class _HttpBackend(Protocol):
    name: str
    def fetch_ohlcv(
        self,
        ticker: str,
        first_date: _dt.date,
        last_date: _dt.date,
        freq: str,
    ) -> pd.DataFrame: ...


class _YFinanceBackend:
    name = "yfinance"
    def fetch_ohlcv(self, ticker, first_date, last_date, freq):
        import yfinance as yf
        interval = {"daily": "1d", "weekly": "1wk", "monthly": "1mo"}.get(freq, "1d")
        df = yf.Ticker(ticker).history(
            start=first_date.isoformat(),
            end=(last_date + _dt.timedelta(days=1)).isoformat(),
            interval=interval,
            auto_adjust=False,
        )
        # normalize to yfR-shaped columns ...
        return df


class _BrapiBackend:
    name = "brapi"
    def fetch_ohlcv(self, ticker, first_date, last_date, freq):
        # ticker is .SA-suffixed for yfinance; strip for Brapi
        # ... call api.brapi.dev with the bare symbol
        ...
```

### Pattern 3: Content-addressed Parquet cache

```python
# yfr_py/_cache.py

from __future__ import annotations
import hashlib, os, tempfile
from pathlib import Path
import pandas as pd

_DEFAULT_FOLDER = Path.home() / ".cache" / "yfr_py"


def _key(ticker: str, first_date, last_date, freq, type_return) -> str:
    raw = f"{ticker}|{first_date}|{last_date}|{freq}|{type_return}"
    return hashlib.sha1(raw.encode()).hexdigest()


class _Cache:
    def __init__(self, folder: str | os.PathLike | None = None):
        self.folder = Path(folder) if folder else _DEFAULT_FOLDER
        self.folder.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.folder / f"{key}.parquet"

    def get(self, key: str) -> pd.DataFrame | None:
        p = self._path(key)
        return pd.read_parquet(p) if p.exists() else None

    def put(self, key: str, df: pd.DataFrame) -> None:
        # atomic: write to .tmp, then rename
        p = self._path(key)
        with tempfile.NamedTemporaryFile(
            "wb", dir=self.folder, delete=False, suffix=".tmp"
        ) as fh:
            tmp = Path(fh.name)
        df.to_parquet(tmp)
        os.replace(tmp, p)
```

### Pattern 4: Silver SCD2 ticker dim (polars)

```python
# pipelines/notebooks/silver/b3_ticker_dim.py

import polars as pl
from deltalake import DeltaTable
import hashlib

dbutils = ...  # Databricks-injected
catalog = dbutils.widgets.get("catalog")  # finance_prd

universe = pl.read_delta(f"/Volumes/{catalog}/bronze/b3_universe").select(
    "ticker", "company_name", "sector_b3", "subsector_b3",
    "listed_from", "listed_to", "prior_tickers", "ingested_at",
)

def _canonical_root(ticker: str, priors: list[str]) -> str:
    chain = list(priors) + [ticker]
    return chain[0]  # oldest = root

universe = universe.with_columns([
    pl.struct(["ticker", "prior_tickers"])
      .map_elements(lambda r: _canonical_root(r["ticker"], r["prior_tickers"] or []))
      .alias("canonical_root"),
])

universe = universe.with_columns(
    pl.col("canonical_root")
      .map_elements(lambda s: hashlib.sha1(f"b3:{s}".encode()).hexdigest())
      .alias("ticker_key")
)

# Emit one SCD2 row per (ticker, valid_from, valid_to)
scd2 = universe.select(
    "ticker_key", "ticker", "company_name", "sector_b3", "subsector_b3",
    pl.col("listed_from").alias("valid_from"),
    pl.col("listed_to").alias("valid_to"),
    pl.col("listed_to").is_null().alias("is_current"),
)

scd2.write_delta(
    f"/Volumes/{catalog}/silver/b3_ticker_dim",
    mode="overwrite",
    overwrite_schema=True,
)
```

### Pattern 5: Gold covariance computation with `valid_tickers`

```python
# pipelines/notebooks/gold/cov_matrix.py

import polars as pl
import numpy as np
from deltalake import write_deltalake

catalog = dbutils.widgets.get("catalog")
window_label = dbutils.widgets.get("window")  # "1y" | "5y" | "full"
window_days = {"1y": 252, "5y": 1260, "full": None}[window_label]

returns = pl.read_delta(f"/Volumes/{catalog}/gold/returns_wide")
if window_days:
    returns = returns.tail(window_days)

# tickers with full coverage in the window
ticker_cols = [c for c in returns.columns if c != "trading_date"]
valid = [c for c in ticker_cols if returns[c].null_count() == 0]

X = returns.select(valid).to_numpy()
# annualized covariance — daily returns × 252
cov = np.cov(X.T, ddof=1) * 252
# symmetrize for floating-point safety
cov = 0.5 * (cov + cov.T)

assert np.linalg.eigvalsh(cov).min() >= -1e-10, "Covariance not PSD"

long = []
for i, ti in enumerate(valid):
    for j, tj in enumerate(valid):
        long.append({
            "ticker_i": ti, "ticker_j": tj,
            "cov": float(cov[i, j]),
            "window_label": window_label,
            "valid_through": str(returns["trading_date"].max()),
        })

pl.DataFrame(long).write_delta(
    f"/Volumes/{catalog}/gold/cov_matrix_{window_label}",
    mode="overwrite",
)

import json
with open(f"/Volumes/{catalog}/gold/artifacts/valid_tickers_{window_label}.json", "w") as f:
    json.dump({"window": window_label, "valid_tickers": valid}, f)
```

### Pattern 6: JSON Schema contract (kpis_per_ticker)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://applied-finance.example/contracts/kpis_per_ticker.schema.json",
  "title": "KPIs per ticker",
  "type": "object",
  "required": ["as_of", "source_run_id", "tickers"],
  "properties": {
    "as_of":           { "type": "string", "format": "date" },
    "source_run_id":   { "type": "string" },
    "tickers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["ticker", "return_ytd", "vol_annual", "max_drawdown", "sharpe_vs_cdi"],
        "properties": {
          "ticker":         { "type": "string", "pattern": "^[A-Z0-9]+\\.SA$" },
          "return_ytd":     { "type": "number" },
          "vol_annual":     { "type": "number", "minimum": 0 },
          "max_drawdown":   { "type": "number", "maximum": 0 },
          "sharpe_vs_cdi":  { "type": "number" }
        }
      }
    }
  }
}
```

### Pattern 7: Frontend KPI mirror (TS)

```ts
// app/lib/kpi.ts
export function returnYtd(priceSeries: number[]): number {
  if (priceSeries.length < 2) return NaN;
  const first = priceSeries[0];
  const last = priceSeries[priceSeries.length - 1];
  return Math.log(last / first);
}

export function annualizedVolatility(dailyReturns: number[]): number {
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

export function maxDrawdown(priceSeries: number[]): number {
  let peak = -Infinity, worst = 0;
  for (const p of priceSeries) {
    peak = Math.max(peak, p);
    worst = Math.min(worst, (p - peak) / peak);
  }
  return worst;
}

export function sharpeVsCdi(meanReturn: number, vol: number, cdiAnnual: number): number {
  return (meanReturn - cdiAnnual) / vol;
}
```

### Pattern 8: Next.js `next.config.mjs` for GH Pages static export

```js
// app/next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: process.env.GH_PAGES_BASE ?? '',
  assetPrefix: process.env.GH_PAGES_BASE ?? '',
  images: { unoptimized: true },  // GH Pages doesn't run the image optimizer
  experimental: { typedRoutes: true },
};
export default nextConfig;
```

### Pattern 9: Asset Bundle (`pipelines/databricks.yml` skeleton)

```yaml
bundle:
  name: mercado-br

variables:
  catalog:
    description: "Unity Catalog catalog name"
    default: finance_prd

targets:
  dev:
    default: true
    workspace:
      host: https://dbc-cafe0a5f-07e3.cloud.databricks.com
    presets: { tags: { env: dev } }
  prod:
    mode: production
    workspace:
      host: https://dbc-cafe0a5f-07e3.cloud.databricks.com
    run_as: { user_name: ${workspace.current_user.userName} }

resources:
  jobs:
    job_mercado_br_daily_refresh:
      name: refresh mercado_br
      tags:
        team: applied-finance
        domain: equities-b3
        layer: orchestration
        pattern: medallion
        cadence: daily
        pii: "false"
        source: yahoo_finance
      max_concurrent_runs: 1
      tasks:
        - task_key: ingest_yf_ohlcv
          notebook_task:
            notebook_path: ./notebooks/ingest/yf_ohlcv.py
            base_parameters:
              catalog: "${var.catalog}"
              volume_dir: "/Volumes/${var.catalog}/bronze/raw/yf"

        - task_key: bronze_b3_universe
          notebook_task:
            notebook_path: ./notebooks/bronze/b3_universe.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: bronze_b3_index_members
          notebook_task:
            notebook_path: ./notebooks/bronze/b3_index_members.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: bronze_b3_ohlcv_raw
          depends_on: [{ task_key: ingest_yf_ohlcv }]
          notebook_task:
            notebook_path: ./notebooks/bronze/b3_ohlcv_raw.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: silver_b3_ticker_dim
          depends_on: [{ task_key: bronze_b3_universe }]
          notebook_task:
            notebook_path: ./notebooks/silver/b3_ticker_dim.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: silver_b3_index_members_long
          depends_on: [{ task_key: bronze_b3_index_members }]
          notebook_task:
            notebook_path: ./notebooks/silver/b3_index_members_long.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: silver_b3_ohlcv_adjusted
          depends_on: [{ task_key: bronze_b3_ohlcv_raw }]
          notebook_task:
            notebook_path: ./notebooks/silver/b3_ohlcv_adjusted.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: gold_returns_wide
          depends_on: [{ task_key: silver_b3_ohlcv_adjusted }]
          notebook_task:
            notebook_path: ./notebooks/gold/returns_wide.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: gold_cov_matrix_1y
          depends_on: [{ task_key: gold_returns_wide }]
          notebook_task:
            notebook_path: ./notebooks/gold/cov_matrix.py
            base_parameters: { catalog: "${var.catalog}", window: "1y" }

        - task_key: gold_cov_matrix_5y
          depends_on: [{ task_key: gold_returns_wide }]
          notebook_task:
            notebook_path: ./notebooks/gold/cov_matrix.py
            base_parameters: { catalog: "${var.catalog}", window: "5y" }

        - task_key: gold_cov_matrix_full
          depends_on: [{ task_key: gold_returns_wide }]
          notebook_task:
            notebook_path: ./notebooks/gold/cov_matrix.py
            base_parameters: { catalog: "${var.catalog}", window: "full" }

        - task_key: gold_kpis_per_ticker
          depends_on: [{ task_key: silver_b3_ohlcv_adjusted }, { task_key: silver_b3_ticker_dim }]
          notebook_task:
            notebook_path: ./notebooks/gold/kpis_per_ticker.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: gold_sector_aggregates
          depends_on: [{ task_key: silver_b3_ohlcv_adjusted }, { task_key: silver_b3_ticker_dim }]
          notebook_task:
            notebook_path: ./notebooks/gold/sector_aggregates.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: gold_correlation_heatmap
          depends_on: [{ task_key: gold_returns_wide }]
          notebook_task:
            notebook_path: ./notebooks/gold/correlation_heatmap.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: gold_ibov_overview
          depends_on: [{ task_key: silver_b3_ohlcv_adjusted }, { task_key: silver_b3_index_members_long }]
          notebook_task:
            notebook_path: ./notebooks/gold/ibov_overview.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: quality_contracts_assert
          depends_on:
            - { task_key: gold_kpis_per_ticker }
            - { task_key: gold_sector_aggregates }
            - { task_key: gold_correlation_heatmap }
            - { task_key: gold_ibov_overview }
            - { task_key: gold_cov_matrix_1y }
            - { task_key: gold_cov_matrix_5y }
            - { task_key: gold_cov_matrix_full }
          notebook_task:
            notebook_path: ./notebooks/quality/contracts_assert.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: export_json_artifacts
          depends_on: [{ task_key: quality_contracts_assert }]
          notebook_task:
            notebook_path: ./notebooks/export/json_artifacts.py
            base_parameters: { catalog: "${var.catalog}" }

        - task_key: export_parquet_artifacts
          depends_on: [{ task_key: quality_contracts_assert }]
          notebook_task:
            notebook_path: ./notebooks/export/parquet_artifacts.py
            base_parameters: { catalog: "${var.catalog}" }
```

---

## Data Flow

```text
1. GH Actions cron fires (0 1 * * 2-6 UTC, ~22:00 BRT)
   │
   ▼
2. `databricks bundle run --target prod job_mercado_br_daily_refresh`
   │
   ▼
3. Ingest task: yfr_py.yf_get over full universe → Parquet to UC Volume
   │
   ▼
4. Bronze MERGE INTO bronze.b3_ohlcv_raw (idempotent on (ticker, trading_date))
   │
   ▼
5. Silver tasks: ticker_dim (SCD2), ohlcv_adjusted (splits+divs), index_members_long
   │
   ▼
6. Gold tasks: returns_wide, kpis, sector_aggregates, correlation_heatmap, ibov_overview, cov_1y/5y/full
   │
   ▼
7. Quality task: PK nulls, row-count deltas, PSD covariance, schema asserts
   │
   ▼
8. Export tasks: write JSON + Parquet to /Volumes/finance_prd/gold/artifacts/
   │
   ▼
9. GH Actions copies artifacts via `databricks fs cp -r`
   │
   ▼
10. jsonschema CLI validates every published JSON against pipelines/contracts/*.schema.json
   │
   ▼
11. Build app/ static export (`pnpm build` → `out/`)
   │
   ▼
12. Merge `out/` + `_artifacts/` into a fresh orphan branch → force-push to gh-pages
   │
   ▼
13. GH Pages serves the new state within ~30s
   │
   ▼
14. Browser fetches /data/*.json + /data/*.parquet on demand
```

---

## Integration Points

| External System | Integration Type | Authentication |
|-----------------|-----------------|----------------|
| Yahoo Finance | HTTPS via `yfinance` library (unofficial endpoints) | None (rate-limited by IP) |
| Brapi.dev (fallback) | HTTPS via `httpx` | Optional API key (`BRAPI_TOKEN` env), free tier works without |
| Databricks Workspace | REST API + Asset Bundles CLI | `DATABRICKS_HOST` + `DATABRICKS_TOKEN` (in `.env`, in GH Actions secrets as `DATABRICKS_TOKEN`) |
| Unity Catalog | SQL / REST via Databricks SDK | Token (above); catalog `finance_prd` already exists, owned by `leonardochalhoub@gmail.com` |
| GitHub | git push + GH Pages | `GITHUB_TOKEN` (auto-provisioned in Actions) |
| GitHub Pages | HTTPS publish via orphan-branch force-push | none for read; push uses `GITHUB_TOKEN` |

---

## Testing Strategy

| Test Type | Scope | Files | Tools | Coverage Goal |
|-----------|-------|-------|-------|---------------|
| Unit (Python) | yfr_py functions, cache, chunker, KPI math | `yfr_py/tests/test_*.py` | `pytest`, `pytest-cov`, `responses` (mock HTTP) | ≥ 90% lines, 100% branches in cache/chunker |
| Parity (Python) | yfr_py ↔ yfR golden files | `yfr_py/tests/test_parity.py` | `pytest` + Parquet fixtures captured from R | 10 tickers × 2 freqs × 2 windows |
| Unit (TS) | `lib/kpi.ts`, `lib/format.ts`, `lib/data.ts` parsing | `app/**/*.test.ts` | `vitest` | ≥ 90% lines on `lib/` |
| Cross-language | KPI math: Python output JSON matches TS implementation byte-for-byte (within tolerance) | `tests/fixtures/kpi_hand/*.json` consumed by both `yfr_py/tests/test_kpi.py` and `app/lib/kpi.test.ts` | `pytest` + `vitest` | 3 reference tickers (PETR4, VALE3, ITUB4) |
| Contract | JSON Schema validation of every Gold artifact | `pipelines/contracts/*.schema.json` | `jsonschema` (Python CLI) in GH Actions | 100% of artifacts |
| Notebook smoke (Databricks) | Each notebook can run end-to-end on a tiny synthetic fixture catalog | `pipelines/tests/notebook_smoke.py` | databricks-connect or bundle local | All notebooks |
| E2E (browser) | Home + ticker detail + correlation page render with current artifacts | `app/tests/e2e/*.spec.ts` | Playwright | Happy path + 1 mobile viewport |
| Lighthouse | Performance + Accessibility ≥ 90 on deployed pages | `.github/workflows/lighthouse.yml` (later) | Lighthouse CI | Home, ticker detail, sectors |

---

## Error Handling

| Error Type | Handling Strategy | Retry? |
|------------|-------------------|--------|
| Yahoo HTTP 429 / 5xx in ingest task | Exponential backoff in `_HttpBackend`; after 3 retries, log+skip the ticker (don't fail whole task); aggregate skipped list at end and fail if > 5% of universe missing | Yes (3 attempts, 1s/2s/4s) |
| Yahoo returns empty DataFrame for a known-active ticker | Treat as transient; record in `bronze.b3_ohlcv_raw_ingest_log` for ops review; do NOT fail | No (next-day refresh covers it) |
| Bronze MERGE conflict | Should never happen with idempotent MERGE; if it does, fail loudly — investigate | No |
| Silver join finds an OHLCV row with no matching ticker in `b3_ticker_dim` | Fail task with explicit error: "ticker X observed but not in universe; add to `data/ticker_universe.csv`" | No |
| Covariance not PSD (eigenvalue < -1e-10 after symmetrization) | Fail task; surface the problematic window | No |
| Schema validation fails on published JSON | Fail GH Actions step; don't push to gh-pages; alert via workflow failure email | No |
| Force-push to gh-pages fails | Fail workflow; alert; previous state remains live | No (manual investigation) |
| Frontend `fetch('/data/*.json')` returns 404 | Show pt-BR error banner with last-known-good timestamp; degrade gracefully (no chart, no crash) | No (UX retry button) |
| Cache corruption (Parquet read fails) | Catch, delete corrupted file, refetch | Yes |

---

## Configuration

| Config Key | Type | Default | Description |
|------------|------|---------|-------------|
| `DATABRICKS_HOST` | string | (env) | Databricks workspace URL — set in `.env` (dev) and GH Actions secret (CI) |
| `DATABRICKS_TOKEN` | string | (env) | Personal Access Token — never committed |
| `DATABRICKS_CATALOG` | string | `finance_prd` | Unity Catalog catalog name; passed as `${var.catalog}` to all notebooks |
| `YFR_PY_CACHE_FOLDER` | string | `~/.cache/yfr_py` | Local cache dir for the package; can be overridden per-call |
| `YFR_PY_BACKEND` | string | `yfinance` | Default HTTP backend; `brapi` for fallback |
| `BRAPI_TOKEN` | string | _empty_ | Optional, only when `YFR_PY_BACKEND=brapi` |
| `GH_PAGES_BASE` | string | _empty_ | Next.js `basePath`; set to repo name when deployed under user.github.io/repo |
| `MERCADO_BR_AS_OF` | string (date) | _empty_ | Override "as_of" date for golden-file test runs (replay against a known snapshot) |
| `MERCADO_BR_THRESH_BAD_DATA` | float | `0.75` | Mirrors yfR's `thresh_bad_data` for the ingest task |

---

## Security Considerations

- `.env` is gitignored; `.env.example` is the only template committed.
- Databricks PAT is short-lived best-effort — rotate quarterly + after any chat-transcript exposure.
- GH Actions secrets are scoped to the repo + Actions only (not Codespaces).
- No PII in any layer — all data is public market data + curated metadata.
- `yfinance` is a third-party library; pinned to a specific version; reviewed for dependency footprint.
- All published artifacts on GH Pages are world-readable by design — confirmed no internal data leaks possible.
- JSON Schema validation defends against malformed-artifact pollution: a corrupted artifact never reaches the frontend.
- CSP headers via `<meta http-equiv>` in `app/layout.tsx`: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`.

---

## Observability

| Aspect | Implementation |
|--------|----------------|
| Logging | Notebooks use stdlib `logging` with JSON formatter; Databricks captures stdout into job run logs |
| Metrics | Per-task row counts, ingest duration, % skipped tickers written to `gold.observability_run_metrics` (Delta table); displayed on a `/finops` page later |
| Tracing | Every Gold artifact includes `source_run_id` (GitHub Actions run id) and `bronze_max_trading_date` for ex-post lineage |
| Alerting | GH Actions workflow failure → email (default Actions behavior); no PagerDuty / Slack in v1 |
| FinOps | Daily Databricks DBU usage scraped from Databricks billing API (where available) into `gold.observability_run_costs`; rendered as a badge value in README |
| Frontend errors | Vanilla `window.onerror` posts a single one-line beacon to a hard-coded telemetry path in `gh-pages/_telemetry/` (which is just a 404, but the GH access log captures the URL); zero-cost crash visibility |

---

## Pipeline Architecture

### DAG Diagram

```text
                       ┌─────────────────────┐
                       │ ingest_yf_ohlcv     │
                       └──────────┬──────────┘
                                  │
              ┌───────────────────┼────────────────────────────┐
              │                   │                            │
              ▼                   ▼                            ▼
┌──────────────────────┐ ┌────────────────────┐ ┌─────────────────────────┐
│ bronze_b3_universe   │ │ bronze_b3_ohlcv_   │ │ bronze_b3_index_members │
│ (from data/csv)      │ │ raw (MERGE)        │ │ (from data/csv)         │
└──────────┬───────────┘ └──────────┬─────────┘ └──────────┬──────────────┘
           │                        │                      │
           ▼                        ▼                      ▼
┌──────────────────────┐ ┌────────────────────┐ ┌─────────────────────────┐
│ silver_b3_ticker_dim │ │ silver_b3_ohlcv_   │ │ silver_b3_index_        │
│ (SCD2)               │ │ adjusted           │ │ members_long            │
└──────────┬───────────┘ └──────────┬─────────┘ └──────────┬──────────────┘
           │                        │                      │
           └────────────┬───────────┴───────┬──────────────┘
                        │                   │
                        ▼                   ▼
       ┌────────────────────┐    ┌────────────────────┐
       │ gold_returns_wide  │    │ gold_kpis_per_     │
       │                    │    │ ticker             │
       └────────┬───────────┘    └──────────┬─────────┘
                │                           │
       ┌────────┼───────────┐               │
       ▼        ▼           ▼               │
   cov_1y   cov_5y      cov_full            │
       │        │           │               │
       └────┬───┴────┬──────┘               │
            │        │                      │
            ▼        ▼                      ▼
    correlation_  sector_     gold_ibov_overview
    heatmap       aggregates
       │             │              │
       └─────────────┼──────────────┘
                     ▼
         quality_contracts_assert
                     │
              ┌──────┴───────────┐
              ▼                  ▼
       export_json_       export_parquet_
       artifacts           artifacts
```

### Partition Strategy

| Table | Partition Key | Granularity | Rationale |
|-------|---------------|-------------|-----------|
| `bronze.b3_ohlcv_raw` | `year(trading_date)` | yearly | Even row distribution (250 trading days × ~400 tickers ≈ 100k rows/year), low partition count (26 partitions) |
| `silver.b3_ohlcv_adjusted` | `year(trading_date)` | yearly | Same as bronze; downstream queries usually slice by date range |
| `silver.b3_ticker_dim` | _none_ | n/a | ~500 rows total; partitioning adds cost without benefit |
| `silver.b3_index_members_long` | _none_ | n/a | small |
| `gold.returns_wide` | _none_ | n/a | Wide table, one row per trading day (~6500 rows total); single file |
| `gold.cov_matrix_*` | `window_label` (already implicit) | per window | 3 separate tables; no further partitioning needed |
| `gold.kpis_per_ticker` | _none_ | n/a | ~500 rows; full overwrite each refresh |
| `gold.sector_aggregates` | _none_ | n/a | ~20 sectors × few rows |

Z-order: `bronze.b3_ohlcv_raw` z-orders on `ticker` after each refresh (auto-optimize on).

### Incremental Strategy

| Model | Strategy | Key Column | Lookback |
|-------|----------|------------|----------|
| `bronze.b3_ohlcv_raw` | `MERGE INTO ... ON (ticker, trading_date)` | composite | 5 trading days (refresh window) |
| `silver.b3_ohlcv_adjusted` | full overwrite | n/a | 26y (cheap given polars + small data) |
| `silver.b3_ticker_dim` | full overwrite (SCD2 rebuild from CSV) | n/a | n/a |
| `gold.*` | full overwrite | n/a | n/a |
| Published JSON / Parquet artifacts | full overwrite + orphan force-push | n/a | n/a |

### Schema Evolution Plan

| Change Type | Handling | Rollback |
|-------------|----------|----------|
| New column in Bronze | Add column with default + auto-merge on next MERGE; downstream silver picks it up explicitly | Drop column |
| Type widen (DOUBLE → DECIMAL) | Dual-write to a parallel column for one refresh cycle, then cutover; ADR required | Revert to DOUBLE; cutover-cycle artifact is replay-able |
| Remove a column from published JSON contract | Deprecate in `pipelines/contracts/*.schema.json` (mark `deprecated: true`), keep emitting for 1 refresh cycle, then remove | Re-add to schema + emit |
| Add a new artifact | New schema file in contracts; new export task; bump README "artifact count" badge | Drop the new artifact + remove schema |
| Bump schema version | Schema file `$id` versioned; frontend reads version + warns if mismatch | Pin frontend to old version while artifact regenerates |

### Data Quality Gates

| Gate | Tool | Threshold | Action on Failure |
|------|------|-----------|-------------------|
| No null PKs in any layer | Python assert in `quality_contracts_assert.py` | 0 nulls on `(ticker, trading_date)` and on `ticker_key` | Fail task; block export |
| Bronze row count delta vs T-1 | Python assert | within ±10% of yesterday's count (allowing for new tickers + holidays) | Alert + continue (one bad day) / fail (two bad days in a row) |
| Covariance PSD check | numpy eigenvalue | min eigenvalue ≥ -1e-10 | Fail task; surface window |
| JSON schema conformance | `jsonschema` CLI | 100% records pass | Fail GH Actions step before force-push |
| Active-ticker presence | Python set-diff | every `ticker_universe` row with `listed_to IS NULL` appears in latest Bronze | Alert + continue (mark missing tickers in artifact metadata) |
| Source freshness | Python assert on `max(bronze.trading_date)` | last B3 trading day or T-1 (allow for late refreshes) | Fail if > 2 trading days stale |
| Returns sanity | Python assert | no daily return > +50% / < -50% (corporate-event artifact) | Surface; route to manual review queue |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-05-21 | design-agent | Initial version from DEFINE_MERCADO_BR.md |

---

## Next Step

**Ready for:** `/agentspec:build .claude/sdd/features/DESIGN_MERCADO_BR.md`

**Suggested Build sequence (preview):**

1. **`yfr_py` package first** (#1-12) — independently testable; unlocks ingest notebook.
2. **`data/ticker_universe.csv` seed** (#55) — one-off scrape + manual review; gates Silver.
3. **Asset Bundle skeleton + notebooks scaffolding** (#13-29) — empty notebooks with widgets, deploy to dev to validate auth + catalog access.
4. **JSON Schemas** (#30-34) — written upfront; lock the publisher↔consumer contract.
5. **Notebook implementations** (#14-29) — Bronze → Silver → Gold, top-down, with a smoke test after each layer.
6. **Quality + export** (#27-29) — only after Gold is producing real data.
7. **GH Actions workflows** (#69-71) — wire CI + daily refresh.
8. **Frontend** (#37-54) — last, against real published artifacts.
9. **Docs + README** (#57-65, #72) — written alongside, finalized after first successful deploy.
10. **Manual smoke** — visit the deployed Pages URL, verify all KPI cards render, verify Lighthouse ≥ 90.
