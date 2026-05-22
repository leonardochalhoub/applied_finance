# Databricks notebook source
"""Data quality asserts. Block exports if any check fails."""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

import numpy as np
import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

errors: list[str] = []


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


bronze_rows = spark.table(f"{catalog}.bronze.b3_ohlcv_raw").count()
bronze_null_pks = (
    spark.table(f"{catalog}.bronze.b3_ohlcv_raw")
    .where("ticker IS NULL OR trading_date IS NULL")
    .count()
)
_assert(bronze_null_pks == 0, f"bronze.b3_ohlcv_raw has {bronze_null_pks} null PKs")

silver_null_pks = (
    spark.table(f"{catalog}.silver.b3_ohlcv_adjusted")
    .where("ticker IS NULL OR trading_date IS NULL OR close IS NULL")
    .count()
)
_assert(silver_null_pks == 0, f"silver.b3_ohlcv_adjusted has {silver_null_pks} null PKs/close")

dim_dupe = spark.sql(f"""
    SELECT ticker, COUNT(*) AS n
    FROM {catalog}.silver.b3_ticker_dim
    WHERE is_current
    GROUP BY ticker
    HAVING COUNT(*) > 1
""").count()
_assert(dim_dupe == 0, f"silver.b3_ticker_dim has {dim_dupe} duplicate current rows")

for w in ("1y", "5y", "10y", "15y", "20y", "full"):
    df = spark.table(f"{catalog}.gold.cov_matrix_{w}").toPandas()
    if df.empty:
        errors.append(f"gold.cov_matrix_{w} is empty")
        continue
    tickers = sorted(set(df["ticker_i"]) | set(df["ticker_j"]))
    n = len(tickers)
    idx = {t: i for i, t in enumerate(tickers)}
    cov = np.zeros((n, n))
    for _, r in df.iterrows():
        cov[idx[r["ticker_i"]], idx[r["ticker_j"]]] = r["cov"]
    cov = 0.5 * (cov + cov.T)
    min_eig = float(np.linalg.eigvalsh(cov).min())
    _assert(min_eig >= -1e-10, f"gold.cov_matrix_{w} not PSD: min eig = {min_eig:.2e}")

kpi_rows = spark.table(f"{catalog}.gold.kpis_per_ticker").count()
_assert(kpi_rows >= 10, f"gold.kpis_per_ticker has only {kpi_rows} tickers (expected ≥ 10)")

bad_returns = (
    spark.table(f"{catalog}.gold.returns_wide")
    .toPandas()
    .drop(columns=["trading_date"])
    .abs()
    .max()
    .max()
)
_assert(bad_returns < 0.5, f"gold.returns_wide has an extreme daily log return: {bad_returns:.4f}")

if errors:
    raise RuntimeError("Quality gate failed:\n  - " + "\n  - ".join(errors))

log.info(f"Quality gate OK · bronze rows={bronze_rows:,} · kpi tickers={kpi_rows}")
