# Databricks notebook source
"""MERGE Parquet runs from /Volumes/.../bronze/raw/yf/** into bronze.b3_ohlcv_raw."""
# COMMAND ----------
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
PARTITIONED BY (year(trading_date))
TBLPROPERTIES (
    delta.autoOptimize.optimizeWrite = true,
    delta.autoOptimize.autoCompact   = true
)
""")

stage = spark.read.parquet(f"/Volumes/{catalog}/bronze/raw/yf/*/ohlcv.parquet")
stage = (
    stage.selectExpr(
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
    .dropDuplicates(["ticker", "trading_date", "source_run_id"])
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
print(f"bronze.b3_ohlcv_raw → {merged_rows:,} rows total")
dbutils.jobs.taskValues.set(key="bronze_rows", value=merged_rows)
