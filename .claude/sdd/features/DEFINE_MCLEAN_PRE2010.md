# DEFINE: McLean's Model — Pre-2010 Fundamentals Backfill

> Extend the existing McLean (2011) replication panel from 2010-2025 back to 1995, by scraping CVM Sistemas legacy filings, so the author's 2015 RBFin paper can be reproduced inside the platform — with paper-published Tab. 1 + Fig. 1 coefficients matching to 2 decimals.

## Metadata

| Attribute | Value |
|-----------|-------|
| **Feature** | MCLEAN_PRE2010 |
| **Date** | 2026-05-25 |
| **Author** | Leonardo Chalhoub + Claude Code via agentspec:workflow:define |
| **Status** | Ready for Design |
| **Clarity Score** | 15/15 |
| **Source** | `.claude/sdd/features/BRAINSTORM_MCLEAN_PRE2010.md` (Phase 0 dialogue complete) |

---

## Problem Statement

The current McLean pipeline only covers fiscal years **2010-2025** because its data source — CVM Dados Abertos — begins at the 2010 IFRS transition. The user's published 2015 RBFin paper (Chalhoub-Kirch-Terra) covered **1995-2013** using Economática, a paid aggregator that pre-mapped pre-IFRS BR GAAP filings into a clean schema. Without pre-2010 fundamentals, the in-house platform cannot reproduce the user's own published research, and the panel loses the macro-regime variation (Real Plan, 1999 float, 2002 election shock, 2008 GFC) that was central to the original paper's precautionary-savings interpretation. Economática is paid and out of budget; the only free public path is CVM Sistemas' legacy ASP-form portal at `sistemas.cvm.gov.br/port/ciasabertas/*`.

---

## Target Users

| User | Role | Pain Point |
|------|------|------------|
| Leonardo Chalhoub (primary) | Author of the 2015 RBFin paper being replicated | Cannot reproduce his own published Tab. 1 + Fig. 1 inside the platform; replication is incomplete without pre-2010 data |
| Future readers of the McLean app page | Finance practitioners / students exploring corporate cash-savings behavior | Can only see 2010-2025 cross-section coefficients; misses the multi-regime story the original paper tells |
| Academic-replication maintainers | Anyone running the pipeline 6-12 months from now | No public source-of-truth for pre-2010 Brazilian listed-firm fundamentals; without this workstream, the gap re-opens every time a co-author asks "can you show 1995?" |

---

## Goals

| Priority | Goal |
|----------|------|
| **MUST** | Reproduce 2015 paper Tab. 1 statistics (Cash, ΔCash, ΔIssue, ΔDebt, CashFlow, Other, Assets, Dividends means + medians) to **2 decimals** on a 1995-2013 panel filtered to match the paper's 614 firms |
| **MUST** | Reproduce 2015 paper Fig. 1 main-regression coefficients (β_ΔIssue ≈ 0.087, β_ΔDebt ≈ 0.095, β_CashFlow ≈ 0.083) to **2 decimals**, with t-statistic significance at 1% |
| **MUST** | Land all 1995-2009 raw filings in the bronze lakehouse layer once, byte-for-byte, and never re-fetch them; the scraper must be resumable across failures |
| **MUST** | Merge legacy 1995-2009 panel into existing 2010-2025 silver via a unified view `silver.mclean_firm_year_unified` that is a strict superset (rows + columns) of `silver.mclean_firm_year` |
| **MUST** | Ship all paper extensions in MVP: Tobin's Q + Q-interactions, CF Vol., CF Vol. Median, Cash Flow Risk, Prec precautionary-savings proxies |
| **MUST** | Report coverage attrition per stage: `(cd_cvm × year)` rows fetched → parsed → mapped → in-regression, so dropped-firm-year counts are transparent and auditable |
| **SHOULD** | Add a window-selector to the McLean app page: `1995-2013 (paper)` / `1995-2025 (extended)` / `2010-2025 (CPC-only, current)` |
| **SHOULD** | Document the CVM-raw → Economática-clean mapping layer in `docs/METHODOLOGY.md` § McLean so future maintainers understand the two-stage normalization |
| **COULD** | Per-firm DOAR override file `data/mclean_doar_bridge.csv` for firms where the dictionary-based DOAR↔DFC bridge fails |
| **COULD** | Side-by-side panel comparison view: paper's 1995-2013 coefficients vs our re-derived 1995-2013 coefficients, with a "delta" column flagging firms or accounts where we diverge |

