# DESIGN: McLean's Model — Pre-2010 Fundamentals Backfill

> Technical design for extending the McLean (2011) replication panel to 1995-2025 by scraping CVM Sistemas legacy filings, parsing CVMWIN binary format, and merging into the existing 2010-2025 silver layer via a unified view. Two new bronze tables, one new silver table, one new silver view, one new gold attrition table, and widened gold notebooks. No changes to the existing Dados Abertos pipeline; the legacy path runs strictly in parallel.

## Metadata

| Attribute | Value |
|-----------|-------|
| **Feature** | MCLEAN_PRE2010 |
| **Date** | 2026-05-25 |
| **Author** | design-agent (Claude Code) |
| **DEFINE** | [DEFINE_MCLEAN_PRE2010.md](./DEFINE_MCLEAN_PRE2010.md) |
| **BRAINSTORM** | [BRAINSTORM_MCLEAN_PRE2010.md](./BRAINSTORM_MCLEAN_PRE2010.md) |
| **Status** | Ready for Build |
| **Effort** | 9-11 weeks across 6 phases (see File Manifest) |

---

## Architecture Overview

```text
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                       MCLEAN_PRE2010 — PARALLEL LEGACY INGEST PATH                         │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                            │
│   ┌──────────────────────────────┐         ┌─────────────────────────────────────────┐   │
│   │  CVM SISTEMAS LEGACY PORTAL  │         │   CVM DADOS ABERTOS (EXISTING, 2010+)   │   │
│   │  sistemas.cvm.gov.br/        │         │   dados.cvm.gov.br/...                  │   │
│   │  port/ciasabertas/*  (ASP)   │         │   dfp_cia_aberta_{year}.zip             │   │
│   └──────────────────────────────┘         └─────────────────────────────────────────┘   │
│                  │                                              │                          │
│                  │ HTTPS GET (ASP forms + CVMWIN binary)        │ HTTPS GET (CSV zips)    │
│                  ▼                                              ▼                          │
│   ┌──────────────────────────────┐         ┌─────────────────────────────────────────┐   │
│   │  ingest/cvm_legacy_dfp.py    │         │   ingest/cvm_dfp.py    (UNCHANGED)      │   │
│   │  resumable scraper           │         │                                          │   │
│   │  +checkpoint table           │         │                                          │   │
│   └──────────────────────────────┘         └─────────────────────────────────────────┘   │
│                  │                                              │                          │
│                  ▼                                              ▼                          │
│   /Volumes/.../bronze/raw/cvm_legacy/        /Volumes/.../bronze/raw/cvm_dfp/             │
│         (raw HTML pages + .DFM/.DFL/             (raw .zip files containing CSVs)         │
│         .ITM/.ITL/.IAN binaries)                                                          │
│                  │                                              │                          │
│                  ▼                                              ▼                          │
│   ┌──────────────────────────────┐         ┌─────────────────────────────────────────┐   │
│   │  bronze/cvm_legacy_dfp.py    │         │   bronze/cvm_dfp_lines.py (UNCHANGED)   │   │
│   │  CVMWIN binary parser        │         │   ZIP+CSV reader                        │   │
│   │  + line-item extraction      │         │                                          │   │
│   └──────────────────────────────┘         └─────────────────────────────────────────┘   │
│                  │                                              │                          │
│                  ▼                                              ▼                          │
│      bronze.cvm_legacy_dfp_lines              bronze.cvm_dfp_lines  (existing)            │
│           (LONG format, BR GAAP chart)             (LONG format, CPC IFRS chart)          │
│                  │                                              │                          │
│                  └────────────────┐         ┌───────────────────┘                          │
│                                   ▼         ▼                                              │
│                          ┌─────────────────────────────────────┐                          │
│                          │  silver/cvm_account_mapping.py      │                          │
│                          │  CVM-raw → Economática-clean        │                          │
│                          │    + DOAR↔DFC bridge                │                          │
│                          └─────────────────────────────────────┘                          │
│                                              │                                             │
│                                              ▼                                             │
│         silver.mclean_firm_year_legacy   ⋃   silver.mclean_firm_year  (existing)          │
│                                              │                                             │
│                                              ▼                                             │
│                           silver.mclean_firm_year_unified  (VIEW, UNION ALL)              │
│                                              │                                             │
│                                              ▼                                             │
│                           silver.mclean_clean  (existing — widened to 1995+)              │
│                                              │                                             │
│                                              ▼                                             │
│            ┌─────────────────────────────────┴─────────────────────────────────┐         │
│            ▼                                                                    ▼          │
│  gold.mclean_descriptives                                          gold.mclean_attrition  │
│  gold.mclean_annual         (existing — widened to (1995,2025))    (NEW — coverage rpt)  │
│  gold.mclean_pooled                                                                       │
│            │                                                                    │          │
│            └─────────────────────────────────┬──────────────────────────────────┘         │
│                                              ▼                                             │
│              export/mclean_artifacts.py → /Volumes/.../artifacts/mclean_results.json      │
│                                              │                                             │
│                                              ▼                                             │
│                                      app/app/mclean/page.tsx                              │
│                              (window selector: 1995-2013 / 1995-2025 / 2010-2025)         │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| **ASP scraper** | Fetches ~37k filings from CVM Sistemas with resumable checkpointing | Python 3.11 + `httpx` + `tenacity` (retry) + Delta checkpoint table |
| **CVMWIN binary parser** | Parses `.DFM`/`.DFL`/`.ITM`/`.ITL`/`.IAN` proprietary binary format into long-format CSV rows | Python 3.11 + `struct` (binary unpack) + reference layout specs |
| **Account mapper** | Maps CVM raw `cd_conta` codes to Economática-clean labels per Chalhoub 2015 dictionary | PySpark SQL + reference table `silver.mclean_account_mapping` |
| **DOAR↔DFC bridge** | Resolves cash-flow variables for pre-2008 firms filing DOAR instead of DFC; classifies each firm-year as clean/ambiguous/missing | PySpark + decision tree |
| **Inflation deflator** | Applies IPCA annual deflator to BRL 2013 (paper base year) | PySpark + IPEA SGS series 1419 (IPCA-anual) |
| **Survivorship resolver** | Looks up sector for delisted firms not in `data/ticker_universe.csv` via historical `cvm_cad_cia` snapshots, keyed by `cd_cvm` | PySpark left-join on `cd_cvm` |
| **Unified silver view** | `silver.mclean_firm_year_unified` = `silver.mclean_firm_year` ∪ `silver.mclean_firm_year_legacy`, strict-superset invariant | Delta VIEW (UNION ALL) |
| **Attrition reporter** | Counts (cd_cvm × fiscal_year) cells at each pipeline stage; powers SC-7 transparency | PySpark + new `gold.mclean_attrition` Delta table |
| **App window selector** | UI control for 1995-2013 / 1995-2025 / 2010-2025 views | Next.js 16 + React 19 + Tailwind v4 chip control |

---

## Key Decisions

### Decision 1: ASP-Form Scraping vs Download Múltiplo

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-25 |

**Context:** Two free public paths to pre-2010 CVM filings exist: (1) the Download Múltiplo bulk endpoint at `seguro.bmfbovespa.com.br/rad/download/SolicitaDownload.asp` requiring CVM-issued credentials, or (2) the ASP-form portal at `sistemas.cvm.gov.br/port/ciasabertas/*` with no auth required.

**Choice:** ASP-form scraping path (option 2), one fetch per (firm × year × statement) tuple.

**Rationale:**
- User confirmed in brainstorm Q2: cannot obtain Download Múltiplo credentials.
- No regulatory dependency; no risk of credentials being revoked mid-workstream.
- Trade-off accepted: ~37k individual fetches vs one credentialed bulk call. Mitigated by aggressive caching + resumable checkpoint table (Decision 3).

**Alternatives Rejected:**
1. **Download Múltiplo with credentials** — blocked by user's inability to register.
2. **Hand-extract from annual report PDFs on firm IR pages** — labor-intensive at 614 firms × 15 years.
3. **Paid Economática subscription** — out of budget.

**Consequences:**
- Pipeline wall-clock dominated by HTTP latency: ~3 days at safe concurrency (2-3 parallel + 1-3s jitter).
- Rate-limit risk: CVM's policy is undocumented. Mitigated by polite-scraper behavior (User-Agent identifying purpose, exponential backoff on 429/503).
- Endpoint deprecation risk: CVM Sistemas is officially deprecated since 2022-02-01. Mitigated by caching every fetched byte on first hit (Decision 3).

---

### Decision 2: Parallel Bronze Tables, Unified Silver View

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-25 |

**Context:** Two source systems (CVM Sistemas legacy 1995-2009, CVM Dados Abertos 2010+) produce filings with different chart-of-accounts and statement structures. The downstream silver layer needs a single firm-year wide table consumable by existing gold notebooks unchanged.

**Choice:** Two physically separate bronze tables (`bronze.cvm_dfp_lines` existing + `bronze.cvm_legacy_dfp_lines` new) feed two silver wide tables (`silver.mclean_firm_year` existing + `silver.mclean_firm_year_legacy` new); a `silver.mclean_firm_year_unified` Delta VIEW UNION-ALLs them. Existing gold notebooks read from `_unified` going forward.

**Rationale:**
- Per-source bronze preserves provenance (`source_system` column at silver layer) and lets us drop the legacy path cleanly if it sunsets, without touching the existing pipeline.
- Unified silver via VIEW (not materialized table) avoids double-write costs and keeps the schema-superset invariant SC-6 automatic — if the underlying tables agree on columns, the VIEW always agrees.
- Gold notebooks need a single read source — `WHERE fiscal_year BETWEEN 1995 AND 2025` against `_unified` is cleaner than UNION-ing in every gold notebook.

**Alternatives Rejected:**
1. **Single unified bronze table with `source_system` column** — couples ingest schemas; a CSV-format change on either side would require a coordinated migration.
2. **Materialize `silver.mclean_firm_year_unified` as a Delta table** — doubles storage, adds a refresh cascade dependency, no observed query-performance benefit at <100k rows.
3. **Refactor existing 2010+ pipeline to consume legacy rows** — explicitly out-of-scope per DEFINE Constraints.

**Consequences:**
- Two bronze tables to monitor + dedupe independently.
- One additional Delta VIEW DDL to maintain.
- Gold notebooks must update one line: `spark.table("...silver.mclean_firm_year_unified")` instead of `spark.table("...silver.mclean_firm_year")`. Tracked as a single rename PR.

---

### Decision 3: Resumable Scraper via Delta Checkpoint Table

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-25 |

**Context:** ~37k HTTP fetches over ~3 days of wall-clock; any failure (network blip, rate-limit 429, parser crash on a single bad file) must not cost re-fetching what's already cached. SC-5 mandates zero re-fetch on restart.

**Choice:** A Delta table `bronze.cvm_legacy_scrape_checkpoint` recording every (cd_cvm, fiscal_year, statement, attempt) tuple with status ∈ {`pending`, `fetching`, `cached`, `failed_terminal`, `failed_retryable`}. Bronze files land at deterministic paths `/Volumes/.../cvm_legacy/{cd_cvm}/{fy}/{statement}.{ext}`. Scraper logic: SELECT pending rows → fetch → write file with `.tmp` suffix → rename atomically → MERGE checkpoint row → next row.

**Rationale:**
- Idempotent by construction: re-running the scraper with the same input is a no-op for `cached` rows.
- Survives mid-fetch SIGTERM: the `.tmp` suffix is dropped on success, so any non-renamed file is detected as partial on restart and re-fetched (AT-004 in DEFINE).
- Delta MERGE is the standard pattern for this in the existing pipeline (`bronze.b3_ohlcv_raw` uses an analogous run_id-keyed MERGE).
- Querying `WHERE status IN ('pending', 'failed_retryable')` gives the work queue for the next pass — simple resume semantics.

**Alternatives Rejected:**
1. **Filesystem-only state (no checkpoint table)** — requires expensive directory walks on restart; can't distinguish "succeeded with empty payload" from "never attempted".
2. **Per-firm subdirectory marker files** — same as above, plus race-conditions on parallel writers.
3. **In-memory state with serialized resume** — fragile, requires the process to write state on every shutdown signal.

**Consequences:**
- Single source of truth for scraper progress; debuggable via `SELECT status, COUNT(*) GROUP BY status`.
- Trade-off: every successful fetch incurs one extra MERGE write. At ~37k fetches and Delta's batch-merge optimization, this is <1% of total wall-clock.
- Adds one new bronze Delta table to schema (counted in File Manifest).

---

### Decision 4: CVMWIN Parser via `dbfread` (Clipper/dBase Format) — REVISED

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted (revised 2026-05-25 after public-info recovery; supersedes original "byte-level parser from scratch") |
| **Date** | 2026-05-25 |

**Context:** The pre-2010 filings have `.DFM`/`.DFL`/`.ITM`/`.ITL`/`.IAN` extensions. Initial design assumed proprietary binary format requiring custom `struct.unpack` parsing. **Public-info recovery post-initial-commit (2026-05-25) overturned this**: the legacy CVM reader (`Consulta.zip` v2.4 at `sistemas.cvm.gov.br/download/sep/pub/programas/RelatCias24/`) has `set clipper=F:200` in its DOS autoexec.bat — the Clipper xBase compiler's memory directive. The files are therefore almost certainly **standard dBase III/IV / Clipper DBF databases** with a rename, not proprietary binary. Extension semantics: M = "Mil" (monetary scale 000s), L = "Livre" (free unit).

**Choice:** Use the `dbfread` Python library (pure Python, MIT-licensed, handles Clipper variants) as the primary parser. Module `pipelines/notebooks/bronze/cvmwin_parser.py` wraps `dbfread.DBF` to emit `CvmwinAccountLine` records via the same public API the bronze MERGE notebook depends on. Detection-by-experiment in Phase 0 step 2: download one real `.DFM`, run `dbfread.DBF(path).field_names`, populate `_DBF_FIELD_MAP[statement]`.

**Rationale:**
- dBase/Clipper format is a 1990s standard with mature OSS parsers; `dbfread` is widely used and stable.
- Drops parser scope from ~600-800 LoC custom binary parsing to ~50-100 LoC of `dbfread` wrapper + field-name mapping.
- Effort estimate for Phase 0 step 2: **1-2 days → 2-4 hours** (just column inspection, no byte-level decoding).
- Fallback `dbf` library (broader Clipper-variant support) and `simpledbf` (last-resort manual decoding) keep the risk bounded.

**Alternatives Rejected (revised):**
1. **Custom `struct.unpack` byte-level parser** (the original Decision 4) — rejected after format reframe. Would have been ~10× more work for no extra capability.
2. **Wrap CVMWIN.exe** — requires Windows runtime, not feasible in Databricks Linux executors.
3. **`pycvm` library** — handles only post-2010 CSV, doesn't cover pre-2010 DBF.
4. **OCR rendered HTML** — fragile, loses precision.

**Consequences:**
- Adds `dbfread` to the pipeline dependency closure (small, pure-Python, no transitive deps).
- Parser becomes a thin wrapper, not a long-term maintenance burden.
- Still need to handle: (a) Clipper variants `dbfread` doesn't cover (fallback to `dbf` lib); (b) memo fields if present in `.DFL` files (Clipper memo is `.DBT`, may need separate retrieval); (c) Portuguese encoding (cp850 DOS or cp1252 Windows-ANSI — test on real file).
- Test strategy unchanged: validate parser output against 2010-2013 Dados Abertos overlap (R7 mitigation).

---

### Decision 5: DOAR↔DFC Bridge Classification (Clean/Ambiguous/Missing)

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-25 |

**Context:** Pre-2008 filings used DOAR (Demonstração das Origens e Aplicações de Recursos) instead of DFC (Demonstração do Fluxo de Caixa). The McLean variables `deprec_amort`, `venda_imobilizado`, `dividendos_pagos` come from DOAR for 1995-2007 and DFC for 2008+. The dissertation gives the variable-name mapping but firms vary in how they actually structured their DOAR lines (some split D&A across 3 sub-items, some omit "Venda de Bens Permanentes" entirely).

**Choice:** A `bridge_status` column on `silver.mclean_firm_year_legacy` with three values:
- `clean` — exactly one DOAR line matches each McLean variable; values populated.
- `ambiguous` — multiple DOAR lines match (e.g., D&A split across 3 sub-items); values populated as SUM, flagged for downstream filtering.
- `missing` — no matching DOAR line found; values NULL.

For 2008+ rows, `bridge_status = 'na'` (DFC era, no bridging needed).

Headline regression panel (used for SC-1 paper-match) filters to `bridge_status IN ('clean', 'na')`. Extended panel (for app display) includes `ambiguous` rows with a UI flag. `missing` rows are always excluded from regression but counted in `gold.mclean_attrition`.

**Rationale:**
- The paper itself doesn't document which firms had which bridge state; we have to derive this from the data.
- Three-state classification preserves the analyst's ability to choose strict vs lenient sub-samples downstream.
- Falsifiable: a firm flagged `clean` should match its 2008+ DFC values within rounding; this is a unit test.

**Alternatives Rejected:**
1. **Binary clean/dirty classification** — collapses too much information; loses the ability to recover ambiguous firms if downstream analysis tolerates them.
2. **Manual per-firm curation in `data/mclean_doar_bridge.csv`** — promoted from COULD to MUST only if A-004 (≥90% clean) fails in PoC.
3. **Skip pre-2008 cash-flow variables entirely** — fails DEFINE SC-3 (≥5,500 firm-years on 1995-2013 implies pre-2008 must be in scope).

**Consequences:**
- One new column (`bridge_status`) on the silver schema; documented in DEFINE Data Contract.
- `gold.mclean_clean` filter at [silver/mclean_clean.py:118](pipelines/notebooks/silver/mclean_clean.py#L118) gets a `bridge_status IN ('clean', 'na')` clause for the headline panel.
- Per-firm override mechanism (`data/mclean_doar_bridge.csv`) is built as a COULD goal — only activated if PoC shows <90% clean rate.

---

### Decision 6: Firm Universe Keyed by `cd_cvm`, Not Ticker

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-25 |

**Context:** The 614-firm paper sample includes many firms that delisted before 2010 (Aracruz, Sadia, Telemar, AmBev-old, Lojas Americanas pre-2010-merger, etc.) and have no current `.SA` ticker on B3. Our existing `data/ticker_universe.csv` is ticker-keyed and only includes firms with at least one historical ticker we still recognize.

**Choice:** A new `data/mclean_firm_universe.csv` keyed by `cd_cvm` (CVM's stable firm identifier), independent of `ticker_universe.csv`. Sector resolved per-firm-year from `bronze.cvm_cad_cia` historical snapshots (or a frozen first-observation lookup if Cadastro doesn't cover delisted firms — see Decision 7).

**Rationale:**
- `cd_cvm` is the only universal key across the 30-year window (tickers change, names change, but cd_cvm stays).
- Decouples the McLean pipeline from the trading-data pipeline; each can have its own universe definition.
- Per-firm-year sector lookup correctly handles firms that changed sectors over decades (rare but real — banks reclassified post-2008 financial crisis, mining companies that diversified, etc.).

**Alternatives Rejected:**
1. **Extend `ticker_universe.csv` with synthetic tickers for delisted firms** — pollutes the ticker universe used by the trading-data app; couples two unrelated concerns.
2. **Use only firms in both universes (intersection)** — drops the 150+ delisted firms; fails SC-4 (≥550 firms).

**Consequences:**
- One new reference CSV to maintain (`data/mclean_firm_universe.csv`, ~614 rows).
- App McLean page must accept `cd_cvm` as identifier alongside ticker; cosmetic UI change.
- Sector resolution at silver layer must left-join `bronze.cvm_cad_cia` on `cd_cvm` (existing pattern at [silver/mclean_firm_year.py:138](pipelines/notebooks/silver/mclean_firm_year.py#L138)).

---

### Decision 7: First-Observation Sector for Historical Firms

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-25 |

**Context:** `bronze.cvm_cad_cia` (CVM Cadastro de Companhias) is refreshed daily and represents *current* firm-sector mappings. Delisted firms may be missing entirely, or may carry a sector that doesn't match their historical filings.

**Choice:** For each `cd_cvm` in the firm universe, pin the sector at **first observation** in our data (or curated value in `data/mclean_firm_universe.csv` if absent from Cadastro). Apply this single sector across all firm-years for that firm.

**Rationale:**
- Paper appears to use a single sector per firm based on the sector at acquisition (Economática convention).
- Time-varying sector classification would complicate the constrained/unconstrained partitioning (sector × year deciles) without obvious analytical benefit.
- Matches existing pipeline pattern: `silver/mclean_firm_year.py` already does a left-join on Cadastro and doesn't vary sector by year.

**Alternatives Rejected:**
1. **Year-specific Cadastro snapshot** — requires us to capture historical Cadastro state (not available pre-2010); adds complexity.
2. **Most-recent Cadastro for each firm** — biased: a firm reclassified post-merger keeps the new sector for pre-merger years.
3. **Hand-curated sector for every firm-year** — labor-intensive at 614 × 15 = ~9,200 cells.

**Consequences:**
- Firms that genuinely changed sectors over 30 years get one sector for all years; tradeoff accepted as matching the paper's apparent practice.
- ~150 delisted firms need curated sector entries in `data/mclean_firm_universe.csv`; treated as a one-time data-curation task at the start of Phase 2.

---

### Decision 8: Proof-of-Concept Gate Before Full Build

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-25 |

**Context:** Four load-bearing assumptions (A-001 through A-004 in DEFINE) determine whether the workstream is feasible at all: CVM portal accessibility, CVMWIN layout-spec accuracy, ≥550 firms recoverable, DOAR bridge clean rate ≥90%. Committing to 9-11 weeks without testing these is high-risk.

**Choice:** Phase 0 of the implementation runs a **proof-of-concept (PoC)** scoped to **10 firms × 3 years** (1998, 2003, 2008) before the full scraper is built out. Phase 1 (full scrape) only starts after PoC PASS.

**PoC firm list** (mix of survivors + delisted, all 4 statements):
- Survivors: PETR4 (cd_cvm=9512), VALE3 (4170), BBAS3 (1023), USIM5 (7617)
- Delisted: ACES4 (Aracruz, cd_cvm=4030), SDIA4 (Sadia, 5258), TNLP4 (Telemar, 11592), AMBV4 (AmBev pre-rebrand, 11193)
- Edge cases: ENBR3 (EDP Brasil, taken private 2024, 8265), GOLL4 (GOL in RJ, 19305)

**PoC PASS criteria:**
- A-001: ≥9/10 firms have at least one statement fetchable for all 3 PoC years
- A-002: Parser produces non-NULL values for ≥80% of expected `cd_conta` codes on those firms
- A-003: All 10 firms found in `bronze.cvm_cad_cia` OR have a derivable sector from filings
- A-004: ≥9/10 firm-years have `bridge_status = 'clean'` for DOAR-era years (1998, 2003)

**Rationale:**
- PoC failure on any assumption changes the workstream materially (e.g., A-004 fail → per-firm override curation goes from COULD to MUST, +2-3 weeks).
- 10 firms × 3 years × 4 statements = 120 fetches; 1-2 days wall-clock; tractable.
- Same parser + scraper code paths as the full build; PoC code is not throwaway.

**Alternatives Rejected:**
1. **Skip PoC, commit to full build immediately** — high risk of finding A-002 wrong after parser is 80% done.
2. **PoC scoped to 50 firms** — diminishing marginal information; 10 carefully chosen firms test all the regime variations.

**Consequences:**
- PoC adds ~1 week to the timeline (Week 1 instead of starting Phase 1 directly).
- If PoC fails, design pivots (Decision 5 escalates, or Decision 4 needs alternative parser).
- PoC artifacts (the 10 firms × 3 years filings + checkpoint table) seed the full scrape — not wasted work.

---

### Decision 9: Inflation Deflation Applied in Silver, Not Gold

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-25 |

**Context:** Paper deflates to BRL 2013 using IPCA annual from IPEA. The existing 2010-2025 pipeline does NOT deflate (per DEFINE Constraints: silver stores nominal BRL). We need to choose where the deflation happens.

**Choice:** Add an optional `deflate_to_brl_2013` widget (default `False`) on `silver.mclean_firm_year_legacy` AND `silver.mclean_clean`. When `True`, multiplies level variables (`ativo_total`, `cash`, `debt_*`, `patrimonio_liquido`, `reserva_lucros`, `lucros_acumulados`, `lucro_liquido`, `deprec_amort`, `venda_imobilizado`, `dividendos_pagos`) by `ipca_cumulative_2013[fiscal_year]`. Ratio variables (Cash, ΔCash, ΔIssue, ΔDebt, CashFlow, Other, Assets, Dividends) are unaffected since they're already AT-normalized.

The McLean app and existing gold notebooks default to `False` (nominal); the paper-match regression run sets it to `True`.

**Rationale:**
- Paper-match (SC-1, SC-2) requires deflation; nominal vs real changes the level statistics in Tab. 1.
- Default `False` preserves backward compatibility with existing 2010-2025 outputs (SC-9).
- Silver is the right layer: it's the canonical wide table; doing it in gold would force every gold notebook to know the deflator series.

**Alternatives Rejected:**
1. **Always deflate (no toggle)** — breaks SC-9 (no regression on existing 2010+ outputs).
2. **Always nominal, never deflate** — fails SC-2 (Tab. 1 absolute means differ).
3. **Deflation in gold per-notebook** — duplicates the IPCA lookup, easy to introduce drift.

**Consequences:**
- One new bronze table or reference CSV: `bronze.ipca_annual` or `data/ipca_annual.csv` (31 rows, base year 2013).
- All gold notebooks gain a `deflate` widget passthrough.
- Tab. 1 output in `gold.mclean_descriptives` is computed twice: once nominal (for the app), once deflated (for the paper-match validation).

---

## File Manifest

Phase numbers track the brainstorm effort estimate (9-11 weeks total).

| # | File | Action | Purpose | Agent | Dependencies | Phase |
|---|------|--------|---------|-------|--------------|-------|
| **PHASE 0 — Proof of Concept (Week 1)** | | | | | | |
| 1 | `data/mclean_firm_universe.csv` | Create | 614-firm universe keyed by cd_cvm with curated sector for delisted firms | manual + data-engineer | None | 0 |
| 2 | `pipelines/notebooks/bronze/cvmwin_parser.py` | Create | Pure-Python CVMWIN binary parser (PoC subset: just BPA structure) | @python-developer | None | 0 |
| 3 | `pipelines/notebooks/ingest/cvm_legacy_dfp.py` | Create | ASP scraper (PoC scope: 10 firms × 3 years) | @python-developer | 1 | 0 |
| 4 | `tests/unit/test_cvmwin_parser.py` | Create | Unit tests for parser against 2010-2013 overlap | @test-generator | 2 | 0 |
| 5 | `.claude/sdd/reports/POC_REPORT_MCLEAN_PRE2010.md` | Create | PoC results vs A-001/A-002/A-003/A-004 thresholds; GO/NO-GO gate | @ai-data-engineer | 1, 2, 3, 4 | 0 |
| **PHASE 1 — Full Scraper + Bronze (Weeks 2-3)** | | | | | | |
| 6 | `pipelines/notebooks/bronze/cvm_legacy_scrape_checkpoint.py` | Create | DDL + MERGE for resumable scraper checkpoint Delta table | @lakeflow-architect | None | 1 |
| 7 | `pipelines/notebooks/ingest/cvm_legacy_dfp.py` | Modify | Generalize PoC scraper to full universe + all statements | @python-developer | 3, 6 | 1 |
| 8 | `pipelines/notebooks/bronze/cvm_legacy_dfp_lines.py` | Create | DDL + MERGE for legacy bronze long table | @lakeflow-architect | None | 1 |
| 9 | `pipelines/notebooks/bronze/cvmwin_parser.py` | Modify | Extend PoC parser to BPP/DRE/DOAR/DFC/IAN | @python-developer | 2 | 1 |
| 10 | `pipelines/notebooks/bronze/cvm_legacy_parse_runner.py` | Create | Orchestrator: walks UC Volume legacy files → parser → bronze MERGE | @python-developer | 8, 9 | 1 |
| 11 | `tests/integration/test_legacy_scraper_resumable.py` | Create | Integration test for SC-5 resumability invariant | @test-generator | 7 | 1 |
| **PHASE 2 — Silver Mapping + Bridge (Weeks 4-6)** | | | | | | |
| 12 | `pipelines/notebooks/silver/mclean_account_mapping.py` | Create | Reference table: CVM cd_conta → Economática label → McLean variable | @schema-designer | 1, 8 | 2 |
| 13 | `data/mclean_account_mapping.csv` | Create | Reference data for table 12 (BR GAAP chart of accounts → Economática labels) | manual + data-engineer | None | 2 |
| 14 | `data/ipca_annual.csv` | Create | IPCA annual deflator series 1995-2025 (base year 2013) from IPEA SGS 1419 | manual + data-engineer | None | 2 |
| 15 | `pipelines/notebooks/silver/mclean_firm_year_legacy.py` | Create | Pivot legacy bronze long → wide firm-year + DOAR↔DFC bridge + bridge_status | @lakeflow-architect | 12, 8 | 2 |
| 16 | `pipelines/notebooks/silver/mclean_firm_year_unified.py` | Create | DDL for `silver.mclean_firm_year_unified` VIEW (UNION ALL legacy ∪ existing) | @schema-designer | 15 | 2 |
| 17 | `pipelines/notebooks/silver/mclean_clean.py` | Modify | Read from `_unified`, add `deflate_to_brl_2013` widget, add `bridge_status` filter | @lakeflow-architect | 14, 16 | 2 |
| 18 | `tests/unit/test_doar_dfc_bridge.py` | Create | Bridge classification correctness (AT-006, AT-007, AT-008) | @test-generator | 15 | 2 |
| **PHASE 3 — Gold Extensions + Attrition (Weeks 7-8)** | | | | | | |
| 19 | `pipelines/notebooks/gold/mclean_annual.py` | Modify | Widen `WINDOWS` to `("full": (1995,2025), "original": (1995,2013))` | @lakeflow-architect | 17 | 3 |
| 20 | `pipelines/notebooks/gold/mclean_pooled.py` | Modify | Same widening + deflation widget passthrough | @lakeflow-architect | 17 | 3 |
| 21 | `pipelines/notebooks/gold/mclean_descriptives.py` | Modify | Dual output: nominal + deflated Tab. 1 stats | @lakeflow-architect | 17 | 3 |
| 22 | `pipelines/notebooks/gold/mclean_extensions.py` | Create | Tobin Q + Q-interactions + CF Vol. + CF Vol. Median + Cash Flow Risk + Prec proxies | @lakeflow-architect | 17 | 3 |
| 23 | `pipelines/notebooks/gold/mclean_attrition.py` | Create | Per-stage cell counts: fetched → parsed → mapped → filter-passed → in-regression | @lakeflow-architect | 6, 8, 15, 17 | 3 |
| 24 | `pipelines/contracts/mclean_results.schema.json` | Modify | Add fields for window selector + attrition + extensions | @data-contracts-engineer | 22, 23 | 3 |
| **PHASE 4 — Validation (Weeks 9)** | | | | | | |
| 25 | `tests/integration/test_mclean_paper_match.py` | Create | SC-1 + SC-2 paper-coefficient + Tab. 1 match assertions on 1995-2013 panel | @test-generator | 19, 20, 21 | 4 |
| 26 | `.claude/sdd/reports/PAPER_MATCH_REPORT.md` | Create | Coefficient comparison report (ours vs paper), with deltas + dropped-firm-year accounting | @ai-data-engineer | 25 | 4 |
| **PHASE 5 — App + Docs (Weeks 10)** | | | | | | |
| 27 | `app/app/mclean/page.tsx` | Modify | Add window selector chip control (1995-2013 / 1995-2025 / 2010-2025) | @python-developer (TS adjacent) | 24 | 5 |
| 28 | `app/components/MCleanView.tsx` | Modify | Render extensions (Tobin Q, precautionary proxies) + attrition table | @python-developer | 24, 27 | 5 |
| 29 | `pipelines/notebooks/export/mclean_artifacts.py` | Modify | Export windowed datasets + attrition table to UC Volume artifacts | @lakeflow-architect | 22, 23 | 5 |
| 30 | `docs/METHODOLOGY.md` | Modify | New § "McLean Pre-2010 Backfill" documenting account mapping + DOAR↔DFC bridge | @code-documenter | All | 5 |
| 31 | `docs/adrs/0013-mclean-pre2010-fundamentals.md` | Create | Architectural Decision Record summarizing this design's 9 decisions | @code-documenter | All | 5 |
| **PHASE 6 — Buffer (Week 11)** | | | | | | |
| 32 | (any) | Fix | Debug buffer for paper-match coefficient drift, parser quirks, bridge edge cases | @ai-data-engineer | All | 6 |

**Total Files:** 32 (24 new, 8 modified)

---

## Agent Assignment Rationale

| Agent | Files Assigned | Why This Agent |
|-------|----------------|----------------|
| @python-developer | 2, 3, 7, 9, 10, 27, 28 | Python parser + scraper + Next.js component code — generalist with clean-patterns focus |
| @lakeflow-architect | 6, 8, 15, 16, 17, 19, 20, 21, 22, 23, 29 | Databricks Lakeflow/DLT specialist — owns bronze MERGE, silver pivots, gold widening, exports |
| @schema-designer | 12, 16 | Reference data + Delta VIEW DDL — schema modeling specialty |
| @data-contracts-engineer | 24 | JSON Schema contract — data-contract specialty |
| @code-documenter | 30, 31 | METHODOLOGY.md + ADR — documentation specialty |
| @ai-data-engineer | 5, 26, 32 | PoC report + paper-match validation + debug — analytical + cross-component |
| @test-generator | 4, 11, 18, 25 | pytest test files — testing specialty |
| (manual + data-engineer) | 1, 13, 14 | Reference CSVs — hand-curation, not agent-generated |

**Agent Discovery:** scanned `/home/leochalhoub/.claude/plugins/cache/agentspec/agentspec/3.2.0/agents/**/*.md` and matched by purpose keywords (Lakehouse/DLT/Spark for Databricks notebooks, schema design for DDLs, contracts for JSON schemas, documentation for markdown).

---

## Code Patterns

### Pattern 1: Resumable Scraper Checkpoint Loop

```python
# pipelines/notebooks/ingest/cvm_legacy_dfp.py — core resume loop

