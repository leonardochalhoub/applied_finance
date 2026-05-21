"""Batch and optionally parallel ticker fetching."""
from __future__ import annotations

import datetime as _dt
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import pandas as pd

from ._cache import Cache, _hash_key
from ._http import HttpBackend


@dataclass(slots=True)
class FetchResult:
    ticker: str
    df: pd.DataFrame
    from_cache: bool
    error: Exception | None = None


def _fetch_one(
    ticker: str,
    backend: HttpBackend,
    cache: Cache | None,
    first_date: _dt.date,
    last_date: _dt.date,
    freq: str,
    type_return: str,
) -> FetchResult:
    if cache is not None:
        key = _hash_key(ticker, first_date, last_date, freq, type_return, backend.name)
        cached = cache.get(key)
        if cached is not None:
            return FetchResult(ticker=ticker, df=cached, from_cache=True)
    try:
        df = backend.fetch_ohlcv(ticker, first_date, last_date, freq)
    except Exception as exc:
        return FetchResult(ticker=ticker, df=pd.DataFrame(), from_cache=False, error=exc)
    if cache is not None and not df.empty:
        key = _hash_key(ticker, first_date, last_date, freq, type_return, backend.name)
        cache.put(key, df)
    return FetchResult(ticker=ticker, df=df, from_cache=False)


def fetch_many(
    tickers: list[str],
    backend: HttpBackend,
    first_date: _dt.date,
    last_date: _dt.date,
    *,
    cache: Cache | None,
    freq: str,
    type_return: str,
    do_parallel: bool,
    max_workers: int = 8,
) -> list[FetchResult]:
    if not do_parallel or len(tickers) < 2:
        return [
            _fetch_one(t, backend, cache, first_date, last_date, freq, type_return)
            for t in tickers
        ]
    results: list[FetchResult] = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_fetch_one, t, backend, cache, first_date, last_date, freq, type_return): t
            for t in tickers
        }
        for fut in as_completed(futures):
            results.append(fut.result())
    return results
