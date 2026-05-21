# Databricks notebook source
"""Build silver.b3_ohlcv_adjusted from bronze.

Yahoo already returns split/dividend-adjusted close (`price_adjusted`); we
preserve both raw and adjusted, compute the adjustment factor, and gap-fill
flag (currently false; reserved for future intraday/halt handling).
"""
# COMMAND ----------
dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.silver")

spark.sql(f"""
CREATE OR REPLACE TABLE {catalog}.silver.b3_ohlcv_adjusted
USING DELTA
PARTITIONED BY (year(trading_date))
AS
SELECT
    ticker,
    trading_date,
    price_open      * (price_adjusted / NULLIF(price_close, 0)) AS open,
    price_high      * (price_adjusted / NULLIF(price_close, 0)) AS high,
    price_low       * (price_adjusted / NULLIF(price_close, 0)) AS low,
    price_adjusted                                              AS close,
    price_close                                                 AS close_raw,
    (price_adjusted / NULLIF(price_close, 0))                   AS adj_factor,
    volume,
    FALSE                                                       AS is_imputed
FROM {catalog}.bronze.b3_ohlcv_raw
WHERE price_close IS NOT NULL
  AND price_adjusted IS NOT NULL
""")

rows = spark.table(f"{catalog}.silver.b3_ohlcv_adjusted").count()
print(f"silver.b3_ohlcv_adjusted → {rows:,} rows")