from pyspark.sql import functions as F
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

CHECKPOINT_TABLE = f"{catalog}.bronze.cvm_legacy_scrape_checkpoint"

def _work_queue():
    """All (cd_cvm, fiscal_year, statement) tuples that still need fetching."""
    return (
        spark.table(CHECKPOINT_TABLE)
        .where(F.col("status").isin("pending", "failed_retryable"))
        .select("cd_cvm", "fiscal_year", "statement")
        .toPandas()
        .to_dict("records")
    )

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=30))
def _fetch(cd_cvm: str, fy: int, stmt: str) -> bytes:
    """Single HTTP fetch with exponential-backoff retry."""
    url = _build_url(cd_cvm, fy, stmt)
    r = httpx.get(url, timeout=60.0, headers={"User-Agent": "applied-finance/mclean-replication"})
    r.raise_for_status()
    return r.content

def _persist(payload: bytes, cd_cvm: str, fy: int, stmt: str) -> str:
    """Atomic write: write `.tmp` then rename to final path."""
    final = f"/Volumes/{catalog}/bronze/raw/cvm_legacy/{cd_cvm}/{fy}/{stmt}.bin"
    tmp = f"{final}.tmp"
    dbutils.fs.put(tmp, payload, overwrite=True)
    dbutils.fs.mv(tmp, final)
    return final

