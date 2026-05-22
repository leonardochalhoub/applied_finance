# Databricks notebook source
"""Per-ticker KPI snapshot.

Implements:
  - return_ytd        log return YTD (close[last_in_year] / close[first_in_year])
  - vol_annual        std(daily log returns, ddof=1) × √252
  - max_drawdown      min((P − cummax(P)) / cummax(P))   [≤ 0]
  - sharpe_vs_cdi     (mean_log_return × 252 − cdi_annual_mean) / vol_annual

CDI is pulled from BCB SGS série 12 (CDI Over, daily annualized %). The mean of
CDI over each ticker's own price-history window is used as the risk-free rate
for that ticker. Both the CDI source (mean used) and a coverage note (n_obs)
are published into the artifact so consumers can audit the Sharpe.
"""
# COMMAND ----------
# MAGIC %pip install -q httpx
# COMMAND ----------
dbutils.library.restartPython()
# COMMAND ----------
import datetime as dt
import json
import logging
import os
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

log = logging.getLogger("gold.kpis_per_ticker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("cdi_fallback_annual", "0.1290")
catalog = dbutils.widgets.get("catalog")
cdi_fallback_annual = float(dbutils.widgets.get("cdi_fallback_annual"))

today = dt.date.today()
ytd_start = dt.date(today.year, 1, 1)


def _fetch_cdi(start: dt.date, end: dt.date) -> pd.DataFrame:
    """Fetch BCB SGS série 12 (CDI Over, daily) and annualize."""
    url = (
        "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados"
        f"?formato=json&dataInicial={start.strftime('%d/%m/%Y')}"
        f"&dataFinal={end.strftime('%d/%m/%Y')}"
    )
    with httpx.Client(timeout=30.0) as client:
        r = client.get(url)
        r.raise_for_status()
    rows = r.json()
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["data"], dayfirst=True).dt.date
    df["rate_daily"] = df["valor"].astype(float) / 100.0
    df["rate_annual"] = (1 + df["rate_daily"]) ** 252 - 1
    return df[["date", "rate_daily", "rate_annual"]].sort_values("date").reset_index(drop=True)


silver = (
    spark.table(f"{catalog}.silver.b3_ohlcv_adjusted")
    .select("ticker", "trading_date", "close")
    .toPandas()
)
silver["trading_date"] = pd.to_datetime(silver["trading_date"])
silver = silver.drop_duplicates(subset=["ticker", "trading_date"], keep="last")

dim = (
    spark.table(f"{catalog}.silver.b3_ticker_dim")
    .where("is_current")
    .select("ticker", "company_name", "sector_b3")
    .toPandas()
)

# CDI window covering the full history of any ticker, plus a safety margin
min_d = silver["trading_date"].min().date() if len(silver) else dt.date(today.year - 5, 1, 1)
try:
    cdi_df = _fetch_cdi(min_d - dt.timedelta(days=30), today)
    cdi_lookup = {row["date"]: row["rate_annual"] for _, row in cdi_df.iterrows()}
    cdi_global_mean = float(cdi_df["rate_annual"].mean())
    log.info(
        "CDI fetched from BCB: %d business days, mean=%.4f, last=%.4f",
        len(cdi_df), cdi_global_mean, cdi_df["rate_annual"].iloc[-1],
    )
except Exception as exc:
    log.warning("BCB CDI fetch failed (%s); falling back to constant %.4f", exc, cdi_fallback_annual)
    cdi_df = pd.DataFrame(columns=["date", "rate_daily", "rate_annual"])
    cdi_lookup = {}
    cdi_global_mean = cdi_fallback_annual

MIN_OBS_FOR_VOL = 20

