# Databricks notebook source
"""Ingest OHLCV from Yahoo Finance via yfr_py and land Parquet to a UC Volume."""
# COMMAND ----------
# MAGIC %pip install -q "yfr_py @ git+https://github.com/leonardochalhoub/applied_finance.git#subdirectory=yfr_py"
# COMMAND ----------
dbutils.library.restartPython()
# COMMAND ----------
# `import logging` + log binding must live BELOW restartPython — the kernel
# restart wipes any globals set in earlier cells. Matches the same fix
# already applied to gold/mclean_{annual,pooled}.py in commit 0148ca9.
import datetime as dt
import logging
import os
import uuid
from pathlib import Path

import pandas as pd

from yfr_py import yf_get

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("volume_dir", "/Volumes/finance_prd/bronze/raw/yf")
dbutils.widgets.text("lookback_days", "10")
dbutils.widgets.text("first_date", "")  # Optional override (YYYY-MM-DD). If set, takes precedence over lookback_days.

catalog = dbutils.widgets.get("catalog")
volume_dir = dbutils.widgets.get("volume_dir")
lookback_days = int(dbutils.widgets.get("lookback_days"))
first_date_override = dbutils.widgets.get("first_date").strip()

today = dt.date.today()
if first_date_override:
    first_date = dt.date.fromisoformat(first_date_override)
else:
    first_date = today - dt.timedelta(days=lookback_days)
last_date = today
log.info(
    "Date range: %s → %s (%s)",
    first_date, last_date,
    "backfill override" if first_date_override else f"lookback={lookback_days}d",
)

universe_path = Path(f"/Volumes/{catalog}/bronze/reference/ticker_universe.csv")
if not universe_path.exists():
    raise FileNotFoundError(
        f"{universe_path} not found. Upload data/ticker_universe.csv to the UC Volume first:"
        f"  databricks fs cp data/ticker_universe.csv dbfs:/Volumes/{catalog}/bronze/reference/"
    )
universe = pd.read_csv(universe_path)
active = universe[universe["listed_to"].isna()]
tickers = active["ticker"].tolist()

# Two-mode ingest:
#   - EXISTING tickers (already in bronze.b3_ohlcv_raw) → short lookback only.
#   - NEW tickers (just added to ticker_universe.csv, no bronze rows yet) →
#     full backfill from BACKFILL_FROM so the silver/gold tables don't have
#     a 10-day-long ticker dragging the universe-wide coverage filter down.
#
# Without this split, every ticker added to the universe CSV would appear
# in the app with ~10 days of price history (since lookback_days defaults
# to 10), fail every long-window coverage filter, and the user would see
# "5Y / 10Y / MAX collapse to the same data" indefinitely until 20-30
# manual backfill runs caught up.
BACKFILL_FROM = dt.date(2000, 1, 3)

# A ticker is "well-covered" if bronze.b3_ohlcv_raw has at least
# MIN_DAYS_FOR_LOOKBACK rows for it (≈ 1 trading year of history). Anything
# below that gets full-backfilled — covers the case where bronze has
# historically been a sliding 10-day window, not a full archive, so even
# the long-time tickers like PETR4 / VALE3 have only ~10 rows.
MIN_DAYS_FOR_LOOKBACK = 252

try:
    coverage = (
        spark.sql(
            f"""
            SELECT ticker, COUNT(*) AS n_days
            FROM {catalog}.bronze.b3_ohlcv_raw
            GROUP BY ticker
            HAVING n_days >= {MIN_DAYS_FOR_LOOKBACK}
            """
        )
        .toPandas()["ticker"]
        .tolist()
    )
    well_covered = set(coverage)
except Exception as e:
    log.warning("bronze.b3_ohlcv_raw not queryable (%s) — full-backfill EVERY ticker", e)
    well_covered = set()

new_tickers = [t for t in tickers if t not in well_covered]
returning_tickers = [t for t in tickers if t in well_covered]
log.info(
    "Universe split: %d need full backfill from %s · %d well-covered (lookback %s, threshold ≥%d days)",
    len(new_tickers), BACKFILL_FROM, len(returning_tickers), first_date, MIN_DAYS_FOR_LOOKBACK,
)

run_id = os.environ.get("DATABRICKS_RUN_ID", str(uuid.uuid4()))
out_dir = f"{volume_dir}/run_id={run_id}"
dbutils.fs.mkdirs(out_dir)


def _persist(chunk_df: pd.DataFrame, label: str) -> None:
    """Write a fetched chunk to its own Parquet immediately. Partial progress
    survives cancellation: the next refresh-pipelines run's bronze MERGE
    picks up every chunk that landed in /Volumes/.../yf/run_id={run_id}/.
    Each chunk gets a unique filename so chunks within one run_id don't
    collide."""
    if chunk_df is None or len(chunk_df) == 0:
        return
    chunk_df = chunk_df.copy()
    chunk_df["source_run_id"] = run_id
    chunk_df["ingested_at"] = pd.Timestamp.utcnow()
    out_path = f"{out_dir}/{label}.parquet"
    chunk_df.to_parquet(out_path, index=False)
    log.info("Wrote %s rows → %s", f"{len(chunk_df):,}", out_path)


total_rows = 0
if returning_tickers:
    df_old = yf_get(
        tickers=returning_tickers,
        first_date=first_date,
        last_date=last_date,
        freq_data="daily",
        type_return="arit",
        do_cache=False,
        do_parallel=True,
        be_quiet=True,
        # yfr_py defaults thresh_bad_data=0.75: it drops any ticker whose
        # date coverage vs ^BVSP is below 75%. Over a 2000→today bench
        # window (~6500 trading days), every B3 ticker that IPO'd after
        # ~2010 (IRBR3, BPAC11, NTCO3, RAIZ4, …) fails the threshold and
        # gets silently dropped. We want full history for newer listings,
        # so disable the filter — quality control is downstream in
        # gold.kpis_per_ticker via MIN_OBS_FOR_VOL.
        thresh_bad_data=0.0,
    )
    _persist(df_old, "returning")
    total_rows += len(df_old) if df_old is not None else 0

if new_tickers:
    # Yahoo can handle ~250+ tickers × 25y in one call, but chunk into 50
    # for two reasons: (1) graceful degradation on timeouts, and (2) partial
    # progress survives cancellation since each chunk persists immediately.
    CHUNK = 50
    n_batches = (len(new_tickers) + CHUNK - 1) // CHUNK
    for i in range(0, len(new_tickers), CHUNK):
        chunk = new_tickers[i : i + CHUNK]
        batch_idx = i // CHUNK + 1
        log.info("backfill batch %d/%d: %d tickers", batch_idx, n_batches, len(chunk))
        df_new_chunk = yf_get(
            tickers=chunk,
            first_date=BACKFILL_FROM,
            last_date=last_date,
            freq_data="daily",
            type_return="arit",
            do_cache=False,
            do_parallel=True,
            be_quiet=True,
            # Same thresh_bad_data=0.0 rationale as the returning_tickers
            # call above — the bench-coverage filter would drop every
            # post-2010 IPO from a 2000→today backfill window.
            thresh_bad_data=0.0,
        )
        _persist(df_new_chunk, f"backfill_batch_{batch_idx:03d}")
        total_rows += len(df_new_chunk) if df_new_chunk is not None else 0

if total_rows == 0:
    raise RuntimeError("No tickers ingested — universe CSV empty or all tickers delisted?")

dbutils.jobs.taskValues.set(key="ingest_run_id", value=run_id)
dbutils.jobs.taskValues.set(key="ingest_rows", value=total_rows)