def _mark_cached(cd_cvm: str, fy: int, stmt: str, path: str, n_bytes: int):
    spark.sql(f"""
        MERGE INTO {CHECKPOINT_TABLE} t
        USING (SELECT '{cd_cvm}' cd_cvm, {fy} fiscal_year, '{stmt}' statement,
                      'cached' status, '{path}' file_path, {n_bytes} n_bytes,
                      current_timestamp() updated_at) s
        ON t.cd_cvm = s.cd_cvm AND t.fiscal_year = s.fiscal_year AND t.statement = s.statement
        WHEN MATCHED THEN UPDATE SET
            status = s.status, file_path = s.file_path, n_bytes = s.n_bytes, updated_at = s.updated_at
    """)

for row in _work_queue():
    try:
        payload = _fetch(row["cd_cvm"], row["fiscal_year"], row["statement"])
        path = _persist(payload, row["cd_cvm"], row["fiscal_year"], row["statement"])
        _mark_cached(row["cd_cvm"], row["fiscal_year"], row["statement"], path, len(payload))
    except Exception as e:
        log.warning("fetch failed: cd_cvm=%s fy=%s stmt=%s err=%s",
                    row["cd_cvm"], row["fiscal_year"], row["statement"], e)
        _mark_failed(row["cd_cvm"], row["fiscal_year"], row["statement"], str(e))
