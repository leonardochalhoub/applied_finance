# BRAINSTORM: McLean's Model — Pre-2010 Fundamentals Backfill

> Phase 0 exploration concluded. Selected: full **1995-2009 extension** of the McLean panel via CVM Sistemas ASP-form scraping, joining the existing 2010-2025 pipeline. MVP includes all paper extensions (Tobin's Q, precautionary-savings proxies). Validation target: reproduce 2015 paper Tab. 1 + Fig. 1 coefficients to 2 decimals.

## Metadata

| Attribute | Value |
|-----------|-------|
| **Feature** | MCLEAN_PRE2010 |
| **Date** | 2026-05-24 |
| **Author** | User (Leonardo Chalhoub) + Claude Code via agentspec:workflow:brainstorm |
| **Status** | ✅ Ready for `/agentspec:workflow:define` |
| **Depends on** | Existing McLean pipeline at `pipelines/notebooks/{ingest,silver,gold}/mclean_*.py` and `pipelines/notebooks/ingest/cvm_dfp.py` (2010-2025 path stays as-is) |
| **Related memory** | `mcleans_model_spec.md` (variable formulas + sample filters), `user_background.md` (author of original 2015 RBFin paper) |
| **Source archive** | `.claude/sdd/archive/000969628.pdf` (dissertation), `.claude/sdd/archive/admin,+rbfin2015_3_4.pdf` (article) — both with `.txt` extractions |

---

## Initial Idea

**Raw Input (from user):**

> Today the McLean pipeline only covers 2010-2025 because CVM Dados Abertos starts in 2010. My 2015 RBFin paper used Economática and covered 1995-2013. I want pre-2010 Brazilian listed-company fundamentals so the replication panel can be extended back to 1995 without breaking the existing 2010+ pipeline.

**Why this matters:**

1. **Personal/portfolio significance** — replicating the user's own published research inside his own analytics platform. First pass must be *exact*: same window, same filters, same coefficients as the 2015 paper (per `mcleans_model_spec.md` § Why).
2. **Statistical power** — the original paper has **614 firms** and 5,952 firm-years; our current 2010-2025 re-implementation has a smaller balanced subset. Extending back to 1995 roughly doubles the panel and unlocks the **original-window comparison**.
3. **Macro regime variation** — a 1995-onwards panel captures Real Plan, 1999 currency float, 2002 election shock, 2008 GFC, 2014-2016 recession. Sharpens the precautionary-savings interpretation of β.

---

## Hard Constraint: The 2010 Cutoff Is Structural

Why 2010 isn't an arbitrary cutoff, and what changes pre-2010:

| Dimension | 2010+ (current pipeline) | Pre-2010 (this scope) |
|---|---|---|
| **Accounting standard** | CPC / IFRS (mandatory from FY2010 for B3-listed) | BR GAAP (Lei 6.404/76, pre Lei 11.638/07 + 11.941/09 transition) |
| **Chart of accounts** | CPC codes (`1`, `2.03`, `6.01.01`, etc.) | BACEN/CVM legacy chart — different codes, different aggregations |
| **Statement names** | BPA / BPP / DRE / DFC (DFC mandatory) | BP-ATIVO / BP-PASSIVO / DRE / **DOAR** (DFC was optional until 2008) |
| **CVM source** | Dados Abertos (`dados.cvm.gov.br`) — annual zips of clean CSVs | CVMWIN (1996-2009) + Empresas.NET (2009→) — proprietary binary `.DFM/.DFL/.ITM/.ITL/.IAN` files |
| **Public bulk download** | Free, no auth, weekly-refreshed zips | **No bulk endpoint accessible** (Download Múltiplo requires CVM credentials we don't have) |
| **"Other" account** | Line `6.02.06 — Venda/Baixa de Bens Permanentes` in DFC | DOAR's "Venda de Ativo Permanente" — different statement, different aggregation, **needs DOAR↔DFC bridge** |

**Implication:** this isn't "set `from_year=1995` in `cvm_dfp.py`". It's a **second parallel ingest path** with its own source system, parser, and account-mapping layer that **merges** into the existing silver table via the shared target schema (`ativo_total`, `cash`, `debt_cp`, `debt_lp`, `patrimonio_liquido`, `reserva_lucros`, `lucros_acumulados`, `lucro_liquido`, `deprec_amort`, `venda_imobilizado`, `dividendos_pagos`).

---

## Discovery Questions & Answers (Brainstorm Dialogue)

| # | Question | User's answer | Impact |
|---|----------|---------------|--------|
| 1 | **How far back?** 2006 / 1995 / no extension | **1995** | Approach B locked: full original-paper window. Forces multi-system scope (CVMWIN binary + DOAR↔DFC bridge). |
| 2 | **CVM Download Múltiplo credentials?** Have / can register / can't / unsure | **Don't think I can get them** | Falls back to ASP-form scraping at `sistemas.cvm.gov.br/port/ciasabertas/*` for the **entire** 1995-2009 window. ~37k fetches. No regulatory dependency, but rate-limited and fragile. |
| 3 | **Firm count.** | **614 firms** (per Chalhoub 2015 dissertation, corrected from initial 150 estimate) | Sample size larger than my initial sizing. Most cost is in the scraper + parser (one-time); fetch wall-clock scales linearly with firm-count. |
| 4 | **Economática account dictionary** | **Recoverable from dissertation** — full variable→account mapping confirmed in §Variables of `000969628.txt`. See dictionary table below. | Mapping work collapses from "weeks" to "days" for the Economática→McLean half. Still need CVM-raw→Economática-clean layer. |
| 5 | **Validation bar** | **Match published Tab. 1 + Fig. 1 to 2 decimals** | Strictest possible without re-acquiring Economática. Budget 1 week of debugging if first pass doesn't match. |
| 6 | **Other sample assets** (Economática raw, original Stata) | **Neither — only dissertation + article PDFs** | No row-by-row validation possible. Only aggregate-stat (Tab.1) + coefficient (Fig.1) match. Higher risk of mapping drift. |
| 7 | **MVP scope** — headline only / Tobin Q in / all extensions / Tab.1 only | **All extensions in MVP — ship complete or not at all** | Tobin Q, Q-interactions, CF Vol., CF Vol. Median, Cash Flow Risk, Prec all in scope. Effort back to 9-11 weeks. |

---

## Economática Account Dictionary (Extracted From Dissertation §Variables)

This is the bridge from the 2015 paper's Economática variable names to what we need to extract from CVM raw filings.

| McLean variable | 1995-2009 era (BR GAAP) | 2010-2013 era (IFRS transition) | Source statement |
|---|---|---|---|
| **Cash** (level) | "Disponivel e Inv CP" / AT_t | "Caixa e equival caixa" / AT_t | BPA |
| **ΔCash** | Δ"Disponivel e Inv CP" / AT_{t-1} | Δ"Caixa e equival caixa" / AT_{t-1} | BPA |
| **ΔIssue** | [(PL_t − PL_{t-1}) − ((Reserva Lucros + Lucros Acumulados)_t − (...)_{t-1})] / AT_{t-1} | same | BPP |
| **ΔDebt** | Δ("Total empres e financ CP" + "Total empres e financ LP") / AT_{t-1} | same | BPP |
| **ΔDebtCP / ΔDebtLP** | "Total empres e financ CP" / "Total empres e financ LP" split | same | BPP |
| **CashFlow** | (Lucro Líquido + "Deprec, amort e exaust") / AT_{t-1} | same | DRE + DOAR (pre-2008) / DFC (2008+) |
| **Other** | "Venda/Baixa Bens Permane" (1995-2006) → "Venda de ativo permanente" (2007-2013) | "Venda de ativo permanente" | DOAR (pre-2008) / DFC (2008+) |
| **Dividends** | "Dividendos" (1995-2007) → "Dividendos Pagos" (2008-2013) | "Dividendos Pagos" | DOAR (pre-2008) / DFC (2008+) |
| **Assets** | ln(Ativo Total_t) | same | BPA |
| **Q (Tobin)** | (AT + Market Cap − PL) / AT_t | same | BPA + BPP + B3 prices |

**Filter rules (from `mcleans_model_spec.md`, must match for exact replication):**
1. B3-listed firms, annual frequency, **1995-2013** (original window) or 1995-2025 (extended).
2. Drop **financial sector + funds** (high leverage / regulated).
3. Drop firm-years with **Total Assets < R$ 200,000**.
4. Drop firm-years with **YoY asset growth > 100%**.
5. Winsorize 1% both tails; CashFlow uses 2.5% left / 1% right.
6. Inflation-adjust to **BRL 2013 using IPCA annual** from IPEA.
7. Keep delisted firms — survivorship not desired.
8. Constrained/unconstrained: within sector-year, sort by AT asc; **bottom 3 deciles = constrained, top 3 = unconstrained**.

---

## Selected Approach: B — Full 1995-2009 Extension

**Description:** Two-stage ingest mirroring the existing 2010+ pipeline:

1. **`pipelines/notebooks/ingest/cvm_legacy_dfp.py`** — ASP-form scraper against `sistemas.cvm.gov.br/port/ciasabertas/*`. For each firm in the 614-firm universe × each year 1995-2009 × each statement (BPA, BPP, DRE, DOAR/DFC, IAN), fetch raw HTML + downloadable CVMWIN binary files. Land bytes-as-is in `/Volumes/{catalog}/bronze/raw/cvm_legacy/`. Resumable via a `(cd_cvm, year, statement) → fetched_at` checkpoint table.

2. **`pipelines/notebooks/silver/cvm_legacy_dfp_lines.py`** — parses CVMWIN binary files (per public layout specs at `sistemas.cvm.gov.br/port/ciasabertas/Leiaute_de_Formularios_do_EmpresasNET.asp`) into the existing `bronze.cvm_dfp_lines` schema (`cd_cvm, fiscal_year, statement, cd_conta, ds_conta, vl_norm, ordem_exerc, versao, source_year_file, ingested_at`). Includes the **DOAR↔DFC bridge** for pre-2008 fiscal years.

3. **`silver.mclean_firm_year_unified`** — view UNION-ing the new legacy silver table with the existing 2010-2025 `silver.mclean_firm_year`. Consumed by all downstream gold notebooks unchanged.

4. **`gold.mclean_*`** — widen `WINDOWS = {"full": (1995, 2025), "original": (1995, 2013)}` in `mclean_annual.py`, `mclean_pooled.py`, `mclean_descriptives.py`. No other gold-layer changes.

5. **App** — McLean page gets a window selector: `1995-2013 (paper window) | 1995-2025 (extended) | 2010-2025 (CPC-only, current)`.

**Effort estimate: 9-11 weeks**

| Phase | Weeks | Deliverable |
|---|---|---|
| 1. ASP scraper + UC Volume landing + resumable checkpoint | 2-3 | All ~37k raw filings cached byte-for-byte in bronze |
| 2. CVMWIN binary parser + CVM-raw→Economática-clean mapper + DOAR↔DFC bridge | 3-4 | `silver.mclean_firm_year_unified` populated, 1995-2025 rows visible |
| 3. Tobin's Q + precautionary-savings extensions (CF Vol., CF Vol. Median, Cash Flow Risk, Prec) | 1-2 | All extensions table-feature complete in gold |
| 4. Gold widening to 1995-2025 + Tab.1/Fig.1 paper-match validation | 1 | Coefficients within 2-decimal tolerance |
| 5. Debug buffer for mapping drift / parser quirks | 1 | Final paper-match passes |
| 6. App window-selector + docs update | 0.5 | McLean page shipped with all three window options |

**Why this approach (and not the alternatives):**
- **A (2006-2009 only)** — rejected: doesn't reach the paper's 1995 start.
- **C (2006-2013 with explicit gap note)** — rejected: same reason.
- **D (no extension, just 2010+ robustness)** — rejected: doesn't address the "replicate my own paper" goal.

---

## Sample Data Inventory

| Type | Location | Use |
|------|----------|-----|
| Original dissertation (PT) | `.claude/sdd/archive/000969628.pdf` + `.txt` | Variable formulas, account dictionary, sample filters, target stats |
| Published article (EN) | `.claude/sdd/archive/admin,+rbfin2015_3_4.pdf` + `.txt` | Tab. 1 + Fig. 1 numerical targets for validation |
| Existing 2010-2025 silver | `silver.mclean_firm_year` in Databricks | Schema template + 2010-2013 overlap (sanity check the parser against firms that also filed CVMWIN) |
| Public CVMWIN layout specs | `sistemas.cvm.gov.br/port/ciasabertas/Leiaute_de_Formularios_do_EmpresasNET.asp` | Binary parser reference |
| Existing ticker_universe | `data/ticker_universe.csv` (982 tickers) | Starting point for cd_cvm→ticker resolution — but most pre-2010 firms have no current ticker |

**Not available** (per user): original Economática raw export, original Stata/SAS regression script. Validation is aggregate-stat only.

---

## Risk Register

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| **R1** | ASP-form scraping breaks mid-workstream — CVM web forms change without notice; rate-limit policy unclear | High | Cache every fetched page byte-for-byte in UC Volume on first hit. Resumable scraper with `(cd_cvm, year, statement) → fetched_at` checkpoint table. Never re-fetch what we have. |
| **R2** | DOAR↔DFC bridge fails for some firms — firms split D&A across multiple DOAR lines or omit "Venda de Bens Permanentes" entirely | High | Per-firm-year diagnostic column `bridge_status ∈ {clean, ambiguous, missing}`. Drop ambiguous/missing from headline panel; report dropped-firm count alongside Tab. 1 reproduction. |
| **R3** | Survivorship resolution — 614 firms include many non-existent on B3 today (Aracruz, Sadia, Telemar, AmBev-old, etc.) | High | Build `data/mclean_firm_universe.csv` independent of `ticker_universe.csv`, keyed by `cd_cvm` not ticker. Sector from `cvm_cad_cia` historical snapshots. |
| **R4** | Tab.1/Fig.1 coefficients don't match to 2-decimal tolerance after first pass | Medium | Budget 1 week of debugging (in 9-11 week estimate). If still drifting, hand-spot-check 20 firm-years against dissertation's per-variable means/medians (Tab. 1 column data is in `000969628.txt`). |
| **R5** | Inflation deflation choice — IPCA confirmed by paper; base year 2013 affects all level variables | Low | Match paper exactly: deflate to BRL 2013 using IPCA annual from IPEA. |
| **R6** | Constrained/unconstrained cell-size — paper uses sector-year deciles; small sectors may have <10 firms in some years | Medium | Reuse paper's exact rule (bottom-3 / top-3 deciles). Document cells with <10 firms; exclude from Fig. 1 sub-sample if cell-size <5. |
| **R7** | CVMWIN binary parser quirks — format changed across CVMWIN versions 5.x → 9.x; 1995-2009 spans both | High | Validate parser against 2010-2013 overlap (firms that filed both CVMWIN and Dados Abertos). If parser fails on a CVMWIN version, drop those firm-years and document dropped-count. |
| **R8** | Wall-clock for 37k scrapes — rate limits unknown; could be hours or days per pass | Medium | First pass at low concurrency (2-3 parallel) with random 1-3s jitter. Caching means subsequent passes are near-instant. |

---

## Open Items For Phase 1 (Define)

These are non-blocking for brainstorm but must be answered before implementation begins:

1. **Exact ASP-form URL patterns** for each statement type. Need to spider `sistemas.cvm.gov.br/port/ciasabertas` to map endpoints per (firm × year × statement type).
2. **Cadastro snapshot selection for historical sector** — firms changed sectors over 30 years. Decide whether to pin sector at first observation or use the year-specific Cadastro.
3. **Bronze table layout** — separate `bronze.cvm_legacy_dfp_lines` vs unified `bronze.cvm_dfp_lines_all`. Recommend: separate bronze (per-source provenance), unified silver (`silver.mclean_firm_year_unified`).
4. **App window-selector UX** — three options (1995-2013 / 1995-2025 / 2010-2025) on a chip control vs dropdown. UX detail, decide in Phase 2 (Design).
5. **DOAR account-name normalization** — `cvm_legacy_dfp_lines.py` must trim/upper-case the Portuguese account labels for stable matching; the existing `silver.mclean_firm_year.py:73` filter has prior art for this.
6. **Cadastro pre-2010** — does `cvm_cad_cia` cover delisted firms? May need a separate `bronze.cvm_cad_cia_historical` from a CVM legacy endpoint.

---

## YAGNI — What Was Considered and Dropped

| Considered | Why dropped |
|---|---|
| Quarterly (ITR) data | McLean is annual. Adds 4× scrape volume for no model value. |
| Pre-1995 data | Paper window starts at 1995. |
| Macro variables (CDI, IPCA, GDP) | Handled by separate `bcb_*` ingest path (IPCA needed for deflation only — small fetch). |
| BDR / foreign-issuer fundamentals | McLean is Brazilian non-financial only. |
| Per-firm DOAR override curation file | Start with dictionary-based mapping for everyone; only build per-firm overrides if R2 mitigation drops too many firms. |
| Tobin's Q deferred to v2 | **Rejected** — user wants all extensions in MVP. |
| Precautionary proxies deferred to v2 | **Rejected** — same. |

---

## Out of Scope

- Quarterly ITR data (annual only)
- Pre-1995 data (paper window)
- Macro variables (separate pipeline)
- BDR / foreign-issuer fundamentals
- Index methodology changes (IBOV reconstitutions pre-2003 affect benchmark, not panel)
- Re-acquiring Economática (paid, out of scope)

---

## Quality Gate ✅

- [x] Minimum 3 discovery questions asked (7 asked)
- [x] Sample collection question asked (Q6)
- [x] At least 2 approaches explored (A, B, C, D — all 4)
- [x] YAGNI applied (extensions debated; user chose all-in)
- [x] Minimum 2 validation checkpoints (scope + risks)
- [x] User confirmed selected approach (Approach B, all extensions)
- [x] Draft requirements included (Risk register + Open items)

---

## Ready for Next Phase

This document is the input for **`/agentspec:workflow:define`**. Expected output: `DEFINE_MCLEAN_PRE2010.md` with hard acceptance criteria, especially:

- Validation criterion: coefficient match to 2 decimals on Tab. 1 + Fig. 1 with explicit firm-year counts in the regression panel.
- Resumability criterion: scraper can be killed and restarted at any point with zero data loss and no re-fetching.
- Schema criterion: `silver.mclean_firm_year_unified` is a strict superset (rows + columns) of the existing `silver.mclean_firm_year`.
- Coverage criterion: report `(cd_cvm × year)` rows successfully fetched / parsed / mapped / used-in-regression, with documented attrition at each stage.
