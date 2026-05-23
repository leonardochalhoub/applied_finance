# Databricks notebook source
"""Build silver.b3_ohlcv_adjusted from bronze.

Yahoo already returns split/dividend-adjusted close (`price_adjusted`); we
preserve both raw and adjusted, compute the adjustment factor, and gap-fill
flag (currently false; reserved for future intraday/halt handling).
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.silver")

spark.sql(f"""
CREATE OR REPLACE TABLE {catalog}.silver.b3_ohlcv_adjusted
USING DELTA
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
  -- Yahoo ships negative price_adjusted for a handful of B3 tickers during
  -- historical corporate-action windows (split / spin-off / migration):
  --   OIBR4 → ~986 rows from 2002-2007  (min adj = -128,771)
  --   SANB3 → ~2384 rows starting 2000  (min adj = -50,550)
  --   SANB4 → ~2384 rows starting 2000  (min adj = -44,238)
  --   EPAR3 → ~253 rows starting 2003   (min adj = -0.34)
  -- Equity adjusted close cannot be ≤ 0 (Yahoo's split-adjustment logic
  -- divides by a forward-only chain of ratios; a sign flip there is a
  -- pipeline bug, not market data). Without this filter, the first-valid
  -- value picked by prices_artifacts.py for OIBR4 ends up negative, the
  -- entire normalized series gets sign-flipped, and every frontend that
  -- consumes prices_normalized.json (sparklines, sector detail tables,
  -- Markowitz inputs) sees nonsensical -0.00149 prices in 2026.
  AND price_adjusted > 0
""")

rows = spark.table(f"{catalog}.silver.b3_ohlcv_adjusted").count()
log.info(f"silver.b3_ohlcv_adjusted → {rows:,} rows")
