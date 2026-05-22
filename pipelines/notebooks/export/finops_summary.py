# Databricks notebook source
# MAGIC %md
# MAGIC # export · finops_summary
# MAGIC
# MAGIC Lê `gold.finops_run_costs` + `gold.finops_daily_spend` e emite o JSON único
# MAGIC consumido pela aba `/finops` do app:
# MAGIC `/Volumes/<catalog>/gold/artifacts/finops_summary.json`.
# MAGIC
# MAGIC Estrutura — vide `app/lib/data.ts → FinopsArtifact`.

# COMMAND ----------

dbutils.widgets.text("catalog",       "finance_prd")
dbutils.widgets.text("artifacts_dir", "/Volumes/finance_prd/gold/artifacts")
dbutils.widgets.text("top_jobs",      "20")
dbutils.widgets.text("top_runs",      "25")

CATALOG       = dbutils.widgets.get("catalog")
ARTIFACTS_DIR = dbutils.widgets.get("artifacts_dir")
TOP_JOBS      = int(dbutils.widgets.get("top_jobs"))
TOP_RUNS      = int(dbutils.widgets.get("top_runs"))

GOLD_RUNS         = f"{CATALOG}.gold.finops_run_costs"
GOLD_DAILY        = f"{CATALOG}.gold.finops_daily_spend"
ATTRIBUTION_TABLE = f"{CATALOG}.silver.finops_storage_attribution"
LAYER_TABLE       = f"{CATALOG}.silver.finops_layer_breakdown"
OUTPUT_PATH       = f"{ARTIFACTS_DIR}/finops_summary.json"

dbutils.fs.mkdirs(ARTIFACTS_DIR)
print(f"runs={GOLD_RUNS}  daily={GOLD_DAILY}  out={OUTPUT_PATH}")

# COMMAND ----------

import json
from pathlib import Path
from datetime import datetime, timezone

import pandas as pd
from pyspark.sql import functions as F, types as T

# ─── Defensive: skip gracefully if upstream gold is missing/empty ─────────────
if not (spark.catalog.tableExists(GOLD_RUNS) and spark.catalog.tableExists(GOLD_DAILY)):
    print(f"⚠ {GOLD_RUNS} ou {GOLD_DAILY} não existe.")
    dbutils.notebook.exit("SKIPPED: upstream gold table missing")


def cast_decimals_to_double(df_):
    for f in df_.schema.fields:
        if isinstance(f.dataType, T.DecimalType):
            df_ = df_.withColumn(f.name, F.col(f.name).cast("double"))
    return df_


runs_pdf  = cast_decimals_to_double(spark.read.table(GOLD_RUNS).drop("_gold_built_ts")).toPandas()
daily_pdf = cast_decimals_to_double(spark.read.table(GOLD_DAILY).drop("_gold_built_ts")).toPandas()

if daily_pdf.empty:
    print("⚠ gold.finops_daily_spend vazio — nada pra exportar.")
    dbutils.notebook.exit("SKIPPED: gold daily is empty")

print(f"runs_pdf={len(runs_pdf)}  daily_pdf={len(daily_pdf)}")

# COMMAND ----------

# ─── Window metadata ──────────────────────────────────────────────────────────
daily_pdf = daily_pdf.sort_values("usage_date").reset_index(drop=True)
first_day = pd.to_datetime(daily_pdf["usage_date"].iloc[0]).date()
last_day  = pd.to_datetime(daily_pdf["usage_date"].iloc[-1]).date()
n_days    = (last_day - first_day).days + 1
print(f"window: {first_day} → {last_day}  ({n_days} days)")

# COMMAND ----------

def f(x):
    if pd.isna(x):
        return 0.0
    return round(float(x), 6)


def i(x):
    if pd.isna(x):
        return 0
    return int(x)


total_cost_lifetime = float(daily_pdf["cost_total"].sum())

# Normalize datetime columns
daily_pdf["usage_date"] = pd.to_datetime(daily_pdf["usage_date"])
if not runs_pdf.empty:
    runs_pdf["day"] = pd.to_datetime(runs_pdf["day"])

