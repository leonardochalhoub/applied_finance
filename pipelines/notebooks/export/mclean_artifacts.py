# Databricks notebook source
"""Export gold.mclean_* tables to a single JSON artifact for the app.

Combines:
  - gold.mclean_descriptives  → desc per (window × sample)
  - gold.mclean_pooled        → pooled OLS coefficients per (window × sample)
  - gold.mclean_pooled_fit    → fit metadata (n, R²)
  - gold.mclean_annual        → annual cross-section coefficients

Output: /Volumes/{catalog}/gold/artifacts/mclean_results.json

The JSON contract matches `app/lib/data.ts → McLeanArtifact` so the app reads
it via `loadMcLean()` in `/mclean/page.tsx`.
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# COMMAND ----------
import datetime as dt
import json
import os
from collections import defaultdict

import pandas as pd

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("artifacts_dir", "/Volumes/finance_prd/gold/artifacts")
catalog       = dbutils.widgets.get("catalog")
artifacts_dir = dbutils.widgets.get("artifacts_dir")
dbutils.fs.mkdirs(artifacts_dir)

PAPER_DESC = {
    "Cash":     {"mean": 0.090, "std": 0.122, "p25": 0.010, "median": 0.0429, "p75": 0.122, "n": 5943},
    "dCash":    {"mean": 0.007, "std": 0.075, "p25": -0.013, "median": 0.0007, "p75": 0.025, "n": 5936},
    "dIssue":   {"mean": 0.027, "std": 0.106, "p25": -0.002, "median": 0.000, "p75": 0.030, "n": 5946},
    "dDebt":    {"mean": 0.038, "std": 0.127, "p25": -0.011, "median": 0.011, "p75": 0.076, "n": 5950},
    "Cashflow": {"mean": 0.038, "std": 0.152, "p25": 0.004, "median": 0.059, "p75": 0.116, "n": 5801},
    "Other":    {"mean": 0.003, "std": 0.015, "p25": 0.0,    "median": 0.0,    "p75": 0.0,   "n": 5640},
    "Assets":   {"mean": 13.854,"std": 2.162, "p25": 12.579, "median": 14.059, "p75": 15.278,"n": 5950},
}
PAPER_POOLED = {
    "dIssue":   {"coef":  0.087,    "tstat": 6.12, "sig": "***"},
    "dDebt":    {"coef":  0.095,    "tstat": 7.88, "sig": "***"},
    "Cashflow": {"coef":  0.0833,   "tstat": 8.35, "sig": "***"},
    "Other":    {"coef":  0.0414,   "tstat": 0.60, "sig":  ""},
    "Assets":   {"coef":  0.000146, "tstat": 0.22, "sig":  ""},
    "r2": 0.06, "n": 5473,
}


def _to_clean_pd(df_name: str) -> pd.DataFrame:
    df = spark.table(f"{catalog}.{df_name}").toPandas()
    return df.replace({pd.NA: None, float("nan"): None})


desc_df    = _to_clean_pd("gold.mclean_descriptives")
pooled_df  = _to_clean_pd("gold.mclean_pooled")
fit_df     = _to_clean_pd("gold.mclean_pooled_fit")
annual_df  = _to_clean_pd("gold.mclean_annual")

WINDOWS = ["full", "original"]
SAMPLES = ["full", "unconstrained", "constrained"]


def _desc_block(window: str, sample: str) -> dict[str, dict]:
    sub = desc_df[(desc_df["window"] == window) & (desc_df["sample"] == sample)]
    return {
        r["variable"]: {
            "mean":   r["mean"],
            "std":    r["std"],
            "p25":    r["p25"],
            "median": r["median"],
            "p75":    r["p75"],
            "n":      int(r["n"]) if r["n"] is not None else 0,
        }
        for _, r in sub.iterrows()
    }


def _pooled_block(window: str, sample: str) -> dict:
    sub = pooled_df[(pooled_df["window"] == window) & (pooled_df["sample"] == sample)]
    fit = fit_df[(fit_df["window"] == window) & (fit_df["sample"] == sample)]
    out: dict = {}
    if len(fit):
        m = fit.iloc[0]
        out["n"]      = int(m["n"]) if m["n"] is not None else 0
        out["r2"]     = float(m["r2"]) if m["r2"] is not None else 0.0
        out["r2_adj"] = float(m["r2_adj"]) if m["r2_adj"] is not None else 0.0
    for _, r in sub.iterrows():
        out[r["variable"]] = {
            "coef":  float(r["coef"]) if r["coef"] is not None else 0.0,
            "tstat": float(r["tstat"]) if r["tstat"] is not None else 0.0,
            "p":     float(r["p_value"]) if r["p_value"] is not None else 1.0,
            "sig":   r["sig"] or "",
        }
    return out


def _annual_block(window: str, sample: str) -> list[dict]:
    sub = annual_df[(annual_df["window"] == window) & (annual_df["sample"] == sample)]
    by_year: dict[int, dict] = defaultdict(lambda: {})
    for _, r in sub.iterrows():
        yr = int(r["fiscal_year"])
        if "year" not in by_year[yr]:
            by_year[yr] = {"year": yr, "n": int(r["n"]), "r2": float(r["r2"])}
        by_year[yr][r["variable"]] = {
            "coef":  float(r["coef"]),
            "tstat": float(r["tstat"]),
            "sig":   r["sig"] or "",
        }
    return sorted(by_year.values(), key=lambda d: d["year"])


def _window_meta(window: str) -> dict:
    sub = desc_df[(desc_df["window"] == window) & (desc_df["sample"] == "full")]
    if sub.empty:
        return {"window": [None, None], "n_firms": 0, "n_obs": 0}
    # n_obs comes from one of the variable rows (they all share the same panel)
    n_obs = int(sub["n"].max())
    # window bounds and n_firms not in gold; recover from fit table
    fit = fit_df[(fit_df["window"] == window) & (fit_df["sample"] == "full")]
    n_firms = 0
    # We don't carry n_firms in any gold table — but we can derive it from the
    # silver.mclean_clean filtered for the same window. Cheap enough:
    yrs = {"full": (2010, 2024), "original": (2010, 2013)}[window]
    nf = (
        spark.table(f"{catalog}.silver.mclean_clean")
        .where(f"fiscal_year BETWEEN {yrs[0]} AND {yrs[1]}")
        .selectExpr("count(DISTINCT cd_cvm) AS n_firms").collect()[0]["n_firms"]
    )
    n_firms = int(nf)
    return {"window": [yrs[0], yrs[1]], "n_firms": n_firms, "n_obs": n_obs}


payload = {
    "meta": {
        "paper":          "Chalhoub, Kirch & Terra (2015) — RBFin 13(3): 470–503",
        "paper_window":   [1995, 2013],
        "paper_n_firms":  655,
        "paper_n_obs":    5952,
        "data_source":    "CVM Dados Abertos / DFP",
        "generated_at":   dt.datetime.utcnow().isoformat() + "Z",
    },
    "windows": {},
    "paper_ref": {
        "desc_full":           PAPER_DESC,
        "pooled_model1_full":  PAPER_POOLED,
    },
}

for w in WINDOWS:
    payload["windows"][w] = {
        **_window_meta(w),
        "desc":   {s: _desc_block(w, s)   for s in SAMPLES},
        "pooled": {s: _pooled_block(w, s) for s in SAMPLES},
        "annual": {s: _annual_block(w, s) for s in SAMPLES},
    }

out_path = f"{artifacts_dir}/mclean_results.json"
with open(out_path, "w") as f:
    json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
log.info(f"wrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KB)")