```

### Pattern 2: CVMWIN Parser via `dbfread` (revised after Clipper discovery)

```python
# pipelines/notebooks/bronze/cvmwin_parser.py — dBase/Clipper parser

from collections.abc import Iterator
from dataclasses import dataclass
from io import BytesIO

import dbfread

# Pre-2010 CVM filings are Clipper DBF databases (extension renamed to
# .DFM/.DFL/.ITM/.ITL/.IAN). The Consulta.zip v2.4 DOS reader has
# `set clipper=F:200` in autoexec.bat — the Clipper memory directive.
# M = Mil (monetary scale 000s), L = Livre (free unit).

@dataclass(frozen=True)
class CvmwinAccountLine:
    cd_conta: str
    ds_conta: str
    vl_norm: float
    ordem_exerc: str  # 'ÚLTIMO' or 'PENÚLTIMO'


# Populated in Phase 0 step 2 after running
#     dbfread.DBF(path).field_names
# on a real downloaded sample file. Anticipated shape:
#   "DFP": {"cd_conta": "CD_CONTA", "ds_conta": "DS_CONTA",
#           "vl_norm": "VL_CONTA", "ordem_exerc": "ORDEM_EXER"}
_DBF_FIELD_MAP: dict[str, dict[str, str]] = {}


def detect_dbf(blob: bytes) -> bool:
    """Check first byte for dBase III/IV / FoxPro / Clipper signature."""
    if not blob:
        raise UnsupportedVersionError("empty blob")
    header = blob[0]
    if header in (0x03, 0x83, 0xF5, 0xFB, 0x30):
        return True
    raise UnsupportedVersionError(f"first byte 0x{header:02x} is not dBase/Clipper")


