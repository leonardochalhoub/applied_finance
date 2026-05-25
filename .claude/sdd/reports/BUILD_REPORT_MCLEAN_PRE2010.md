# BUILD REPORT: McLean's Model — Pre-2010 Fundamentals Backfill

> Phase 0 (Proof of Concept) scaffold complete. Phases 1-6 deliberately not started — the PoC has a binary GO/NO-GO gate (DESIGN Decision 8) that must pass against assumptions A-001 through A-004 before committing to the 9-11 week full build.

## Metadata

| Attribute | Value |
|-----------|-------|
| **Feature** | MCLEAN_PRE2010 |
| **Date** | 2026-05-25 |
| **Author** | build-agent (Claude Code, direct execution — no subagents) |
| **DEFINE** | [DEFINE_MCLEAN_PRE2010.md](../features/DEFINE_MCLEAN_PRE2010.md) |
| **DESIGN** | [DESIGN_MCLEAN_PRE2010.md](../features/DESIGN_MCLEAN_PRE2010.md) |
| **Status** | 🔄 In Progress — Phase 0 scaffold complete; Phase 0 execution + Phase 1-6 pending |
| **Phase scope** | Files 1-4 of 32 (Phase 0 PoC); file 5 (POC_REPORT) is post-execution artifact |

---

## Summary

| Metric | Value |
|--------|-------|
| **Phase 0 tasks completed** | 4/5 (scaffolding); file 5 is post-execution |
| **Files Created** | 4 (firm universe CSV, parser scaffold, scraper, parser tests) |
| **Lines of Code** | ~340 (135 parser + 145 scraper + 60 tests + 11 CSV rows) |
| **Build Time** | Single session |
| **Tests Passing** | 18/18 (parser interface tests) |
| **Lint Status** | ruff: clean |
| **Agents Used** | 0 (direct execution; in-context build chosen over subagent delegation for a 4-file scaffold) |

---

## Task Execution

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Create `data/mclean_firm_universe.csv` (10 PoC firms) | ✅ Complete | Best-effort cd_cvm values — see "Pending User Verification" below |
| 2 | Create `pipelines/notebooks/bronze/cvmwin_parser.py` | ✅ Complete | Honest scaffold: `LayoutNotDecodedError` until Phase 0 step 2 |
| 3 | Create `pipelines/notebooks/ingest/cvm_legacy_dfp.py` | ✅ Complete | Runnable scraper; `_build_url` is placeholder pending Phase 0 step 1 |
| 4 | Create `pipelines/tests/test_cvmwin_parser.py` | ✅ Complete | 18 interface tests, all pass |
| 5 | Write `.claude/sdd/reports/POC_REPORT_MCLEAN_PRE2010.md` | ⏳ Pending | Generated after PoC executes in Databricks |
| 6-32 | Phases 1-6 (full build) | ⏳ Pending | Gated by PoC GO/NO-GO |

---

## Files Created

| File | Lines | Verified | Notes |
| ---- | ----- | -------- | ----- |
| `data/mclean_firm_universe.csv` | 11 | ✅ CSV parses | 10 PoC firms; cd_cvm values are best-effort — verify before running |
| `pipelines/notebooks/bronze/cvmwin_parser.py` | 156 | ✅ ruff clean, pytest 18/18 | Honest layout-TBD scaffold; raises `LayoutNotDecodedError` until decoded |
| `pipelines/notebooks/ingest/cvm_legacy_dfp.py` | 158 | ✅ ast.parse passes | Real, runnable scraper; placeholder ASP URL pending Phase 0 spider |
| `pipelines/tests/test_cvmwin_parser.py` | 67 | ✅ 18/18 pass | Interface tests; byte-level tests come post-decode |

**Total scaffold:** 4 files, ~340 LoC, ~30 minutes elapsed.

---

## Verification Results

### Lint Check

```text
ruff check pipelines/notebooks/bronze/cvmwin_parser.py pipelines/tests/test_cvmwin_parser.py
Ruff: No issues found
```

(`pipelines/notebooks/ingest/cvm_legacy_dfp.py` is excluded from ruff per existing pyproject.toml rule — Databricks notebook `# COMMAND ----------` magic markers break the AST.)

**Status:** ✅ Pass

### Tests

```text
pytest pipelines/tests/test_cvmwin_parser.py -q
Pytest: 18 passed
```

| Test class | Tests | Result |
|------------|-------|--------|
| `TestParserInterface` | 8 | ✅ All pass |
| `TestVersionDetection` | 2 | ✅ All pass |
| `TestParserScaffoldRaisesUntilDecoded` | 6 | ✅ All pass — confirms parser fails loudly until layout decoded |
| `TestExceptionHierarchy` | 2 | ✅ All pass |

