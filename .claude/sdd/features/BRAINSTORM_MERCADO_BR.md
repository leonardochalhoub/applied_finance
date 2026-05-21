# BRAINSTORM: Mercado BR — Plataforma de Análise do Mercado Acionário Brasileiro

> Phase 0 exploration for an open lakehouse + static dashboard combining the data discipline of `mirante-dos-dados-br` with the interactive UX of `caixa-forte-app`, applied to the full Brazilian equities universe.

## Metadata

| Attribute | Value |
|-----------|-------|
| **Feature** | MERCADO_BR |
| **Date** | 2026-05-21 |
| **Author** | brainstorm-agent (via Claude Code / agentspec) |
| **Status** | Ready for Define |

---

## Initial Idea

**Raw Input (from user):**

> Build a Brazilian stock market analytics platform that combines the data discipline of `mirante-dos-dados-br` with the interactive UX of `caixa-forte-app`. Databricks Free Edition does heavy compute (medallion Delta tables, returns matrices, covariance, Markowitz inputs); a fully static Next.js 16 + Recharts + Tailwind v4 frontend on GitHub Pages consumes versioned JSON / Parquet artifacts. No database, no backend server, no auth — every interaction runs in the browser against precomputed artifacts. Phase 1 is a public market dashboard; Phase 2 (architecture-only for now) adds CVM fundamentals, BCB macro, and a client-side Markowitz portfolio builder.

**Project Context Gathered:**

- `~/applied_finance` is an empty scaffold (single-line README, fresh `.claude/agents/`). Greenfield build.
- User has shipped two production references locally:
  - **`~/mirante-dos-dados-br`** — Databricks Asset Bundles + Delta medallion + GH Actions + React/Vite + GH Pages + LaTeX working papers. FinOps-tracked. Lifetime cost US$ 70 / 322 days. This is the *data engineering* template.
  - **`~/caixa-forte-app`** — Next.js 16 + React 19 + Tailwind v4 + Recharts + Vercel (currently with Supabase, but **not** used here). This is the *frontend* template.
- User has a Finance Master's (10 yrs since completion, refreshing intuition) — domain literate, not a working quant.
- Databricks Free Edition is in scope; tokens available if needed.

**Technical Context Observed (for Define):**

| Aspect | Observation | Implication |
|--------|-------------|-------------|
| Likely Location | Monorepo under `~/applied_finance/`: `pipelines/` (Databricks bundle + notebooks), `yfr_py/` (the package), `app/` (Next.js static export), `data/` (ticker universe + reference CSVs) | Mirror Mirante's layout, swap Vite→Next |
| Relevant KB Domains | `medallion`, `lakeflow`, `spark`, `dbt` (light), `cloud-platforms`, `terraform` (light), `ai-data-engineering` (Phase 2 macro/fund.), `python`, `testing` | Multi-domain — pure DE + pure FE |
| IaC Patterns | Databricks Asset Bundles + GH Actions workflows (`refresh-pipelines.yml`, `deploy-pages.yml`) — copy Mirante's bundle pattern verbatim | One bundle, one repo, two workflows |

---

## Discovery Questions & Answers

