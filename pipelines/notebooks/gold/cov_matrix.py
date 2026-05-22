# Databricks notebook source
"""Build gold.cov_matrix_<window> + valid_tickers_<window>.json sidecar.

Windows:
  - 1y:   last 252 trading days
  - 5y:   last 1260 trading days
  - full: every row available

Survivorship: the "full" window in particular subsets to tickers with
complete coverage; the sidecar reports n_total / n_valid / n_excluded
and breaks down exclusions by reason for transparency.

Shrinkage: optional Ledoit-Wolf shrinkage toward (a) identity or
(b) constant-correlation target. Sample covariance with N≳T can be
ill-conditioned and explode Markowitz; shrinkage reduces estimation
error at the cost of bias.

PSD check: min eigenvalue ≥ -1e-10 after symmetrization. Hard fail otherwise.
"""
# COMMAND ----------
import datetime as dt
import json
import logging
import os

import numpy as np
import pandas as pd

log = logging.getLogger("gold.cov_matrix")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

dbutils.widgets.text("catalog", "finance_prd")
dbutils.widgets.text("window", "5y")
dbutils.widgets.dropdown("shrinkage_target", "none", ["none", "identity", "constant_correlation"])
catalog = dbutils.widgets.get("catalog")
window = dbutils.widgets.get("window")
shrinkage_target = dbutils.widgets.get("shrinkage_target")

window_days = {
    "1y": 252,
    "5y": 1260,
    "10y": 2520,
    "15y": 3780,
    "20y": 5040,
    "full": None,
}[window]

returns = spark.table(f"{catalog}.gold.returns_wide").toPandas()
returns = returns.sort_values("trading_date").reset_index(drop=True)
if window_days is not None and len(returns) > window_days:
    returns = returns.tail(window_days)

ticker_cols = [c for c in returns.columns if c != "trading_date"]
n_total = len(ticker_cols)

# Classify each ticker by coverage in the window
MIN_COVERAGE = 0.95  # at least 95% non-null observations in window
n_window = len(returns)

valid: list[str] = []
excluded: list[dict[str, str]] = []
for c in ticker_cols:
    series = returns[c]
    coverage = float(series.notna().mean())
    if coverage >= 1.0:
        valid.append(c)
    elif coverage >= MIN_COVERAGE:
        excluded.append({"ticker": c, "reason": "low_liquidity", "coverage": round(coverage, 4)})
    else:
        # Decide whether this is insufficient_history vs delisted by looking at
        # where the gaps are
        first_idx = series.first_valid_index()
        last_idx = series.last_valid_index()
        if first_idx is None:
            excluded.append({"ticker": c, "reason": "insufficient_history", "coverage": 0.0})
        elif first_idx > 0:
            excluded.append({"ticker": c, "reason": "insufficient_history", "coverage": round(coverage, 4)})
        elif last_idx is not None and last_idx < len(series) - 1:
            excluded.append({"ticker": c, "reason": "delisted", "coverage": round(coverage, 4)})
        else:
            excluded.append({"ticker": c, "reason": "insufficient_history", "coverage": round(coverage, 4)})

if not valid:
    raise RuntimeError(f"No ticker has complete coverage in window {window}")

X = returns[valid].to_numpy(dtype=np.float64)
T, N = X.shape


def _sample_cov(X_: np.ndarray) -> np.ndarray:
    return np.cov(X_.T, ddof=1)


def _ledoit_wolf_identity(X_: np.ndarray) -> tuple[np.ndarray, float]:
    """Ledoit-Wolf shrinkage toward σ̄² · I.

    Returns (Σ̂_shrunk, optimal_intensity δ*).
    """
    Tn, Nn = X_.shape
    # de-meaned
    Xc = X_ - X_.mean(axis=0, keepdims=True)
    S = (Xc.T @ Xc) / (Tn - 1)
    mu = float(np.trace(S) / Nn)
    F = mu * np.eye(Nn)
    # Pi: sum of asymptotic variances of sample cov entries
    Y = Xc * Xc
    Pi = float(((Y.T @ Y) / Tn - S * S).sum())
    # No need for rho_diag/off correction toward identity; just rho_hat
    gamma = float(((F - S) ** 2).sum())
    if gamma <= 0:
        return S, 0.0
    kappa = Pi / gamma
    delta = max(0.0, min(1.0, kappa / Tn))
    return delta * F + (1 - delta) * S, delta