---

## Success Criteria

Measurable acceptance gates — all must be true before this feature is "shipped":

- [ ] **SC-1 (coefficient match):** Pooled OLS on 1995-2013 panel produces β_ΔIssue ∈ [0.077, 0.097], β_ΔDebt ∈ [0.085, 0.105], β_CashFlow ∈ [0.073, 0.093] (±0.01 around paper values), all significant at 1%
- [ ] **SC-2 (Tab. 1 match):** Panel descriptive stats for all 8 McLean variables match paper Tab. 1 means and medians to ±0.005 in absolute terms
- [ ] **SC-3 (panel size):** Final regression panel contains ≥ **5,500 firm-year observations** on the 1995-2013 window (paper had 5,952; some attrition acceptable due to delisted-firm filing gaps)
- [ ] **SC-4 (firm count):** Final regression panel contains ≥ **550 unique firms** on the 1995-2013 window (paper had 614)
- [ ] **SC-5 (resumability):** Killing the scraper at any wall-clock point and restarting it produces **zero re-fetches** of cached pages and **zero data loss**; verified by integration test
- [ ] **SC-6 (schema superset):** `silver.mclean_firm_year_unified` contains every row and every column of `silver.mclean_firm_year`, byte-identical for the 2010-2025 overlap
- [ ] **SC-7 (attrition transparency):** A `gold.mclean_attrition` table reports counts of (cd_cvm × fiscal_year) cells at each stage: fetched, parsed, account-mapped, filter-passed, in-regression
- [ ] **SC-8 (extension parity):** Tobin's Q, CF Vol., CF Vol. Median, Cash Flow Risk, Prec proxies all computed and exposed via `gold.mclean_descriptives` for 1995-2025
- [ ] **SC-9 (no regression):** Existing 2010-2025 `gold.mclean_*` outputs are unchanged byte-for-byte after the unified view replaces the per-source silver table

---

## Acceptance Tests

