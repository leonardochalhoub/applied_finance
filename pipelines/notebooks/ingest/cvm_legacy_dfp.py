# Databricks notebook source
"""Scrape CVM Sistemas legacy filings (1995-2009) for the McLean replication panel.

PoC scope: 10 firms × 3 years (1998, 2003, 2008) × 5 statements = 150 fetches.
Resumable via `bronze.cvm_legacy_scrape_checkpoint`: every (cd_cvm, fiscal_year,
statement) tuple is one row; status transitions pending → fetching → cached
(or failed_retryable / failed_terminal). Killing this notebook at any point
and re-running it picks up at the first non-cached row with zero re-fetches.

PoC TODOs (mark in BUILD_REPORT before running for real):
  1. The ASP-form URL pattern in `_build_url` is a PLACEHOLDER — Phase 0
     step 1 spiders sistemas.cvm.gov.br/port/ciasabertas/* to find the real
     endpoint for each statement type. Without this, the scraper will 404
     on every fetch.
  2. The "is this a CVMWIN binary vs HTML page?" detection in `_persist`
     uses the Content-Type header; verify CVM sends application/octet-stream
     for binaries (Phase 0 manual fetch check).
"""
# COMMAND ----------
# MAGIC %pip install -q httpx tenacity
# COMMAND ----------
dbutils.library.restartPython()
# COMMAND ----------
import logging
import time
from random import uniform

import httpx
from pyspark.sql import functions as F
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("volume_dir", "/Volumes/finance_prd/bronze/raw/cvm_legacy")
dbutils.widgets.text("firm_universe_path", "/Volumes/finance_prd/bronze/reference/mclean_firm_universe.csv")
dbutils.widgets.text("from_year", "1998")
dbutils.widgets.text("to_year", "2008")
dbutils.widgets.text("poc_only", "true")
dbutils.widgets.text("concurrency", "1")  # single-threaded for PoC; bump to 3 for full run
dbutils.widgets.text("jitter_min_s", "1.0")
dbutils.widgets.text("jitter_max_s", "3.0")

catalog = dbutils.widgets.get("catalog")
volume_dir = dbutils.widgets.get("volume_dir")
firm_universe_path = dbutils.widgets.get("firm_universe_path")
from_year = int(dbutils.widgets.get("from_year"))
to_year = int(dbutils.widgets.get("to_year"))
poc_only = dbutils.widgets.get("poc_only").lower() == "true"
jitter_min = float(dbutils.widgets.get("jitter_min_s"))
jitter_max = float(dbutils.widgets.get("jitter_max_s"))

STATEMENT_TYPES = ["BPA", "BPP", "DRE", "DOAR_DFC", "IAN"]
USER_AGENT = "applied-finance/mclean-replication (academic replication of Chalhoub-Kirch-Terra 2015)"
CHECKPOINT_TABLE = f"{catalog}.bronze.cvm_legacy_scrape_checkpoint"

# COMMAND ----------
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.bronze")
spark.sql(f"""
CREATE TABLE IF NOT EXISTS {CHECKPOINT_TABLE} (
    cd_cvm       STRING NOT NULL,
    fiscal_year  INT    NOT NULL,
    statement    STRING NOT NULL,
    status       STRING NOT NULL,
    file_path    STRING,
    n_bytes      LONG,
    http_status  INT,
    error_msg    STRING,
    attempts     INT    NOT NULL,
    updated_at   TIMESTAMP NOT NULL
) USING DELTA
""")

# COMMAND ----------
# Seed the checkpoint table with all (firm × year × stmt) tuples we plan to fetch.
universe = spark.read.option("header", "true").csv(firm_universe_path)
if poc_only:
    universe = universe.where(F.col("poc_subset") == "true")
firms = [r["cd_cvm"] for r in universe.select("cd_cvm").collect()]
log.info(f"Seeding {len(firms)} firms × {to_year - from_year + 1} years × {len(STATEMENT_TYPES)} stmts")

seed_rows = [
    (cd, fy, stmt, "pending", None, None, None, None, 0)
    for cd in firms
    for fy in range(from_year, to_year + 1)
    for stmt in STATEMENT_TYPES
]
seed_df = spark.createDataFrame(
    seed_rows,
    ["cd_cvm", "fiscal_year", "statement", "status", "file_path", "n_bytes", "http_status", "error_msg", "attempts"],
).withColumn("updated_at", F.current_timestamp())

# Idempotent seed: MERGE inserts new tuples, leaves existing ones untouched.
seed_df.createOrReplaceTempView("_seed")
spark.sql(f"""
MERGE INTO {CHECKPOINT_TABLE} t
USING _seed s
ON t.cd_cvm = s.cd_cvm AND t.fiscal_year = s.fiscal_year AND t.statement = s.statement
WHEN NOT MATCHED THEN INSERT *
""")

