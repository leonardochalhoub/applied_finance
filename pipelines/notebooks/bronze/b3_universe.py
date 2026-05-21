# Databricks notebook source
"""Overwrite bronze.b3_universe from the committed CSV."""
# COMMAND ----------
from pathlib import Path

import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

repo_root = Path("/Workspace/Repos") if Path("/Workspace/Repos").exists() else Path.cwd().parent.parent
csv_path = next(
    p for p in [
        Path(f"/Volumes/{catalog}/bronze/reference/ticker_universe.csv"),
        repo_root / "data" / "ticker_universe.csv",
    ]
    if p.exists()
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
print(f"bronze.b3_universe → {len(df)} rows")
