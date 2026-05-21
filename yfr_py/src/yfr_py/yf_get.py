"""Main entry — Python port of yfR::yf_get."""
from __future__ import annotations

import datetime as _dt
from collections.abc import Sequence
from typing import Literal

import pandas as pd

from ._cache import Cache
from ._chunker import fetch_many
from ._http import HttpBackend, resolve_backend
from .yf_utils import (
    aggregate_frequency,
    complete_panel,
    compute_returns,
    filter_bad_data,
    parse_date,
)

Frequency = Literal["daily", "weekly", "monthly", "yearly"]
ReturnType = Literal["arit", "log"]
AggregationMode = Literal["first", "last"]


def yf_get(
    tickers: str | Sequence[str],
    first_date: _dt.date | str | None = None,
    last_date: _dt.date | str | None = None,
    *,
    thresh_bad_data: float = 0.75,
    bench_ticker: str = "^BVSP",
    type_return: ReturnType = "arit",
    freq_data: Frequency = "daily",
    how_to_aggregate: AggregationMode = "last",
    do_complete_data: bool = False,
    do_cache: bool = True,
    cache_folder: str | None = None,
    do_parallel: bool = False,
    be_quiet: bool = False,
    backend: HttpBackend | str | None = None,
) -> pd.DataFrame:
    """Download financial data from Yahoo Finance — Python port of yfR::yf_get.

    Returns a long-format DataFrame with columns:
    `ticker, ref_date, price_open, price_high, price_low, price_close, volume,
     price_adjusted, ret_adjusted_prices, ret_closing_prices, cumret_adjusted_prices`.
    """
    today = _dt.date.today()
    fd = parse_date(first_date, default=today - _dt.timedelta(days=30))
    ld = parse_date(last_date, default=today)
    if fd > ld:
        raise ValueError(f"first_date ({fd}) is after last_date ({ld})")
    if freq_data not in ("daily", "weekly", "monthly", "yearly"):
        raise ValueError(f"invalid freq_data: {freq_data!r}")
    if type_return not in ("arit", "log"):
        raise ValueError(f"invalid type_return: {type_return!r}")
    if how_to_aggregate not in ("first", "last"):
        raise ValueError(f"invalid how_to_aggregate: {how_to_aggregate!r}")

    tickers_list = [tickers] if isinstance(tickers, str) else list(tickers)
    if not tickers_list:
        raise ValueError("tickers must be non-empty")

    backend_obj = resolve_backend(backend)
    cache = Cache(cache_folder) if do_cache else None

    bench_results = fetch_many(
        [bench_ticker],
        backend_obj,
        fd,
        ld,
        cache=cache,
        freq="daily",
        type_return=type_return,
        do_parallel=False,
    )
    bench_df = bench_results[0].df if bench_results else pd.DataFrame()
    bench_dates = list(bench_df["ref_date"]) if not bench_df.empty else []

    results = fetch_many(
        tickers_list,
        backend_obj,
        fd,
        ld,
        cache=cache,
        freq="daily",
        type_return=type_return,
        do_parallel=do_parallel,
    )

    frames: list[pd.DataFrame] = []
    skipped: list[str] = []
    for res in results:
        if res.error is not None or res.df.empty:
            skipped.append(res.ticker)
            continue
        frames.append(res.df)
    df = pd.concat(frames, ignore_index=True) if frames else _empty_long()

    df, dropped = filter_bad_data(df, bench_dates, thresh_bad_data)
    skipped.extend(dropped)

    df = aggregate_frequency(df, freq_data, how_to_aggregate)
    if do_complete_data:
        df = complete_panel(df)
    df = compute_returns(df, type_return)

    if not be_quiet and skipped:
        import warnings

        warnings.warn(
            f"yf_get: {len(skipped)} ticker(s) skipped due to errors or insufficient data: {skipped[:10]}",
            stacklevel=2,
        )

    return df


def _empty_long() -> pd.DataFrame:
    return pd.DataFrame(
        columns=[
            "ticker", "ref_date", "price_open", "price_high", "price_low",
            "price_close", "volume", "price_adjusted",
        ]
    )
