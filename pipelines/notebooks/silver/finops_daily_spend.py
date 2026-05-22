# Databricks notebook source
# MAGIC %md
# MAGIC # silver · finops_daily_spend
# MAGIC
# MAGIC FinOps vertical — ledger diário por (data × produto × workload-class), filtrado
# MAGIC para gastos atribuíveis ao Applied Finance.
# MAGIC
# MAGIC O workspace é compartilhado com outros projetos (ex.: `mirante_prd`), então
# MAGIC a atribuição depende do tipo de custo:
# MAGIC
# MAGIC - **Compute** (JOBS/SQL/INTERACTIVE/DLT): filtra por `custom_tags.team='applied-finance'`.
# MAGIC   Bundle propaga tags do job pra cluster, então 100% atribuível.
# MAGIC
# MAGIC - **Overhead** (DEFAULT_STORAGE/NETWORKING/PREDICTIVE_OPTIMIZATION): cobrado
# MAGIC   no nível do workspace, sem tags de job. Rateado pela razão de bytes:
# MAGIC   ```
# MAGIC   share = bytes(finance_prd) / bytes(workspace_total)
# MAGIC   cost_attributed = cost_workspace × share
# MAGIC   ```
# MAGIC   onde `bytes` = Σ tabelas Delta (DESCRIBE DETAIL) + Σ arquivos em /Volumes/{catalog}/.
# MAGIC
# MAGIC Grão: 1 linha por `(usage_date, product, workload_class, is_serverless)`.

# COMMAND ----------

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("team_tag", "applied-finance")
CATALOG  = dbutils.widgets.get("catalog")
TEAM_TAG = dbutils.widgets.get("team_tag")

SILVER_TABLE       = f"{CATALOG}.silver.finops_daily_spend"
ATTRIBUTION_TABLE  = f"{CATALOG}.silver.finops_storage_attribution"
print(f"silver={SILVER_TABLE}  attribution={ATTRIBUTION_TABLE}  team_tag={TEAM_TAG}")

# COMMAND ----------

# ── Workspace identification ──────────────────────────────────────────────────
# system.billing.usage é account-scoped (todos os workspaces da conta).
# Tentamos descobrir o workspace atual via múltiplos caminhos; se nenhum
# funcionar, seguimos sem o filtro (válido quando a conta tem 1 workspace só).
current_ws_id = None
for fn in (
    "current_workspace_id()",
    "current_metastore_id()",  # último recurso — não é workspace, mas serve de proxy se a conta tem 1
):
    try:
        v = spark.sql(f"SELECT {fn} AS id").first()["id"]
        if v:
            if "workspace" in fn:
                current_ws_id = str(v)
            break
    except Exception:
        continue
print(f"current_workspace_id = {current_ws_id}")

# COMMAND ----------

# ── Compute bytes per catalog (Delta tables + Volume files) ───────────────────
EXCLUDE_CATALOGS = {"system", "samples", "hive_metastore", "main", "__databricks_internal", "spark_catalog"}
EXCLUDE_SCHEMAS  = {"information_schema", "default"}


def _table_bytes(catalog: str) -> dict:
    """Sum Delta sizeInBytes per schema in a catalog (via DESCRIBE DETAIL)."""
    schema_bytes: dict = {}
    try:
        schemas = [r[0] for r in spark.sql(f"SHOW SCHEMAS IN `{catalog}`").collect()]
    except Exception as e:
        print(f"  WARN cannot list schemas of {catalog}: {e}")
        return schema_bytes
    for sch in schemas:
        if sch in EXCLUDE_SCHEMAS:
            continue
        sch_total = 0
        try:
            tables = spark.sql(f"SHOW TABLES IN `{catalog}`.`{sch}`").collect()
        except Exception:
            continue
        for t in tables:
            tbl = t["tableName"]
            try:
                detail = spark.sql(f"DESCRIBE DETAIL `{catalog}`.`{sch}`.`{tbl}`").first()
                sz = detail["sizeInBytes"] if detail and "sizeInBytes" in detail.asDict() else 0
                sch_total += int(sz or 0)
            except Exception:
                pass
        schema_bytes[sch] = sch_total
    return schema_bytes


def _volume_bytes(catalog: str) -> int:
    """Recursively sum sizes of files under /Volumes/{catalog}/."""
    total = 0
    try:
        stack = [f"/Volumes/{catalog}/"]
    except Exception:
        return 0
    while stack:
        path = stack.pop()
        try:
            for entry in dbutils.fs.ls(path):
                if entry.size and entry.size > 0:
                    total += int(entry.size)
                # Heuristic: dbutils.fs.ls returns name ending in '/' for dirs
                if entry.path.endswith("/") and entry.path != path:
                    stack.append(entry.path)
        except Exception:
            pass
    return total


