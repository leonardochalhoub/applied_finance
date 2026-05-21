"""Unit tests for yf_get against a stub backend."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
import pytest
from yfr_py._http import HttpBackend

from yfr_py import yf_get


@dataclass
class StubBackend:
    """Deterministic in-memory backend for unit tests."""

    name: str = "stub"
    calls: list[str] = field(default_factory=list)

    def fetch_ohlcv(self, ticker, first_date, last_date, freq):
        self.calls.append(ticker)
        dates = pd.date_range(first_date, last_date, freq="B")[:5]
        return pd.DataFrame(
            {
                "ticker": ticker,
                "ref_date": [d.date() for d in dates],
                "price_open": [10.0 + i for i in range(len(dates))],
                "price_high": [11.0 + i for i in range(len(dates))],
                "price_low": [9.0 + i for i in range(len(dates))],
                "price_close": [10.5 + i for i in range(len(dates))],
                "volume": [100 + i for i in range(len(dates))],
                "price_adjusted": [10.5 + i for i in range(len(dates))],
            }
        )

    def fetch_dividends(self, ticker, first_date, last_date):
        return pd.DataFrame(columns=["ticker", "ref_date", "dividend"])


def test_stub_conforms_to_protocol() -> None:
    assert isinstance(StubBackend(), HttpBackend)


def test_yf_get_returns_long_format(tmp_path: Path) -> None:
    df = yf_get(
        tickers=["PETR4.SA", "VALE3.SA"],
        first_date="2024-01-02",
        last_date="2024-01-08",
        bench_ticker="^BVSP",
        backend=StubBackend(),
        do_cache=True,
        cache_folder=str(tmp_path),
        be_quiet=True,
    )
    assert not df.empty
    assert set(df["ticker"]) == {"PETR4.SA", "VALE3.SA"}
    expected_cols = {
        "ticker", "ref_date", "price_open", "price_high", "price_low",
        "price_close", "volume", "price_adjusted",
        "ret_adjusted_prices", "ret_closing_prices", "cumret_adjusted_prices",
    }
    assert expected_cols.issubset(df.columns)


def test_yf_get_cache_hit_skips_backend(tmp_path: Path) -> None:
    backend = StubBackend()
    kwargs = dict(
        tickers=["PETR4.SA"],
        first_date="2024-01-02",
        last_date="2024-01-08",
        bench_ticker="^BVSP",
        backend=backend,
        do_cache=True,
        cache_folder=str(tmp_path),
        be_quiet=True,
    )
    _ = yf_get(**kwargs)
    first_count = len(backend.calls)
    _ = yf_get(**kwargs)
    second_count = len(backend.calls)
    assert second_count == first_count, "second call must hit cache only"


def test_yf_get_rejects_inverted_dates() -> None:
    with pytest.raises(ValueError):
        yf_get(
            tickers=["PETR4.SA"],
            first_date="2024-12-31",
            last_date="2024-01-01",
            backend=StubBackend(),
            do_cache=False,
            be_quiet=True,
        )


def test_yf_get_rejects_empty_tickers() -> None:
    with pytest.raises(ValueError):
        yf_get(tickers=[], backend=StubBackend(), do_cache=False, be_quiet=True)


def test_yf_get_string_ticker_accepted() -> None:
    df = yf_get(
        tickers="PETR4.SA",
        first_date="2024-01-02",
        last_date="2024-01-08",
        backend=StubBackend(),
        do_cache=False,
        be_quiet=True,
    )
    assert set(df["ticker"]) == {"PETR4.SA"}
