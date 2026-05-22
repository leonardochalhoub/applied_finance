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
LAYER_TABLE        = f"{CATALOG}.silver.finops_layer_breakdown"
print(f"silver={SILVER_TABLE}  attribution={ATTRIBUTION_TABLE}  layer={LAYER_TABLE}  team_tag={TEAM_TAG}")

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


def _has_iceberg_uniform(catalog: str, schema: str, table: str) -> bool:
    """Detect if a Delta table is also exposed as Iceberg via UniForm."""
    try:
        props = spark.sql(f"SHOW TBLPROPERTIES `{catalog}`.`{schema}`.`{table}`").collect()
        for p in props:
            k = p["key"]; v = str(p["value"]).lower()
            if k == "delta.universalFormat.enabledFormats" and "iceberg" in v:
                return True
    except Exception:
        pass
    return False


def _table_details(catalog: str, schema: str, table: str, count_rows: bool) -> dict | None:
    """Returns {bytes, num_files, format, rows, has_iceberg}. None if not introspectable."""
    try:
        d = spark.sql(f"DESCRIBE DETAIL `{catalog}`.`{schema}`.`{table}`").first()
        if d is None:
            return None
        dd = d.asDict()
        out = {
            "bytes":    int(dd.get("sizeInBytes") or 0),
            "num_files": int(dd.get("numFiles") or 0),
            "format":   (dd.get("format") or "delta"),
            "rows":     None,
            "has_iceberg": False,
        }
        if count_rows and out["bytes"] > 0:
            try:
                cnt = spark.sql(f"SELECT COUNT(*) AS n FROM `{catalog}`.`{schema}`.`{table}`").first()
                out["rows"] = int(cnt["n"]) if cnt and cnt["n"] is not None else None
            except Exception:
                pass
        out["has_iceberg"] = _has_iceberg_uniform(catalog, schema, table)
        return out
    except Exception:
        return None


def _scan_catalog(catalog: str, count_rows: bool) -> dict:
    """Walk all tables in a catalog. Returns {schemas: {schema: [table_rows]}, totals: {...}}."""
    out: dict = {"schemas": {}, "totals": {"bytes": 0, "rows": 0, "n_tables": 0, "formats": set(), "has_iceberg": False}}
    try:
        schemas = [r[0] for r in spark.sql(f"SHOW SCHEMAS IN `{catalog}`").collect()]
    except Exception as e:
        print(f"  WARN cannot list schemas of {catalog}: {e}")
        return out
    for sch in schemas:
        if sch in EXCLUDE_SCHEMAS:
            continue
        out["schemas"][sch] = []
        try:
            tables = spark.sql(f"SHOW TABLES IN `{catalog}`.`{sch}`").collect()
        except Exception:
            continue
        for t in tables:
            tbl = t["tableName"]
            d = _table_details(catalog, sch, tbl, count_rows)
            if d is None:
                continue
            row = {"table": tbl, **d}
            out["schemas"][sch].append(row)
            out["totals"]["bytes"]  += d["bytes"]
            out["totals"]["rows"]   += d["rows"] or 0
            out["totals"]["n_tables"] += 1
            out["totals"]["formats"].add(d["format"])
            if d["has_iceberg"]:
                out["totals"]["has_iceberg"] = True
    return out


def _scan_volumes(catalog: str) -> dict:
    """Walk /Volumes/{catalog}/ recursively. Returns {by_ext: {ext: {bytes,files}}, total_bytes}."""
    by_ext: dict = {}
    total = 0
    stack = [f"/Volumes/{catalog}/"]
    while stack:
        path = stack.pop()
        try:
            entries = dbutils.fs.ls(path)
        except Exception:
            continue
        for e in entries:
            if e.path.endswith("/") and e.path != path:
                stack.append(e.path)
            elif e.size and e.size > 0:
                total += int(e.size)
                name = e.path.rstrip("/").split("/")[-1]
                ext = name.rsplit(".", 1)[-1].lower() if "." in name else "other"
                if ext not in by_ext:
                    by_ext[ext] = {"bytes": 0, "files": 0}
                by_ext[ext]["bytes"] += int(e.size)
                by_ext[ext]["files"] += 1
    return {"by_ext": by_ext, "total_bytes": total}


