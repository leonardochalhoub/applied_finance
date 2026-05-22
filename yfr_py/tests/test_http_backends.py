"""Tests for HttpBackend implementations + chunker concurrent fetches."""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
import pytest
from yfr_py._chunker import fetch_many
from yfr_py._http import BrapiBackend, HttpBackend, YFinanceBackend, resolve_backend

# ─── resolve_backend ─────────────────────────────────────────────────────


def test_resolve_backend_yfinance_default():
    b = resolve_backend(None)
    assert isinstance(b, YFinanceBackend)
    assert b.name == "yfinance"


def test_resolve_backend_brapi_string():
    b = resolve_backend("brapi")
    assert isinstance(b, BrapiBackend)


def test_resolve_backend_passthrough():
    class Custom:
        name = "custom"
        def fetch_ohlcv(self, *a, **k): return pd.DataFrame()
        def fetch_dividends(self, *a, **k): return pd.DataFrame()
    c = Custom()
    assert resolve_backend(c) is c


def test_resolve_backend_invalid_raises():
    with pytest.raises(ValueError):
        resolve_backend("not-a-real-backend")


# ─── chunker behavior with stubs ─────────────────────────────────────────


@dataclass
class _CountingStub:
    name: str = "stub"
    calls: list[str] = field(default_factory=list)
    fail_for: set[str] = field(default_factory=set)
    empty_for: set[str] = field(default_factory=set)

    def fetch_ohlcv(
        self,
        ticker: str,
        first_date: _dt.date,
        last_date: _dt.date,
        freq: str,
    ) -> pd.DataFrame:
        self.calls.append(ticker)
        if ticker in self.fail_for:
            raise RuntimeError(f"simulated failure for {ticker}")
        if ticker in self.empty_for:
            return pd.DataFrame(
                columns=[
                    "ticker", "ref_date", "price_open", "price_high", "price_low",
                    "price_close", "volume", "price_adjusted",
                ]
            )
        dates = pd.date_range(first_date, last_date, freq="B")[:3]
        return pd.DataFrame({
            "ticker": ticker,
            "ref_date": [d.date() for d in dates],
            "price_open": [10.0] * len(dates),
            "price_high": [11.0] * len(dates),
            "price_low": [9.0] * len(dates),
            "price_close": [10.5] * len(dates),
            "volume": [100] * len(dates),
            "price_adjusted": [10.5] * len(dates),
        })

    def fetch_dividends(self, *a, **k):
        return pd.DataFrame(columns=["ticker", "ref_date", "dividend"])


def test_stub_conforms_to_protocol():
    assert isinstance(_CountingStub(), HttpBackend)


def test_fetch_many_serial_per_ticker(tmp_path: Path):
    backend = _CountingStub()
    results = fetch_many(
        ["A.SA", "B.SA", "C.SA"],
        backend,
        _dt.date(2024, 1, 2),
        _dt.date(2024, 1, 8),
        cache=None,
        freq="daily",
        type_return="arit",
        do_parallel=False,
    )
    assert len(results) == 3
    assert backend.calls == ["A.SA", "B.SA", "C.SA"]
    assert all(r.error is None for r in results)


def test_fetch_many_parallel_calls_all_tickers(tmp_path: Path):
    backend = _CountingStub()
    tickers = [f"T{i}.SA" for i in range(8)]
    results = fetch_many(
        tickers, backend, _dt.date(2024, 1, 2), _dt.date(2024, 1, 8),
        cache=None, freq="daily", type_return="arit",
        do_parallel=True, max_workers=4,
    )
    assert {r.ticker for r in results} == set(tickers)
    assert set(backend.calls) == set(tickers)


def test_fetch_many_isolates_per_ticker_failure():
    backend = _CountingStub(fail_for={"BAD.SA"})
    results = fetch_many(
        ["GOOD.SA", "BAD.SA", "ALSO.SA"],
        backend, _dt.date(2024, 1, 2), _dt.date(2024, 1, 8),
        cache=None, freq="daily", type_return="arit",
        do_parallel=False,
    )
    by_t = {r.ticker: r for r in results}
    assert by_t["GOOD.SA"].error is None
    assert by_t["BAD.SA"].error is not None
    assert by_t["ALSO.SA"].error is None


def test_brapi_backend_constructs():
    """BrapiBackend should construct without raising even without a token."""
    b = BrapiBackend(token=None)
    assert b.name == "brapi"
    df = b.fetch_dividends("PETR4.SA", _dt.date(2024, 1, 1), _dt.date(2024, 12, 31))
    assert df.empty
    assert list(df.columns) == ["ticker", "ref_date", "dividend"]
