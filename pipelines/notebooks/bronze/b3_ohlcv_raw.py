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

stage = spark.read.parquet(f"/Volumes/{catalog}/bronze/raw/yf/*/ohlcv.parquet").selectExpr(
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
