# Databricks notebook source
"""SCD2 over bronze.b3_universe.

Surrogate key: `ticker_key = sha1("b3:" + canonical_root)`.

`canonical_root` = first element of `prior_tickers` (which is curated in the
CSV in *chronological order, oldest first*) — falls back to the current ticker
if the chain is empty. This is the explicit-contract version of the surrogate;
lexicographic ordering would mis-root cases like `AAAA3 → BBBB3` where the
visible chronology is `BBBB3 (oldest) → AAAA3 (current)`.
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")


universe = spark.table(f"{catalog}.bronze.b3_universe")

canonical_root = F.when(
    F.size(F.coalesce(F.col("prior_tickers"), F.array())) > 0,
    F.col("prior_tickers").getItem(0),
).otherwise(F.col("ticker"))

ticker_key = F.sha1(F.concat(F.lit("b3:"), canonical_root))

dim = (
    universe
    .withColumn("canonical_root", canonical_root)
    .withColumn("ticker_key", ticker_key)
    .selectExpr(
        "ticker_key",
        "ticker",
        "company_name",
        "sector_b3",
        "subsector_b3",
        "try_cast(listed_from AS DATE) AS valid_from",
        "try_cast(listed_to   AS DATE) AS valid_to",
        "listed_to IS NULL    AS is_current",
        "canonical_root",
    )
)

dim.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.silver.b3_ticker_dim"
)

log.info(f"silver.b3_ticker_dim → {dim.count()} rows")