**Status:** ✅ 18/18 Pass

---

## Deviations from Design

| Deviation | Reason | Impact |
|-----------|--------|--------|
| Parser **does NOT bake in speculative byte offsets** from DESIGN Code Pattern 2 | The byte offsets in DESIGN (`cd_conta @ offset 4, width 16`, etc.) were speculation from web research, not retrieved from the actual spec page. Baking them in would propagate unverified information into production code. | Parser now raises `LayoutNotDecodedError` loudly until Phase 0 step 2 decodes the spec page + verifies against a real CVM file. This is **safer**, not a downgrade — silent empty iterators would be worse. |
| Tests located at `pipelines/tests/test_cvmwin_parser.py`, not `tests/unit/test_cvmwin_parser.py` | Existing repo convention: pipeline tests live under `pipelines/tests/` (see `pipelines/tests/test_gold_smoke.py`). DESIGN's `tests/unit/` path was speculative. | None — same content, conventional location. |
| Scraper's ASP URL is a clearly-labeled placeholder | Same reason as parser layout: the real ASP-form URL pattern needs spidering at runtime (Phase 0 step 1). DESIGN did not commit to a specific URL. | Scraper will 404 on every fetch until URL is updated. Confined to one function (`_build_url`), one-line fix once the pattern is known. |
| Only 10 firms in `data/mclean_firm_universe.csv` (PoC subset) | DESIGN Decision 8 explicitly scopes Phase 0 to 10 firms × 3 years. Full 614 firms come in Phase 1 after PoC PASS. | Aligned with DESIGN. |

---

## Blockers (Non-Code)

| # | Blocker | Required Action | Owner |
|---|---------|-----------------|-------|
| B1 | **CVM Sistemas ASP URL pattern unknown** (partially investigated, see Public-Info Recovery below) | Manually submit a known query at `rad.cvm.gov.br/ENET/frmConsultaExternaCVM.aspx` (modern post-2010 query form) AND `sistemas.cvm.gov.br/port/ciasabertas` (legacy portal) via browser, capture the network request, update `_build_url()` in `cvm_legacy_dfp.py`. ~30 minutes of work. | User (or someone with browser access to CVM portal) |
| B2 | **CVMWIN file format reframed** — public-info recovery (see below) established the files are likely **Clipper / dBase databases**, not unknown proprietary binary. The parser now uses a dBase-detection-first approach and is wired to call `dbfread`. **Remaining work:** open one real `.DFM` file with `dbfread`, inspect field names, populate `_DBF_FIELD_MAP` in `cvmwin_parser.py`. Estimate revised from ~1-2 days of byte-level parsing to ~2-4 hours of column-name discovery. | User or @python-developer in Phase 0 |
| B3 | **cd_cvm values in firm universe need verification** | The 10 cd_cvm codes in `data/mclean_firm_universe.csv` are my best-effort recollection. Verify against `bronze.cvm_cad_cia` (active firms) and the original 2015 paper's appendix (for delisted firms like Aracruz, Sadia, Telemar). ~15 minutes of SQL + cross-check. | User |
| B4 | **Databricks workspace required to execute PoC** | Phase 0 PoC runs `cvm_legacy_dfp.py` as a Databricks notebook (the file uses `dbutils.widgets`, `spark.sql`, UC Volumes). Cannot run from this laptop session. | User (deploy via `databricks bundle deploy`) |
| B5 | **CVM portal accessibility from Databricks egress IP** | Databricks workers must be able to reach `sistemas.cvm.gov.br` over HTTPS. Verify with a `curl` smoke test before the full scrape. | User (one-off check) |

---

## Public-Info Recovery (2026-05-25, post-initial-commit)

After the first commit (`d3e4a528`), I attempted to unblock B1 + B2 by querying public CVM pages directly. Findings:

### What was recovered

1. **Pre-2010 file format is Clipper / dBase**, not unknown proprietary binary. Evidence: the legacy DOS reader (`sistemas.cvm.gov.br/download/sep/pub/programas/RelatCias24/Consulta.zip` v2.4) has `set clipper=F:200` in its autoexec.bat — the Clipper memory directive for the Clipper xBase compiler. The `.DFM/.DFL/.ITM/.ITL` extensions are almost certainly standard dBase III/IV / Clipper DBF files with a rename. This shifts the parser approach from "byte-level reverse engineering" (1-2 days) to "use `dbfread` Python library and discover column names" (2-4 hours).

