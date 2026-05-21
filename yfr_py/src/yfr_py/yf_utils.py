"""Date parsing, frequency aggregation, return computation."""
from __future__ import annotations

import datetime as _dt
from collections.abc import Iterable

import numpy as np
import pandas as pd


def parse_date(d: _dt.date | str | None, default: _dt.date) -> _dt.date:
    if d is None:
        return default
    if isinstance(d, _dt.datetime):
        return d.date()
    if isinstance(d, _dt.date):
        return d
    return _dt.date.fromisoformat(str(d))


def aggregate_frequency(
    df: pd.DataFrame,
    freq: str,
    how: str,
) -> pd.DataFrame:
    """Aggregate daily long-format OHLCV to weekly/monthly/yearly.

    `how` is one of 'first' or 'last' (matches yfR's `how_to_aggregate`).
    """
    if freq == "daily" or df.empty:
        return df
    rule = {"weekly": "W", "monthly": "ME", "yearly": "YE"}[freq]
    df = df.copy()
    df["ref_date"] = pd.to_datetime(df["ref_date"])
    df = df.set_index("ref_date").sort_index()

    grouped = df.groupby([pd.Grouper(freq=rule), "ticker"])
    agg_fn = {"first": "first", "last": "last"}[how]
    out = grouped.agg(
        {
            "price_open": "first",
            "price_high": "max",
            "price_low": "min",
            "price_close": agg_fn,
            "volume": "sum",
            "price_adjusted": agg_fn,
        }
    ).reset_index()
    out["ref_date"] = out["ref_date"].dt.date
    cols = ["ticker", "ref_date", "price_open", "price_high", "price_low",
            "price_close", "volume", "price_adjusted"]
    return out[cols]


def compute_returns(df: pd.DataFrame, type_return: str) -> pd.DataFrame:
    """Add ret_adjusted_prices, ret_closing_prices, cumret_adjusted_prices columns."""
    if df.empty:
        for col in ("ret_adjusted_prices", "ret_closing_prices", "cumret_adjusted_prices"):
            df[col] = pd.Series(dtype="float64")
        return df

    df = df.sort_values(["ticker", "ref_date"]).copy()
    grouped = df.groupby("ticker", sort=False)
    adj = df["price_adjusted"].astype("float64")
    close = df["price_close"].astype("float64")
    adj_prev = grouped["price_adjusted"].shift(1).astype("float64")
    close_prev = grouped["price_close"].shift(1).astype("float64")

    if type_return == "log":
        df["ret_adjusted_prices"] = np.log(adj / adj_prev)
        df["ret_closing_prices"] = np.log(close / close_prev)
    else:
        df["ret_adjusted_prices"] = adj / adj_prev - 1.0
        df["ret_closing_prices"] = close / close_prev - 1.0

    df["cumret_adjusted_prices"] = (
        df.groupby("ticker", sort=False)["ret_adjusted_prices"]
        .transform(lambda s: np.nancumprod(1.0 + s.fillna(0.0).to_numpy()))
    )
    return df.reset_index(drop=True)


def filter_bad_data(
    df: pd.DataFrame,
    bench_dates: Iterable[_dt.date],
    thresh: float,
) -> tuple[pd.DataFrame, list[str]]:
    """Drop tickers whose date coverage vs the benchmark is below threshold."""
    if df.empty:
        return df, []
    bench_dates = set(bench_dates)
    if not bench_dates:
        return df, []
    keep: list[str] = []
    drop: list[str] = []
    for ticker, grp in df.groupby("ticker"):
        coverage = len(set(grp["ref_date"]) & bench_dates) / max(len(bench_dates), 1)
        if coverage >= thresh:
            keep.append(ticker)
        else:
            drop.append(ticker)
    return df[df["ticker"].isin(keep)].reset_index(drop=True), drop


def complete_panel(df: pd.DataFrame, fill: str = "ffill") -> pd.DataFrame:
    """Balance the panel — every ticker present on every ref_date in the union."""
    if df.empty:
        return df
    all_dates = sorted(df["ref_date"].unique())
    all_tickers = sorted(df["ticker"].unique())
    idx = pd.MultiIndex.from_product([all_tickers, all_dates], names=["ticker", "ref_date"])
    full = (
        df.set_index(["ticker", "ref_date"])
        .reindex(idx)
        .reset_index()
        .sort_values(["ticker", "ref_date"])
    )
    if fill == "ffill":
        cols = ["price_open", "price_high", "price_low", "price_close", "price_adjusted"]
        full[cols] = full.groupby("ticker")[cols].ffill()
    return full.reset_index(drop=True)
