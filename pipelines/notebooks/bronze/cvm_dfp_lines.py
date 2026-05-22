# Databricks notebook source
"""MERGE CVM DFP zips from /Volumes/.../bronze/raw/cvm_dfp/** into bronze.cvm_dfp_lines.

Each annual DFP zip contains 4 statement-type CSVs we care about (consolidated):
    BPA_con  — Balance Sheet Assets
    BPP_con  — Balance Sheet Liabilities + Equity
    DRE_con  — Income Statement
    DFC_MI_con — Cash Flow (indirect method)

We unify them into a single LONG bronze table keyed by
(cd_cvm, fiscal_year, statement, cd_conta, ordem_exerc) with VL_NORM already
scaled by the `ESCALA_MOEDA` flag ("MIL" × 1000, else identity). Idempotent
MERGE on the key tuple — re-ingests of the same year overwrite older versions.
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# COMMAND ----------
import os
import re
import zipfile

from pyspark.sql import functions as F
from pyspark.sql.types import (DateType, DoubleType, IntegerType, StringType, StructField, StructType, TimestampType)

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("volume_dir", "/Volumes/finance_prd/bronze/raw/cvm_dfp")
catalog    = dbutils.widgets.get("catalog")
volume_dir = dbutils.widgets.get("volume_dir")

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.bronze")
spark.sql(f"""
CREATE TABLE IF NOT EXISTS {catalog}.bronze.cvm_dfp_lines (
    cnpj_cia        STRING,
    cd_cvm          STRING NOT NULL,
    denom_cia       STRING,
    fiscal_year     INT    NOT NULL,
    dt_refer        DATE,
    dt_fim_exerc    DATE   NOT NULL,
    statement       STRING NOT NULL,      -- 'BPA' | 'BPP' | 'DRE' | 'DFC_MI'
    grupo_dfp       STRING,
    ordem_exerc     STRING NOT NULL,      -- 'ÚLTIMO' | 'PENÚLTIMO'
    cd_conta        STRING NOT NULL,
    ds_conta        STRING,
    vl_norm         DOUBLE,               -- already scaled to BRL (no MIL multiplier)
    versao          STRING,
    source_year_file INT,                 -- which annual zip this row came from
    source_run_id   STRING NOT NULL,
    ingested_at     TIMESTAMP NOT NULL
)
USING DELTA
PARTITIONED BY (fiscal_year, statement)
TBLPROPERTIES (
    delta.autoOptimize.optimizeWrite = true,
    delta.autoOptimize.autoCompact   = true
)
""")

STMT_PATTERNS = {
    "BPA":    "BPA_con",
    "BPP":    "BPP_con",
    "DRE":    "DRE_con",
    "DFC_MI": "DFC_MI_con",
}

STAGE_SCHEMA = StructType([
    StructField("cnpj_cia",         StringType()),
    StructField("cd_cvm",           StringType(), nullable=False),
    StructField("denom_cia",        StringType()),
    StructField("fiscal_year",      IntegerType(), nullable=False),
    StructField("dt_refer",         DateType()),
    StructField("dt_fim_exerc",     DateType(), nullable=False),
    StructField("statement",        StringType(), nullable=False),
    StructField("grupo_dfp",        StringType()),
    StructField("ordem_exerc",      StringType(), nullable=False),
    StructField("cd_conta",         StringType(), nullable=False),
    StructField("ds_conta",         StringType()),
    StructField("vl_norm",          DoubleType()),
    StructField("versao",           StringType()),
    StructField("source_year_file", IntegerType()),
    StructField("source_run_id",    StringType(), nullable=False),
    StructField("ingested_at",      TimestampType(), nullable=False),
])

def _parse_year_from_zip_name(name: str) -> int | None:
    # Use just the basename so 4-digit runs of digits inside parent directories
    # (e.g. UUID-shaped `run_id=...`) don't shadow the real year suffix.
    m = re.search(r"(\d{4})", os.path.basename(name))
    return int(m.group(1)) if m else None

def _scale(escala: str | None) -> float:
    return 1000.0 if escala == "MIL" else 1.0

import datetime as dt
ingested_at = dt.datetime.utcnow()

# Locate every run partition in the volume — process all uningested zips.
all_zips: list[tuple[str, int, str]] = []  # (path, year, run_id)
for status in dbutils.fs.ls(volume_dir):
    if not status.path.endswith("/"):
        continue
    run_id_dir = status.path
    run_id = run_id_dir.rstrip("/").split("run_id=")[-1]
    for entry in dbutils.fs.ls(run_id_dir):
        if not entry.path.lower().endswith(".zip"):
            continue
        yr = _parse_year_from_zip_name(entry.path)
        if yr is None:
            continue
        all_zips.append((entry.path.replace("dbfs:", ""), yr, run_id))

if not all_zips:
    raise RuntimeError(f"No zip files found under {volume_dir}/run_id=*/")
log.info(f"Found {len(all_zips)} zip(s) under {volume_dir}")

# Parse and MERGE one zip at a time. Each annual CVM zip yields ~200k rows
# (~16 fields each as Python tuples), and accumulating all of them in one
# Python list before staging blows the driver heap once you have ~15+ years.
# Staging per-zip caps the driver footprint at one year's worth of rows.
import csv, gc, io


def _parse_zip(path: str, year: int, run_id: str) -> list[tuple]:
    rows: list[tuple] = []
    with zipfile.ZipFile(path) as z:
        for stmt, pattern in STMT_PATTERNS.items():
            candidates = [n for n in z.namelist() if pattern in n]
            if not candidates:
                log.warning(f"    no {pattern} CSV inside {os.path.basename(path)}; skipping")
                continue
            with z.open(candidates[0]) as fh:
                text = fh.read().decode("latin-1")
            reader = csv.DictReader(io.StringIO(text), delimiter=";")
            for r in reader:
                escala = r.get("ESCALA_MOEDA")
                try:
                    vl = float(r.get("VL_CONTA", "")) * _scale(escala)
                except (TypeError, ValueError):
                    vl = None
                fy_src = r.get("DT_FIM_EXERC", "")[:4]
                if not fy_src.isdigit():
                    continue
                fy = int(fy_src)
                dt_fim = r.get("DT_FIM_EXERC")
                dt_ref = r.get("DT_REFER") or None
                rows.append((
                    r.get("CNPJ_CIA"),
                    str(r.get("CD_CVM", "")).zfill(6),
                    r.get("DENOM_CIA"),
                    fy,
                    dt.date.fromisoformat(dt_ref) if dt_ref else None,
                    dt.date.fromisoformat(dt_fim),
                    stmt,
                    r.get("GRUPO_DFP"),
                    r.get("ORDEM_EXERC", ""),
                    r.get("CD_CONTA", ""),
                    r.get("DS_CONTA"),
                    vl,
                    r.get("VERSAO"),
                    year,
                    run_id,
                    ingested_at,
                ))
    return rows


# Dedupe the source by the natural key before MERGE — newer CVM zips
# (notably 2025) ship restatements that produce multiple rows with the same
# (cd_cvm, dt_fim_exerc, statement, cd_conta, ordem_exerc) but different
# VERSAO. Without this, Delta MERGE fails with
# DELTA_MULTIPLE_SOURCE_ROW_MATCHING_TARGET_ROW_IN_MERGE. Keep the highest
# VERSAO (the latest restatement); break ties by ingested_at.
MERGE_SQL = f"""
MERGE INTO {catalog}.bronze.cvm_dfp_lines AS tgt
USING (
  SELECT * EXCEPT(_rn) FROM (
    SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY cd_cvm, dt_fim_exerc, statement, cd_conta, ordem_exerc
             ORDER BY versao DESC NULLS LAST, ingested_at DESC
           ) AS _rn
    FROM stage_cvm_dfp_chunk
  )
  WHERE _rn = 1
) AS src
ON  tgt.cd_cvm = src.cd_cvm
AND tgt.dt_fim_exerc = src.dt_fim_exerc
AND tgt.statement = src.statement
AND tgt.cd_conta = src.cd_conta
AND tgt.ordem_exerc = src.ordem_exerc
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *
"""

grand_total = 0
for path, year, run_id in all_zips:
    log.info(f"  reading {os.path.basename(path)} (year={year}, run={run_id[:8]})")
    chunk = _parse_zip(path, year, run_id)
    log.info(f"    parsed {len(chunk):,} rows; staging + MERGE…")
    spark.createDataFrame(chunk, schema=STAGE_SCHEMA).createOrReplaceTempView("stage_cvm_dfp_chunk")
    spark.sql(MERGE_SQL)
    grand_total += len(chunk)
    del chunk
    gc.collect()

log.info(f"Parsed and merged {grand_total:,} raw lines across {len(all_zips)} zip(s).")

total = spark.table(f"{catalog}.bronze.cvm_dfp_lines").count()
log.info(f"bronze.cvm_dfp_lines → {total:,} rows total")
dbutils.jobs.taskValues.set(key="bronze_cvm_dfp_rows", value=total)