2. **File extension semantics confirmed**: M = "Mil" (monetary scale 000s), L = "Livre" (free unit). Same column structure within a statement type, different scale.

3. **CVMWIN current version**: 9.2 (Windows); DIVEXT 9.2 (query/disclosure); DOS-era reader 2.4 (consultation). Pre-2010 filings span multiple CVMWIN versions but file format should be stable across them.

4. **Empresas.NET / ENET 3.0** is the CURRENT (post-2010) format. The layout spec page at `sistemas.cvm.gov.br/port/ciasabertas/Leiaute_de_Formularios_do_EmpresasNET.asp` documents only ENET 3.0 — pre-2010 CVMWIN/Clipper layouts are NOT publicly documented. We will decode-by-experiment.

### What remained blocked

1. **ASP URL pattern**: the public CVM query form at `rad.cvm.gov.br/ENET/frmConsultaExternaCVM.aspx` accepts firm/year/type parameters but its submission endpoint isn't visible in static HTML — needs browser dev-tools / curl session capture.
2. **Actual DBF column names**: confirms that we MUST download a real `.DFM` file to inspect via `dbfread.DBF(path).field_names`. This is the smallest unit of remaining unknown.
3. **No existing OSS parser** for the legacy CVMWIN/Clipper format. `pycvm` and `brFinance` both stop at the post-2010 CSV format.

### Code updates from these findings

- **`pipelines/notebooks/bronze/cvmwin_parser.py` rewritten** (commit pending):
  - Replaced speculative byte-offset stubs (`_VERSION_MAGIC`, `_RECORD_LAYOUTS`) with dBase-detection (`detect_dbf`) checking dBase III/IV / FoxPro / Clipper header bytes (`0x03, 0x83, 0xF5, 0xFB, 0x30`).
  - Added `_DBF_FIELD_MAP` keyed by statement type (DFP/ITR/IAN) — to be populated once columns are inspected.
  - Wrote the anticipated `dbfread` usage in the docstring as a guide for Phase 0 implementer.
- **Tests rewritten** to match the new dBase-based detection: 24/24 still pass.

### Revised effort estimates

| Phase | Before recovery | After recovery |
|---|---|---|
| 0 step 2 (parser decode) | 1-2 days | 2-4 hours (column inspection via `dbfread`) |
| Phase 1 (full parser + scrape) | 2-3 weeks | 1.5-2 weeks (parser scope shrunk) |
| Total | 9-11 weeks | **~7-9 weeks** if the Clipper hypothesis holds |

