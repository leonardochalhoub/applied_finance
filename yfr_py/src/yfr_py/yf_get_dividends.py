"""Dividend stream fetcher."""
from __future__ import annotations

import datetime as _dt
from collections.abc import Sequence

import pandas as pd

from ._http import HttpBackend, resolve_backend
from .yf_utils import parse_date


def yf_get_dividends(
    tickers: str | Sequence[str],
    first_date: _dt.date | str | None = None,
    last_date: _dt.date | str | None = None,
    *,
    backend: HttpBackend | str | None = None,
    be_quiet: bool = False,
) -> pd.DataFrame:
    """Download dividend events for one or more tickers."""
    today = _dt.date.today()
    fd = parse_date(first_date, default=today - _dt.timedelta(days=365))
    ld = parse_date(last_date, default=today)
    tickers_list = [tickers] if isinstance(tickers, str) else list(tickers)
    backend_obj = resolve_backend(backend)

    frames: list[pd.DataFrame] = []
    skipped: list[str] = []
    for t in tickers_list:
        try:
            df = backend_obj.fetch_dividends(t, fd, ld)
        except Exception:
            skipped.append(t)
            continue
        if not df.empty:
            frames.append(df)

    if not be_quiet and skipped:
        import warnings

        warnings.warn(
            f"yf_get_dividends: {len(skipped)} ticker(s) failed: {skipped[:10]}",
            stacklevel=2,
        )

    return (
        pd.concat(frames, ignore_index=True)
        if frames
        else pd.DataFrame(columns=["ticker", "ref_date", "dividend"])
    )
