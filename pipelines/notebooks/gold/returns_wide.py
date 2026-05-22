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
log_returns = log_returns.reset_index().rename(columns={"trading_date": "trading_date"})

sdf = spark.createDataFrame(log_returns)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.gold.returns_wide"
)
log.info(
    f"gold.returns_wide → {log_returns.shape[0]} dates × {log_returns.shape[1] - 1} tickers"
)