def parse_bpa(blob: bytes) -> Iterator[CvmwinAccountLine]:
    """Iterate BPA (Balanço Patrimonial Ativo) account lines from a .DFM file."""
    detect_dbf(blob)
    if "DFP" not in _DBF_FIELD_MAP:
        raise LayoutNotDecodedError("_DBF_FIELD_MAP['DFP'] not populated — Phase 0 step 2")
    fmap = _DBF_FIELD_MAP["DFP"]
    table = dbfread.DBF(filename=None, filedata=BytesIO(blob),
                        encoding="cp850", lowernames=True)
    for record in table:
        yield CvmwinAccountLine(
            cd_conta=str(record[fmap["cd_conta"]]).strip(),
            ds_conta=str(record[fmap["ds_conta"]]).strip(),
            vl_norm=float(record[fmap["vl_norm"]] or 0.0),
            ordem_exerc=str(record[fmap["ordem_exerc"]]).strip(),
        )
```

**Phase 0 step 2 work to populate `_DBF_FIELD_MAP`** (was previously "decode binary spec, write 600-800 LoC of struct.unpack"):

```python
# Run once on a downloaded .DFM file to inspect columns:
import dbfread
table = dbfread.DBF("petr4_2005.DFM", lowernames=True)
print(table.field_names)  # → ['cd_conta', 'ds_conta', 'vl_conta', 'ordem_exer', ...]
print(next(iter(table)))  # → sample record to verify encoding + value types
```

Total Phase 0 step 2: ~2-4 hours (download, inspect, populate map, commit fixture).

### Pattern 3: DOAR↔DFC Bridge Decision Tree

```python
# pipelines/notebooks/silver/mclean_firm_year_legacy.py — bridge classification

