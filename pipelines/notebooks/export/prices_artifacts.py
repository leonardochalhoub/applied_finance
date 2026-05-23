# Databricks notebook source
"""Export prices_normalized.json + prices_close.json for the Next.js app.

Both artifacts share a wide-format shape:

    {
      "as_of": "YYYY-MM-DD",
      "rebase": 100,                 # normalized only — first non-null = 100
      "currency": "BRL",             # close only
      "dates":   [d_0, d_1, ...],    # all trading dates in scope
      "series":  { "<ticker>": [v_0, v_1, ...], ... }
    }

Both artifacts are pivoted from `silver.b3_ohlcv_adjusted` so they cover the
FULL universe — no coverage filter. Tickers with missing observations on
a given date get `null`. App-side code (`lib/windowed.ts`, `PortfolioBuilder`,
`PortfolioSuggestions`) already handles `null` values per ticker via its
own coverage filter at chart-render time.

This notebook fixes a gap discovered 2026-05-22: previously these two JSONs
were checked into the repo as static files (~50 tickers, ~6600 dates) and
never re-emitted by the pipeline — the refresh job updated every other
artifact but left the prices feed frozen at whatever was last manually
generated. After this notebook is wired into databricks.yml, the GH Action
that copies `/Volumes/.../gold/artifacts/` into `app/public/data/` picks
them up automatically.
"""
# COMMAND ----------
import datetime as dt
import json
import logging
import os

import numpy as np
import pandas as pd

log = logging.getLogger("export.prices_artifacts")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("artifacts_dir", "/Volumes/finance_prd/gold/artifacts")
catalog = dbutils.widgets.get("catalog")
artifacts_dir = dbutils.widgets.get("artifacts_dir")
dbutils.fs.mkdirs(artifacts_dir)

run_id = os.environ.get("DATABRICKS_RUN_ID", "local")
as_of = dt.date.today().isoformat()

# ── Load adjusted prices ───────────────────────────────────────────────────
prices = (
    spark.table(f"{catalog}.silver.b3_ohlcv_adjusted")
    .select("ticker", "trading_date", "close")
    .toPandas()
)
prices["trading_date"] = pd.to_datetime(prices["trading_date"]).dt.date
prices = prices.drop_duplicates(subset=["ticker", "trading_date"], keep="last")

# ── Pivot to wide (date × ticker) ──────────────────────────────────────────
wide = prices.pivot(index="trading_date", columns="ticker", values="close").sort_index()
dates = [str(d) for d in wide.index]
tickers = sorted(wide.columns.tolist())

log.info("prices wide: %d dates × %d tickers", len(dates), len(tickers))


def _series_with_nulls(col: pd.Series) -> list:
    """Convert pandas series with NaN → list with native Python None."""
    out: list = []
    for v in col.tolist():
        if v is None or (isinstance(v, float) and np.isnan(v)):
            out.append(None)
        else:
            out.append(float(v))
    return out


# ── prices_close.json (raw adjusted close in BRL) ──────────────────────────
close_series: dict[str, list] = {t: _series_with_nulls(wide[t]) for t in tickers}
with open(f"{artifacts_dir}/prices_close.json", "w") as f:
    json.dump(
        {
            "as_of": as_of,
            "source_run_id": run_id,
            "currency": "BRL",
            "dates": dates,
            "series": close_series,
        },
        f,
        separators=(",", ":"),
    )
log.info("prices_close.json → %d tickers", len(close_series))

# ── prices_normalized.json (each ticker rebased to 100 at its first obs) ──
norm_series: dict[str, list] = {}
for t in tickers:
    col = wide[t]
    # Drop non-positive prices BEFORE picking the base — silver already
    # filters Yahoo's negative adjusted-close artifacts (b3_ohlcv_adjusted
    # WHERE price_adjusted > 0), but mask defensively here too: if a single
    # negative slips through, picking it as `first_valid` flips the sign of
    # the entire normalized series for that ticker.
    col_pos = col.where(col > 0)
    first_valid = col_pos.first_valid_index()
    if first_valid is None:
        norm_series[t] = [None] * len(dates)
        continue
    base = float(col_pos.loc[first_valid])
    if base == 0 or np.isnan(base):
        norm_series[t] = [None] * len(dates)
        continue
    norm_col = col_pos / base * 100.0
    norm_series[t] = _series_with_nulls(norm_col)

with open(f"{artifacts_dir}/prices_normalized.json", "w") as f:
    json.dump(
        {
            "as_of": as_of,
            "source_run_id": run_id,
            "rebase": 100,
            "dates": dates,
            "series": norm_series,
        },
        f,
        separators=(",", ":"),
    )
log.info("prices_normalized.json → %d tickers", len(norm_series))
