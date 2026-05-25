# Databricks notebook source
"""Apply Unity Catalog governance (COMMENT + TAGS + column docs) to ALL tables
and ALL columns. Single source of truth — every change lives here.

Runs after quality_contracts_assert succeeds. Idempotent — re-applies on every
refresh.

Tag taxonomy (consistent with databricks.yml job tags):
  layer    : bronze | silver | gold
  domain   : equities-b3
  source   : yahoo_finance | curated_csv | bcb | derived
  grain    : ticker+trading_date | ticker+valid_window | sector | window
  pii      : false  (all public market data)
  pattern  : medallion | scd2 | reference | materialized_artifact
"""
# COMMAND ----------
import logging

log = logging.getLogger("quality.apply_governance")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")


# ── schemas ────────────────────────────────────────────────────────────────
spark.sql(
    f"COMMENT ON SCHEMA {catalog}.bronze IS "
    "'Raw ingestion layer — Yahoo Finance OHLCV + curated CSVs (universe, "
    "index membership). Append-only via MERGE; preserves source fidelity.'"
)
spark.sql(
    f"COMMENT ON SCHEMA {catalog}.silver IS "
    "'Cleaned and conformed layer — split/dividend-adjusted OHLCV, SCD2 ticker "
    "dimension, long-form index membership. Single source of truth for KPI math.'"
)
spark.sql(
    f"COMMENT ON SCHEMA {catalog}.gold IS "
    "'Analytics-ready artifacts — per-ticker KPIs, sector aggregates, daily "
    "returns matrix, annualized covariance matrices per window.'"
)


def _escape(s: str) -> str:
    return s.replace("'", "''")


def _classify_column(col: str, dtype: str) -> dict:
    """Derive {role, unit, pii} tags from column name + Spark dtype.

    Roles: key | dimension | measure | timestamp | provenance | flag | attribute | collection
    Units (measures only): BRL | count | ratio | fraction | log_return |
        stddev_annualized | sharpe_ratio | variance_annualized | utc_timestamp
    pii is always 'false' (all public market data).
    """
    n = col.lower()
    dt = (dtype or "").lower()
    t = {"pii": "false"}

    if n in ("source_run_id",):
        t["role"] = "provenance"; return t
    if n == "ingested_at" or n.endswith("_at"):
        t["role"] = "provenance"; t["unit"] = "utc_timestamp"; return t
    if n in ("trading_date", "valid_from", "valid_to", "valid_through",
             "as_of", "listed_from", "listed_to", "last_close_date") \
            or n.endswith("_date"):
        t["role"] = "timestamp"; return t

    if n in ("ticker", "ticker_i", "ticker_j", "ticker_key", "cnpj"):
        t["role"] = "key"; return t

    if n.startswith("is_"):
        t["role"] = "flag"; return t

    if n in ("sector_b3", "subsector_b3", "sector_i", "sector_j", "index", "window_label"):
        t["role"] = "dimension"; return t

    if n in ("prior_tickers", "members"):
        t["role"] = "collection"; return t

    if n in ("company_name", "notes", "canonical_root"):
        t["role"] = "attribute"; return t

    if n in ("price_open", "price_high", "price_low", "price_close", "price_adjusted",
             "open", "high", "low", "close", "close_raw", "last_close", "index_level"):
        t["role"] = "measure"; t["unit"] = "BRL"; return t
    if n in ("volume", "n_obs", "member_count"):
        t["role"] = "measure"; t["unit"] = "count"; return t
    if n == "weight":
        t["role"] = "measure"; t["unit"] = "fraction"; return t
    if n in ("adj_factor", "cdi_annual_used", "cdi_global_mean", "max_drawdown"):
        t["role"] = "measure"; t["unit"] = "ratio"; return t
    if n.startswith("return") or n.startswith("contribution"):
        t["role"] = "measure"; t["unit"] = "log_return"; return t
    if n.startswith("vol_"):
        t["role"] = "measure"; t["unit"] = "stddev_annualized"; return t
    if n.startswith("sharpe"):
        t["role"] = "measure"; t["unit"] = "sharpe_ratio"; return t
    if n == "cov":
        t["role"] = "measure"; t["unit"] = "variance_annualized"; return t

    # Fallback: numeric column of a known type → likely a measure (covers
    # gold.returns_wide ticker columns and any future numeric additions).
    if dt.startswith(("double", "float", "decimal", "int", "long", "bigint", "smallint", "tinyint")):
        t["role"] = "measure"; t["unit"] = "log_return"; return t
    t["role"] = "attribute"
    return t