records = []
for ticker, grp in silver.groupby("ticker"):
    grp = grp.sort_values("trading_date").reset_index(drop=True)
    if len(grp) < 2:
        continue
    last = grp.iloc[-1]
    last_close = float(last["close"])
    last_date = last["trading_date"].date()

    ytd = grp[grp["trading_date"].dt.date >= ytd_start]
    if len(ytd) >= 2:
        first_ytd = float(ytd["close"].iloc[0])
        return_ytd = float(np.log(last_close / first_ytd)) if first_ytd > 0 else None
    else:
        return_ytd = None

    log_ret = np.log(grp["close"].to_numpy() / grp["close"].shift(1).to_numpy())[1:]
    log_ret = log_ret[np.isfinite(log_ret)]
    n_obs = int(log_ret.shape[0])

    if n_obs < MIN_OBS_FOR_VOL:
        vol_annual = None
        sharpe = None
        cdi_used = None
    else:
        vol_annual = float(np.std(log_ret, ddof=1) * np.sqrt(252))
        mean_ann = float(np.mean(log_ret) * 252)
        # CDI rate averaged over this ticker's trading dates
        ticker_dates = grp["trading_date"].dt.date.tolist()
        ticker_cdi = [cdi_lookup[d] for d in ticker_dates if d in cdi_lookup]
        if ticker_cdi:
            cdi_used = float(np.mean(ticker_cdi))
        else:
            cdi_used = cdi_global_mean
        sharpe = float((mean_ann - cdi_used) / vol_annual) if vol_annual > 0 else None

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
        "cdi_annual_used": cdi_used,
        "n_obs": n_obs,
        "last_close": last_close,
        "last_close_date": last_date.isoformat(),
    })

df = pd.DataFrame(records).merge(dim, on="ticker", how="left")

run_id = os.environ.get("DATABRICKS_RUN_ID", "local")
df["source_run_id"] = run_id
df["as_of"] = today.isoformat()
df["cdi_global_mean"] = cdi_global_mean

# Force-cast numeric columns to float64 so Spark schema inference can't drop
# an all-None column. Without this, when every ticker has < MIN_OBS_FOR_VOL
# observations (e.g. fresh bronze, short window, or yf_ohlcv lookback miss),
# `vol_annual` / `max_drawdown` / `sharpe_vs_cdi` / `cdi_annual_used` /
# `last_close` are all `None` → pandas dtype = `object` → Spark can't infer
# a type → the column silently disappears from the written Delta table.
# Downstream `gold.sector_aggregates` then crashes with
#   [INTERNAL_ERROR_ATTRIBUTE_NOT_FOUND] Could not find vol_annual ...
# Casting to float64 turns None into NaN which Spark reads as a nullable
# DoubleType column, preserved through to the Delta schema.
NUMERIC_COLS = (
    "return_ytd", "vol_annual", "max_drawdown", "sharpe_vs_cdi",
    "cdi_annual_used", "last_close",
)
for col in NUMERIC_COLS:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")
INTEGER_COLS = ("n_obs",)
for col in INTEGER_COLS:
    if col in df.columns:
        # nullable Int64 → Spark LongType (preserved even when all-null)
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

sdf = spark.createDataFrame(df)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.gold.kpis_per_ticker"
)
log.info("gold.kpis_per_ticker → %d tickers · cdi_global_mean=%.4f", len(df), cdi_global_mean)

# Publish the CDI series as a sidecar artifact for the frontend
artifacts_dir = f"/Volumes/{catalog}/gold/artifacts"
dbutils.fs.mkdirs(artifacts_dir)
cdi_payload = {
    "source": "BCB SGS série 12 (CDI Over)",
    "fetched_at": pd.Timestamp.now(dt.timezone.utc).isoformat(),
    "global_mean_annual": cdi_global_mean,
    "rows": cdi_df.assign(date=cdi_df["date"].astype(str)).round(6).to_dict("records"),
}
with open(f"{artifacts_dir}/cdi.json", "w") as f:
    json.dump(cdi_payload, f, separators=(",", ":"), default=str)
log.info("cdi.json → %s rows", len(cdi_df))