cutoff_30 = pd.Timestamp(last_day) - pd.Timedelta(days=29)
cutoff_7  = pd.Timestamp(last_day) - pd.Timedelta(days=6)

daily_30 = daily_pdf[daily_pdf["usage_date"] >= cutoff_30]
daily_7  = daily_pdf[daily_pdf["usage_date"] >= cutoff_7]

runs_30 = runs_pdf[runs_pdf["day"] >= cutoff_30] if not runs_pdf.empty else runs_pdf
runs_7  = runs_pdf[runs_pdf["day"] >= cutoff_7]  if not runs_pdf.empty else runs_pdf

# Wasted cost (ERROR + CANCELLED)
wasted_lifetime = float(runs_pdf[runs_pdf["is_wasted"]]["cost_usd"].sum()) if not runs_pdf.empty else 0.0
runs_jobs_total = float(runs_pdf["cost_usd"].sum()) if not runs_pdf.empty else 0.0
wasted_pct = (100.0 * wasted_lifetime / runs_jobs_total) if runs_jobs_total > 0 else 0.0

# Chargeable vs overhead split (lifetime)
charge_total = float(daily_pdf["cost_chargeable_total"].sum())
over_total   = float(daily_pdf["cost_overhead_total"].sum())
total_for_share = charge_total + over_total
charge_pct = (100.0 * charge_total / total_for_share) if total_for_share > 0 else 0.0
over_pct   = (100.0 * over_total   / total_for_share) if total_for_share > 0 else 0.0

# Cost-per-run distribution
if not runs_pdf.empty:
    costs_per_run = runs_pdf["cost_usd"].dropna().sort_values()
    avg_cost_per_run = float(costs_per_run.mean()) if len(costs_per_run) else 0.0
    p95_cost_per_run = float(costs_per_run.quantile(0.95)) if len(costs_per_run) else 0.0
else:
    avg_cost_per_run = 0.0
    p95_cost_per_run = 0.0

most_expensive_run = None
if not runs_pdf.empty:
    top_run = runs_pdf.sort_values("cost_usd", ascending=False).head(1)
    if len(top_run):
        r = top_run.iloc[0]
        most_expensive_run = {
            "job_id":         str(r["job_id"]) if pd.notna(r["job_id"]) else None,
            "run_id":         str(r["run_id"]) if pd.notna(r["run_id"]) else None,
            "job_name":       r["job_name_canonical"] if pd.notna(r["job_name_canonical"]) else "(sem nome)",
            "result_state":   r["result_state"],
            "cost_usd":       f(r["cost_usd"]),
            "billed_minutes": f(r["billed_minutes"]),
            "day":            r["day"].strftime("%Y-%m-%d") if pd.notna(r["day"]) else None,
        }

kpis = {
    "total_cost_usd_lifetime":   f(total_cost_lifetime),
    "total_cost_usd_30d":        f(daily_30["cost_total"].sum()),
    "total_cost_usd_7d":         f(daily_7["cost_total"].sum()),
    "total_dbus_lifetime":       f(daily_pdf["dbus_total"].sum()),
    "n_runs_lifetime":           i(len(runs_pdf)),
    "n_runs_30d":                i(len(runs_30)),
    "n_runs_7d":                 i(len(runs_7)),
    "wasted_cost_usd_lifetime":  f(wasted_lifetime),
    "wasted_pct_lifetime":       f(wasted_pct),
    "avg_cost_per_run_usd":      f(avg_cost_per_run),
    "p95_cost_per_run_usd":      f(p95_cost_per_run),
    "chargeable_share_pct":      f(charge_pct),
    "overhead_share_pct":        f(over_pct),
    "most_expensive_run":        most_expensive_run,
}
print("KPIs:", json.dumps(kpis, default=str, indent=2))

# COMMAND ----------

