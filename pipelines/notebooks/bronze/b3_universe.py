# Databricks notebook source
"""Overwrite bronze.b3_universe from the committed CSV."""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

from pathlib import Path

import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

csv_path = Path(f"/Volumes/{catalog}/bronze/reference/ticker_universe.csv")
if not csv_path.exists():
    raise FileNotFoundError(
        f"{csv_path} not found. Upload data/ticker_universe.csv to the UC Volume first."
    )

df = pd.read_csv(csv_path, parse_dates=["listed_from", "listed_to"], keep_default_na=True)
df["prior_tickers"] = df["prior_tickers"].fillna("").apply(
    lambda s: [t for t in str(s).split("|") if t]
)
df["cnpj"] = df["cnpj"].fillna("").astype(str)
df["ingested_at"] = pd.Timestamp.utcnow()

sdf = spark.createDataFrame(df)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.bronze.b3_universe"
)
log.info(f"bronze.b3_universe → {len(df)} rows")