def _apply_column_tags(fqn: str) -> None:
    rows = spark.sql(f"DESCRIBE TABLE {fqn}").collect()
    for r in rows:
        col = r["col_name"]
        if not col or col.startswith("#"):
            continue
        tags = _classify_column(col, r["data_type"] or "")
        tag_sql = ", ".join(f"'{k}' = '{_escape(str(v))}'" for k, v in tags.items())
        try:
            spark.sql(f"ALTER TABLE {fqn} ALTER COLUMN `{col}` SET TAGS ({tag_sql})")
        except Exception as exc:
            log.warning("column tag failed on %s.%s: %s", fqn, col, exc)


def _apply(table: str, comment: str, tags: dict, columns: dict | None = None,
           apply_generic_to_remaining: str | None = None,
           skip_column_tags: bool = False) -> None:
    """Apply COMMENT + TAGS on table, COMMENT on each listed column.

    If `apply_generic_to_remaining` is set, every column not explicitly listed
    in `columns` gets that generic comment (useful for wide tables with
    dynamic ticker columns).

    `skip_column_tags=True` skips per-column tag application. Use for wide
    pivot tables where every value column is uniform (e.g., one column per
    ticker, all numeric log returns) — per-column tags add zero governance
    value over the table-level tag and rapidly exhaust Unity Catalog's
    1000-tag-per-table quota.
    """
    fqn = f"{catalog}.{table}"
    if not spark.catalog.tableExists(fqn):
        log.warning("skipping governance for missing table: %s", fqn)
        return
    spark.sql(f"COMMENT ON TABLE {fqn} IS '{_escape(comment)}'")
    if tags:
        tag_sql = ", ".join(f"'{k}' = '{_escape(str(v))}'" for k, v in tags.items())
        spark.sql(f"ALTER TABLE {fqn} SET TAGS ({tag_sql})")

    listed = set((columns or {}).keys())
    for col, desc in (columns or {}).items():
        try:
            spark.sql(f"ALTER TABLE {fqn} ALTER COLUMN `{col}` COMMENT '{_escape(desc)}'")
        except Exception as exc:
            log.warning("column comment failed on %s.%s: %s", table, col, exc)

    if apply_generic_to_remaining:
        present = [r["col_name"] for r in spark.sql(f"DESCRIBE TABLE {fqn}").collect()
                   if r["col_name"] and not r["col_name"].startswith("#")]
        for col in present:
            if col in listed:
                continue
            try:
                spark.sql(
                    f"ALTER TABLE {fqn} ALTER COLUMN `{col}` "
                    f"COMMENT '{_escape(apply_generic_to_remaining.format(col=col))}'"
                )
            except Exception as exc:
                log.warning("generic column comment failed on %s.%s: %s", table, col, exc)

    if not skip_column_tags:
        _apply_column_tags(fqn)
    log.info("governance applied: %s", fqn)


D = {"domain": "equities-b3", "pii": "false"}


# ── bronze ─────────────────────────────────────────────────────────────────
_apply(
    "bronze.b3_ohlcv_raw",
    "Raw OHLCV from Yahoo Finance via yfr_py — append-only via MERGE on "
    "(ticker, trading_date), deduped to the latest source_run_id by ingested_at "
    "DESC. Both adjusted (price_adjusted) and unadjusted (price_close) are "
    "preserved for auditability across 26 years of corporate actions.",
    {**D, "layer": "bronze", "source": "yahoo_finance",
     "grain": "ticker+trading_date", "pattern": "medallion"},
    {
        "ticker": "Yahoo-suffixed B3 ticker (e.g., PETR4.SA).",
        "trading_date": "B3 trading session date (America/Sao_Paulo calendar).",
        "price_open": "Unadjusted opening price (BRL).",
        "price_high": "Unadjusted intraday high (BRL).",
        "price_low": "Unadjusted intraday low (BRL).",
        "price_close": "Unadjusted regular-session close (BRL).",
        "volume": "Number of shares traded.",
        "price_adjusted": "Yahoo split+dividend-adjusted close (BRL-equivalent).",
        "source_run_id": "GitHub Actions run id (or 'local') — provenance.",
        "ingested_at": "UTC timestamp when this row was first written to Bronze.",
    },
)

