"""Single live quote fetcher (used sparingly — Yahoo's free endpoint, no SLA)."""
from __future__ import annotations

from collections.abc import Sequence

import pandas as pd

from ._http import HttpBackend, resolve_backend


def yf_live_price(
    tickers: str | Sequence[str],
    *,
    backend: HttpBackend | str | None = None,
) -> pd.DataFrame:
    """Return the last available price for each ticker.

    Output columns: `ticker, price, currency, fetched_at_utc`.
    """
    import datetime as _dt

    backend_obj = resolve_backend(backend)
    tickers_list = [tickers] if isinstance(tickers, str) else list(tickers)
    now = _dt.datetime.now(_dt.UTC)

    if backend_obj.name != "yfinance":
        return pd.DataFrame(columns=["ticker", "price", "currency", "fetched_at_utc"])

    import yfinance as yf

    rows: list[dict[str, object]] = []
    for t in tickers_list:
        info = yf.Ticker(t).fast_info
        price = getattr(info, "last_price", None) or getattr(info, "lastPrice", None)
        currency = getattr(info, "currency", None) or "BRL"
        if price is None:
            continue
        rows.append(
            {"ticker": t, "price": float(price), "currency": currency, "fetched_at_utc": now}
        )
    return pd.DataFrame(rows, columns=["ticker", "price", "currency", "fetched_at_utc"])
