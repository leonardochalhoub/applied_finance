# Databricks notebook source
"""Per-ticker KPI snapshot: return YTD, annualized vol, max drawdown, Sharpe vs CDI.

The CDI annual rate is a build-time constant pulled from a small TXT in
`data/`; sourcing from BCB is a Phase-2 enhancement.
"""
# COMMAND ----------
import datetime as dt
import os
from pathlib import Path

import numpy as np
import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("cdi_annual", "0.1075")
catalog = dbutils.widgets.get("catalog")
cdi_annual = float(dbutils.widgets.get("cdi_annual"))

today = dt.date.today()
ytd_start = dt.date(today.year, 1, 1)

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

records = []
for ticker, grp in silver.groupby("ticker"):
    grp = grp.sort_values("trading_date").reset_index(drop=True)
    if len(grp) < 2:
        continue
    last = grp.iloc[-1]
    last_close = float(last["close"])
    last_date = last["trading_date"].date()

    ytd = grp[grp["trading_date"].dt.date >= ytd_start]
    if not ytd.empty:
        first_ytd = float(ytd["close"].iloc[0])
        return_ytd = float(np.log(last_close / first_ytd)) if first_ytd > 0 else None
    else:
        return_ytd = None

    log_ret = np.log(grp["close"].to_numpy() / grp["close"].shift(1).to_numpy())[1:]
    log_ret = log_ret[np.isfinite(log_ret)]
    if len(log_ret) < 20:
        vol_annual = None
        sharpe = None
    else:
        vol_annual = float(np.std(log_ret, ddof=1) * np.sqrt(252))
        mean_ann = float(np.mean(log_ret) * 252)
        sharpe = float((mean_ann - cdi_annual) / vol_annual) if vol_annual > 0 else None

    prices = grp["close"].to_numpy()
    peaks = np.maximum.accumulate(prices)
    drawdowns = (prices - peaks) / peaks
    max_dd = float(drawdowns.min()) if len(drawdowns) else None

    records.append({
        "ticker": ticker,
        "return_ytd": return_ytd,
        "vol_annual": vol_annual,
        "max_drawdown": max_dd,
        "sharpe_vs_cdi": sharpe,
        "last_close": last_close,
        "last_close_date": last_date.isoformat(),
    })

df = pd.DataFrame(records)
df = df.merge(dim, on="ticker", how="left")

run_id = os.environ.get("DATABRICKS_RUN_ID", "local")
df["source_run_id"] = run_id
df["as_of"] = today.isoformat()

sdf = spark.createDataFrame(df)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.gold.kpis_per_ticker"
)
print(f"gold.kpis_per_ticker → {len(df)} tickers")
