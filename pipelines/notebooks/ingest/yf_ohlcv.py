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

try:
    existing = set(
        spark.sql(f"SELECT DISTINCT ticker FROM {catalog}.bronze.b3_ohlcv_raw")
            .toPandas()["ticker"]
            .tolist()
    )
except Exception as e:
    log.warning("bronze.b3_ohlcv_raw not queryable (%s) — full-backfill EVERY ticker", e)
    existing = set()

new_tickers = [t for t in tickers if t not in existing]
returning_tickers = [t for t in tickers if t in existing]
log.info(
    "Universe split: %d new (backfill from %s) · %d returning (lookback %s)",
    len(new_tickers), BACKFILL_FROM, len(returning_tickers), first_date,
)

frames: list[pd.DataFrame] = []
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
    )
    log.info("returning batch: %d rows", len(df_old))
    frames.append(df_old)

if new_tickers:
    # Yahoo can handle ~250+ tickers × 25y in one call, but be defensive
    # in case of timeouts: chunk into 50 per call.
    CHUNK = 50
    for i in range(0, len(new_tickers), CHUNK):
        chunk = new_tickers[i : i + CHUNK]
        log.info("backfill batch %d/%d: %d tickers", i // CHUNK + 1, (len(new_tickers) + CHUNK - 1) // CHUNK, len(chunk))
        df_new_chunk = yf_get(
            tickers=chunk,
            first_date=BACKFILL_FROM,
            last_date=last_date,
            freq_data="daily",
            type_return="arit",
            do_cache=False,
            do_parallel=True,
            be_quiet=True,
        )
        frames.append(df_new_chunk)

if not frames:
    raise RuntimeError("No tickers ingested — universe CSV empty or all tickers delisted?")

df = pd.concat(frames, ignore_index=True)

run_id = os.environ.get("DATABRICKS_RUN_ID", str(uuid.uuid4()))
df["source_run_id"] = run_id
df["ingested_at"] = pd.Timestamp.utcnow()

out_dir = f"{volume_dir}/run_id={run_id}"
dbutils.fs.mkdirs(out_dir)
out_path = f"{out_dir}/ohlcv.parquet"
df.to_parquet(out_path, index=False)
log.info(f"Wrote {len(df):,} rows → {out_path}")

dbutils.jobs.taskValues.set(key="ingest_run_id", value=run_id)
dbutils.jobs.taskValues.set(key="ingest_rows", value=len(df))
