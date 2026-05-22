# Databricks notebook source
"""Overwrite bronze.cvm_cad_cia from the cadastro CSV in the latest run partition.

The CVM Cadastro (`cad_cia_aberta.csv`) carries sector metadata (`SETOR_ATIV`)
which we use later to (a) exclude financial firms per the McLean replication
spec, and (b) compute the Kirch (2014) within-sector-year size deciles for
the constrained / unconstrained classification.

The file is small (~1.5 MB, ~2.7k rows) so we overwrite each run — keeping
the latest snapshot only.
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# COMMAND ----------
import datetime as dt
import re

import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("volume_dir", "/Volumes/finance_prd/bronze/raw/cvm_dfp")
catalog    = dbutils.widgets.get("catalog")
volume_dir = dbutils.widgets.get("volume_dir")

# Find the most-recent run_id partition that contains a cadastro CSV.
candidates = []
for status in dbutils.fs.ls(volume_dir):
    if not status.path.endswith("/"):
        continue
    for entry in dbutils.fs.ls(status.path):
        if entry.path.endswith("cad_cia_aberta.csv"):
            candidates.append(entry.path.replace("dbfs:", ""))

if not candidates:
    raise FileNotFoundError(
        f"No cad_cia_aberta.csv found under {volume_dir}/run_id=*/ — run ingest_cvm_dfp first."
    )

# Pick the one in the lexicographically-largest path (UUID4 run_ids aren't
# strictly ordered, so we also check mtime).
import os
csv_path = max(candidates, key=lambda p: os.path.getmtime(p))
log.info(f"Reading cadastro from: {csv_path}")

cad = pd.read_csv(csv_path, sep=";", encoding="latin-1", low_memory=False)

# Keep only the latest row per CD_CVM (DT_INI_SIT is monotonic per company).
cad["cd_cvm"] = cad["CD_CVM"].astype("Int64").astype("string").str.zfill(6)
cad = cad.sort_values(["cd_cvm", "DT_INI_SIT"]).drop_duplicates("cd_cvm", keep="last")
cad["sector_raw"] = cad["SETOR_ATIV"].fillna("Sem Setor")
# Strip the holding-company prefix so 'Emp. Adm. Part. - Energia Elétrica' is
# bucketed alongside 'Energia Elétrica' for within-sector ranking purposes.
cad["sector"] = cad["sector_raw"].str.replace(r"^Emp\. Adm\. Part\. - ", "", regex=True)

out = cad[[
    "cd_cvm", "DENOM_SOCIAL", "sector", "sector_raw", "SIT", "TP_MERC", "CATEG_REG",
    "SIT_EMISSOR", "CONTROLE_ACIONARIO", "DT_REG", "DT_CANCEL",
]].rename(columns={
    "DENOM_SOCIAL":       "denom_social",
    "SIT":                "situation",
    "TP_MERC":            "market_type",
    "CATEG_REG":          "category",
    "SIT_EMISSOR":        "issuer_situation",
    "CONTROLE_ACIONARIO": "control",
    "DT_REG":             "dt_registered",
    "DT_CANCEL":          "dt_cancelled",
})
out["ingested_at"] = pd.Timestamp.utcnow()

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.bronze")
sdf = spark.createDataFrame(out)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.bronze.cvm_cad_cia"
)
log.info(f"bronze.cvm_cad_cia → {len(out):,} rows")
dbutils.jobs.taskValues.set(key="bronze_cad_cia_rows", value=len(out))
