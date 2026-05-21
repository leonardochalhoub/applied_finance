import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# Databricks notebook source
"""Ingest OHLCV from Yahoo Finance via yfr_py and land Parquet to a UC Volume."""
# COMMAND ----------
# MAGIC %pip install -q "yfr_py @ git+https://github.com/leonardochalhoub/applied_finance.git#subdirectory=yfr_py"
# COMMAND ----------
dbutils.library.restartPython()
# COMMAND ----------
import datetime as dt
import os
import uuid
from pathlib import Path

import pandas as pd

from yfr_py import yf_get

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("volume_dir", "/Volumes/finance_prd/bronze/raw/yf")
dbutils.widgets.text("lookback_days", "10")

catalog = dbutils.widgets.get("catalog")
volume_dir = dbutils.widgets.get("volume_dir")
lookback_days = int(dbutils.widgets.get("lookback_days"))

today = dt.date.today()
first_date = today - dt.timedelta(days=lookback_days)
last_date = today

universe_path = Path(f"/Volumes/{catalog}/bronze/reference/ticker_universe.csv")
if not universe_path.exists():
    raise FileNotFoundError(
        f"{universe_path} not found. Upload data/ticker_universe.csv to the UC Volume first:"
        f"  databricks fs cp data/ticker_universe.csv dbfs:/Volumes/{catalog}/bronze/reference/"
    )
universe = pd.read_csv(universe_path)
active = universe[universe["listed_to"].isna()]
tickers = active["ticker"].tolist()

log.info(f"Ingesting {len(tickers)} active tickers from {first_date} to {last_date}")

df = yf_get(
    tickers=tickers,
    first_date=first_date,
    last_date=last_date,
    freq_data="daily",
    type_return="arit",
    do_cache=False,
    do_parallel=True,
    be_quiet=True,
)

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
