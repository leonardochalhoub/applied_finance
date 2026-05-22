# Databricks notebook source
# MAGIC %md
# MAGIC # gold · finops_daily_spend
# MAGIC
# MAGIC Pivota a série diária por workload-class com cumulativo lifetime.
# MAGIC Schema final (1 linha por `usage_date`):
# MAGIC ```
# MAGIC usage_date,
# MAGIC cost_jobs, cost_sql, cost_interactive, cost_dlt,    -- chargeable
# MAGIC cost_networking, cost_storage, cost_pred_opt,       -- overhead
# MAGIC cost_chargeable_total, cost_overhead_total, cost_total,
# MAGIC dbus_total,
# MAGIC cost_total_cumulative
# MAGIC ```

# COMMAND ----------

dbutils.widgets.text("catalog", "finance_prd")
CATALOG = dbutils.widgets.get("catalog")

SILVER_TABLE = f"{CATALOG}.silver.finops_daily_spend"
GOLD_TABLE   = f"{CATALOG}.gold.finops_daily_spend"
print(f"silver={SILVER_TABLE}  gold={GOLD_TABLE}")

# COMMAND ----------

from pyspark.sql import functions as F, Window as W

silver = spark.read.table(SILVER_TABLE)
n_silver = silver.count()
print(f"silver rows={n_silver}")
if n_silver == 0:
    dbutils.notebook.exit(f"SKIPPED: {SILVER_TABLE} is empty")

PRODUCTS_OF_INTEREST = [
    "JOBS", "SQL", "INTERACTIVE", "DLT",
    "NETWORKING", "DEFAULT_STORAGE", "PREDICTIVE_OPTIMIZATION",
]

pivoted = (
    silver.groupBy("usage_date")
          .pivot("product", PRODUCTS_OF_INTEREST)
          .agg(F.sum("cost_usd"))
)
rename_map = {
    "JOBS":                    "cost_jobs",
    "SQL":                     "cost_sql",
    "INTERACTIVE":             "cost_interactive",
    "DLT":                     "cost_dlt",
    "NETWORKING":              "cost_networking",
    "DEFAULT_STORAGE":         "cost_storage",
    "PREDICTIVE_OPTIMIZATION": "cost_pred_opt",
}
for src, dst in rename_map.items():
    if src not in pivoted.columns:
        pivoted = pivoted.withColumn(src, F.lit(0.0))
    pivoted = pivoted.withColumnRenamed(src, dst)
    pivoted = pivoted.fillna(0.0, subset=[dst])

daily_totals = (
    silver.groupBy("usage_date")
          .agg(F.sum("dbus").cast("double").alias("dbus_total"))
)

df = pivoted.join(daily_totals, on="usage_date", how="left")

df = (
    df
    .withColumn(
        "cost_chargeable_total",
        F.col("cost_jobs") + F.col("cost_sql") + F.col("cost_interactive") + F.col("cost_dlt"),
    )
    .withColumn(
        "cost_overhead_total",
        F.col("cost_networking") + F.col("cost_storage") + F.col("cost_pred_opt"),
    )
    .withColumn(
        "cost_total",
        F.col("cost_chargeable_total") + F.col("cost_overhead_total"),
    )
)

w = W.orderBy("usage_date").rowsBetween(W.unboundedPreceding, W.currentRow)
df = df.withColumn("cost_total_cumulative", F.sum("cost_total").over(w))

cost_cols = [c for c in df.columns if c.startswith("cost_") or c == "dbus_total"]
for c in cost_cols:
    df = df.withColumn(c, F.round(F.col(c), 6))

gold_df = (
    df.withColumn("_gold_built_ts", F.current_timestamp())
      .orderBy("usage_date")
)

n = gold_df.count()
total = gold_df.agg(F.sum("cost_total")).first()[0] or 0.0
last = gold_df.orderBy(F.col("usage_date").desc()).first()
print(f"gold rows={n}  lifetime_cost_usd={total:.4f}  "
      f"latest_day={last['usage_date']}  latest_cost={last['cost_total']:.4f}")

# COMMAND ----------

(
    gold_df.write.format("delta")
        .mode("overwrite")
        .option("overwriteSchema", "true")
        .saveAsTable(GOLD_TABLE)
)

spark.sql(f"COMMENT ON TABLE {GOLD_TABLE} IS "
          f"'Applied Finance FinOps · série diária de spend (USD) pivoteada por '"
          f"'produto, com totais chargeable/overhead/global e cumulativo lifetime. '"
          f"'Grão: 1 linha por usage_date. Filtrado por team=applied-finance.'")

for col, desc in [
    ("usage_date",             "Data UTC"),
    ("cost_jobs",              "USD em JOBS (workloads tagueados a job_run_id)"),
    ("cost_sql",               "USD em SQL warehouses"),
    ("cost_interactive",       "USD em clusters interativos (notebooks ad-hoc)"),
    ("cost_dlt",               "USD em DLT pipelines"),
    ("cost_networking",        "USD em egress/networking de compute serverless (overhead)"),
    ("cost_storage",           "USD em DEFAULT_STORAGE (overhead — quando tagueado)"),
    ("cost_pred_opt",          "USD em PREDICTIVE_OPTIMIZATION (auto-vacuum/optimize — overhead)"),
    ("cost_chargeable_total",  "Σ cost_jobs + cost_sql + cost_interactive + cost_dlt"),
    ("cost_overhead_total",    "Σ cost_networking + cost_storage + cost_pred_opt"),
    ("cost_total",             "cost_chargeable_total + cost_overhead_total"),
    ("dbus_total",             "DBUs consumidas no dia (qualquer produto)"),
    ("cost_total_cumulative",  "Soma running de cost_total ao longo de todo o histórico"),
]:
    spark.sql(f"ALTER TABLE {GOLD_TABLE} ALTER COLUMN {col} COMMENT '{desc}'")

for k, v in [
    ("layer",  "gold"),
    ("domain", "finops"),
    ("grain",  "day"),
    ("pii",    "false"),
]:
    spark.sql(f"ALTER TABLE {GOLD_TABLE} SET TAGS ('{k}'='{v}')")

print(f"✔ {GOLD_TABLE} written ({n} rows)")
