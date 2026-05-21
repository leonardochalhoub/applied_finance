import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# Databricks notebook source
"""Overwrite bronze.b3_index_members from the committed CSV."""
# COMMAND ----------
from pathlib import Path

import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

csv_path = Path(f"/Volumes/{catalog}/bronze/reference/index_membership.csv")
if not csv_path.exists():
    raise FileNotFoundError(
        f"{csv_path} not found. Upload data/index_membership.csv to the UC Volume first."
    )

df = pd.read_csv(csv_path, parse_dates=["valid_from", "valid_to"])
df["ingested_at"] = pd.Timestamp.utcnow()

sdf = spark.createDataFrame(df)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.bronze.b3_index_members"
)
log.info(f"bronze.b3_index_members → {len(df)} rows")
