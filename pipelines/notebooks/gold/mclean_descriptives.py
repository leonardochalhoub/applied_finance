# Databricks notebook source
"""Build gold.mclean_descriptives — Table 1 stats per (window, sample, variable).

Materializes the descriptive statistics that feed the McLean replication app
tab. Two windows (full=2010–2025, original=2010–2013) × three sub-samples
(full, unconstrained, constrained) × seven variables = 42 rows.

The constrained/unconstrained classification follows Kirch et al (2014):
within each (sector, year), firms in the bottom 3 deciles of AT_{t-1} are
labelled constrained and those in the top 3 deciles unconstrained.
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# COMMAND ----------
import numpy as np
import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.gold")

DESC_VARS = ["Cash", "dCash", "dIssue", "dDebt", "Cashflow", "Other", "Assets"]
WINDOWS = {
    "full":     (2010, 2025),
    "original": (2010, 2013),
}


def _classify(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["sector"] = df["sector"].fillna("Sem Setor")
    cell_size = df.groupby(["sector", "fiscal_year"])["cd_cvm"].transform("count")
    df["ranked_pct"] = df.groupby(["sector", "fiscal_year"])["ativo_total_lag"].rank(pct=True)
    df["group"] = "middle"
    df.loc[(df["ranked_pct"] <= 0.30) & (cell_size >= 5), "group"] = "constrained"
    df.loc[(df["ranked_pct"] >= 0.70) & (cell_size >= 5), "group"] = "unconstrained"
    return df


def _describe(df: pd.DataFrame, window: str, sample: str) -> list[dict]:
    out = []
    for v in DESC_VARS:
        s = df[v].dropna()
        if s.empty:
            out.append({"window": window, "sample": sample, "variable": v,
                        "n": 0, "mean": None, "std": None, "p25": None, "median": None, "p75": None})
        else:
            out.append({
                "window":   window,
                "sample":   sample,
                "variable": v,
                "n":        int(len(s)),
                "mean":     float(s.mean()),
                "std":      float(s.std()),
                "p25":      float(s.quantile(0.25)),
                "median":   float(s.median()),
                "p75":      float(s.quantile(0.75)),
            })
    return out


clean = spark.table(f"{catalog}.silver.mclean_clean").toPandas()
log.info(f"loaded silver.mclean_clean → {len(clean):,} rows")

rows: list[dict] = []
for window, (y0, y1) in WINDOWS.items():
    win = clean[clean["fiscal_year"].between(y0, y1)]
    win = _classify(win)
    rows.extend(_describe(win,                                window, "full"))
    rows.extend(_describe(win[win["group"] == "unconstrained"], window, "unconstrained"))
    rows.extend(_describe(win[win["group"] == "constrained"],   window, "constrained"))

out = pd.DataFrame(rows)
out["computed_at"] = pd.Timestamp.utcnow()
sdf = spark.createDataFrame(out)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.gold.mclean_descriptives"
)
log.info(f"gold.mclean_descriptives → {len(out)} rows ({out['window'].nunique()} windows × "
         f"{out['sample'].nunique()} samples × {out['variable'].nunique()} variables)")
