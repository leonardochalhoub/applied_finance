# Databricks notebook source
"""Export Gold JSON artifacts to /Volumes/.../gold/artifacts/."""
# COMMAND ----------
import datetime as dt
import json
import os

import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("artifacts_dir", "/Volumes/finance_prd/gold/artifacts")
catalog = dbutils.widgets.get("catalog")
artifacts_dir = dbutils.widgets.get("artifacts_dir")
dbutils.fs.mkdirs(artifacts_dir)

run_id = os.environ.get("DATABRICKS_RUN_ID", "local")
as_of = dt.date.today().isoformat()
bronze_max = (
    spark.sql(f"SELECT max(trading_date) AS d FROM {catalog}.bronze.b3_ohlcv_raw")
    .toPandas()
    .iloc[0]["d"]
)
bronze_max_str = pd.Timestamp(bronze_max).date().isoformat()


def _write_json(path: str, payload: dict) -> None:
    with open(path, "w") as f:
        json.dump(payload, f, indent=2, default=str)


kpis = spark.table(f"{catalog}.gold.kpis_per_ticker").toPandas()
kpis = kpis.replace({pd.NA: None, float("nan"): None})
_write_json(
    f"{artifacts_dir}/kpis_per_ticker.json",
    {
        "as_of": as_of,
        "source_run_id": run_id,
        "bronze_max_trading_date": bronze_max_str,
        "tickers": kpis.drop(columns=["source_run_id", "as_of"], errors="ignore").to_dict("records"),
    },
)

sectors = spark.table(f"{catalog}.gold.sector_aggregates").toPandas()
sectors = sectors.drop(columns=["as_of", "source_run_id"], errors="ignore")
sectors = sectors.replace({pd.NA: None, float("nan"): None})
_write_json(
    f"{artifacts_dir}/sector_aggregates.json",
    {
        "as_of": as_of,
        "source_run_id": run_id,
        "sectors": sectors.to_dict("records"),
    },
)

# correlation_heatmap.json and ibov_overview.json are already written by their
# generating notebooks (avoids re-pivoting heavy tables); they live under the
# same artifacts_dir already.
print("JSON artifacts emitted to", artifacts_dir)
