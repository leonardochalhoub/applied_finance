# Databricks notebook source
"""Build gold.cov_matrix_<window> + valid_tickers_<window>.json sidecar.

Windows:
  - 1y:   last 252 trading days
  - 5y:   last 1260 trading days
  - full: every row available
"""
# COMMAND ----------
import datetime as dt
import json
import os

import numpy as np
import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("window", "5y")
catalog = dbutils.widgets.get("catalog")
window = dbutils.widgets.get("window")

window_days = {"1y": 252, "5y": 1260, "full": None}[window]

returns = spark.table(f"{catalog}.gold.returns_wide").toPandas()
returns = returns.sort_values("trading_date").reset_index(drop=True)
if window_days is not None and len(returns) > window_days:
    returns = returns.tail(window_days)

ticker_cols = [c for c in returns.columns if c != "trading_date"]

valid: list[str] = []
excluded: list[dict[str, str]] = []
for c in ticker_cols:
    series = returns[c]
    if series.notna().all():
        valid.append(c)
    else:
        excluded.append({"ticker": c, "reason": "insufficient_history"})

if not valid:
    raise RuntimeError(f"No ticker has complete coverage in window {window}")

X = returns[valid].to_numpy(dtype=np.float64)
cov = np.cov(X.T, ddof=1) * 252.0
cov = 0.5 * (cov + cov.T)
min_eig = float(np.linalg.eigvalsh(cov).min())
assert min_eig >= -1e-10, f"Covariance not PSD: min eigenvalue = {min_eig}"

long_rows = []
window_end_date = returns["trading_date"].max()
for i, ti in enumerate(valid):
    for j, tj in enumerate(valid):
        long_rows.append({
            "ticker_i": ti,
            "ticker_j": tj,
            "cov": float(cov[i, j]),
            "window_label": window,
            "valid_through": pd.Timestamp(window_end_date).date(),
        })
long_df = pd.DataFrame(long_rows)
sdf = spark.createDataFrame(long_df)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.gold.cov_matrix_{window}"
)
print(
    f"gold.cov_matrix_{window} → {len(valid)} tickers, "
    f"{len(long_df)} cells, min eigenvalue = {min_eig:.2e}"
)

run_id = os.environ.get("DATABRICKS_RUN_ID", "local")
sidecar = {
    "window_label": window,
    "as_of": dt.date.today().isoformat(),
    "source_run_id": run_id,
    "window_start": pd.Timestamp(returns["trading_date"].min()).date().isoformat(),
    "window_end": pd.Timestamp(window_end_date).date().isoformat(),
    "valid_tickers": valid,
    "excluded_tickers": excluded,
}
artifacts_dir = f"/Volumes/{catalog}/gold/artifacts"
dbutils.fs.mkdirs(artifacts_dir)
with open(f"{artifacts_dir}/valid_tickers_{window}.json", "w") as f:
    json.dump(sidecar, f, indent=2)
print(
    f"valid_tickers_{window}.json → {len(valid)} valid, {len(excluded)} excluded"
)
