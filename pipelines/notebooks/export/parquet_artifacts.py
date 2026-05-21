import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# Databricks notebook source
"""Export Gold Parquet artifacts to /Volumes/.../gold/artifacts/."""
# COMMAND ----------
import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("artifacts_dir", "/Volumes/finance_prd/gold/artifacts")
catalog = dbutils.widgets.get("catalog")
artifacts_dir = dbutils.widgets.get("artifacts_dir")
dbutils.fs.mkdirs(artifacts_dir)


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    """Drop the Spark-Connect PlanMetrics attrs that break to_parquet."""
    out = pd.DataFrame(df.to_dict(orient="list"))
    out.attrs = {}
    return out


_clean(spark.table(f"{catalog}.gold.returns_wide").toPandas()).to_parquet(
    f"{artifacts_dir}/returns_wide.parquet", index=False
)

for w in ("1y", "5y", "full"):
    _clean(spark.table(f"{catalog}.gold.cov_matrix_{w}").toPandas()).to_parquet(
        f"{artifacts_dir}/cov_matrix_{w}.parquet", index=False
    )

log.info("Parquet artifacts emitted to %s", artifacts_dir)