daily_out = []
for _, row in daily_pdf.iterrows():
    daily_out.append({
        "usage_date":             row["usage_date"].strftime("%Y-%m-%d"),
        "cost_jobs":              f(row.get("cost_jobs")),
        "cost_sql":               f(row.get("cost_sql")),
        "cost_interactive":       f(row.get("cost_interactive")),
        "cost_dlt":               f(row.get("cost_dlt")),
        "cost_networking":        f(row.get("cost_networking")),
        "cost_storage":           f(row.get("cost_storage")),
        "cost_pred_opt":          f(row.get("cost_pred_opt")),
        "cost_chargeable_total":  f(row.get("cost_chargeable_total")),
        "cost_overhead_total":    f(row.get("cost_overhead_total")),
        "cost_total":             f(row.get("cost_total")),
        "cost_total_cumulative":  f(row.get("cost_total_cumulative")),
        "dbus_total":             f(row.get("dbus_total")),
    })

# COMMAND ----------

prod_cols = {
    "JOBS": "cost_jobs", "SQL": "cost_sql", "INTERACTIVE": "cost_interactive", "DLT": "cost_dlt",
    "NETWORKING": "cost_networking", "DEFAULT_STORAGE": "cost_storage",
    "PREDICTIVE_OPTIMIZATION": "cost_pred_opt",
}
class_of = {
    "JOBS": "chargeable", "SQL": "chargeable", "INTERACTIVE": "chargeable", "DLT": "chargeable",
    "NETWORKING": "overhead", "DEFAULT_STORAGE": "overhead", "PREDICTIVE_OPTIMIZATION": "overhead",
}
by_product = []
for prod, col in prod_cols.items():
    cost = float(daily_pdf[col].sum())
    if cost <= 0:
        continue
    by_product.append({
        "product":        prod,
        "workload_class": class_of[prod],
        "cost_usd":       f(cost),
        "share_pct":      f(100.0 * cost / total_cost_lifetime) if total_cost_lifetime > 0 else 0.0,
    })
by_product.sort(key=lambda r: r["cost_usd"], reverse=True)

# COMMAND ----------

by_outcome = []
if not runs_pdf.empty:
    for state in ("SUCCEEDED", "ERROR", "CANCELLED", "UNKNOWN"):
        sub = runs_pdf[runs_pdf["result_state"] == state]
        if len(sub) == 0:
            continue
        cost = float(sub["cost_usd"].sum())
        by_outcome.append({
            "result_state":  state,
            "n_runs":        i(len(sub)),
            "cost_usd":      f(cost),
            "share_pct":     f(100.0 * cost / runs_jobs_total) if runs_jobs_total > 0 else 0.0,
            "avg_per_run":   f(cost / len(sub)) if len(sub) > 0 else 0.0,
            "avg_minutes":   f(sub["billed_minutes"].mean()),
        })

# COMMAND ----------

by_job_rows = []
if not runs_pdf.empty:
    for name, group in runs_pdf.groupby("job_name_canonical"):
        cost = float(group["cost_usd"].sum())
        by_job_rows.append({
            "job_name":     name if name else "(sem nome)",
            "n_runs":       i(len(group)),
            "cost_usd":     f(cost),
            "succeeded":    i((group["result_state"] == "SUCCEEDED").sum()),
            "failed":       i((group["result_state"] == "ERROR").sum()),
            "cancelled":    i((group["result_state"] == "CANCELLED").sum()),
            "avg_per_run":  f(cost / len(group)) if len(group) > 0 else 0.0,
            "wasted_cost":  f(group[group["is_wasted"]]["cost_usd"].sum()),
            "avg_minutes":  f(group["billed_minutes"].mean()),
        })
    by_job_rows.sort(key=lambda r: r["cost_usd"], reverse=True)
    by_job_rows = by_job_rows[:TOP_JOBS]

# COMMAND ----------

top_runs_out = []
if not runs_pdf.empty:
    top_runs_pdf = runs_pdf.sort_values("cost_usd", ascending=False).head(TOP_RUNS)
    for _, row in top_runs_pdf.iterrows():
        top_runs_out.append({
            "job_id":         str(row["job_id"]) if pd.notna(row["job_id"]) else None,
            "run_id":         str(row["run_id"]) if pd.notna(row["run_id"]) else None,
            "job_name":       row["job_name_canonical"] or "(sem nome)",
            "result_state":   row["result_state"],
            "is_wasted":      bool(row["is_wasted"]),
            "cost_usd":       f(row["cost_usd"]),
            "dbus":           f(row["dbus"]),
            "billed_minutes": f(row["billed_minutes"]),
            "day":            row["day"].strftime("%Y-%m-%d") if pd.notna(row["day"]) else None,
        })