from pyspark.sql import functions as F

# Economática-clean account labels (from dissertation §Variables) — pre-2008
DOAR_DA_LABELS = ["Depreciação e Amortização", "Deprec, amort e exaust",
                  "Depreciações e Amortizações"]
DOAR_VENDA_LABELS = ["Venda/Baixa Bens Permane", "Venda de Bens Permanentes"]
DOAR_DIV_LABELS = ["Dividendos", "Dividendos Pagos"]

def _classify_bridge(df):
    """Tag each (cd_cvm, fiscal_year) row with bridge_status.

    Rules (apply only to fiscal_year ≤ 2007; 2008+ rows get bridge_status='na'):
        clean      — exactly one DOAR line matches each of {D&A, Venda, Div}
        ambiguous  — multiple DOAR lines match one or more variable (we sum, flag)
        missing    — no DOAR line matches one or more variables (NULL the value, flag)
    """
    has_da = F.size(F.array_distinct(F.collect_list(
        F.when(F.col("ds_conta").isin(*DOAR_DA_LABELS), F.col("cd_conta"))
    ))) > 0
    multi_da = F.size(F.array_distinct(F.collect_list(
        F.when(F.col("ds_conta").isin(*DOAR_DA_LABELS), F.col("cd_conta"))
    ))) > 1
    # ... analogous for venda + div
    return df.withColumn(
        "bridge_status",
        F.when(F.col("fiscal_year") >= 2008, F.lit("na"))
         .when(~has_da | ~has_venda | ~has_div, F.lit("missing"))
         .when(multi_da | multi_venda | multi_div, F.lit("ambiguous"))
         .otherwise(F.lit("clean"))
    )
```

### Pattern 4: Unified Silver View DDL

```sql
-- pipelines/notebooks/silver/mclean_firm_year_unified.py — VIEW DDL

CREATE OR REPLACE VIEW finance_prd.silver.mclean_firm_year_unified AS
SELECT
    cd_cvm, fiscal_year,
    ativo_total, cash, debt_cp, debt_lp, patrimonio_liquido,
    reserva_lucros, lucros_acumulados, lucro_liquido,
    deprec_amort, venda_imobilizado, dividendos_pagos,
    sector, denom_cia,
    'cvm_dados_abertos' AS source_system,
    'CPC_IFRS' AS accounting_standard,
    'na' AS bridge_status
FROM finance_prd.silver.mclean_firm_year

UNION ALL

SELECT
    cd_cvm, fiscal_year,
    ativo_total, cash, debt_cp, debt_lp, patrimonio_liquido,
    reserva_lucros, lucros_acumulados, lucro_liquido,
    deprec_amort, venda_imobilizado, dividendos_pagos,
    sector, denom_cia,
    'cvm_legacy' AS source_system,
    'BR_GAAP' AS accounting_standard,
    bridge_status
FROM finance_prd.silver.mclean_firm_year_legacy;
```

### Pattern 5: Configuration Structure

```yaml
# pipelines/databricks.yml — new bundle task additions (excerpt)

resources:
  jobs:
    job_mclean_legacy_backfill:
      name: mclean_legacy_backfill (one-time scrape + parse)
      tasks:
        - task_key: ingest_cvm_legacy
          notebook_task:
            notebook_path: ./notebooks/ingest/cvm_legacy_dfp.py
            base_parameters:
              catalog: ${var.catalog}
              concurrency: "3"        # parallel HTTP fetches
              jitter_min_s: "1.0"
              jitter_max_s: "3.0"
              max_retries: "3"

        - task_key: parse_cvm_legacy
          depends_on: [{ task_key: ingest_cvm_legacy }]
          notebook_task:
            notebook_path: ./notebooks/bronze/cvm_legacy_parse_runner.py

        - task_key: silver_firm_year_legacy
          depends_on: [{ task_key: parse_cvm_legacy }]
          notebook_task:
            notebook_path: ./notebooks/silver/mclean_firm_year_legacy.py
            base_parameters:
              catalog: ${var.catalog}

        - task_key: refresh_unified_view
          depends_on: [{ task_key: silver_firm_year_legacy }]
          notebook_task:
            notebook_path: ./notebooks/silver/mclean_firm_year_unified.py
```

---

## Data Flow

```text
1. Scraper reads `bronze.cvm_legacy_scrape_checkpoint` for pending work
   │   Initial seed: data/mclean_firm_universe.csv × {1995..2009} × {BPA,BPP,DRE,DOAR/DFC,IAN}
   ▼
2. For each (cd_cvm, fy, stmt):
   ├── HTTP GET sistemas.cvm.gov.br ASP form → response HTML or .DFM/.DFL binary
   ├── Write to /Volumes/.../cvm_legacy/{cd_cvm}/{fy}/{stmt}.bin
   └── MERGE checkpoint row → status='cached'
   ▼
