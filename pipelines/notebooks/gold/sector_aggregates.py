# Databricks notebook source
"""Per-sector aggregates over gold.kpis_per_ticker."""
# COMMAND ----------
dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

spark.sql(f"""
CREATE OR REPLACE TABLE {catalog}.gold.sector_aggregates
USING DELTA
AS
SELECT
    sector_b3,
    COUNT(*)                         AS member_count,
    AVG(return_ytd)                  AS return_ytd_mean,
    percentile_approx(return_ytd, 0.5) AS return_ytd_median,
    AVG(vol_annual)                  AS vol_annual_mean,
    collect_list(ticker)             AS members,
    MAX(as_of)                       AS as_of,
    MAX(source_run_id)               AS source_run_id
FROM {catalog}.gold.kpis_per_ticker
WHERE sector_b3 IS NOT NULL
GROUP BY sector_b3
""")

print(f"gold.sector_aggregates → {spark.table(f'{catalog}.gold.sector_aggregates').count()} sectors")
