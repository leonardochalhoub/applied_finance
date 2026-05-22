"""Smoke test: run the Gold KPI math on a tiny fixture and compare to a frozen hash.

This is the reproducibility gate the Mirante Eng. Software conselheiro asked for.
Runs in CI without Databricks — it re-implements the Gold KPI math (kept in sync
with pipelines/notebooks/gold/kpis_per_ticker.py) and feeds a deterministic
synthetic Bronze frame.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_HASH_FILE = ROOT / "pipelines" / "tests" / "gold_smoke.hash.txt"


def _synthetic_silver(n_tickers: int = 5, n_days: int = 60, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    tickers = [f"TST{i}.SA" for i in range(n_tickers)]
    dates = pd.date_range("2024-01-02", periods=n_days, freq="B")
    rows = []
    for i, t in enumerate(tickers):
        log_ret = rng.normal(loc=0.0005 + 0.0001 * i, scale=0.015 + 0.001 * i, size=n_days)
        price = 100 * np.exp(np.cumsum(log_ret))
        for d, p in zip(dates, price, strict=True):
            rows.append({"ticker": t, "trading_date": d, "close": float(p)})
    return pd.DataFrame(rows)


def _compute_kpis(silver: pd.DataFrame, cdi_annual: float = 0.13) -> pd.DataFrame:
    silver = silver.copy()
    silver["trading_date"] = pd.to_datetime(silver["trading_date"])
    silver = silver.drop_duplicates(subset=["ticker", "trading_date"]).sort_values(
        ["ticker", "trading_date"]
    )
    ytd_start = silver["trading_date"].min().date()
    records = []
    for ticker, grp in silver.groupby("ticker"):
        grp = grp.reset_index(drop=True)
        ytd = grp[grp["trading_date"].dt.date >= ytd_start]
        first_ytd = float(ytd["close"].iloc[0])
        last_close = float(grp["close"].iloc[-1])
        return_ytd = float(np.log(last_close / first_ytd))
        log_ret = np.log(grp["close"].to_numpy() / grp["close"].shift(1).to_numpy())[1:]
        log_ret = log_ret[np.isfinite(log_ret)]
        vol_annual = float(np.std(log_ret, ddof=1) * np.sqrt(252))
        mean_ann = float(np.mean(log_ret) * 252)
        sharpe = float((mean_ann - cdi_annual) / vol_annual) if vol_annual > 0 else None
        prices = grp["close"].to_numpy()
        peaks = np.maximum.accumulate(prices)
        max_dd = float(((prices - peaks) / peaks).min())
        records.append({
            "ticker": ticker,
            "return_ytd": round(return_ytd, 10),
            "vol_annual": round(vol_annual, 10),
            "max_drawdown": round(max_dd, 10),
            "sharpe_vs_cdi": round(sharpe, 10) if sharpe is not None else None,
        })
    return pd.DataFrame(records).sort_values("ticker").reset_index(drop=True)


def _hash_kpis(df: pd.DataFrame) -> str:
    payload = json.dumps(df.to_dict(orient="records"), sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def test_gold_kpi_hash_is_stable():
    silver = _synthetic_silver()
    kpis = _compute_kpis(silver)
    got = _hash_kpis(kpis)
    if not FIXTURE_HASH_FILE.exists():
        FIXTURE_HASH_FILE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE_HASH_FILE.write_text(got + "\n")
        print(f"BOOTSTRAP: wrote initial hash {got[:12]}...")
        return
    want = FIXTURE_HASH_FILE.read_text().strip()
    assert got == want, (
        f"Gold KPI hash drifted!\n  got:  {got}\n  want: {want}\n"
        f"  If the math change is intentional, update {FIXTURE_HASH_FILE.name}."
    )


def test_real_ticker_fixtures_load():
    fixtures_dir = ROOT / "tests" / "fixtures" / "kpi_hand"
    for slug in ("petr4_2023", "vale3_2023", "itub4_2023"):
        fp = fixtures_dir / f"{slug}.json"
        assert fp.exists(), f"missing fixture {fp}"
        data = json.loads(fp.read_text())
        assert "expected" in data
        for k in ("return_log_full", "vol_annual", "max_drawdown", "sharpe_vs_cdi"):
            assert k in data["expected"], f"{slug} missing {k}"


def test_synthetic_5day_fixture_self_consistent():
    fp = ROOT / "tests" / "fixtures" / "kpi_hand" / "synthetic_5day.json"
    data = json.loads(fp.read_text())
    close = data["close_series"]
    log_ret = np.diff(np.log(close))
    expected = data["expected"]
    assert abs(np.std(log_ret, ddof=1) - expected["std_log_return_daily_ddof1"]) < 1e-6
    assert abs(np.std(log_ret, ddof=1) * np.sqrt(252) - expected["vol_annual"]) < 1e-6