# COMMAND ----------
def _build_url(cd_cvm: str, fy: int, statement: str) -> str:
    """Construct the CVM Sistemas ASP form URL for a single filing.

    PoC TODO: this is a PLACEHOLDER. The real URL pattern needs to be
    discovered by Phase 0 step 1 (spider sistemas.cvm.gov.br/port/ciasabertas
    + capture the network request when manually submitting the form for a
    known firm × year × statement). Update this function once known.
    """
    base = "https://sistemas.cvm.gov.br/port/ciasabertas"
    return f"{base}/PLACEHOLDER.asp?cd_cvm={cd_cvm}&ano={fy}&tipo={statement}"


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError)),
    reraise=True,
)
def _fetch(cd_cvm: str, fy: int, statement: str) -> httpx.Response:
    url = _build_url(cd_cvm, fy, statement)
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=60.0, follow_redirects=True) as client:
        r = client.get(url)
        if r.status_code in (429, 503):
            r.raise_for_status()
        return r


def _persist(payload: bytes, content_type: str, cd_cvm: str, fy: int, statement: str) -> tuple[str, int]:
    """Atomic write to UC Volume. Returns (final_path, n_bytes)."""
    ext = "bin" if "octet-stream" in content_type else "html"
    final = f"{volume_dir}/{cd_cvm}/{fy}/{statement}.{ext}"
    tmp = f"{final}.tmp"
    dbutils.fs.put(tmp, payload.decode("latin-1"), overwrite=True)  # latin-1 round-trip preserves bytes
    dbutils.fs.mv(tmp, final)
    return final, len(payload)


def _mark(cd_cvm: str, fy: int, statement: str, *, status: str, file_path: str | None = None,
          n_bytes: int | None = None, http_status: int | None = None, error_msg: str | None = None) -> None:
    spark.sql(f"""
    MERGE INTO {CHECKPOINT_TABLE} t
    USING (SELECT
        '{cd_cvm}' AS cd_cvm, {fy} AS fiscal_year, '{statement}' AS statement,
        '{status}' AS status,
        {f"'{file_path}'" if file_path else "CAST(NULL AS STRING)"} AS file_path,
        {n_bytes if n_bytes is not None else "CAST(NULL AS LONG)"} AS n_bytes,
        {http_status if http_status is not None else "CAST(NULL AS INT)"} AS http_status,
        {f"'{error_msg.replace(chr(39), chr(39)*2)}'" if error_msg else "CAST(NULL AS STRING)"} AS error_msg
    ) s
    ON t.cd_cvm = s.cd_cvm AND t.fiscal_year = s.fiscal_year AND t.statement = s.statement
    WHEN MATCHED THEN UPDATE SET
        status = s.status,
        file_path = s.file_path,
        n_bytes = s.n_bytes,
        http_status = s.http_status,
        error_msg = s.error_msg,
        attempts = t.attempts + 1,
        updated_at = current_timestamp()
    """)


# COMMAND ----------
queue = (
    spark.table(CHECKPOINT_TABLE)
    .where(F.col("status").isin("pending", "failed_retryable"))
    .orderBy("cd_cvm", "fiscal_year", "statement")
    .select("cd_cvm", "fiscal_year", "statement")
    .toPandas()
    .to_dict("records")
)
log.info(f"Work queue: {len(queue)} fetches")

n_cached, n_failed = 0, 0
for i, row in enumerate(queue, 1):
    cd, fy, stmt = row["cd_cvm"], row["fiscal_year"], row["statement"]
    _mark(cd, fy, stmt, status="fetching")
    try:
        resp = _fetch(cd, fy, stmt)
        if resp.status_code == 200 and resp.content:
            path, n = _persist(resp.content, resp.headers.get("content-type", ""), cd, fy, stmt)
            _mark(cd, fy, stmt, status="cached", file_path=path, n_bytes=n, http_status=200)
            n_cached += 1
        elif resp.status_code == 404:
            _mark(cd, fy, stmt, status="failed_terminal", http_status=404, error_msg="not found")
            n_failed += 1
        else:
            _mark(cd, fy, stmt, status="failed_retryable", http_status=resp.status_code,
                  error_msg=f"unexpected status {resp.status_code}")
            n_failed += 1
    except Exception as e:
        _mark(cd, fy, stmt, status="failed_retryable", error_msg=str(e)[:200])
        n_failed += 1

    if i % 10 == 0:
        log.info(f"  progress: {i}/{len(queue)} cached={n_cached} failed={n_failed}")
    time.sleep(uniform(jitter_min, jitter_max))

log.info(f"DONE — cached={n_cached} failed={n_failed} total={len(queue)}")
dbutils.jobs.taskValues.set(key="legacy_scrape_cached", value=n_cached)
dbutils.jobs.taskValues.set(key="legacy_scrape_failed", value=n_failed)