all_catalogs = [r[0] for r in spark.sql("SHOW CATALOGS").collect()]
user_catalogs = [c for c in all_catalogs if c not in EXCLUDE_CATALOGS]
print(f"workspace catalogs scanned: {user_catalogs}")

catalog_scan: dict = {}
for cat in user_catalogs:
    # Only count rows for target catalog (slower but only ~30 tables)
    count_rows = (cat == CATALOG)
    s = _scan_catalog(cat, count_rows=count_rows)
    v = _scan_volumes(cat)
    catalog_scan[cat] = {
        "schemas":      s["schemas"],
        "tables_bytes": s["totals"]["bytes"],
        "tables_rows":  s["totals"]["rows"],
        "n_tables":     s["totals"]["n_tables"],
        "formats":      sorted(list(s["totals"]["formats"])),
        "has_iceberg":  s["totals"]["has_iceberg"],
        "volumes_bytes": v["total_bytes"],
        "volumes_by_ext": v["by_ext"],
        "total_bytes":   s["totals"]["bytes"] + v["total_bytes"],
    }
    print(f"  {cat}: {s['totals']['n_tables']} tables · "
          f"{s['totals']['bytes']/1e6:.2f}MB tables · "
          f"{v['total_bytes']/1e6:.2f}MB volumes · "
          f"formats={catalog_scan[cat]['formats']}")

target_bytes     = catalog_scan.get(CATALOG, {}).get("total_bytes", 0)
workspace_bytes  = sum(c["total_bytes"] for c in catalog_scan.values())
storage_share    = (target_bytes / workspace_bytes) if workspace_bytes > 0 else 0.0
print(f"\nstorage_share_ratio = {target_bytes/1e6:.2f}MB / {workspace_bytes/1e6:.2f}MB "
      f"= {storage_share*100:.2f}%")

# COMMAND ----------

# ── Persist attribution metadata for downstream / export ──────────────────────
import datetime as _dt
import json as _json
from pyspark.sql import functions as F

snapshot_ts = _dt.datetime.utcnow()

# Table A: high-level per-catalog summary (used by daily_spend prorate ratio)
attribution_rows = []
for cat, b in catalog_scan.items():
    attribution_rows.append({
        "snapshot_at":     snapshot_ts,
        "catalog":         cat,
        "is_target":       cat == CATALOG,
        "n_tables":        int(b["n_tables"]),
        "tables_bytes":    int(b["tables_bytes"]),
        "tables_rows":     int(b["tables_rows"]),
        "volumes_bytes":   int(b["volumes_bytes"]),
        "total_bytes":     int(b["total_bytes"]),
        "share_pct":       (b["total_bytes"] / workspace_bytes * 100.0) if workspace_bytes > 0 else 0.0,
        "formats":         _json.dumps(b["formats"]),
        "has_iceberg":     bool(b["has_iceberg"]),
        "volumes_by_ext":  _json.dumps(b["volumes_by_ext"]),
    })
attr_df = spark.createDataFrame(attribution_rows)
(
    attr_df.write.format("delta")
        .mode("overwrite")
        .option("overwriteSchema", "true")
        .saveAsTable(ATTRIBUTION_TABLE)
)
spark.sql(f"COMMENT ON TABLE {ATTRIBUTION_TABLE} IS "
          f"'Applied Finance FinOps · snapshot por catálogo do workspace. '"
          f"'share_pct = total_bytes / Σ(workspace). Usado pra ratear DEFAULT_STORAGE.'")
print(f"✔ attribution snapshot saved with {len(attribution_rows)} catalogs")

