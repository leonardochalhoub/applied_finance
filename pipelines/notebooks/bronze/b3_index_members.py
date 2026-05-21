# Databricks notebook source
"""Overwrite bronze.b3_index_members from the committed CSV."""
# COMMAND ----------
from pathlib import Path

import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

repo_root = Path("/Workspace/Repos") if Path("/Workspace/Repos").exists() else Path.cwd().parent.parent
csv_path = next(
    p for p in [
        Path(f"/Volumes/{catalog}/bronze/reference/index_membership.csv"),
        repo_root / "data" / "index_membership.csv",
    ]
    if p.exists()
)

df = pd.read_csv(csv_path, parse_dates=["valid_from", "valid_to"])
df["ingested_at"] = pd.Timestamp.utcnow()

sdf = spark.createDataFrame(df)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.bronze.b3_index_members"
)
print(f"bronze.b3_index_members → {len(df)} rows")
