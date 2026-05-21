# Databricks notebook source
"""SCD2 over bronze.b3_universe with sha1(canonical_root) surrogate key.

`canonical_root` is the oldest ticker the entity ever used: we walk the
`prior_tickers` chain (sorted ascending so the head is the oldest symbol) and
take the head, or fall back to the current ticker if the chain is empty.
"""
# COMMAND ----------
import hashlib

from pyspark.sql import functions as F
from pyspark.sql.types import StringType

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")


def _canonical_root(ticker: str, priors: list[str] | None) -> str:
    chain = list(priors or []) + [ticker]
    return sorted(chain)[0]


def _ticker_key(canonical_root: str) -> str:
    return hashlib.sha1(f"b3:{canonical_root}".encode()).hexdigest()


canonical_udf = F.udf(_canonical_root, StringType())
ticker_key_udf = F.udf(_ticker_key, StringType())

universe = spark.table(f"{catalog}.bronze.b3_universe")
dim = (
    universe.withColumn("canonical_root", canonical_udf("ticker", "prior_tickers"))
    .withColumn("ticker_key", ticker_key_udf("canonical_root"))
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
print(f"silver.b3_ticker_dim → {dim.count()} rows")
