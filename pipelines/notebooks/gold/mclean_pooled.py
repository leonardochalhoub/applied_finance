# Databricks notebook source
"""Build gold.mclean_pooled — pooled OLS coefficients per (window, sample).

For each (window × sample) combination, estimates:

    ΔCash = α + β1·ΔIssue + β2·ΔDebt + β3·CashFlow + β4·Other + β5·Assets + ε

with HC1 robust standard errors (matching paper Table 3, Model 1).

Rows: (window ∈ {full, original}) × (sample ∈ {full, unconstrained, constrained})
      × (variable ∈ {const, dIssue, dDebt, Cashflow, Other, Assets})
                                                                   = 2×3×6 = 36 rows.
Plus a separate gold table `gold.mclean_pooled_fit` carries the per-fit
metadata (n, R², adj. R²) — kept separate so coefficients stay narrow/joinable.
"""
# COMMAND ----------
# MAGIC %pip install -q statsmodels
# COMMAND ----------
dbutils.library.restartPython()
# COMMAND ----------
import logging

import pandas as pd
import statsmodels.api as sm

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.gold")

REG_VARS = ["dIssue", "dDebt", "Cashflow", "Other", "Assets"]
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


def _sig(p: float) -> str:
    if p < 0.01: return "***"
    if p < 0.05: return "**"
    if p < 0.10: return "*"
    return ""


def _fit(window: str, sample: str, df: pd.DataFrame) -> tuple[list[dict], dict]:
    sub = df[["dCash"] + REG_VARS].dropna()
    if len(sub) < 10:
        log.warning(f"  [{window}/{sample}] only {len(sub)} obs — skipping fit")
        return [], {"window": window, "sample": sample, "n": len(sub), "r2": None, "r2_adj": None}
    fit = sm.OLS(sub["dCash"], sm.add_constant(sub[REG_VARS])).fit(cov_type="HC1")
    coef_rows: list[dict] = []
    for v in ["const"] + REG_VARS:
        coef_rows.append({
            "window":   window,
            "sample":   sample,
            "variable": v,
            "coef":     float(fit.params[v]),
            "tstat":    float(fit.tvalues[v]),
            "p_value":  float(fit.pvalues[v]),
            "sig":      _sig(float(fit.pvalues[v])),
        })
    fit_meta = {
        "window":  window,
        "sample":  sample,
        "n":       int(fit.nobs),
        "r2":      float(fit.rsquared),
        "r2_adj":  float(fit.rsquared_adj),
    }
    return coef_rows, fit_meta


clean = spark.table(f"{catalog}.silver.mclean_clean").toPandas()
log.info(f"loaded silver.mclean_clean → {len(clean):,} rows")

coef_rows: list[dict] = []
fit_rows: list[dict] = []
for window, (y0, y1) in WINDOWS.items():
    win = _classify(clean[clean["fiscal_year"].between(y0, y1)])
    for sample, sub in [
        ("full",          win),
        ("unconstrained", win[win["group"] == "unconstrained"]),
        ("constrained",   win[win["group"] == "constrained"]),
    ]:
        c, m = _fit(window, sample, sub)
        coef_rows.extend(c)
        fit_rows.append(m)
        log.info(f"  fit [{window}/{sample}]  n={m['n']:>5}  R²={m['r2']!r}")

now = pd.Timestamp.utcnow()
coef_df = pd.DataFrame(coef_rows); coef_df["computed_at"] = now
fit_df  = pd.DataFrame(fit_rows);  fit_df["computed_at"]  = now

spark.createDataFrame(coef_df).write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable(f"{catalog}.gold.mclean_pooled")
spark.createDataFrame(fit_df).write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable(f"{catalog}.gold.mclean_pooled_fit")

log.info(f"gold.mclean_pooled → {len(coef_df)} coefficient rows")
log.info(f"gold.mclean_pooled_fit → {len(fit_df)} fit-metadata rows")
