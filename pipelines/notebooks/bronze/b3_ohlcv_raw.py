# Databricks notebook source
"""MERGE Parquet runs from /Volumes/.../bronze/raw/yf/** into bronze.b3_ohlcv_raw."""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.bronze")
spark.sql(f"""
CREATE TABLE IF NOT EXISTS {catalog}.bronze.b3_ohlcv_raw (
    ticker          STRING NOT NULL,
    trading_date    DATE   NOT NULL,
    price_open      DOUBLE,
    price_high      DOUBLE,
    price_low       DOUBLE,
    price_close     DOUBLE,
    volume          BIGINT,
    price_adjusted  DOUBLE,
    source_run_id   STRING NOT NULL,
    ingested_at     TIMESTAMP NOT NULL
)
USING DELTA
TBLPROPERTIES (
    delta.autoOptimize.optimizeWrite = true,
    delta.autoOptimize.autoCompact   = true
)
""")

from pyspark.sql import Window
from pyspark.sql import functions as F

# Glob ALL parquet files in each run_id dir, not just `ohlcv.parquet`.
# yf_ohlcv.py used to write a single `ohlcv.parquet` per run; commit 5c4ceb2
# (per-chunk persistence) changed that to one file per logical chunk:
# `returning.parquet` (lookback ingest) and `backfill_batch_NNN.parquet`
# (full-history backfill, chunked). The old glob silently dropped every
# new-format landing dir — the universe-expansion + IRBR-fix backfills
# (May 22-24, 290 tickers fetched) sat in the volume for 2 days without
# ever reaching bronze, capping the deployed site at the 134 tickers from
# pre-5c4ceb2 ohlcv.parquet runs. `*/*.parquet` picks up both formats so
# old dirs keep merging too.
stage = spark.read.parquet(f"/Volumes/{catalog}/bronze/raw/yf/*/*.parquet").selectExpr(
    "ticker",
    "to_date(ref_date) AS trading_date",
    "CAST(price_open AS DOUBLE) AS price_open",
    "CAST(price_high AS DOUBLE) AS price_high",
    "CAST(price_low AS DOUBLE) AS price_low",
    "CAST(price_close AS DOUBLE) AS price_close",
    "CAST(volume AS BIGINT) AS volume",
    "CAST(price_adjusted AS DOUBLE) AS price_adjusted",
    "source_run_id",
    "ingested_at",
)

w = Window.partitionBy("ticker", "trading_date").orderBy(F.col("ingested_at").desc())
stage = (
    stage.withColumn("_rn", F.row_number().over(w))
    .where("_rn = 1")
    .drop("_rn")
)
stage.createOrReplaceTempView("stage_ohlcv")

spark.sql(f"""
MERGE INTO {catalog}.bronze.b3_ohlcv_raw AS tgt
USING (
    SELECT * FROM stage_ohlcv
) AS src
ON  tgt.ticker = src.ticker
AND tgt.trading_date = src.trading_date
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *
""")

merged_rows = spark.table(f"{catalog}.bronze.b3_ohlcv_raw").count()
log.info(f"bronze.b3_ohlcv_raw → {merged_rows:,} rows total")
dbutils.jobs.taskValues.set(key="bronze_rows", value=merged_rows)