3. Parse runner walks the UC Volume tree:
   ├── For each cached file, dispatch to CVMWIN parser per file extension
   ├── Parser emits CvmwinAccountLine records (cd_conta, ds_conta, vl_norm, ordem_exerc)
   └── Insert into bronze.cvm_legacy_dfp_lines (idempotent MERGE on key)
   ▼
4. Silver mclean_firm_year_legacy:
   ├── Apply account_mapping reference table (CVM cd_conta → Economática label)
   ├── Pivot long → wide firm-year on the 11 McLean target columns
   ├── DOAR↔DFC bridge classification for fy ≤ 2007 → bridge_status
   └── Left-join sector from cvm_cad_cia (or mclean_firm_universe override)
   ▼
5. Silver mclean_firm_year_unified VIEW: UNION ALL legacy ∪ existing 2010+
   ▼
6. Silver mclean_clean (existing, modified):
   ├── Read from _unified
   ├── Apply deflation widget (IPCA → BRL 2013) if flag set
   ├── Apply paper filters (drop financials, AT > 200k, ΔAT ≤ 100%, winsorize)
   └── Filter bridge_status ∈ {'clean','na'} for headline panel
   ▼
7. Gold (existing, widened):
   ├── mclean_annual: cross-section OLS by fiscal_year
   ├── mclean_pooled: pooled OLS with sector dummies
   ├── mclean_descriptives: Tab. 1 stats (dual: nominal + deflated)
   └── mclean_extensions (new): Tobin Q + precautionary proxies
   ▼
8. Gold mclean_attrition (new): per-stage cell counts
   ▼
