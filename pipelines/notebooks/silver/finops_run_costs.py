# Databricks notebook source
# MAGIC %md
# MAGIC # silver · finops_run_costs
# MAGIC
# MAGIC Ledger granular por job-run. Filtra `system.billing.usage` para registros
# MAGIC tagueados como `team=applied-finance` e enriquece com `system.lakeflow.job_run_timeline`.
# MAGIC
# MAGIC Algoritmo de custo:
# MAGIC ```
# MAGIC cost(record) = usage_quantity_DBU × list_price_USD_per_DBU
# MAGIC ```
# MAGIC List price é versionado no tempo — joinamos no intervalo
# MAGIC `[price_start_time, price_end_time)` que contém `usage_start_time`, casando
# MAGIC `(sku_name, cloud, usage_unit)`.
# MAGIC
# MAGIC Grão: 1 linha por `(job_id, run_id)`.

# COMMAND ----------

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("team_tag", "applied-finance")
CATALOG  = dbutils.widgets.get("catalog")
TEAM_TAG = dbutils.widgets.get("team_tag")

SILVER_TABLE = f"{CATALOG}.silver.finops_run_costs"
print(f"silver={SILVER_TABLE}  team_tag={TEAM_TAG}")

# COMMAND ----------

from pyspark.sql import functions as F

priced = spark.sql(f"""
  SELECT
    u.workspace_id,
    u.usage_metadata.job_id          AS job_id,
    u.usage_metadata.job_run_id      AS run_id,
    u.usage_metadata.job_name        AS job_name,
    u.usage_metadata.run_name        AS run_name,
    u.sku_name,
    u.usage_unit,
    u.usage_start_time,
    u.usage_end_time,
    u.usage_date,
    u.usage_quantity                              AS dbus,
    lp.pricing.default                            AS dbu_rate_usd,
    u.usage_quantity * lp.pricing.default         AS cost_usd,
    u.product_features.is_serverless              AS is_serverless,
    u.product_features.is_photon                  AS is_photon,
    u.billing_origin_product                      AS product
  FROM system.billing.usage u
  LEFT JOIN system.billing.list_prices lp
    ON  u.sku_name        = lp.sku_name
    AND u.cloud           = lp.cloud
    AND u.usage_unit      = lp.usage_unit
    AND u.usage_start_time >= lp.price_start_time
    AND (lp.price_end_time IS NULL OR u.usage_start_time < lp.price_end_time)
  WHERE u.custom_tags['team'] = '{TEAM_TAG}'
    AND u.usage_metadata.job_run_id IS NOT NULL
""")

runs = spark.sql("""
  SELECT job_id, run_id,
         max_by(result_state, period_end_time) AS result_state,
         min(period_start_time)                AS started_at,
         max(period_end_time)                  AS ended_at
  FROM system.lakeflow.job_run_timeline
  WHERE job_id IS NOT NULL AND run_id IS NOT NULL
  GROUP BY job_id, run_id
""")

agg = (
    priced
    .groupBy("job_id", "run_id")
    .agg(
        F.first("job_name", ignorenulls=True).alias("job_name"),
        F.first("run_name", ignorenulls=True).alias("run_name"),
        F.sum("dbus").cast("double").alias("dbus"),
        F.sum("cost_usd").cast("double").alias("cost_usd"),
        F.bool_or("is_serverless").alias("is_serverless"),
        F.bool_or("is_photon").alias("is_photon"),
        F.first("sku_name", ignorenulls=True).alias("primary_sku"),
        F.min("usage_date").alias("first_usage_date"),
        F.min("usage_start_time").alias("first_usage_at"),
        F.max("usage_end_time").alias("last_usage_at"),
        F.count("*").cast("long").alias("n_records"),
    )
)

silver_df = (
    agg.join(runs, on=["job_id", "run_id"], how="left")
       .withColumn("result_state", F.coalesce(F.col("result_state"), F.lit("UNKNOWN")))
       .withColumn("started_at", F.coalesce(F.col("started_at"), F.col("first_usage_at")))
       .withColumn("ended_at",   F.coalesce(F.col("ended_at"),   F.col("last_usage_at")))
       .withColumn(
           "billed_minutes",
           F.round(
               (F.col("ended_at").cast("long") - F.col("started_at").cast("long")) / 60.0,
               2,
           ),
       )
       .withColumn("day", F.col("first_usage_date"))
       .select(
           "job_id", "run_id", "job_name", "run_name", "result_state",
           "started_at", "ended_at", "billed_minutes",
           F.round(F.col("dbus"), 6).alias("dbus"),
           F.round(F.col("cost_usd"), 6).alias("cost_usd"),
           "primary_sku", "is_serverless", "is_photon", "day",
       )
       .withColumn("_silver_built_ts", F.current_timestamp())
       .orderBy(F.col("cost_usd").desc_nulls_last())
)

n = silver_df.count()
distinct_jobs = silver_df.select("job_id").distinct().count()
total_cost = silver_df.agg(F.sum("cost_usd")).first()[0] or 0.0
print(f"runs={n}  distinct_jobs={distinct_jobs}  total_cost_usd={total_cost:.4f}")

# COMMAND ----------

(
    silver_df.write.format("delta")
        .mode("overwrite")
        .option("overwriteSchema", "true")
        .saveAsTable(SILVER_TABLE)
)

spark.sql(f"COMMENT ON TABLE {SILVER_TABLE} IS "
          f"'Applied Finance FinOps · ledger granular por job-run, filtrado por '"
          f"'custom_tags.team=applied-finance. Grão: 1 linha por (job_id, run_id). '"
          f"'Custo USD = Σ DBU × list_price (versionado no tempo). '"
          f"'Bronze: system.billing.usage + system.billing.list_prices + '"
          f"'system.lakeflow.job_run_timeline. '"
          f"'Atenção: system.billing tem latência ~1h.'")

for col, desc in [
    ("job_id",         "Databricks job_id (FK → system.lakeflow.jobs)"),
    ("run_id",         "Databricks job_run_id (FK → system.lakeflow.job_run_timeline)"),
    ("job_name",       "Display name do job no momento da execução"),
    ("run_name",       "Nome da run específica (run-now com run_name)"),
    ("result_state",   "Desfecho final: SUCCEEDED, ERROR, CANCELLED, UNKNOWN"),
    ("started_at",     "Início real (timeline). Fallback: primeiro usage_start_time"),
    ("ended_at",       "Fim real (timeline). Fallback: último usage_end_time"),
    ("billed_minutes", "Duração faturada em minutos (ended_at - started_at)"),
    ("dbus",           "DBUs consumidas (sum over billing records)"),
    ("cost_usd",       "Custo USD = Σ DBU × list_price_USD_per_DBU (time-versioned)"),
    ("primary_sku",    "SKU mais frequente nos billing records desta run"),
    ("is_serverless",  "TRUE se a run rodou em compute serverless"),
    ("is_photon",      "TRUE se Photon foi habilitado em pelo menos um record"),
    ("day",            "Data do primeiro billing record desta run (UTC)"),
]:
    spark.sql(f"ALTER TABLE {SILVER_TABLE} ALTER COLUMN {col} COMMENT '{desc}'")

for k, v in [
    ("layer",  "silver"),
    ("domain", "finops"),
    ("source", "system.billing+lakeflow"),
    ("grain",  "job_run"),
    ("pii",    "false"),
]:
    spark.sql(f"ALTER TABLE {SILVER_TABLE} SET TAGS ('{k}'='{v}')")

print(f"✔ {SILVER_TABLE} written ({n} rows)")