all_catalogs = [r[0] for r in spark.sql("SHOW CATALOGS").collect()]
user_catalogs = [c for c in all_catalogs if c not in EXCLUDE_CATALOGS]
print(f"workspace catalogs scanned: {user_catalogs}")

catalog_bytes: dict = {}
for cat in user_catalogs:
    schemas = _table_bytes(cat)
    vol = _volume_bytes(cat)
    tables_total = sum(schemas.values())
    catalog_bytes[cat] = {
        "schemas_bytes":  schemas,
        "tables_bytes":   tables_total,
        "volumes_bytes":  vol,
        "total_bytes":    tables_total + vol,
    }
    print(f"  {cat}: tables={tables_total/1e6:.2f}MB  "
          f"volumes={vol/1e6:.2f}MB  total={(tables_total+vol)/1e6:.2f}MB  "
          f"schemas={ {k: f'{v/1e6:.2f}MB' for k,v in schemas.items()} }")

target_bytes     = catalog_bytes.get(CATALOG, {}).get("total_bytes", 0)
workspace_bytes  = sum(c["total_bytes"] for c in catalog_bytes.values())
storage_share    = (target_bytes / workspace_bytes) if workspace_bytes > 0 else 0.0
print(f"\nstorage_share_ratio = {target_bytes/1e6:.2f}MB / {workspace_bytes/1e6:.2f}MB "
      f"= {storage_share*100:.2f}%")

# COMMAND ----------

# ── Persist attribution metadata for downstream / export ──────────────────────
import datetime as _dt
from pyspark.sql import functions as F

attribution_rows = []
for cat, b in catalog_bytes.items():
    attribution_rows.append({
        "snapshot_at":    _dt.datetime.utcnow(),
        "catalog":        cat,
        "is_target":      cat == CATALOG,
        "tables_bytes":   int(b["tables_bytes"]),
        "volumes_bytes":  int(b["volumes_bytes"]),
        "total_bytes":    int(b["total_bytes"]),
        "share_pct":      (b["total_bytes"] / workspace_bytes * 100.0) if workspace_bytes > 0 else 0.0,
    })
attr_df = spark.createDataFrame(attribution_rows)
(
    attr_df.write.format("delta")
        .mode("overwrite")
        .option("overwriteSchema", "true")
        .saveAsTable(ATTRIBUTION_TABLE)
)
spark.sql(f"COMMENT ON TABLE {ATTRIBUTION_TABLE} IS "
          f"'Applied Finance FinOps · snapshot do tamanho de cada catálogo do '"
          f"'workspace (tabelas Delta + Volumes), usado pra ratear DEFAULT_STORAGE '"
          f"'que não carrega custom_tags. share_pct = total_bytes / Σ(workspace).'")
print(f"✔ attribution snapshot saved with {len(attribution_rows)} catalogs")

# COMMAND ----------

# ── Priced billing: tagged compute (always attributable) ──────────────────────
ws_filter = f"AND u.workspace_id = '{current_ws_id}'" if current_ws_id else ""

tagged_compute = spark.sql(f"""
  SELECT
    u.usage_date,
    u.billing_origin_product                    AS product,
    u.product_features.is_serverless            AS is_serverless,
    u.product_features.is_photon                AS is_photon,
    u.usage_metadata.job_run_id                 AS run_id,
    u.usage_quantity                            AS dbus,
    u.usage_quantity * lp.pricing.default       AS cost_usd,
    1.0                                         AS attribution_ratio,
    'tagged'                                    AS attribution_method
  FROM system.billing.usage u
  LEFT JOIN system.billing.list_prices lp
    ON  u.sku_name        = lp.sku_name
    AND u.cloud           = lp.cloud
    AND u.usage_unit      = lp.usage_unit
    AND u.usage_start_time >= lp.price_start_time
    AND (lp.price_end_time IS NULL OR u.usage_start_time < lp.price_end_time)
  WHERE u.custom_tags['team'] = '{TEAM_TAG}'
    {ws_filter}
""")
n_tagged = tagged_compute.count()
print(f"tagged compute records: {n_tagged}")

