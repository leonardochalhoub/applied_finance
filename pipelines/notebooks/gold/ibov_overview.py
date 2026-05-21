import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# Databricks notebook source
"""IBOV overview: current composition + per-component YTD + contribution."""
# COMMAND ----------
import datetime as dt
import json
import os

import numpy as np
import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

today = dt.date.today()
ytd_start = dt.date(today.year, 1, 1)

members = (
    spark.table(f"{catalog}.silver.b3_index_members_long")
    .where("index = 'IBOV' AND is_current")
    .select("ticker", "weight")
    .toPandas()
)
silver = (
    spark.table(f"{catalog}.silver.b3_ohlcv_adjusted")
    .select("ticker", "trading_date", "close")
    .toPandas()
)
silver["trading_date"] = pd.to_datetime(silver["trading_date"])

dim = (
    spark.table(f"{catalog}.silver.b3_ticker_dim")
    .where("is_current")
    .select("ticker", "company_name", "sector_b3")
    .toPandas()
)

rows = []
for _, m in members.iterrows():
    t = m["ticker"]
    grp = silver[silver["ticker"] == t].sort_values("trading_date")
    if grp.empty:
        continue
    ytd = grp[grp["trading_date"].dt.date >= ytd_start]
    if ytd.empty:
        return_ytd = None
    else:
        return_ytd = float(np.log(grp["close"].iloc[-1] / ytd["close"].iloc[0]))
    info = dim[dim["ticker"] == t].iloc[0] if not dim[dim["ticker"] == t].empty else None
    rows.append({
        "ticker": t,
        "company_name": info["company_name"] if info is not None else "",
        "sector_b3": info["sector_b3"] if info is not None else "",
        "weight": float(m["weight"]),
        "return_ytd": return_ytd,
        "contribution_to_ytd": (
            float(m["weight"]) * return_ytd if return_ytd is not None else None
        ),
    })

index_return_ytd = sum(
    r["contribution_to_ytd"] for r in rows if r["contribution_to_ytd"] is not None
)

out = {
    "as_of": today.isoformat(),
    "source_run_id": os.environ.get("DATABRICKS_RUN_ID", "local"),
    "index_level": 0.0,
    "index_return_ytd": index_return_ytd,
    "members": rows,
}

artifacts_dir = f"/Volumes/{catalog}/gold/artifacts"
dbutils.fs.mkdirs(artifacts_dir)
with open(f"{artifacts_dir}/ibov_overview.json", "w") as f:
    json.dump(out, f, indent=2, default=str)
log.info(f"ibov_overview → {len(rows)} members, index YTD = {index_return_ytd:.4f}")