# Table B: per-schema layer breakdown (only target catalog — for the UI)
layer_rows = []
for cat, b in catalog_scan.items():
    for schema_name, tbls in b["schemas"].items():
        if not tbls:
            continue
        # Aggregate per schema
        n_tbl = len(tbls)
        sch_bytes = sum(t["bytes"] for t in tbls)
        sch_rows = sum((t["rows"] or 0) for t in tbls)
        sch_files = sum(t["num_files"] for t in tbls)
        sch_formats = sorted({t["format"] for t in tbls})
        sch_iceberg = any(t["has_iceberg"] for t in tbls)
        tables_payload = [
            {
                "table":       t["table"],
                "bytes":       int(t["bytes"]),
                "rows":        int(t["rows"]) if t["rows"] is not None else None,
                "num_files":   int(t["num_files"]),
                "format":      t["format"],
                "has_iceberg": bool(t["has_iceberg"]),
            }
            for t in sorted(tbls, key=lambda x: -x["bytes"])
        ]
        layer_rows.append({
            "snapshot_at":  snapshot_ts,
            "catalog":      cat,
            "is_target":    cat == CATALOG,
            "schema":       schema_name,
            "n_tables":     int(n_tbl),
            "total_bytes":  int(sch_bytes),
            "total_rows":   int(sch_rows),
            "total_files":  int(sch_files),
            "formats":      _json.dumps(sch_formats),
            "has_iceberg":  bool(sch_iceberg),
            "tables":       _json.dumps(tables_payload),
        })
if layer_rows:
    layer_df = spark.createDataFrame(layer_rows)
    (
        layer_df.write.format("delta")
            .mode("overwrite")
            .option("overwriteSchema", "true")
            .saveAsTable(LAYER_TABLE)
    )
    spark.sql(f"COMMENT ON TABLE {LAYER_TABLE} IS "
              f"'Applied Finance FinOps · breakdown por (catálogo, schema/layer) com '"
              f"'bytes, rows, formatos, files, e detalhe por tabela em JSON. '"
              f"'Target catalog tem contagem de linhas; outros têm apenas bytes.'")
    print(f"✔ layer breakdown saved with {len(layer_rows)} schemas")

# COMMAND ----------

# ── Priced billing: tagged compute (always attributable) ──────────────────────
ws_filter = f"AND u.workspace_id = '{current_ws_id}'" if current_ws_id else ""

tagged_compute = (
    spark.sql(f"""
      SELECT
        u.usage_date,
        u.billing_origin_product                    AS product,
        u.product_features.is_serverless            AS is_serverless,
        u.product_features.is_photon                AS is_photon,
        u.usage_metadata.job_run_id                 AS run_id,
        u.usage_quantity                            AS dbus,
        u.usage_quantity * lp.pricing.default       AS cost_usd
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
    .withColumn("attribution_ratio", F.lit(1.0))
    .withColumn("attribution_method", F.lit("tagged"))
)
n_tagged = tagged_compute.count()
print(f"tagged compute records: {n_tagged}")

# ── Workspace-level overhead: prorated by bytes_share ─────────────────────────
# DEFAULT_STORAGE / NETWORKING / PREDICTIVE_OPTIMIZATION são cobrados no nível
# do workspace e não carregam tags de job. Multiplicamos cost_usd × share_ratio.
overhead = (
    spark.sql(f"""
      SELECT
        u.usage_date,
        u.billing_origin_product                    AS product,
        u.product_features.is_serverless            AS is_serverless,
        u.product_features.is_photon                AS is_photon,
        CAST(NULL AS STRING)                        AS run_id,
        u.usage_quantity                            AS raw_dbus,
        u.usage_quantity * lp.pricing.default       AS raw_cost_usd
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
    .withColumn("dbus",                F.col("raw_dbus")     * F.lit(storage_share))
    .withColumn("cost_usd",            F.col("raw_cost_usd") * F.lit(storage_share))
    .withColumn("attribution_ratio",   F.lit(float(storage_share)))
    .withColumn("attribution_method",  F.lit("prorated_by_bytes"))
    .drop("raw_dbus", "raw_cost_usd")
)
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
    ("attribution_method",    "tagged (compute) ou prorated_by_bytes (overhead)"),
]:
    # Escape any single quotes in desc to keep SQL valid
    desc_sql = desc.replace("'", "''")
    spark.sql(f"ALTER TABLE {SILVER_TABLE} ALTER COLUMN {col} COMMENT '{desc_sql}'")

for k, v in [
    ("layer",  "silver"),
    ("domain", "finops"),
    ("source", "system.billing"),
    ("grain",  "day_product_class"),
    ("pii",    "false"),
]:
    spark.sql(f"ALTER TABLE {SILVER_TABLE} SET TAGS ('{k}'='{v}')")

print(f"\n✔ {SILVER_TABLE} written ({n} rows)")
