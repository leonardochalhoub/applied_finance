# Databricks notebook source
"""Build gold.mclean_annual — annual cross-section coefficients.

Replicates the paper's Figure 1: for each fiscal_year (in each window × sample),
estimates the McLean cross-section regression separately. The resulting time
series of coefficients shows whether retention rates from each source are
trending up/down/stable.

Rows: (window × sample × fiscal_year × variable). Years with fewer than 20
observations in a sub-sample are skipped.
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# MAGIC %pip install -q statsmodels
# COMMAND ----------
dbutils.library.restartPython()
# COMMAND ----------
import pandas as pd
import statsmodels.api as sm

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.gold")

REG_VARS = ["dIssue", "dDebt", "Cashflow", "Other", "Assets"]
MIN_OBS_PER_YEAR = 20
WINDOWS = {
    "full":     (2010, 2024),
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


def _sig(p: float) -> str:
    if p < 0.01: return "***"
    if p < 0.05: return "**"
    if p < 0.10: return "*"
    return ""


def _fit_year(window: str, sample: str, year: int, df: pd.DataFrame) -> list[dict]:
    sub = df[["dCash"] + REG_VARS].dropna()
    if len(sub) < MIN_OBS_PER_YEAR:
        return []
    try:
        fit = sm.OLS(sub["dCash"], sm.add_constant(sub[REG_VARS])).fit(cov_type="HC1")
    except Exception as e:
        log.warning(f"  [{window}/{sample}/{year}] fit failed: {e}")
        return []
    rows = []
    for v in REG_VARS:
        rows.append({
            "window":      window,
            "sample":      sample,
            "fiscal_year": int(year),
            "variable":    v,
            "coef":        float(fit.params[v]),
            "tstat":       float(fit.tvalues[v]),
            "p_value":     float(fit.pvalues[v]),
            "sig":         _sig(float(fit.pvalues[v])),
            "n":           int(fit.nobs),
            "r2":          float(fit.rsquared),
        })
    return rows


clean = spark.table(f"{catalog}.silver.mclean_clean").toPandas()
log.info(f"loaded silver.mclean_clean → {len(clean):,} rows")

all_rows: list[dict] = []
for window, (y0, y1) in WINDOWS.items():
    win = _classify(clean[clean["fiscal_year"].between(y0, y1)])
    for sample, sub in [
        ("full",          win),
        ("unconstrained", win[win["group"] == "unconstrained"]),
        ("constrained",   win[win["group"] == "constrained"]),
    ]:
        for year, year_sub in sub.groupby("fiscal_year"):
            all_rows.extend(_fit_year(window, sample, int(year), year_sub))

out = pd.DataFrame(all_rows)
out["computed_at"] = pd.Timestamp.utcnow()
spark.createDataFrame(out).write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable(f"{catalog}.gold.mclean_annual")

log.info(f"gold.mclean_annual → {len(out)} rows "
         f"({out['window'].nunique()} windows × {out['sample'].nunique()} samples × "
         f"{out['fiscal_year'].nunique()} years × {out['variable'].nunique()} vars)")