def _ledoit_wolf_constcorr(X_: np.ndarray) -> tuple[np.ndarray, float]:
    """Ledoit-Wolf shrinkage toward constant-correlation target."""
    Tn, Nn = X_.shape
    Xc = X_ - X_.mean(axis=0, keepdims=True)
    S = (Xc.T @ Xc) / (Tn - 1)
    var = np.diag(S)
    sd = np.sqrt(var)
    # Sample correlation
    denom = np.outer(sd, sd)
    denom[denom == 0] = 1.0
    R = S / denom
    # Average off-diagonal correlation
    mask = ~np.eye(Nn, dtype=bool)
    rbar = float(R[mask].mean()) if mask.any() else 0.0
    # Target: constant-correlation
    F = rbar * denom
    np.fill_diagonal(F, var)
    # Simple shrinkage intensity proxy
    gamma = float(((F - S) ** 2).sum())
    if gamma <= 0:
        return S, 0.0
    Y = Xc * Xc
    Pi = float(((Y.T @ Y) / Tn - S * S).sum())
    delta = max(0.0, min(1.0, (Pi / gamma) / Tn))
    return delta * F + (1 - delta) * S, delta


if shrinkage_target == "identity":
    cov_daily, shrinkage_intensity = _ledoit_wolf_identity(X)
    shrinkage_used = "identity"
elif shrinkage_target == "constant_correlation":
    cov_daily, shrinkage_intensity = _ledoit_wolf_constcorr(X)
    shrinkage_used = "constant_correlation"
else:
    cov_daily = _sample_cov(X)
    shrinkage_intensity = 0.0
    shrinkage_used = "none"

cov = cov_daily * 252.0
cov = 0.5 * (cov + cov.T)
min_eig = float(np.linalg.eigvalsh(cov).min())
assert min_eig >= -1e-10, f"Covariance not PSD: min eigenvalue = {min_eig}"
log.info(
    "window=%s · valid=%d/%d · shrinkage=%s δ=%.4f · min_eig=%.2e",
    window, len(valid), n_total, shrinkage_used, shrinkage_intensity, min_eig,
)

# Long-form for Delta
indices = np.indices((len(valid), len(valid)))
i_idx = indices[0].ravel()
j_idx = indices[1].ravel()
window_end_date = pd.Timestamp(returns["trading_date"].max()).date()
long_df = pd.DataFrame({
    "ticker_i": [valid[i] for i in i_idx],
    "ticker_j": [valid[j] for j in j_idx],
    "cov": cov.ravel().astype("float64"),
    "window_label": window,
    "valid_through": str(window_end_date),
})

sdf = spark.createDataFrame(long_df)
sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.gold.cov_matrix_{window}"
)

# Sidecar JSON
run_id = os.environ.get("DATABRICKS_RUN_ID", "local")
window_start_date = pd.Timestamp(returns["trading_date"].min()).date()
exclusions_by_reason = pd.DataFrame(excluded)["reason"].value_counts().to_dict() if excluded else {}
sidecar = {
    "window_label": window,
    "as_of": dt.date.today().isoformat(),
    "source_run_id": run_id,
    "window_start": window_start_date.isoformat(),
    "window_end": window_end_date.isoformat(),
    "n_total": n_total,
    "n_valid": len(valid),
    "n_excluded": len(excluded),
    "exclusions_by_reason": exclusions_by_reason,
    "valid_tickers": valid,
    "excluded_tickers": excluded,
    "shrinkage_target": shrinkage_used,
    "shrinkage_intensity": shrinkage_intensity,
    "min_eigenvalue": min_eig,
}
artifacts_dir = f"/Volumes/{catalog}/gold/artifacts"
dbutils.fs.mkdirs(artifacts_dir)
with open(f"{artifacts_dir}/valid_tickers_{window}.json", "w") as f:
    json.dump(sidecar, f, indent=2, default=str)
log.info(
    "valid_tickers_%s.json → %d valid, %d excluded (%s)",
    window, len(valid), len(excluded), exclusions_by_reason,
)