# ── Workspace-level overhead: prorated by bytes_share ─────────────────────────
# DEFAULT_STORAGE / NETWORKING / PREDICTIVE_OPTIMIZATION são cobrados no nível
# do workspace e não carregam tags de job. Multiplicamos cost_usd × share_ratio.
overhead = spark.sql(f"""
  SELECT
    u.usage_date,
    u.billing_origin_product                    AS product,
    u.product_features.is_serverless            AS is_serverless,
    u.product_features.is_photon                AS is_photon,
    CAST(NULL AS STRING)                        AS run_id,
    u.usage_quantity * {storage_share}          AS dbus,
    u.usage_quantity * lp.pricing.default * {storage_share}  AS cost_usd,
    CAST({storage_share} AS DOUBLE)             AS attribution_ratio,
    'prorated_by_bytes'                         AS attribution_method
  FROM system.billing.usage u
  LEFT JOIN system.billing.list_prices lp
    ON  u.sku_name        = lp.sku_name
    AND u.cloud           = lp.cloud
    AND u.usage_unit      = lp.usage_unit
    AND u.usage_start_time >= lp.price_start_time
    AND (lp.price_end_time IS NULL OR u.usage_start_time < lp.price_end_time)
  WHERE u.billing_origin_product IN ('DEFAULT_STORAGE', 'NETWORKING', 'PREDICTIVE_OPTIMIZATION')
    AND (u.custom_tags['team'] IS NULL OR u.custom_tags['team'] = '')
    {ws_filter}
""")
n_overhead = overhead.count()
print(f"workspace overhead records (prorated): {n_overhead}")

priced = tagged_compute.unionByName(overhead)

# COMMAND ----------

df = priced.withColumn(
    "workload_class",
    F.when(F.col("product").isin("JOBS", "SQL", "INTERACTIVE", "DLT"), F.lit("chargeable"))
     .otherwise(F.lit("overhead")),
)

silver_df = (
    df.groupBy("usage_date", "product", "workload_class", "is_serverless")
      .agg(
          F.bool_or("is_photon").alias("is_photon_any"),
          F.count("*").cast("long").alias("n_records"),
          F.countDistinct("run_id").cast("long").alias("n_runs"),
          F.round(F.sum("dbus"), 6).alias("dbus"),
          F.round(F.sum("cost_usd"), 6).alias("cost_usd"),
          F.avg("attribution_ratio").alias("avg_attribution_ratio"),
          F.first("attribution_method", ignorenulls=True).alias("attribution_method"),
      )
      .withColumn("_silver_built_ts", F.current_timestamp())
      .orderBy("usage_date", "product", "workload_class")
)

n = silver_df.count()
days = silver_df.select("usage_date").distinct().count()
total = silver_df.agg(F.sum("cost_usd")).first()[0] or 0.0
storage_total = (
    silver_df.where(F.col("product") == "DEFAULT_STORAGE")
             .agg(F.sum("cost_usd")).first()[0] or 0.0
)
print(f"\nrows={n}  days={days}  total_cost_usd={total:.4f}  "
      f"storage_cost_usd={storage_total:.4f}")
if n == 0:
    print(f"⚠ Sem registros (nem tagged nem overhead).")

# COMMAND ----------

(
    silver_df.write.format("delta")
        .mode("overwrite")
        .option("overwriteSchema", "true")
        .saveAsTable(SILVER_TABLE)
)

spark.sql(f"COMMENT ON TABLE {SILVER_TABLE} IS "
          f"'Applied Finance FinOps · spend diário por produto × workload-class. '"
          f"'Compute (JOBS/SQL/INTERACTIVE/DLT) filtrado por custom_tags.team={TEAM_TAG}. '"
          f"'Overhead (DEFAULT_STORAGE/NETWORKING/PREDICTIVE_OPTIMIZATION) rateado por '"
          f"'bytes_share = bytes({CATALOG}) / Σ bytes(workspace). '"
          f"'Grão: (usage_date, product, workload_class, is_serverless).'")

for col, desc in [
    ("usage_date",            "Data do uso (UTC)"),
    ("product",               "billing_origin_product"),
    ("workload_class",        "chargeable vs overhead"),
    ("is_serverless",         "TRUE se compute serverless"),
    ("is_photon_any",         "TRUE se ao menos um record do bucket usou Photon"),
    ("n_records",             "Contagem de billing records"),
    ("n_runs",                "Distinct job_run_id (NULL para storage)"),
    ("dbus",                  "DBUs (após rateio quando overhead)"),
    ("cost_usd",              "Custo USD atribuído ao Applied Finance"),
    ("avg_attribution_ratio", "1.0 para compute tagueado; <1.0 para overhead rateado por bytes"),
    ("attribution_method",    "'tagged' (compute) ou 'prorated_by_bytes' (overhead)"),
]:
    spark.sql(f"ALTER TABLE {SILVER_TABLE} ALTER COLUMN {col} COMMENT '{desc}'")

for k, v in [
    ("layer",  "silver"),
    ("domain", "finops"),
    ("source", "system.billing"),
    ("grain",  "day_product_class"),
    ("pii",    "false"),
]:
    spark.sql(f"ALTER TABLE {SILVER_TABLE} SET TAGS ('{k}'='{v}')")

print(f"\n✔ {SILVER_TABLE} written ({n} rows)")