9. Export artifacts to UC Volume + GH Pages → App
```

---

## Integration Points

| External System | Integration Type | Authentication |
|-----------------|------------------|----------------|
| CVM Sistemas legacy portal (`sistemas.cvm.gov.br/port/ciasabertas/*`) | HTTPS ASP form GET / file download | None (anonymous, polite User-Agent) |
| CVMWIN binary layout spec page | One-time HTTPS GET (cached locally) | None |
| IPEA SGS API (IPCA series 1419) | One-time HTTPS GET (cached as `data/ipca_annual.csv`) | None (public dataset) |
| Existing CVM Dados Abertos pipeline | Reads `bronze.cvm_dfp_lines` (existing Delta table) | Unity Catalog grants |
| Existing `bronze.cvm_cad_cia` | Reads (existing Delta table, sector registry) | Unity Catalog grants |
| Existing `silver.mclean_firm_year` | Reads (existing Delta table) | Unity Catalog grants |
| GH Actions `refresh-pipelines.yml` | Triggers Databricks job after data refresh (existing pattern) | OIDC to Databricks |

---

## Testing Strategy

| Test Type | Scope | Files | Tools | Coverage Goal |
|-----------|-------|-------|-------|---------------|
| Unit (parser) | CVMWIN record parsing per statement type, v5 vs v9 dispatch | `tests/unit/test_cvmwin_parser.py` | pytest + fixture `.DFM`/`.DFL` files | Each record type produces expected fields; v5/v9 dispatch correct |
| Unit (bridge) | DOAR↔DFC classification clean/ambiguous/missing | `tests/unit/test_doar_dfc_bridge.py` | pytest + synthetic firm-year fixtures | AT-006, AT-007, AT-008 from DEFINE |
| Unit (account mapping) | CVM cd_conta → Economática label resolution | `tests/unit/test_account_mapping.py` | pytest + reference CSV fixture | All 10 McLean variables resolve for known firms |
| Integration (scraper resumability) | Kill mid-fetch, restart, verify zero re-fetches | `tests/integration/test_legacy_scraper_resumable.py` | pytest + mock HTTP server | AT-003, AT-004 from DEFINE |
| Integration (parser overlap) | 2010-2013 CVMWIN parse rows match Dados Abertos rows | `tests/integration/test_parser_overlap.py` | pytest + Databricks remote | Row-by-row match for 5 overlap firms |
| E2E (paper match) | SC-1 + SC-2 — coefficients within ±0.01, Tab. 1 stats within ±0.005 | `tests/integration/test_mclean_paper_match.py` | pytest + Databricks job + statsmodels | Binary PASS/FAIL gate for ship |
| E2E (schema superset) | SC-6 — 2010-2025 portion of `_unified` byte-identical to `mclean_firm_year` | `tests/integration/test_unified_view_superset.py` | pytest + Spark assertDataFrameEqual | 100% identity for overlap years |
| Manual (UI) | App window selector switches between three panels | Manual smoke test post-deploy | Browser | Happy path |

---

## Error Handling

| Error Type | Handling Strategy | Retry? |
|------------|-------------------|--------|
| HTTP 429 (rate-limited) | Exponential backoff via `tenacity`; mark checkpoint `failed_retryable` after 3 attempts | Yes (3x) |
| HTTP 503 (service unavailable) | Same as 429 | Yes (3x) |
| HTTP 404 (filing not found) | Mark `failed_terminal`; firm-year drops out of panel; counted in attrition | No |
| HTTP timeout (>60s) | Exponential backoff via `tenacity` | Yes (3x) |
| Network error (DNS, connection reset) | Exponential backoff | Yes (3x) |
| CVMWIN parser: unknown version magic | Raise `UnsupportedVersionError`; mark `failed_terminal`; log + investigate | No |
| CVMWIN parser: malformed record | Skip record, log warning, continue; aggregate report at end | No |
| Account mapping: unknown `cd_conta` | Map to NULL; firm-year row produced but variable missing; tracked in attrition | No |
| DOAR bridge: missing required line | `bridge_status='missing'`; firm-year drops from headline regression; counted in attrition | No |
| Spark: out-of-memory on large parse runner | Re-partition by `fiscal_year`; reduce parallelism | Manual |
| Delta MERGE conflict on checkpoint | Optimistic concurrency retry built into Delta; no app-level handling | Auto |

---

## Configuration

| Config Key | Type | Default | Description |
|------------|------|---------|-------------|
| `catalog` | string | `finance_prd` | Unity Catalog catalog name |
| `legacy_volume_dir` | string | `/Volumes/finance_prd/bronze/raw/cvm_legacy` | Where raw CVM legacy files land |
| `scrape_from_year` | int | `1995` | First fiscal year to scrape |
| `scrape_to_year` | int | `2009` | Last fiscal year to scrape (2010+ handled by existing pipeline) |
| `scrape_concurrency` | int | `3` | Parallel HTTP fetches |
| `scrape_jitter_min_s` | float | `1.0` | Min seconds between fetches per worker |
| `scrape_jitter_max_s` | float | `3.0` | Max seconds between fetches per worker |
| `scrape_max_retries` | int | `3` | Retries per fetch before marking `failed_retryable` |
| `deflate_to_brl_2013` | bool | `False` | Apply IPCA deflation to level variables (paper-match runs set to True) |
| `bridge_filter` | string | `clean_only` | Filter for headline regression: `clean_only` / `clean_and_ambiguous` / `all` |
| `min_obs_per_year_regression` | int | `20` | Years with fewer firms skipped (existing — unchanged) |

---

## Security Considerations

- **No PII.** All data is public corporate filings (`cd_cvm`, fiscal_year, account values, company name). No personal data anywhere in the pipeline.
- **Anonymous scraping.** No credentials transmitted. User-Agent identifies purpose (`applied-finance/mclean-replication`) for politeness; no auth tokens to leak.
- **No outbound exfiltration.** Pipeline reads from CVM/IPEA, writes to UC Volume (private), exports to GH Pages (public repo, public artifacts). No third-party endpoints.
- **No write-back to CVM.** Strictly read-only against external sources.
- **Unity Catalog grants** on new bronze/silver/gold tables follow existing pattern: `read` for app-deployment service principal, `read+write` for the bundle's `run_as` user only.

---

## Observability

| Aspect | Implementation |
|--------|----------------|
| **Logging** | Structured `logging` per existing notebook pattern (`%(asctime)s %(levelname)s %(name)s :: %(message)s`); INFO level for scraper progress (every 100 fetches), WARN for retryable failures, ERROR for terminal failures |
| **Metrics** | Existing `dbutils.jobs.taskValues.set()` pattern for cross-task metrics: `legacy_scrape_total_fetches`, `legacy_scrape_failures`, `legacy_parse_rows`, `bridge_clean_pct`, `paper_match_coefficient_delta` |
| **Tracing** | None — single-process Spark notebooks; existing pipeline doesn't use distributed tracing |
| **Attrition table** | `gold.mclean_attrition` provides per-stage cell counts queryable via SQL; powers the app's "X firm-years dropped due to Y" transparency block |
| **Alerts** | Existing pattern: GH Actions workflow fails if any notebook errors. Add specific check: if `bridge_clean_pct < 0.80` on PoC, fail the workflow with a pointed message about Decision 5 escalation |

---

## Pipeline Architecture

### DAG Diagram

```text
[CVM Sistemas]──HTTPS──→ [cvm_legacy_dfp.py]──Volume──→ [cvm_legacy_parse_runner.py]
                              ↓                                        ↓
                  bronze.cvm_legacy_scrape_checkpoint        bronze.cvm_legacy_dfp_lines
                                                                       │
                                                                       ▼
[CVM Dados Abertos]──existing pipeline──→ bronze.cvm_dfp_lines        │
                                                  │                    │
                                                  ▼                    ▼
                              silver.mclean_firm_year      silver.mclean_firm_year_legacy
                                                  │                    │
                                                  └────────┬───────────┘
                                                           ▼
                                          silver.mclean_firm_year_unified (VIEW)
                                                           │
                                                           ▼
                                                  silver.mclean_clean
                                                           │
                  ┌────────────────────────────────────────┼───────────────────────────────┐
                  ▼                ▼                       ▼                ▼                ▼
        gold.mclean_annual  gold.mclean_pooled  gold.mclean_descriptives  gold.mclean_extensions  gold.mclean_attrition
                  │                │                       │                │                │
                  └────────────────┴───────┬───────────────┴────────────────┴────────────────┘
                                           ▼
                                  export/mclean_artifacts.py
                                           ▼
                                  app/app/mclean/page.tsx
```

### Partition Strategy

| Table | Partition Key | Granularity | Rationale |
|-------|---------------|-------------|-----------|
| `bronze.cvm_legacy_dfp_lines` | `(fiscal_year, statement)` | Annual × 5 stmts | Matches existing `bronze.cvm_dfp_lines` pattern; statement-scoped queries common |
| `bronze.cvm_legacy_scrape_checkpoint` | None (small table, <50k rows) | N/A | Small enough to scan; partitioning would hurt MERGE perf |
| `silver.mclean_firm_year_legacy` | `fiscal_year` | Annual | Matches existing `silver.mclean_firm_year` |
| `silver.mclean_firm_year_unified` | N/A (VIEW) | N/A | Not materialized |
| `gold.mclean_attrition` | `pipeline_stage` | 5 stages | Stage-scoped queries common for app display |

### Incremental Strategy

| Model | Strategy | Key Column | Lookback |
|-------|----------|------------|----------|
| `bronze.cvm_legacy_scrape_checkpoint` | `incremental_by_pk` | `(cd_cvm, fiscal_year, statement)` | N/A — one-time scrape |
| `bronze.cvm_legacy_dfp_lines` | `incremental_by_pk` (MERGE) | `(cd_cvm, fiscal_year, statement, cd_conta, ordem_exerc)` | N/A — one-time backfill |
| `silver.mclean_firm_year_legacy` | `full_refresh` | N/A | Always rebuild — small (<50k rows), avoids MERGE complexity |
| `silver.mclean_firm_year_unified` | `view` (no materialization) | N/A | View is always current |
| `gold.mclean_*` | `full_refresh` | N/A | Existing pattern, unchanged |

### Schema Evolution Plan

| Change Type | Handling | Rollback |
|-------------|----------|----------|
| New columns on `silver.mclean_firm_year_legacy` (`source_system`, `accounting_standard`, `bridge_status`) | Added as part of initial DDL; not breaking | Drop column |
| New columns on `silver.mclean_firm_year_unified` (same three) | Defined in VIEW DDL; redeploys atomically | Revert VIEW |
| New widget on `silver.mclean_clean` (`deflate_to_brl_2013`) | Default False preserves backward compat | Remove widget |
| Widened `WINDOWS` in `gold.mclean_*` | Default `("full": (1995,2025))` is additive | Revert constant |
| Existing columns on `silver.mclean_firm_year` | UNCHANGED — strict-superset invariant enforces no breaking change | N/A |

### Data Quality Gates

| Gate | Tool | Threshold | Action on Failure |
|------|------|-----------|-------------------|
| Schema-superset invariant (SC-6) | Custom assertion in `tests/integration/test_unified_view_superset.py` | 100% row + column identity on 2010-2025 overlap | Block pipeline |
| PoC firm coverage (A-001) | `scripts/poc_report.py` | ≥9/10 firms fetchable | Block Phase 1; investigate CVM portal status |
| PoC parser correctness (A-002) | `scripts/poc_report.py` | ≥80% non-NULL on expected cd_conta codes | Block Phase 1; revise parser per Decision 4 |
| PoC bridge clean rate (A-004) | `scripts/poc_report.py` | ≥9/10 firm-years clean | Block Phase 1 OR escalate Decision 5 (per-firm override curation) |
| Paper-match coefficients (SC-1) | `tests/integration/test_mclean_paper_match.py` | β_ΔIssue/ΔDebt/CashFlow each within ±0.01 of paper | Block ship; debug in Phase 6 buffer |
| Paper-match Tab. 1 stats (SC-2) | Same test | All 32 stats within ±0.005 of paper | Block ship |
| Firm-year panel size (SC-3) | Same test | ≥5,500 firm-years on 1995-2013 | Block ship; investigate attrition |
| Unique firms (SC-4) | Same test | ≥550 firms on 1995-2013 | Block ship |
| Scraper resumability (SC-5) | `tests/integration/test_legacy_scraper_resumable.py` | Zero re-fetches, zero data loss on kill+restart | Block ship |
| Existing 2010+ no-regression (SC-9) | Pre/post snapshot diff on `gold.mclean_descriptives` | Byte-identical for 2010-2025 portion | Block ship |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-05-25 | design-agent (Claude Code) | Initial version from DEFINE_MCLEAN_PRE2010.md |
| 1.1 | 2026-05-25 | iterate (post-public-info-recovery) | Decision 4 revised: parser pivots from custom `struct.unpack` to `dbfread` after discovery that pre-2010 files are Clipper/dBase databases. Code Pattern 2 rewritten. Effort estimate dropped 9-11w → ~7-9w. See `BUILD_REPORT_MCLEAN_PRE2010.md` § Public-Info Recovery for evidence trail. |

---

## Next Step

**Ready for:** `/agentspec:workflow:build .claude/sdd/features/DESIGN_MCLEAN_PRE2010.md`

The Build phase should start with **Phase 0 (PoC, Week 1)** before committing to the full implementation. The PoC has a binary GO/NO-GO gate against assumptions A-001 through A-004; only on PASS does Phase 1 (full scraper) begin.

Suggested first build command:
```bash
/agentspec:workflow:build .claude/sdd/features/DESIGN_MCLEAN_PRE2010.md --phase=0
```

(If `/build` doesn't support phase scoping, run Phase 0 as a self-contained PoC commit and gate manually before resuming.)