| # | Question | Answer | Impact |
|---|----------|--------|--------|
| 1 | Ticker universe for Phase 1 — how broad? | **All B3 (~400+ incl. illiquid)** | Maximum coverage; forces serious ticker-universe management (active + delisted + renames) and missing-data strategy in Gold |
| 2 | Historical depth for OHLCV ingestion? | **Max available (~since 2000)** | ~26y × ~400 tickers ≈ ~2.6M OHLCV rows (small absolute size, but corporate-action hygiene is non-trivial; many tickers IPO'd or delisted within the window) |
| 3 | Static hosting target? | **GitHub Pages only — like Mirante** | Mirror Mirante's `gh-pages` orphan-branch artifact pattern; no Vercel coupling; Next.js must use `output: 'export'` (static export, no SSR/ISR) |
| 4 | Grounding for the yfR → Python translation? | **yfR GitHub repo + docs only** | Port API ergonomics from msperlin/yfR source (12 R files, rOpenSci-reviewed, MIT); golden-file tests built by running yfR in a side R script during dev |

**Plus the platform-level decision already made before /brainstorm:** drop Supabase from Spec C — portfolios persist in localStorage + base64 URL state in Phase 2.

---

## Sample Data Inventory

> Samples improve LLM accuracy through in-context learning and few-shot prompting.

| Type | Location | Count | Notes |
|------|----------|-------|-------|
| Input files | `msperlin/yfR` GitHub repo (R source, DESCRIPTION, vignettes) | 12 R files + docs | API surface to mirror: `yf_get`, `yf_get_dividends`, `yf_get_index_components`, `yf_get_single_ticker`, `yf_live_price`, `yf_cache`, `yf_data_convert_to_wide`. Caching + parallel-fetch behavior is the part hardest to recover from `yfinance` alone. |
| Output examples | Generated during build via `Rscript` calls to yfR in CI (golden files committed to `tests/fixtures/`) | TBD | Authoritative parity check |
| Ground truth | yfR's own test suite (`testthat`) | ~ a few hundred assertions | Reuse as test names where possible |
| Related code | `~/mirante-dos-dados-br/pipelines/`, `~/mirante-dos-dados-br/databricks.yml`, `~/caixa-forte-app/app/`, `~/caixa-forte-app/components/` | 4 dirs | Mirante = bundle + medallion template; Caixa Forte = Recharts + monochrome design tokens template |

**How samples will be used:**

- yfR R source is the **functional spec** of the Python port. Read once, port deliberately.
- yfR CLI output captured to CSV is the **golden file** for `pytest` parity tests on a sample of ~10 tickers × 2 frequencies × 2 date ranges.
- Mirante's `databricks.yml` is the **infra template** — copy structure, change resource names.
- Caixa Forte's `components/` and Tailwind config are the **design system source** — lift tokens, not pages.

---

## Approaches Explored

### Approach A: Mirante-twin lakehouse + Next.js static export ⭐ Recommended

**Description:** Databricks Free runs the full medallion (Bronze raw OHLCV → Silver adjusted/joined → Gold materialized analytics) on a daily Asset-Bundle-driven job. Gold publishes JSON (small KPI snapshots, sector aggregates, ticker metadata) and Parquet (returns matrix, covariance matrices for multiple windows) to a `gh-pages` orphan branch via a second GH Actions workflow. The frontend is Next.js 16 with `output: 'export'`, Recharts, Tailwind v4, deployed to the same Pages site. All interactivity runs in the browser against fetched artifacts. Phase 2 plugs in `GetDFPData2` / `GetBCBData` Python ports as additional Bronze sources and adds a client-side QP solver (WASM, e.g. `osqp.js` or a small pure-JS implementation) reading the Parquet covariance matrix.

**Pros:**
- Pure twin of Mirante's architectural pattern — proven, FinOps-disciplined, free-tier-clean.
- Zero backend, zero database, zero auth → smallest possible attack surface and operational load.
- Static Parquet + JSON over CDN is fast enough for 400-ticker dashboards.
- Markowitz on the client is impressive demo and forces clean Gold contracts (the covariance matrix becomes a public artifact, not a hidden side effect).
- Reuses an existing CI / ADR / FinOps badge story the user has already built once.

**Cons:**
- Static export means no server actions; any future "search by free-text" or "live filter on 1 GB of data" requires precomputed indexes or a client-side DuckDB-WASM (acceptable).
- Client-side Markowitz means shipping the covariance matrix to every visitor (~6.4 MB JSON for 400×400 floats, less as Parquet+zstd) — fine for desktop, slightly heavy on mobile cold load.
- Ticker hygiene for the full B3 universe + max history is real work in Silver (delistings, renames, sub/super-shares). Not a tooling problem, a domain problem.

**Why Recommended:** It is the literal architectural synthesis the user asked for, and the constraints (free-tier, no DB, GH Pages, pt-BR, Mirante/Caixa-Forte parentage) all align with it. No competing approach is cheaper or simpler given the user's choices.

---

### Approach B: Same lakehouse, but ship interactivity through DuckDB-WASM instead of precomputed JSON

**Description:** Same Bronze/Silver/Gold on Databricks, but Gold materializes a single Parquet file per layer (tickers, daily_ohlcv_adjusted, returns_long, sector_membership). The frontend loads DuckDB-WASM in the browser and runs SQL directly against the Parquet artifacts. Filters, joins, sector rollups, and KPI computations all happen client-side via DuckDB rather than via 10+ precomputed JSON files.

**Pros:**
- One canonical artifact set; no JSON proliferation.
- Filter UX is much more flexible — any user-defined query is possible.
- Aligns with a modern "lakehouse-on-the-edge" pattern.

**Cons:**
- DuckDB-WASM cold-load is ~5 MB; adds ~1-2 s to first paint.
- Cognitive overhead — every chart now needs a SQL query string in TS, harder to type-check than reading a JSON shape.
- Diverges from Mirante's pattern (Mirante ships small JSON snapshots, not raw Parquet for in-browser query) — loses the "twin" framing.
- For a public marketing-grade dashboard, precomputed JSON gives faster first paint and cleaner Lighthouse scores.

**When to revisit:** If Phase 2's Markowitz UI grows complex enough that we want users to slice the data freely (e.g., "show me efficient frontier of all tickers with ROE > 15% and sector = Financials"), DuckDB-WASM becomes attractive. Defer the decision.

---

### Approach C: Skip Databricks; do everything in a single Python repo + GH Actions

**Description:** Drop the lakehouse entirely. A single Python repo (`yfr_py` package + a few scripts) runs on GH Actions daily, fetches OHLCV with the ported package, computes returns / covariance / KPIs in pandas / numpy / polars, writes JSON + Parquet directly to `gh-pages`, and Next.js consumes them.

**Pros:**
- Truly minimum infrastructure. Smallest free-tier surface (just GH Actions).
- Easiest local dev — no Databricks workspace needed to run the pipeline end-to-end.

**Cons:**
- Throws away the "data discipline of Mirante" half of the user's stated goal.
- Medallion gives genuine value here: Bronze immutability (raw Yahoo response shape) is precious when you need to debug a corporate-action issue 6 months later. GH Actions + pandas erases that record.
- Loses the lakehouse showcase that makes this project portfolio-worthy on the *data engineering* axis.
- Once Phase 2 fundamentals (`GetDFPData2`) and macro (`GetBCBData`) arrive, scope grows past "one Python script" and refactoring back into a lakehouse is more painful than starting there.

**Why not recommended:** User explicitly said "follow Mirante's steps". This violates that instruction.

---

## Data Engineering Context

### Source Systems

| Source | Type | Volume Estimate | Current Freshness |
|--------|------|-----------------|-------------------|
| Yahoo Finance (B3 `.SA`) via `yfr_py` | HTTPS / unofficial Yahoo endpoints | ~400 tickers × ~26y × ~250 trading days ≈ **~2.6 M OHLCV rows** | Daily after close (~22:00 BRT) |
| B3 listing / sector metadata | CSV (curated; hand-maintained `data/ticker_universe.csv` with active + delisted, plus sector map) | ~500 rows | Updated quarterly or on event |
| IBOV / IBrA / IBrX composition history | Scraped or static CSV | ~quarterly snapshots | Updated quarterly |
| **Phase 2:** CVM DFPs via `GetDFPData2`-Python | HTTPS to dados.cvm.gov.br | ~hundreds of MB / yr historical, then incremental | Quarterly |
| **Phase 2:** BCB SGS via `GetBCBData`-Python | HTTPS to api.bcb.gov.br/dados/serie | ~MB scale | Daily / monthly per series |

### Data Flow Sketch

```text
                    ┌─────────────────────────────────────────────┐
                    │  GitHub Actions (cron, after B3 close)      │
                    │  → triggers Databricks Job (Asset Bundle)   │
                    └────────────────┬────────────────────────────┘
                                     ▼
              ┌──────────────────────────────────────────┐
              │ BRONZE (Delta, append-only, raw)         │
              │  • bronze.b3_ohlcv_raw     (yfr_py dump) │
              │  • bronze.b3_universe      (CSV land)    │
              │  • bronze.b3_index_members (snapshot)    │
              └────────────────┬─────────────────────────┘
                               ▼
              ┌──────────────────────────────────────────┐
              │ SILVER (Delta, cleaned, conformed)       │
              │  • silver.b3_ohlcv_adjusted  (splits/div)│
              │  • silver.b3_ticker_dim      (SCD2)      │
              │  • silver.b3_index_members_long          │
              └────────────────┬─────────────────────────┘
                               ▼
              ┌──────────────────────────────────────────┐
              │ GOLD (Delta + published artifacts)       │
              │  • gold.returns_wide          → Parquet  │
              │  • gold.cov_matrix_{1y,5y,full} → Parquet│
              │  • gold.kpis_per_ticker       → JSON     │
              │  • gold.sector_aggregates     → JSON     │
              │  • gold.correlation_heatmap   → JSON     │
              │  • gold.ibov_overview         → JSON     │
              └────────────────┬─────────────────────────┘
                               ▼
              ┌──────────────────────────────────────────┐
              │ GH Pages (orphan branch: gh-pages)       │
              │  /data/  ← Parquet + JSON artifacts      │
              │  /app/   ← Next.js static export         │
              └────────────────┬─────────────────────────┘
                               ▼
                     ┌────────────────────┐
                     │ Browser (Next.js)  │
                     │  Recharts dashboards│
                     │  Phase 2: WASM QP   │
                     └────────────────────┘
```

### Key Data Questions Explored

| # | Question | Answer | Impact |
|---|----------|--------|--------|
| 1 | Expected data volume? | ~2.6 M OHLCV rows for full B3 × 26 y; ~50 KB JSON per dashboard view; ~6 MB Parquet per covariance matrix (400×400 float32) | Tiny by lakehouse standards — Databricks Free is *vastly* over-provisioned, which is fine; we earn the platform with Markowitz + fundamentals later |
| 2 | Freshness SLA? | Daily, after B3 close (~22:00 BRT). No intraday. | Single cron-triggered job, no streaming |
| 3 | Who consumes the output? | Public web visitors via static GH Pages dashboard (Phase 1); same visitors + their localStorage portfolios (Phase 2) | Public read, no auth, no rate-limit concerns past CDN limits |
| 4 | How are corporate actions handled across 26y? | yfR / yfinance returns Yahoo-adjusted prices; we store both raw and adjusted in Silver. Splits & dividends present as separate streams. Renames + delistings tracked in `silver.b3_ticker_dim` as SCD2 with effective dates. | Silver gets the real complexity; Gold only sees clean adjusted series |
| 5 | How is missing data handled for Markowitz? | Covariance is computed per window only on tickers whose history spans the full window. `gold.cov_matrix_*` artifacts ship a `valid_tickers` list alongside the matrix. | Forces an honest UX in Phase 2 — user can't pick a ticker that wasn't trading in the chosen window |

---

## Selected Approach

| Attribute | Value |
|-----------|-------|
| **Chosen** | Approach A — Mirante-twin lakehouse + Next.js static export |
| **User Confirmation** | Confirmed pre-brainstorm (Spec C revised, Supabase removed) + all four discovery answers consistent with this approach |
| **Reasoning** | Literal synthesis of stated goal ("Mirante data discipline + Caixa Forte UX"). Free-tier discipline, no DB, no auth match all stated constraints. Maximum reuse of patterns the user has already shipped twice. |

---

## Key Decisions Made

| # | Decision | Rationale | Alternative Rejected |
|---|----------|-----------|----------------------|
| 1 | **Port yfR API surface, not just wrap yfinance** | User explicit: "canonical ingestion library for the project — not a thin yfinance wrapper". The value is the ergonomics (cache, batch, parallel, frequency dial, parity tests vs R) | Thin `yfinance` wrapper (loses the differentiator) |
| 2 | **Use `yfinance` (Python) under the hood; mirror yfR's caching + parallel logic in Python** | yfR depends on `quantmod`, which hits the same Yahoo endpoints `yfinance` does. Don't reinvent the HTTP layer; reinvent the *organization* layer above it | Direct HTTP fetches (more brittle, no Yahoo reverse-engineering benefit) |
| 3 | **Bronze stores both raw + adjusted; Silver applies splits/dividends explicitly** | 26y of corporate actions is the project's hardest data hygiene problem. Keep the raw record for forensics. | Trust Yahoo's `Adj Close` and discard raw (loses auditability) |
| 4 | **Ticker universe lives in `data/ticker_universe.csv` (versioned in repo, hand-curated)** | ~500 rows is small enough to track in git; sector mapping and delisting events are too irregular to scrape reliably | Scrape every refresh (fragile, no provenance) |
| 5 | **Gold publishes covariance matrices for multiple windows (1y / 5y / full) at build time** | Phase 2 Markowitz UI needs covariance over different lookback windows; precomputing all three is cheap and removes the need for a server | Compute covariance in browser from returns matrix (heavier client compute, slower frontier UI) |
| 6 | **Static export via Next.js `output: 'export'`, deployed to `gh-pages` branch** | Matches Mirante's exact deploy pattern; no Vercel coupling; Pages serves both `/data/*` artifacts and `/app/*` HTML from one place | Vercel deploy (introduces vendor lock; user picked GH Pages explicitly) |
| 7 | **No DuckDB-WASM in Phase 1** | First-paint speed matters for a portfolio piece; precomputed JSON wins for the fixed dashboard surface | Use DuckDB-WASM (deferred — revisit if Phase 2 filter UX grows freeform) |
| 8 | **Markowitz solver library decision deferred to Phase 2** | Gold artifacts (`returns_wide`, `cov_matrix_*`, `valid_tickers`) are what we lock now; the solver is interchangeable later (`osqp.js`, `quadprog-js`, custom analytic for unconstrained case) | Premature lock-in on a JS QP library |
| 9 | **pt-BR copy only in v1; i18n deferred** | Mirante and Caixa Forte both ship pt-BR-first; Clube da Matemática's 11-language story is a separate scope of work | Multi-language from day one (YAGNI) |
| 10 | **Feature slug `MERCADO_BR` covers Phase 1 + Phase 2 architecture** | One coherent platform; `/define` may split into `MERCADO_BR_DASHBOARD` and `MERCADO_BR_PORTFOLIO` if needed | Single feature too broad to ship (mitigated by clear Phase-1 cut-line in DEFINE) |

---

## Features Removed (YAGNI)

| Feature Suggested | Reason Removed | Can Add Later? |
|-------------------|----------------|----------------|
| Real-time / intraday quotes | Explicit non-goal in user spec; daily-close cadence is sufficient for analytics | No (different system entirely) |
| Backtesting framework | Explicit non-goal; out of scope for a dashboard | Yes, separate feature |
| User accounts / saved portfolios in a DB | User explicitly removed Supabase; localStorage + URL state in Phase 2 covers it | Yes, if usage justifies |
| Paid market data feeds (B3 official, Economatica, Refinitiv) | Cost gate + free-tier discipline | No (would compromise FinOps story) |
| Multi-language UI from v1 | pt-BR first matches reference projects | Yes, post-v1 |
| Live Markowitz on a server | Client-side solver against published covariance matrix is faster + zero backend | Yes, if richer optimization (CVaR, Black-Litterman) outgrows the browser |
| DuckDB-WASM for client queries | Precomputed JSON is faster for the fixed dashboard surface | Yes — see Approach B; revisit in Phase 2 |
| Charting library beyond Recharts (e.g., Visx, lightweight-charts) | Recharts is what Caixa Forte uses; design-system consistency | Yes, if a specific chart (candlestick with brush) demands it |
| LaTeX working papers (Mirante-style) | Defer — get the platform first, write papers off the artifacts later | Yes, natural Phase 3 |
| Streaming / Kafka / CDC | Daily batch is enough | No (architectural mismatch) |

---

## Incremental Validations

| Section | Presented | User Feedback | Adjusted? |
|---------|-----------|---------------|-----------|
| Three starting-spec versions (A / B / C) before `/brainstorm` | ✅ | User picked C | Yes — Supabase removed on follow-up |
| Spec C revised without Supabase (localStorage + URL state path) | ✅ | Accepted | No further changes |
| Four discovery answers (scope / depth / hosting / samples) | ✅ | All four answered with maximalist data choices + Mirante-twin hosting | Brainstorm proceeded; data-hygiene risks documented above |
| Selected approach + key decisions (this document) | (pending /define handoff) | — | — |

**Validations completed: 3** (exceeds minimum of 2).

---

## Suggested Requirements for /define

### Problem Statement (Draft)

> Brazilian retail and amateur quants lack a free, open, auditable, fully reproducible analytics surface over the full B3 equities universe with enough history (20+ years) to support honest Markowitz portfolio construction — every existing alternative is either paywalled (Economatica, Refinitiv), shallow (3rd-party dashboards with no provenance), or undisciplined (random Colab notebooks). `Mercado BR` builds that surface as a public lakehouse + static dashboard on free infrastructure, with the data pipeline and the UI both shipped open-source under MIT.

### Target Users (Draft)

| User | Pain Point |
|------|------------|
| Brazilian retail investor refreshing finance fundamentals | Wants a clean, free dashboard to look at sector returns, correlations, ticker-level history without a brokerage paywall |
| Quant student / hobbyist | Needs auditable returns + covariance matrices over the full B3 universe with explicit corporate-action handling, not a black-box yfinance call |
| The author (user) | Wants a portfolio piece that demonstrates both data engineering discipline (Mirante-grade) and product UX (Caixa-Forte-grade) on a domain they have a master's degree in |

### Success Criteria (Draft)

- [ ] `yfr_py` is an installable Python package on PyPI (or at minimum `uv add` from GitHub) with parity tests vs yfR for ≥ 10 tickers / 2 frequencies / 2 date windows
- [ ] Databricks Asset Bundle deploys cleanly to Databricks Free; full Bronze→Silver→Gold runs in ≤ 30 min on a small cluster
- [ ] Gold publishes ≥ 5 distinct JSON artifacts (KPIs, sector aggregates, correlation heatmap, IBOV overview, ticker universe) + ≥ 3 Parquet artifacts (returns wide, covariance 1y / 5y / full)
- [ ] GH Pages serves the Next.js static export + the artifacts from the same `gh-pages` branch; site is publicly reachable
- [ ] Dashboard surfaces all four KPI types (return YTD, vol, max drawdown, Sharpe vs CDI) for every ticker in the universe
- [ ] All KPI math is unit-tested against hand-computed fixtures for ≥ 3 reference tickers (PETR4, VALE3, ITUB4)
- [ ] Lifetime cloud cost ≤ US$ 50 across Databricks Free + GH Actions + GH Pages over the first year
- [ ] README has Mirante-style FinOps badges + working-paper-grade architecture doc

### Constraints Identified

- Free-tier only — Databricks Free Edition, GH Pages, GH Actions, no paid SaaS in critical path.
- No DB, no backend server, no auth — by user decree.
- Static export only (`output: 'export'` on Next.js).
- pt-BR copy in v1.
- MIT license.
- Visual language must reuse Caixa Forte's monochrome design tokens + Recharts patterns.
- Architecture must accommodate Phase 2 (fundamentals + macro + portfolio + Markowitz) without rework.
- Corporate-action handling must be explicit (raw + adjusted both stored in Silver).
- Ticker universe is hand-curated in `data/ticker_universe.csv` (not scraped at runtime).

### Out of Scope (Confirmed)

- Real-time / intraday data.
- Backtesting framework.
- User accounts, server-side persistence, authentication.
- Paid market data feeds.
- LaTeX working papers (deferred to a later phase).
- Multi-language UI (pt-BR only in v1).
- Phase 2 implementation (CVM fundamentals, BCB macro, Markowitz solver) — architecture-only in scope for this brainstorm; actual build deferred.

---

## Session Summary

| Metric | Value |
|--------|-------|
| Questions Asked | 4 (batched, after a pre-brainstorm 3-spec convergence) |
| Approaches Explored | 3 |
| Features Removed (YAGNI) | 10 |
| Validations Completed | 3 |
| Duration | ~1 hr conversation (spec convergence + brainstorm) |

---

## Next Step

**Ready for:** `/agentspec:define .claude/sdd/features/BRAINSTORM_MERCADO_BR.md`

**Suggested Define focus areas (preview):**

1. Lock the `yfr_py` API surface — function-by-function mapping from yfR R functions to Python equivalents.
2. Lock the Silver schema — especially `silver.b3_ticker_dim` (SCD2) and the rename/delisting representation.
3. Lock the Gold artifact contracts — exact JSON shapes and Parquet schemas published to `gh-pages`, so frontend can be designed against frozen contracts.
4. Decide whether to split `MERCADO_BR` into `MERCADO_BR_DASHBOARD` (Phase 1) and `MERCADO_BR_PORTFOLIO` (Phase 2) at the DEFINE level, or keep as one feature.
