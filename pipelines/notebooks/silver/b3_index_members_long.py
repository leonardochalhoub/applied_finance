# Databricks notebook source
"""Pivot index membership snapshots into a long-format Delta table."""
# COMMAND ----------
dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

spark.sql(f"""
CREATE OR REPLACE TABLE {catalog}.silver.b3_index_members_long
USING DELTA
AS
SELECT
    upper(index)            AS index,
    ticker,
    CAST(weight AS DOUBLE)  AS weight,
    to_date(valid_from)     AS valid_from,
    to_date(valid_to)       AS valid_to,
    valid_to IS NULL        AS is_current
FROM {catalog}.bronze.b3_index_members
""")

rows = spark.table(f"{catalog}.silver.b3_index_members_long").count()
print(f"silver.b3_index_members_long → {rows} rows")