| ID | Scenario | Given | When | Then |
|----|----------|-------|------|------|
| AT-001 | Paper-headline coefficient match | The new 1995-2009 silver is populated and unified with existing 2010-2013 silver | Run pooled OLS on the 1995-2013 panel with paper filters (drop financials, AT < 200k, asset growth > 100%, winsorize 1%/CashFlow 2.5%-left/1%-right, IPCA-deflate to 2013 BRL) | β_ΔIssue, β_ΔDebt, β_CashFlow are within ±0.01 of paper-published values, t-stats significant at 1% |
| AT-002 | Tab. 1 descriptive stats match | Same as AT-001 | Compute mean, median, p25, p75 for Cash, ΔCash, ΔIssue, ΔDebt, CashFlow, Other, Assets, Dividends | All 32 statistics (8 vars × 4 stats) within ±0.005 of paper Tab. 1 |
| AT-003 | Resumable scraper — happy path | Scraper started fresh, has fetched first 100 firms' BPA filings | Kill the process; restart from same command | Restart consumes the `(cd_cvm, year, statement) → fetched_at` checkpoint table and resumes at firm 101 with zero re-fetches of firms 1-100 |
| AT-004 | Resumable scraper — partial firm-year | Scraper crashed mid-fetch of firm X year Y, leaving a partial file in bronze | Restart from same command | Partial file is detected as incomplete (size mismatch or missing footer) and re-fetched; subsequent firm-years are not re-fetched |
| AT-005 | Schema-superset invariant | `silver.mclean_firm_year_unified` exists | Query 2010-2025 rows from unified view vs 2010-2025 rows from original silver | Result sets are byte-identical (row count, column count, every cell value) |
| AT-006 | DOAR↔DFC bridge — clean firm | Firm filed DOAR pre-2008 with line item matching "Venda/Baixa Bens Permane" | Run silver parsing pipeline | `silver.mclean_firm_year_unified.venda_imobilizado` is populated with the BRL value, `bridge_status = 'clean'` |
| AT-007 | DOAR↔DFC bridge — ambiguous firm | Firm filed DOAR pre-2008 but split D&A across 3 different DOAR lines | Run silver parsing pipeline | `deprec_amort` is summed across matching lines, `bridge_status = 'ambiguous'`; firm is **excluded** from headline regression panel but **included** in `gold.mclean_attrition` reporting |
| AT-008 | DOAR↔DFC bridge — missing firm | Firm filed BPA + BPP + DRE but no DOAR for fiscal year 1998 | Run silver parsing pipeline | `deprec_amort`, `venda_imobilizado`, `dividendos_pagos` are NULL, `bridge_status = 'missing'`; firm-year excluded from headline regression, counted in attrition |
| AT-009 | Survivorship — delisted firm | Firm Aracruz Celulose (`cd_cvm=4030`) delisted in 2009 after Suzano merger | Query 1995-2009 panel | Firm appears in regression panel with all firm-years where filings exist; no special handling required beyond Cadastro historical-sector resolution |
| AT-010 | Survivorship — unknown ticker | `cd_cvm` from CVM filings has no entry in `data/ticker_universe.csv` (e.g., delisted before 2010) | Run silver pipeline | Firm-year is **included** in panel via `cd_cvm` keying (no ticker required); sector resolved from `bronze.cvm_cad_cia` historical snapshot |
| AT-011 | Inflation deflation | Firm Y's 1995 Total Assets = R$ 1,000,000 nominal; IPCA cumulative 1995→2013 = 4.2x | Run silver pipeline with `deflate_to_brl_2013=True` | Stored Total Assets = R$ 4,200,000 (BRL 2013) |
| AT-012 | Tobin's Q computation | Firm Z 2000-fiscal-year has AT=100M, MarketCap=80M, PL=60M | Run gold extension pipeline | `Q_tobin` = (100 + 80 − 60) / 100 = 1.20 |
| AT-013 | Constrained/unconstrained classification | Sector "Bens Industriais" in 2002 has 14 firms with ranked AT | Run sample classification | Bottom 4 firms (AT-ranked) flagged constrained, top 4 unconstrained, middle 6 unclassified; cell-size ≥ 5 so included in Fig. 1 sub-panel |
| AT-014 | App window selector | User opens McLean page, clicks `1995-2013 (paper)` chip | Trigger window switch | Page re-renders Fig. 1 with 1995-2013 panel only, shows paper-target coefficient overlay |
| AT-015 | No-regression on existing 2010+ outputs | Pre-feature `gold.mclean_descriptives` snapshot taken | Run new pipeline end-to-end | Post-feature snapshot byte-identical to pre-feature snapshot for the 2010-2025 portion |

---

## Out of Scope

Explicitly NOT included in this feature:

- **Quarterly (ITR) filings.** McLean is annual; 4× scrape volume for no model value.
- **Pre-1995 data.** Paper window starts at 1995.
- **BDR / foreign-issuer fundamentals.** McLean is Brazilian non-financial only.
- **Macro variable backfill (CDI, GDP).** Handled by separate `bcb_*` ingest path. IPCA is in scope only as the deflation series.
- **Re-acquiring Economática.** Paid, out of budget.
- **CVM Download Múltiplo credentials.** User confirmed unable to obtain; ASP-form scraping is the only access path.
- **Refactoring the existing 2010-2025 pipeline.** It works; we only add a parallel legacy path.
- **Index-methodology backfills (IBOV pre-2003).** Affects benchmark not panel.

---

## Constraints