If `dbfread` opens a real `.DFM` cleanly, we save ~1-2 weeks of binary-parsing work. If it does NOT (e.g., the files turn out to be a Clipper-specific extension `dbfread` doesn't handle), fallback is the `dbf` library (handles more Clipper variants) or — worst case — `simpledbf` + manual column-offset detection.

---

## Databricks Recovery Pass (2026-05-25, second follow-up)

After the parser-pivot commit (`b30927af`) and the DESIGN-sync + IPCA commit (`f1416a21`), the user pointed out that Databricks workspace tokens are available via `./.env`. This unblocked **B3 (firm-universe cd_cvm verification)** in this session.

### What was unblocked

- **B3: cd_cvm verification completed.** Queried `finance_prd.bronze.cvm_cad_cia` (warehouse `Serverless Starter Warehouse`, id `9e9a68644c51f277`) for the 10 PoC firms. Discovery: cd_cvm is stored **zero-padded to 6 characters** (e.g., `009512` not `9512`), and **7 of 10 of my initial best-effort values were wrong**.

  | Ticker | Old (wrong) | Verified | Notes |
  |--------|-------------|----------|-------|
  | PETR4 | 9512 | **009512** | ✓ match |
  | VALE3 | 4170 | **004170** | ✓ match |
  | BBAS3 | 1023 | **001023** | ✓ match |
  | USIM5 | 7617 | **014320** | corrected |
  | ACES4 | 4030 | **000434** | corrected (Aracruz; CANCELADA 2009) |
  | SDIA4 | 5258 | **018848** | corrected (Sadia; multiple matches existed) |
  | TNLP4 | 11592 | **011320** | corrected (Telemar Norte Leste; CANCELADA) |
  | AMBV4 | 11193 | **018112** | corrected (old AmBev pre-2013) |
  | ENBR3 | 8265 | **019763** | corrected (EDP Brasil) |
  | GOLL4 | 19305 | **019569** | corrected (GOL; CANCELADA — likely Chapter 11 admin status) |

  `data/mclean_firm_universe.csv` updated with verified values.

### Other findings from the Databricks pass

- **Free fy=2009 data already in bronze.** `bronze.cvm_dfp_lines` has 88,461 rows / 364 firms for fy=2009 — captured via the PENÚLTIMO mechanism from the 2010 zip (see filter at `silver/mclean_firm_year.py:74`). This data flows into `silver.mclean_firm_year` (363 firms in fy=2009) but **NOT** into `silver.mclean_clean` (which needs fy=2008 lags). Once legacy data fills 1995-2008, fy=2009 promotes into the regression panel **for free**.

- **Panel-growth math revised.** Original assumption: legacy work adds 1995-2009 = 15 years. Actual: legacy work adds **1995-2008 = 14 raw years**, which then unlocks 1996-2009 = 14 panel years in the regression (since fy=1995 still needs lag, fy=2009 unlocks once we have fy=2008). Net: panel grows from 16 years (2010-2025) → **30 years (1996-2025)**.

- **Bronze schema confirmed.** Spot-query for Petrobras 2010 BPA returned 4 rows (Ativo Total + Caixa, each in ÚLTIMO + PENÚLTIMO) with `vl_norm` already scaled to BRL (Ativo Total = ~R$ 519B, sensible). Legacy bronze must match this schema exactly. The existing column shape (cd_cvm, fiscal_year, statement, cd_conta, ds_conta, vl_norm, ordem_exerc) is the contract.

### What's still blocked

- **B1: ASP URL pattern.** Probed `cvmweb.cvm.gov.br/SWB/Sistemas/SCW/CPublica/CiaAb/FormBuscaCiaAb*.aspx` and `rad.cvm.gov.br/ENET/frmConsultaExternaCVM.aspx` from a curl session. Every link to an actual filing is an ASP.NET `__doPostBack` JavaScript callback. Scraping them from curl requires simulating a full WebForms session (POST back, VIEWSTATE round-trip, etc.) — possible but ~half a day of work and brittle. Easier: capture the network request from a browser dev-tools session for one known query (PETR4 2005 DFP), then plug the URL pattern into `_build_url()`.

- **B2: DBF column names.** Still need one real `.DFM` file. From curl session: pre-2010 Dados Abertos zips don't exist (all 404). The legacy CVMWIN files are gated behind the ASP.NET WebForms portal that B1 also blocks. Both unblock together when B1 is resolved.

- **B4-B5: Bundle deploy + smoke test.** Not attempted in this session. Ready to run once B1/B2 resolved.

---

## Acceptance Test Verification

PoC-scope tests (most DEFINE ATs are Phase 1+):

| ID | Scenario | Status | Evidence |
|----|----------|--------|----------|
| AT-003 (resumability happy path) | Scaffold: Delta MERGE pattern in `_mark()` is idempotent; queue is `WHERE status IN ('pending','failed_retryable')` so cached rows skipped | 🟡 Design-correct, **not yet executed** | Code review only |
| AT-004 (resumability partial fetch) | Scaffold: `.tmp` rename pattern in `_persist()` makes failed mid-fetch detectable | 🟡 Design-correct, **not yet executed** | Code review only |
| AT-006/007/008 (DOAR bridge) | Not in Phase 0 scope | ⏳ Phase 2 |
| AT-009/010 (survivorship) | Firm universe includes 4 delisted firms (ACES4, SDIA4, TNLP4, AMBV4) to test this | 🟡 **Validated against universe CSV** but not against parser output yet | Universe CSV |

Remaining ATs (AT-001 paper-match, AT-002 Tab.1, AT-005 unified-view superset, AT-011-015) gate on Phase 1+ work.

---

## PoC GO/NO-GO Gate (DESIGN Decision 8 — Must Run in Databricks)

Before Phase 1 begins, the PoC must validate these four load-bearing assumptions. The criteria below are copied verbatim from DESIGN Decision 8:

| Assumption | Criterion | Test |
|------------|-----------|------|
| **A-001** (portal accessibility) | ≥9/10 firms have at least one statement fetchable for all 3 PoC years | Count `WHERE status='cached' GROUP BY cd_cvm HAVING COUNT(*) >= 3` |
| **A-002** (parser correctness) | ≥80% of expected `cd_conta` codes resolve to non-NULL values for those firms | Parser dump vs hand-coded list of expected codes for PETR4 1998 BPA |
| **A-003** (sector resolution) | All 10 firms found in `bronze.cvm_cad_cia` OR have derivable sector from filings | Existence check + IAN section parsing |
| **A-004** (DOAR bridge) | ≥9/10 firm-years have `bridge_status='clean'` for DOAR-era years (1998, 2003) | Bridge classification on real DOAR data |

**Run order in Databricks**:
1. Resolve B1, B2, B3 above (update `_build_url`, `_RECORD_LAYOUTS`, verify cd_cvm).
2. Upload `data/mclean_firm_universe.csv` to UC Volume `bronze/reference/`.
3. Deploy bundle: `databricks bundle deploy -t dev`.
4. Run `pipelines/notebooks/ingest/cvm_legacy_dfp.py` (PoC mode: `poc_only=true`, `from_year=1998`, `to_year=2008`).
5. Check `bronze.cvm_legacy_scrape_checkpoint` for cached vs failed counts.
6. (After parser layout decoded) Run a parse smoke test on one cached file per firm.
7. Write `.claude/sdd/reports/POC_REPORT_MCLEAN_PRE2010.md` documenting all four assumption results.

If **any** assumption FAILs, do NOT proceed to Phase 1. Instead, iterate DESIGN per DEFINE's R3 (survivorship), R4 (bridge), R7 (parser) mitigations.

---

## What's Pending After PoC PASS (Phases 1-6)

Per DESIGN File Manifest, 28 more files across 6 phases:

| Phase | Files | Effort | Key deliverable |
|-------|-------|--------|------------------|
| 1 | 5, 6, 7, 8, 9, 10, 11 (7 files) | Weeks 2-3 | Full scraper + bronze populated for 614 firms × 15 years |
| 2 | 12, 13, 14, 15, 16, 17, 18 (7 files) | Weeks 4-6 | Account mapping + DOAR bridge + unified silver view |
| 3 | 19, 20, 21, 22, 23, 24 (6 files) | Weeks 7-8 | Gold widened + extensions + attrition |
| 4 | 25, 26 (2 files) | Week 9 | Paper-match validation report |
| 5 | 27, 28, 29, 30, 31 (5 files) | Week 10 | App + docs |
| 6 | (buffer) | Week 11 | Debug for coefficient drift |

---

## Final Status

### Overall: 🔄 IN PROGRESS — Phase 0 scaffold complete; Phase 0 execution + Phase 1-6 not started

**Completion Checklist:**

- [x] Phase 0 scaffolding tasks complete
- [x] Scaffolded code lints clean
- [x] Parser interface tests pass (18/18)
- [x] No TODO comments masquerading as completed work — every TODO is a labeled placeholder with a clear unblock path
- [x] Build report generated
- [ ] PoC executed in Databricks (blocked by B1, B2, B3, B4, B5)
- [ ] PoC GO/NO-GO gate passed (cannot evaluate until executed)
- [ ] Phases 1-6 implemented
- [ ] Acceptance tests AT-001 through AT-015 verified
- [ ] Ready for /ship

---

## Recommendations Before Continuing Build

1. **Commit Phase 0 scaffold + SDD docs together.** Commit the 3 SDD docs (BRAINSTORM/DEFINE/DESIGN) + the 4 scaffold files + this BUILD_REPORT as one logical landing: "scope MCLEAN_PRE2010 + Phase 0 scaffold". Gives the git history a clean inflection point.
2. **Resolve B1 + B2 in one focused session.** Both are "fetch a CVM web page + transcribe". Block out 2-3 hours, fetch the spec, populate the parser layout dict, capture the ASP URL pattern, and update `data/mclean_firm_universe.csv` with verified cd_cvm values.
3. **Run the PoC in Databricks.** 150 fetches; ~10-20 minutes of wall clock at safe jitter. Costs effectively nothing (it's within Databricks Free Edition limits).
4. **Only after PoC PASS, commit to Phase 1.** If A-002 (parser correctness) fails, the entire workstream is at risk — that's the point of the gate.
5. **Do not run Phase 1 from this Claude session.** Phase 1 = ~7 files of Databricks-specific notebooks against a live external system. That work belongs in your Databricks environment with the user's eyes on the scraper progress, not in this conversation.

---

## Next Step

**If Phase 0 PoC will run next:** see the "Run order in Databricks" section above.

**If iterating DESIGN due to a discovered constraint:**
```bash
/agentspec:workflow:iterate DESIGN_MCLEAN_PRE2010.md "constraint to address"
```

**If PoC has passed and ready for Phase 1:** resume with a fresh `/build` session pointed at the post-PoC DESIGN (which should include the decoded parser layout + the real ASP URL).

**For the SDD workflow gate:** this build is **NOT** ready for `/ship` — `/ship` is for completed, validated features. We are at Phase 3 of 4, with PoC + Phases 1-6 still to execute.
