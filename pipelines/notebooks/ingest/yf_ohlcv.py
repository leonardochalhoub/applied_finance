# Databricks notebook source
"""Ingest OHLCV from Yahoo Finance via yfr_py and land Parquet to a UC Volume."""
# COMMAND ----------
# MAGIC %pip install -q yfinance pyarrow httpx
# COMMAND ----------
import datetime as dt
import os
import sys
import uuid
from pathlib import Path

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("volume_dir", "/Volumes/finance_prd/bronze/raw/yf")
dbutils.widgets.text("lookback_days", "10")

catalog = dbutils.widgets.get("catalog")
volume_dir = dbutils.widgets.get("volume_dir")
lookback_days = int(dbutils.widgets.get("lookback_days"))

repo_root = Path("/Workspace/Repos") if Path("/Workspace/Repos").exists() else Path.cwd().parent.parent
sys.path.insert(0, str(repo_root / "yfr_py" / "src"))

from yfr_py import yf_get  # noqa: E402

import pandas as pd  # noqa: E402

today = dt.date.today()
first_date = today - dt.timedelta(days=lookback_days)
last_date = today

universe_path = next(
    p for p in [
        Path(f"/Volumes/{catalog}/bronze/reference/ticker_universe.csv"),
        repo_root / "data" / "ticker_universe.csv",
    ]
    if p.exists()
)
universe = pd.read_csv(universe_path)
active = universe[universe["listed_to"].isna()]
tickers = active["ticker"].tolist()

print(f"Ingesting {len(tickers)} active tickers from {first_date} to {last_date}")

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

dbutils.fs.mkdirs(volume_dir)
out_path = f"{volume_dir}/run_id={run_id}/ohlcv.parquet"
df.to_parquet(out_path, index=False)
print(f"Wrote {len(df):,} rows → {out_path}")

dbutils.jobs.taskValues.set(key="ingest_run_id", value=run_id)
dbutils.jobs.taskValues.set(key="ingest_rows", value=len(df))