| Type | Constraint | Impact |
|------|------------|--------|
| **Data source** | CVM Sistemas ASP-form portal (`sistemas.cvm.gov.br/port/ciasabertas/*`) is the only access path | Forces ASP scraping, no bulk API, ~37k individual fetches with rate limits + retry logic |
| **Validation source** | No Economática raw export, no original Stata code — only published Tab. 1 + Fig. 1 in PDF/txt | Aggregate-stat validation only; row-by-row firm-level validation impossible |
| **Accounting standard transition** | 1995-2009 used BR GAAP (chart of accounts X), 2010+ used CPC IFRS (chart of accounts Y) | Must build CVM-raw → Economática-clean mapper, plus DOAR↔DFC bridge for 1995-2007 cash-flow variables |
| **Survivorship** | Many of the 614 firms (Aracruz, Sadia, Telemar, AmBev-old) delisted before 2010 and have no current B3 ticker | Build firm-universe keyed by `cd_cvm` not ticker; resolve historical sector from `cvm_cad_cia` snapshots |
| **Technical** | Must merge into existing schema (`silver.mclean_firm_year` columns) without breaking 2010-2025 pipeline | Forces strict-superset constraint on `silver.mclean_firm_year_unified` |
| **Resource** | No paid data, no additional infrastructure budget | Reuses existing Databricks Free + UC Volume + Delta + GH Actions stack |
| **Timeline** | 9-11 weeks total effort (estimated) | Phased delivery: scraper (2-3w) → parser+bridge (3-4w) → extensions (1-2w) → validation+debug (2w) |
| **Endpoint stability** | CVM Sistemas legacy portal officially deprecated since 2022-02-01; could sunset mid-workstream | Cache all fetched bytes on first hit; never re-fetch what bronze has |

---

## Technical Context

| Aspect | Value | Notes |
|--------|-------|-------|
| **Deployment Location** | `pipelines/notebooks/ingest/cvm_legacy_dfp.py`, `pipelines/notebooks/silver/cvm_legacy_dfp_lines.py`, `pipelines/notebooks/silver/cvm_legacy_firm_year.py`, plus widening of existing `pipelines/notebooks/gold/mclean_*.py` | Mirrors existing CVM-Dados-Abertos pipeline layout. App changes go in `app/app/mclean/page.tsx`. |
| **KB Domains** | `lakehouse`, `medallion`, `lakeflow`, `spark`, `python` (web scraping, binary file parsing), `data-quality` | Design phase pulls scraper-resumability patterns from `kb/python/`, Delta MERGE patterns from `kb/lakehouse/`. |
| **IaC Impact** | New UC Volume bronze landing area (`/Volumes/finance_prd/bronze/raw/cvm_legacy/`); new bronze Delta table (`bronze.cvm_legacy_dfp_lines`); new silver Delta table (`silver.mclean_firm_year_legacy`); new silver view (`silver.mclean_firm_year_unified`); new gold table (`gold.mclean_attrition`); widened `WINDOWS` config in existing gold notebooks. | All resources managed via existing Databricks Asset Bundle (`pipelines/databricks.yml`); no new bundles. |

---

## Data Contract

### Source Inventory

