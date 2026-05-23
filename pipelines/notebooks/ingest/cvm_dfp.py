# Databricks notebook source
"""Ingest annual CVM DFP zips + Cadastro CSV to a UC Volume.

CVM Dados Abertos publishes one annual zip with the standardized financial
statements (BPA/BPP/DRE/DFC) for each Brazilian listed company, from 2010
onwards. We use these as the bronze raw landing for the McLean (2011)
replication pipeline (see `docs/METHODOLOGY.md` § McLean).

Output layout under `/Volumes/{catalog}/bronze/raw/cvm_dfp/run_id=<run_id>/`:
    dfp_cia_aberta_2010.zip
    dfp_cia_aberta_2011.zip
    ...
    dfp_cia_aberta_2025.zip
    cad_cia_aberta.csv
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# COMMAND ----------
import os
import urllib.request
import uuid
from pathlib import Path

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("volume_dir", "/Volumes/finance_prd/bronze/raw/cvm_dfp")
dbutils.widgets.text("from_year", "2010")
dbutils.widgets.text("to_year",   "2025")

catalog    = dbutils.widgets.get("catalog")
volume_dir = dbutils.widgets.get("volume_dir")
from_year  = int(dbutils.widgets.get("from_year"))
to_year    = int(dbutils.widgets.get("to_year"))

DFP_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS"
CAD_URL  = "https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv"

run_id = os.environ.get("DATABRICKS_RUN_ID", str(uuid.uuid4()))
out_dir = f"{volume_dir}/run_id={run_id}"
dbutils.fs.mkdirs(out_dir)

def _download(url: str, dest_path: str, label: str) -> int:
    """Stream-download a URL to a UC Volume path, return bytes written."""
    log.info(f"GET {label} ← {url}")
    tmp = dest_path + ".tmp"
    n = 0
    with urllib.request.urlopen(url, timeout=180) as resp, open(tmp, "wb") as f:
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            f.write(chunk)
            n += len(chunk)
    os.replace(tmp, dest_path)
    log.info(f"     ✓ {n/1e6:.1f} MB → {dest_path}")
    return n

total_bytes = 0
for year in range(from_year, to_year + 1):
    fname = f"dfp_cia_aberta_{year}.zip"
    total_bytes += _download(f"{DFP_BASE}/{fname}", f"{out_dir}/{fname}", f"DFP {year}")

# Cadastro (sector registry) — separate static endpoint
total_bytes += _download(CAD_URL, f"{out_dir}/cad_cia_aberta.csv", "Cadastro de Companhias")

log.info(f"Total ingested: {total_bytes/1e6:.1f} MB → {out_dir}")

# Prune prior run_id directories now that the new full set landed cleanly.
# CVM republishes the complete 2010-202x history every year, so prior runs
# are fully redundant; without pruning, `bronze_cvm_dfp_lines` would scan
# N×16 zips after N daily runs and trip the serverless 2h session timeout.
# Pruning happens AFTER all downloads succeed so a mid-ingest failure leaves
# the previous good run in place.
pruned = 0
for status in dbutils.fs.ls(volume_dir):
    if not status.path.endswith("/"):
        continue
    other = status.path.rstrip("/").split("run_id=")[-1]
    if other == run_id:
        continue
    log.info(f"  pruning stale run_id={other[:8]}…")
    dbutils.fs.rm(status.path, recurse=True)
    pruned += 1
log.info(f"Pruned {pruned} prior run_id director(ies); kept run_id={run_id[:8]}.")

dbutils.jobs.taskValues.set(key="cvm_ingest_run_id", value=run_id)
dbutils.jobs.taskValues.set(key="cvm_ingest_bytes", value=total_bytes)