_apply(
    "bronze.b3_universe",
    "Hand-curated B3 ticker universe (~70 active + delisted). Maintained in "
    "data/ticker_universe.csv with prior_tickers chain oldest→newest.",
    {**D, "layer": "bronze", "source": "curated_csv",
     "grain": "ticker", "pattern": "reference"},
    {
        "ticker": "Current visible ticker (Yahoo-suffixed).",
        "company_name": "Razão social / nome de fantasia.",
        "sector_b3": "Setor B3 (taxonomia oficial da B3).",
        "subsector_b3": "Subsetor B3 (granularidade abaixo de sector_b3).",
        "listed_from": "Date the company first listed on B3.",
        "listed_to": "Date the ticker stopped trading (NULL = still active).",
        "prior_tickers": "Array of prior visible tickers, oldest→newest (e.g., BRDT3 for VBBR3).",
        "cnpj": "CNPJ when known (some FII/ETF have empty CNPJ).",
        "notes": "Curatorial notes (mergers, renames, spin-offs).",
        "ingested_at": "UTC timestamp of this universe snapshot.",
    },
)

_apply(
    "bronze.b3_index_members",
    "Index composition snapshots — IBOV / IBrX / IBrA. Maintained in "
    "data/index_membership.csv. Weights as of valid_from.",
    {**D, "layer": "bronze", "source": "curated_csv",
     "grain": "index+ticker+valid_window", "pattern": "reference"},
    {
        "index": "Index code (e.g., IBOV, IBRX100, IBRA).",
        "ticker": "Ticker that was a member during [valid_from, valid_to).",
        "weight": "Fractional weight in the index at valid_from (0..1).",
        "valid_from": "Effective date of this composition.",
        "valid_to": "End date (NULL = still current).",
        "ingested_at": "UTC timestamp of this snapshot.",
    },
)


# ── silver ─────────────────────────────────────────────────────────────────
_apply(
    "silver.b3_ohlcv_adjusted",
    "OHLCV with explicit adjustment for splits + dividends. close = Yahoo "
    "price_adjusted; close_raw = unadjusted; adj_factor = close / close_raw. "
    "All downstream KPI math reads `close`.",
    {**D, "layer": "silver", "source": "yahoo_finance",
     "grain": "ticker+trading_date", "pattern": "medallion"},
    {
        "ticker": "Yahoo-suffixed B3 ticker.",
        "trading_date": "B3 trading session date.",
        "open": "Adjusted opening price (close-equivalent scaled by adj_factor).",
        "high": "Adjusted intraday high.",
        "low": "Adjusted intraday low.",
        "close": "Adjusted close — splits + dividends already applied.",
        "close_raw": "Original unadjusted close — kept for forensic audit.",
        "adj_factor": "close / close_raw — the cumulative split+dividend multiplier.",
        "volume": "Number of shares traded.",
        "is_imputed": "TRUE if this row was synthesized (currently always FALSE).",
    },
)

_apply(
    "silver.b3_ticker_dim",
    "SCD2 dimension over B3 tickers. ticker_key = sha1('b3:' + canonical_root). "
    "canonical_root = first prior_tickers entry (oldest first) or ticker if "
    "chain is empty. Preserves business-entity continuity across renames.",
    {**D, "layer": "silver", "source": "curated_csv",
     "grain": "ticker+valid_window", "pattern": "scd2"},
    {
        "ticker_key": "sha1('b3:' + canonical_root) — deterministic surrogate across clones.",
        "ticker": "Visible ticker for this row (one entity → many rows over time).",
        "company_name": "Razão social.",
        "sector_b3": "Setor B3.",
        "subsector_b3": "Subsetor B3.",
        "valid_from": "Date this symbol first appeared on B3.",
        "valid_to": "Date this symbol stopped trading (NULL = current).",
        "is_current": "TRUE iff valid_to IS NULL.",
        "canonical_root": "Oldest known symbol for the same business entity.",
    },
)

_apply(
    "silver.b3_index_members_long",
    "Long-form index membership — one row per (index, ticker, valid_window).",
    {**D, "layer": "silver", "source": "curated_csv",
     "grain": "index+ticker+valid_window", "pattern": "reference"},
    {
        "index": "Index code uppercased (e.g., IBOV).",
        "ticker": "Ticker that was a member.",
        "weight": "Fractional weight in index (0..1).",
        "valid_from": "Start of this membership window.",
        "valid_to": "End of window (NULL = current).",
        "is_current": "TRUE iff valid_to IS NULL.",
    },
)