# COMMAND ----------

# ─── Storage spending breakdown ───────────────────────────────────────────────
#
# Threshold history: an earlier version used `> 0.001` (one-tenth of a cent)
# to define "days with storage". On smaller Databricks accounts where the
# DEFAULT_STORAGE prorated daily cost lands at ~1e-5 USD (literally a few
# micro-dollars per day) every day fell below the threshold → days_with_storage
# = 0 → per-day metrics divided by zero → UI showed $0.00 across the storage
# panel even though the lifetime total was non-zero. Two robustness changes:
#   1. Threshold dropped to 1e-9 — count any day with any non-zero cost.
#   2. Per-day metrics fall back to averaging over the days the pipeline
#      actually ran (`len(daily_pdf)`) when threshold-based counts hit zero,
#      so the user always sees a meaningful run rate.
STORAGE_EPS = 1e-9
storage_lifetime = float(daily_pdf["cost_storage"].sum())
storage_30d      = float(daily_30["cost_storage"].sum())
days_with_storage    = int((daily_pdf["cost_storage"] > STORAGE_EPS).sum())
days_with_storage_30 = int((daily_30["cost_storage"]  > STORAGE_EPS).sum())

# Use the threshold-based count when it's positive; fall back to total pipeline
# days when storage costs are real (lifetime > 0) but all daily values land
# below the precision threshold. This keeps the per-day/month/year columns
# meaningful in the small-cost regime.
denom_lifetime = days_with_storage    if days_with_storage    > 0 else (len(daily_pdf) if storage_lifetime > 0 else 0)
denom_30d      = days_with_storage_30 if days_with_storage_30 > 0 else (len(daily_30)  if storage_30d      > 0 else 0)

storage_per_day_lifetime = (storage_lifetime / denom_lifetime) if denom_lifetime > 0 else 0.0
storage_per_day_current  = (storage_30d      / denom_30d)      if denom_30d      > 0 else 0.0
storage_per_month_run    = storage_per_day_current * 30.0
storage_per_year_run     = storage_per_day_current * 365.0
storage_pct_of_total     = (100.0 * storage_lifetime / total_cost_lifetime) if total_cost_lifetime > 0 else 0.0

storage = {
    "total_usd_lifetime":    f(storage_lifetime),
    "total_usd_30d":         f(storage_30d),
    "days_with_storage":     i(days_with_storage),
    "per_day_avg_lifetime":  f(storage_per_day_lifetime),
    "per_day_current":       f(storage_per_day_current),
    "per_month_run_rate":    f(storage_per_month_run),
    "per_year_run_rate":     f(storage_per_year_run),
    "share_of_total_pct":    f(storage_pct_of_total),
}
print(f"\nstorage: lifetime ${storage_lifetime:.4f}  "
      f"per_day_current ${storage_per_day_current:.4f}  "
      f"per_year ${storage_per_year_run:.2f}")

# COMMAND ----------

