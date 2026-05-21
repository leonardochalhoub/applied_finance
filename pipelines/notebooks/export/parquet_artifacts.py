# Databricks notebook source
"""Export Gold Parquet artifacts to /Volumes/.../gold/artifacts/."""
# COMMAND ----------
dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("artifacts_dir", "/Volumes/finance_prd/gold/artifacts")
catalog = dbutils.widgets.get("catalog")
artifacts_dir = dbutils.widgets.get("artifacts_dir")
dbutils.fs.mkdirs(artifacts_dir)

(
    spark.table(f"{catalog}.gold.returns_wide")
    .toPandas()
    .to_parquet(f"{artifacts_dir}/returns_wide.parquet", index=False)
)

for w in ("1y", "5y", "full"):
    (
        spark.table(f"{catalog}.gold.cov_matrix_{w}")
        .toPandas()
        .to_parquet(f"{artifacts_dir}/cov_matrix_{w}.parquet", index=False)
    )

print("Parquet artifacts emitted to", artifacts_dir)