| Source | Type | Volume | Freshness | Owner |
|--------|------|--------|-----------|-------|
| CVM Sistemas ASP forms (`sistemas.cvm.gov.br/port/ciasabertas/*`) | HTML form-based portal + CVMWIN binary file downloads | ~614 firms × 15 years × 4-5 statements = ~37,000-46,000 unique filings, ~10-50 KB each | Static (filings don't change once published; refresh only for backfill gaps) | CVM Brazil (officially deprecated since 2022-02-01) |
| CVMWIN binary layout specs | Public HTTP page (text) | ~1 file | Static | CVM Brazil |
| IPCA annual deflator | IPEA SGS series | 1 series × 31 years | Annual | IPEA / IBGE |
| Existing CVM Dados Abertos (2010-2025) | Same schema, current production pipeline | Unchanged | Daily refresh | Existing pipeline |

### Schema Contract (`silver.mclean_firm_year_unified`)

Strict superset of existing `silver.mclean_firm_year`. New columns appended for source provenance and bridge diagnostics:

| Column | Type | Constraints | PII? |
|--------|------|-------------|------|
| `cd_cvm` | INT | NOT NULL, joins to `bronze.cvm_cad_cia` | No |
| `fiscal_year` | INT | NOT NULL, 1995 ≤ fy ≤ 2025 | No |
| `ativo_total` | DOUBLE | NULLABLE, in nominal BRL (deflation applied downstream) | No |
| `cash` | DOUBLE | NULLABLE | No |
| `debt_cp` | DOUBLE | NULLABLE | No |
| `debt_lp` | DOUBLE | NULLABLE | No |
| `patrimonio_liquido` | DOUBLE | NULLABLE | No |
| `reserva_lucros` | DOUBLE | NULLABLE | No |
| `lucros_acumulados` | DOUBLE | NULLABLE | No |
| `lucro_liquido` | DOUBLE | NULLABLE | No |
| `deprec_amort` | DOUBLE | NULLABLE | No |
| `venda_imobilizado` | DOUBLE | NULLABLE | No |
| `dividendos_pagos` | DOUBLE | NULLABLE | No |
| `sector` | STRING | NULLABLE, from historical `cvm_cad_cia` snapshot | No |
| `denom_cia` | STRING | NULLABLE | No |
| `source_system` | STRING | NOT NULL, ∈ {'cvm_legacy', 'cvm_dados_abertos'} **(new)** | No |
| `accounting_standard` | STRING | NOT NULL, ∈ {'BR_GAAP', 'CPC_IFRS'} **(new)** | No |
| `bridge_status` | STRING | NOT NULL, ∈ {'clean', 'ambiguous', 'missing', 'na'} (na for 2008+) **(new)** | No |

### Freshness SLAs

| Layer | Target | Measurement |
|-------|--------|-------------|
| Bronze (`bronze.cvm_legacy_dfp_lines`) | One-time backfill; no daily refresh required (CVM legacy data is frozen) | Successful one-time scrape pass |
| Silver (`silver.mclean_firm_year_unified`) | Refresh whenever bronze or `silver.mclean_firm_year` updates | Delta table version comparison |
| Gold | Refresh on schedule of existing daily pipeline | DAG completion time |

### Completeness Metrics

- ≥ 90% of cd_cvm × fiscal_year cells in the 614-firm × 15-year matrix have at least one statement fetched
- ≥ 80% of fetched cells have all required statements (BPA + BPP + DRE + DOAR/DFC) parseable
- ≥ 70% of fetched cells survive the McLean filter pipeline (sector / size / growth / completeness)
- Final regression panel ≥ 5,500 firm-years (SC-3)

### Lineage Requirements

- Column-level lineage from CVM raw `cd_conta` codes → Economática-clean labels → McLean variables, documented in `docs/METHODOLOGY.md` § McLean + machine-readable in `silver.mclean_account_mapping` reference table
- Impact analysis before any schema change to `silver.mclean_firm_year_unified` (it's now a contract consumed by all gold notebooks + the app)
- `bridge_status` flag carries forward to gold so the app can show "X firm-years excluded due to ambiguous DOAR mapping" if useful

---

## Assumptions

| ID | Assumption | If Wrong, Impact | Validated? |
|----|------------|------------------|------------|
| A-001 | CVM Sistemas ASP forms at `sistemas.cvm.gov.br/port/ciasabertas/*` remain accessible throughout the 9-11 week workstream | If sunset mid-workstream, must pivot to manual archive retrieval; could lose access to ~10-30% of firms not yet scraped | [ ] |
| A-002 | The public CVMWIN binary layout specs at `Leiaute_de_Formularios_do_EmpresasNET.asp` are accurate and complete | Parser will silently produce wrong values; would surface in SC-1/SC-2 coefficient mismatch but waste 1-2 weeks of debug | [ ] |
| A-003 | At least 550 of the 614 paper-sample firms have CVM filings recoverable from CVM Sistemas (delisted firms may have closed historical files) | If <550 firms recoverable, SC-4 fails; would need to drop firms from validation target and renegotiate the "paper-faithful" claim | [ ] |
| A-004 | The DOAR↔DFC bridge documented in the dissertation §Variables is sufficient for ≥90% of firms (only 10% need per-firm overrides) | If <90% clean, MVP slips into the per-firm override curation work (the COULD goal becomes a MUST), adding 2-3 weeks | [ ] |
| A-005 | Tab. 1 stats and Fig. 1 coefficients in the published 2015 paper are the authoritative target; no errata or corrections published since | Validation against wrong target; would surface when comparing against a wider literature, but accept as-is for now | [ ] |
| A-006 | IPCA annual deflator from IPEA SGS for 1995-2013 is identical (within rounding) to whatever Economática applied in the original paper | If divergent, scale of level variables differs; coefficient ratios should still match but Tab. 1 absolute means may drift | [ ] |
| A-007 | `bronze.cvm_cad_cia` either covers delisted firms or can be extended from a CVM legacy endpoint to do so | If neither, sector classification fails for ~150 delisted firms; would need manual sector curation in `data/mclean_firm_universe.csv` | [ ] |
| A-008 | Wall-clock rate limit for ASP scraping allows completing all ~37k fetches within ~3 days at safe concurrency (2-3 parallel + 1-3s jitter) | If rate-limited harder, scraper takes 1-2 weeks of wall-clock; still completes but extends Phase 1 of timeline | [ ] |

**Note:** A-001, A-002, A-003, A-004 are the load-bearing assumptions. Validate via a 10-firm × 3-year proof-of-concept scrape + parse before committing to full implementation.

---

## Clarity Score Breakdown

| Element | Score (0-3) | Notes |
|---------|-------------|-------|
| Problem | 3 | Specific pain point (cannot replicate published paper), specific user (paper's author), specific blocker (paid data) |
| Users | 3 | Primary user + downstream readers + future maintainers all enumerated with pain points |
| Goals | 3 | MUST/SHOULD/COULD prioritized; 6 MUST goals all measurable |
| Success | 3 | 9 success criteria with explicit thresholds (coefficient bands, panel sizes, byte-identity invariants) |
| Scope | 3 | Out-of-scope list explicit; YAGNI from brainstorm carried over; CVM Download Múltiplo path explicitly excluded |
| **Total** | **15/15** | Maximum clarity — brainstorm dialogue exhausted all open questions before this phase |

---

## Open Questions

These are non-blocking for Design phase but should be answered during it:

1. **ASP-form URL patterns per statement type** — spider `sistemas.cvm.gov.br/port/ciasabertas` to map exact endpoints; resolve in Design phase by reading the existing manual-search forms and capturing the network requests.
2. **Cadastro snapshot selection for historical sector** — pin sector at first observation, or use year-specific Cadastro snapshot? Either is defensible; Design phase should pick one and document. Recommend: first-observation sector to match the paper's apparent practice.
3. **Bronze table architecture** — separate `bronze.cvm_legacy_dfp_lines` (per-source provenance) vs unified `bronze.cvm_dfp_lines_all` (single table). Design phase decides. Recommend: separate bronze, unified silver.
4. **App window-selector UX** — chip-control vs dropdown for the three window options (1995-2013 / 1995-2025 / 2010-2025). UX detail.
5. **DOAR account-name normalization** — trim/uppercase Portuguese labels for stable matching; existing `silver/mclean_firm_year.py` has prior art.
6. **`cvm_cad_cia` pre-2010 coverage** — A-007 needs validation in Design phase via a sample query.
7. **Proof-of-concept scope** — 10 firms × 3 years to validate A-001 to A-004 before full implementation; Design phase should define the PoC firm list (mix of survivors + delisted).

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-05-25 | define-agent (Claude Code) | Initial version extracted from `BRAINSTORM_MCLEAN_PRE2010.md` |

---

## Next Step

**Ready for:** `/agentspec:workflow:design .claude/sdd/features/DEFINE_MCLEAN_PRE2010.md`

Design phase should produce:
- Concrete ASP-form scraping endpoints + request templates
- Resumable-scraper state machine (checkpoint schema, retry logic, partial-file detection)
- CVMWIN binary parser pseudocode with field-level layout map
- Bronze/silver/gold Delta table DDLs
- DOAR↔DFC bridge decision tree (clean/ambiguous/missing classification)
- App window-selector component spec
- Proof-of-concept plan (10 firms × 3 years) to validate load-bearing assumptions before full build