# ─── Storage attribution snapshot (workspace bytes per catalog) ──────────────
attribution = None
if spark.catalog.tableExists(ATTRIBUTION_TABLE):
    attr_pdf = spark.read.table(ATTRIBUTION_TABLE).toPandas()
    if not attr_pdf.empty:
        target_row = attr_pdf[attr_pdf["catalog"] == CATALOG]
        target_bytes = int(target_row["total_bytes"].iloc[0]) if len(target_row) else 0
        workspace_bytes = int(attr_pdf["total_bytes"].sum())
        catalogs_breakdown = []
        for _, row in attr_pdf.sort_values("total_bytes", ascending=False).iterrows():
            try:
                fmts = json.loads(row["formats"]) if isinstance(row["formats"], str) else []
            except Exception:
                fmts = []
            try:
                vol_by_ext = json.loads(row["volumes_by_ext"]) if isinstance(row["volumes_by_ext"], str) else {}
            except Exception:
                vol_by_ext = {}
            catalogs_breakdown.append({
                "catalog":        row["catalog"],
                "is_target":      bool(row["is_target"]),
                "n_tables":       int(row.get("n_tables", 0) or 0),
                "tables_bytes":   int(row["tables_bytes"]),
                "tables_rows":    int(row.get("tables_rows", 0) or 0),
                "volumes_bytes":  int(row["volumes_bytes"]),
                "total_bytes":    int(row["total_bytes"]),
                "share_pct":      f(row["share_pct"]),
                "formats":        fmts,
                "has_iceberg":    bool(row.get("has_iceberg", False)),
                "volumes_by_ext": vol_by_ext,
            })
        attribution = {
            "snapshot_at":          str(attr_pdf["snapshot_at"].iloc[0]),
            "target_catalog":       CATALOG,
            "target_bytes":         target_bytes,
            "workspace_bytes":      workspace_bytes,
            "storage_share_pct":    f(100.0 * target_bytes / workspace_bytes) if workspace_bytes > 0 else 0.0,
            "catalogs":             catalogs_breakdown,
        }
        print(f"attribution: {CATALOG} = {target_bytes/1e6:.2f}MB / "
              f"{workspace_bytes/1e6:.2f}MB ({attribution['storage_share_pct']}%)")

# ─── Layer breakdown (target catalog only) ────────────────────────────────────
layers = None
if spark.catalog.tableExists(LAYER_TABLE):
    layer_pdf = spark.read.table(LAYER_TABLE).toPandas()
    if not layer_pdf.empty:
        target_layers = layer_pdf[layer_pdf["catalog"] == CATALOG].copy()
        # Sort: bronze → silver → gold → others
        order_map = {"bronze": 0, "silver": 1, "gold": 2}
        target_layers["_order"] = target_layers["schema"].map(lambda s: order_map.get(s, 99))
        target_layers = target_layers.sort_values(["_order", "schema"]).drop(columns=["_order"])
        layers_out = []
        for _, row in target_layers.iterrows():
            try:
                fmts = json.loads(row["formats"]) if isinstance(row["formats"], str) else []
            except Exception:
                fmts = []
            try:
                tables = json.loads(row["tables"]) if isinstance(row["tables"], str) else []
            except Exception:
                tables = []
            layers_out.append({
                "schema":       row["schema"],
                "n_tables":     int(row["n_tables"]),
                "total_bytes":  int(row["total_bytes"]),
                "total_rows":   int(row["total_rows"]),
                "total_files":  int(row["total_files"]),
                "formats":      fmts,
                "has_iceberg":  bool(row["has_iceberg"]),
                "tables":       tables,
            })
        layers = {
            "catalog":     CATALOG,
            "snapshot_at": str(layer_pdf["snapshot_at"].iloc[0]),
            "layers":      layers_out,
        }
        print(f"layers: {[(l['schema'], l['n_tables'], l['total_rows']) for l in layers_out]}")

summary = {
    "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "catalog":          CATALOG,
    "team_tag":         "applied-finance",
    "window": {
        "first_day": str(first_day),
        "last_day":  str(last_day),
        "n_days":    i(n_days),
    },
    "kpis":         kpis,
    "storage":      storage,
    "attribution":  attribution,
    "layers":       layers,
    "daily":        daily_out,
    "by_product":   by_product,
    "by_outcome":   by_outcome,
    "by_job":       by_job_rows,
    "top_runs":     top_runs_out,
}

print(f"\n--- summary preview ---")
print(f"  total_lifetime: USD {kpis['total_cost_usd_lifetime']}")
print(f"  total_30d:      USD {kpis['total_cost_usd_30d']}")
print(f"  wasted:         USD {kpis['wasted_cost_usd_lifetime']} ({kpis['wasted_pct_lifetime']}%)")
print(f"  daily series:   {len(daily_out)} days")
print(f"  by_product:     {len(by_product)} rows")
print(f"  by_outcome:     {len(by_outcome)} rows")
print(f"  by_job (top):   {len(by_job_rows)} rows")
print(f"  top_runs:       {len(top_runs_out)} rows")

# COMMAND ----------

dest = Path(OUTPUT_PATH)
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"✔ {dest}  ({dest.stat().st_size:,} bytes)")
