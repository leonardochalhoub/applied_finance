# Databricks notebook source
# MAGIC %md
# MAGIC # gold · finops_run_costs
# MAGIC
# MAGIC Cópia enriquecida de `silver.finops_run_costs`:
# MAGIC - mantém **toda a história** (sem cap por janela — o front recorta on-demand)
# MAGIC - normaliza nomes de job (remove prefix `[dev <user>]` para agrupar dev/prod)
# MAGIC - adiciona `is_wasted` (ERROR ou CANCELLED → custo desperdiçado)
# MAGIC - adiciona `cost_bucket` (categoriza valor — micro, small, medium, large)

# COMMAND ----------

dbutils.widgets.text("catalog", "finance_prd")
CATALOG = dbutils.widgets.get("catalog")

SILVER_TABLE = f"{CATALOG}.silver.finops_run_costs"
GOLD_TABLE   = f"{CATALOG}.gold.finops_run_costs"
print(f"silver={SILVER_TABLE}  gold={GOLD_TABLE}")

# COMMAND ----------

from pyspark.sql import functions as F

silver = spark.read.table(SILVER_TABLE)
n_silver = silver.count()
print(f"silver rows={n_silver}")
if n_silver == 0:
    dbutils.notebook.exit(f"SKIPPED: {SILVER_TABLE} is empty")

clean_name = F.regexp_replace(F.col("job_name"), r"^\[dev [^\]]+\]\s*", "")

gold_df = (
    silver
    .withColumn("job_name_canonical", F.coalesce(clean_name, F.lit("(sem nome)")))
    .withColumn("is_wasted", F.col("result_state").isin("ERROR", "CANCELLED"))
    .withColumn(
        "cost_bucket",
        F.when(F.col("cost_usd") < 0.10, F.lit("micro"))
         .when(F.col("cost_usd") < 0.50, F.lit("small"))
         .when(F.col("cost_usd") < 2.00, F.lit("medium"))
         .otherwise(F.lit("large")),
    )
    .select(
        "job_id", "run_id", "job_name", "job_name_canonical", "run_name",
        "result_state", "is_wasted", "cost_bucket",
        "started_at", "ended_at", "billed_minutes",
        "dbus", "cost_usd",
        "primary_sku", "is_serverless", "is_photon", "day",
    )
    .withColumn("_gold_built_ts", F.current_timestamp())
    .orderBy(F.col("cost_usd").desc_nulls_last())
)

n = gold_df.count()
total = gold_df.agg(F.sum("cost_usd")).first()[0] or 0.0
wasted = gold_df.where(F.col("is_wasted")).agg(F.sum("cost_usd")).first()[0] or 0.0
print(f"gold rows={n}  total_cost_usd={total:.4f}  wasted_cost_usd={wasted:.4f} "
      f"({100*wasted/total if total else 0:.1f}%)")

# COMMAND ----------

(
    gold_df.write.format("delta")
        .mode("overwrite")
        .option("overwriteSchema", "true")
        .saveAsTable(GOLD_TABLE)
)

spark.sql(f"COMMENT ON TABLE {GOLD_TABLE} IS "
          f"'Applied Finance FinOps · gold per-run costs com flags derivados '"
          f"'(is_wasted, cost_bucket) e job_name canonicalizado (sem prefix dev). '"
          f"'Insight-chave: ERROR + CANCELLED runs ainda consomem DBUs até falharem.'")

for col, desc in [
    ("job_id",             "Databricks job_id"),
    ("run_id",             "Databricks job_run_id"),
    ("job_name",           "Display name original do job"),
    ("job_name_canonical", "Job name sem prefix [dev <user>] — agrupa dev/prod do mesmo job"),
    ("result_state",       "Desfecho: SUCCEEDED, ERROR, CANCELLED, UNKNOWN"),
    ("is_wasted",          "TRUE se result_state ∈ {ERROR, CANCELLED} — custo não-produtivo"),
    ("cost_bucket",        "Faixa: micro (<$0.10), small (<$0.50), medium (<$2), large (≥$2)"),
    ("billed_minutes",     "Duração faturada"),
    ("dbus",               "DBUs consumidas"),
    ("cost_usd",           "Custo USD"),
    ("is_serverless",      "Compute serverless"),
    ("is_photon",          "Photon habilitado"),
    ("day",                "Data do primeiro billing record"),
]:
    spark.sql(f"ALTER TABLE {GOLD_TABLE} ALTER COLUMN {col} COMMENT '{desc}'")

for k, v in [
    ("layer",  "gold"),
    ("domain", "finops"),
    ("grain",  "job_run"),
    ("pii",    "false"),
]:
    spark.sql(f"ALTER TABLE {GOLD_TABLE} SET TAGS ('{k}'='{v}')")

print(f"✔ {GOLD_TABLE} written ({n} rows)")
