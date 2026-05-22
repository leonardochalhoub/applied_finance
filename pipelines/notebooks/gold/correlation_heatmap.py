# Databricks notebook source
"""Top-N most-correlated and least-correlated pairs over the 1y window."""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

import datetime as dt
import os

import numpy as np
import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("window", "1y")
dbutils.widgets.text("top_n", "50")
catalog = dbutils.widgets.get("catalog")
window = dbutils.widgets.get("window")
top_n = int(dbutils.widgets.get("top_n"))

window_days = {"1y": 252, "5y": 1260, "full": None}[window]

returns = (
    spark.table(f"{catalog}.gold.returns_wide")
    .toPandas()
    .sort_values("trading_date")
    .reset_index(drop=True)
)
if window_days is not None and len(returns) > window_days:
    returns = returns.tail(window_days)

ticker_cols = [c for c in returns.columns if c != "trading_date"]
valid = [c for c in ticker_cols if returns[c].notna().all()]
corr = returns[valid].corr().to_numpy()

dim = (
    spark.table(f"{catalog}.silver.b3_ticker_dim")
    .where("is_current")
    .select("ticker", "sector_b3")
    .toPandas()
    .set_index("ticker")["sector_b3"]
    .to_dict()
)

pairs: list[dict[str, object]] = []
for i in range(len(valid)):
    for j in range(i + 1, len(valid)):
        pairs.append({
            "ticker_i": valid[i],
            "ticker_j": valid[j],
            "correlation": float(corr[i, j]),
            "sector_i": dim.get(valid[i], ""),
            "sector_j": dim.get(valid[j], ""),
        })

pairs_df = pd.DataFrame(pairs)
pairs_df = pairs_df.replace({np.nan: None})
top_pos = (
    pairs_df.sort_values("correlation", ascending=False).head(top_n).to_dict("records")
)
top_neg = (
    pairs_df.sort_values("correlation", ascending=True).head(top_n).to_dict("records")
)

out = {
    "as_of": dt.date.today().isoformat(),
    "source_run_id": os.environ.get("DATABRICKS_RUN_ID", "local"),
    "window_label": window,
    "top_correlated": top_pos,
    "top_anti_correlated": top_neg,
}

artifacts_dir = f"/Volumes/{catalog}/gold/artifacts"
dbutils.fs.mkdirs(artifacts_dir)
import json
with open(f"{artifacts_dir}/correlation_heatmap.json", "w") as f:
    json.dump(out, f, indent=2)

log.info(
    f"correlation_heatmap → {len(valid)} tickers, "
    f"top {top_n} correlated and {top_n} anti-correlated"
)
