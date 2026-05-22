# Databricks notebook source
"""Build gold.returns_wide — wide log-returns matrix, one column per ticker."""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

import numpy as np
import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.gold")

silver = (
    spark.table(f"{catalog}.silver.b3_ohlcv_adjusted")
    .select("ticker", "trading_date", "close")
    .toPandas()
)
silver["trading_date"] = pd.to_datetime(silver["trading_date"])
silver = silver.drop_duplicates(subset=["ticker", "trading_date"], keep="last")

wide_close = silver.pivot(index="trading_date", columns="ticker", values="close").sort_index()
log_returns = np.log(wide_close / wide_close.shift(1))
log_returns = log_returns.iloc[1:]

# Outlier guard. Yahoo Finance occasionally returns corrupt single-day prices
# for less-liquid B3 tickers (typically a split or stock-conversion that
# wasn't propagated to the adjusted-close column, producing a one-day log
# return of order 10+ — a 200,000% move that is obviously wrong). These
# blow up downstream: Σ becomes ill-conditioned, the quality gate
# (`|r| < 0.5`) fails, and the whole refresh job aborts.
#
# We clip log returns at ±0.5 to NaN (≈ ±65% one-day move — exceeded only by
# IPO opening prints and corporate-action artifacts, never by legitimate B3
# trading). Downstream tables (cov_matrix, Ledoit-Wolf, Markowitz) already
# handle NaN via the coverage filter, so this is the cleanest dam against
# corrupt Yahoo data.
EXTREME_LOG_RETURN = 0.5
extreme_mask = log_returns.abs() > EXTREME_LOG_RETURN
n_extreme = int(extreme_mask.sum().sum())
if n_extreme:
    affected = (
        extreme_mask.any(axis=0)
        .pipe(lambda s: s[s].index.tolist())
    )
    log.warning(
        "Clipping %d extreme log returns (|r| > %.2f) → NaN. Affected tickers: %s",
        n_extreme, EXTREME_LOG_RETURN, affected,
    )
    log_returns = log_returns.where(~extreme_mask)

log_returns = log_returns.reset_index().rename(columns={"trading_date": "trading_date"})

sdf = spark.createDataFrame(log_returns)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.gold.returns_wide"
)
log.info(
    f"gold.returns_wide → {log_returns.shape[0]} dates × {log_returns.shape[1] - 1} tickers"
)