# ── gold ───────────────────────────────────────────────────────────────────
_apply(
    "gold.returns_wide",
    "Wide-format daily log-returns matrix. One row per trading_date, one "
    "column per ticker. log_return = ln(close_t / close_{t-1}). NULL where "
    "the ticker did not trade or has insufficient history.",
    {**D, "layer": "gold", "source": "derived",
     "grain": "trading_date", "pattern": "materialized_artifact",
     "shape": "wide_pivot", "value_role": "measure", "value_unit": "log_return"},
    {"trading_date": "B3 trading session date."},
    apply_generic_to_remaining="Daily log-return for ticker {col} on this trading_date "
                               "(NULL = ticker did not trade).",
    # 469 ticker columns × 3 tags would blow the 1000-tag-per-table UC quota.
    # All ticker columns are uniform — role/unit/pii are encoded as
    # value_role/value_unit on the table-level tag set above.
    skip_column_tags=True,
)

for w, label in (
    ("1y", "252 trading days"),
    ("5y", "1260 trading days"),
    ("10y", "2520 trading days"),
    ("15y", "3780 trading days"),
    ("20y", "5040 trading days"),
    ("full", "complete history"),
):
    _apply(
        f"gold.cov_matrix_{w}",
        f"Annualized covariance matrix of daily log-returns over the {label} "
        f"window. Computed as cov(X) × 252, symmetrized. Tickers with "
        f"incomplete coverage are excluded (see valid_tickers_{w}.json sidecar). "
        f"PSD-asserted: min eigenvalue ≥ -1e-10.",
        {**D, "layer": "gold", "source": "derived",
         "grain": "ticker_i+ticker_j", "pattern": "materialized_artifact",
         "window": w},
        {
            "ticker_i": "Row ticker.",
            "ticker_j": "Column ticker.",
            "cov": "Annualized covariance: cov(log_ret_i, log_ret_j) × 252.",
            "window_label": "Window identifier (1y / 5y / full).",
            "valid_through": "Last trading_date included in the window.",
        },
    )

_apply(
    "gold.kpis_per_ticker",
    "Per-ticker KPI snapshot. return_ytd is a log return (ln(close_last / "
    "close_first_in_year)). vol_annual is std(daily log returns) × √252. "
    "max_drawdown is peak-to-trough on the close series (always ≤ 0). "
    "sharpe_vs_cdi uses BCB SGS série 12 (CDI Over) averaged over each ticker's "
    "history window (cdi_annual_used column). NULL on Sharpe means < 20 obs.",
    {**D, "layer": "gold", "source": "derived",
     "grain": "ticker", "pattern": "materialized_artifact"},
    {
        "ticker": "Yahoo-suffixed B3 ticker.",
        "return_ytd": "Log return year-to-date.",
        "vol_annual": "Annualized volatility (std × √252).",
        "max_drawdown": "Peak-to-trough drawdown on close (≤ 0).",
        "sharpe_vs_cdi": "(annualized_return - cdi_annual_used) / vol_annual.",
        "cdi_annual_used": "Mean BCB CDI rate over this ticker's history (decimal).",
        "n_obs": "Number of daily log-return observations used in vol/Sharpe.",
        "last_close": "Most recent adjusted close (BRL).",
        "last_close_date": "Date of last_close.",
        "company_name": "Razão social (from silver.b3_ticker_dim).",
        "sector_b3": "Setor B3 (from silver.b3_ticker_dim).",
        "source_run_id": "GitHub Actions run id (provenance).",
        "as_of": "Snapshot date.",
        "cdi_global_mean": "Mean CDI over the whole pipeline window (debug/reference).",
    },
)

_apply(
    "gold.sector_aggregates",
    "Per-sector aggregates across all tickers in gold.kpis_per_ticker.",
    {**D, "layer": "gold", "source": "derived",
     "grain": "sector", "pattern": "materialized_artifact"},
    {
        "sector_b3": "Setor B3.",
        "member_count": "Number of tickers in this sector with non-null KPIs.",
        "return_ytd_mean": "Mean log return YTD across members.",
        "return_ytd_median": "Median log return YTD across members.",
        "vol_annual_mean": "Mean annualized volatility across members.",
        "members": "Array of member tickers.",
        "as_of": "Snapshot date.",
        "source_run_id": "GitHub Actions run id.",
    },
)


print("Governance applied to all tables and all columns.")
