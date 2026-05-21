"""HTTP backends for OHLCV / dividend fetches.

Default backend is `yfinance`. A `Brapi.dev` backend is shipped as a fallback for
when Yahoo blocks or rate-limits. Backends conform to the `HttpBackend` protocol
so the rest of the package never imports `yfinance` directly.
"""
from __future__ import annotations

import datetime as _dt
import os
import time
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import pandas as pd

_INTERVAL = {"daily": "1d", "weekly": "1wk", "monthly": "1mo"}


@runtime_checkable
class HttpBackend(Protocol):
    name: str

    def fetch_ohlcv(
        self,
        ticker: str,
        first_date: _dt.date,
        last_date: _dt.date,
        freq: str,
    ) -> pd.DataFrame: ...

    def fetch_dividends(
        self,
        ticker: str,
        first_date: _dt.date,
        last_date: _dt.date,
    ) -> pd.DataFrame: ...


def _yfr_columns(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """Reshape a yfinance OHLCV frame into yfR's long format."""
    if df.empty:
        return pd.DataFrame(
            columns=[
                "ticker", "ref_date", "price_open", "price_high", "price_low",
                "price_close", "volume", "price_adjusted",
            ]
        )
    out = pd.DataFrame(
        {
            "ticker": ticker,
            "ref_date": df.index.date if hasattr(df.index, "date") else df.index,
            "price_open": df["Open"].to_numpy(),
            "price_high": df["High"].to_numpy(),
            "price_low": df["Low"].to_numpy(),
            "price_close": df["Close"].to_numpy(),
            "volume": df["Volume"].astype("Int64").to_numpy(),
            "price_adjusted": df.get("Adj Close", df["Close"]).to_numpy(),
        }
    )
    return out.reset_index(drop=True)


@dataclass
class YFinanceBackend:
    name: str = "yfinance"
    max_retries: int = 3
    backoff_base: float = 1.0

    def fetch_ohlcv(
        self,
        ticker: str,
        first_date: _dt.date,
        last_date: _dt.date,
        freq: str,
    ) -> pd.DataFrame:
        import yfinance as yf

        interval = _INTERVAL.get(freq, "1d")
        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                t = yf.Ticker(ticker)
                df = t.history(
                    start=first_date.isoformat(),
                    end=(last_date + _dt.timedelta(days=1)).isoformat(),
                    interval=interval,
                    auto_adjust=False,
                    actions=True,
                )
                return _yfr_columns(df, ticker)
            except Exception as exc:
                last_exc = exc
                time.sleep(self.backoff_base * (2**attempt))
        raise RuntimeError(f"yfinance fetch failed for {ticker} after {self.max_retries} attempts") from last_exc

    def fetch_dividends(
        self,
        ticker: str,
        first_date: _dt.date,
        last_date: _dt.date,
    ) -> pd.DataFrame:
        import yfinance as yf

        t = yf.Ticker(ticker)
        div = t.dividends
        if div is None or div.empty:
            return pd.DataFrame(columns=["ticker", "ref_date", "dividend"])
        div = div.loc[
            (div.index.date >= first_date) & (div.index.date <= last_date)
        ]
        return pd.DataFrame(
            {
                "ticker": ticker,
                "ref_date": div.index.date,
                "dividend": div.to_numpy(),
            }
        )


@dataclass
class BrapiBackend:
    name: str = "brapi"
    token: str | None = None
    base_url: str = "https://brapi.dev/api"

    def fetch_ohlcv(
        self,
        ticker: str,
        first_date: _dt.date,
        last_date: _dt.date,
        freq: str,
    ) -> pd.DataFrame:
        import httpx

        symbol = ticker.removesuffix(".SA")
        params: dict[str, object] = {"interval": _INTERVAL.get(freq, "1d"), "range": "max"}
        if self.token:
            params["token"] = self.token
        with httpx.Client(timeout=30.0) as client:
            r = client.get(f"{self.base_url}/quote/{symbol}", params=params)
            r.raise_for_status()
        payload = r.json()
        results = payload.get("results", [])
        if not results or not results[0].get("historicalDataPrice"):
            return _yfr_columns(pd.DataFrame(), ticker)
        rows = results[0]["historicalDataPrice"]
        df = pd.DataFrame(rows)
        df["ref_date"] = pd.to_datetime(df["date"], unit="s").dt.date
        df = df[(df["ref_date"] >= first_date) & (df["ref_date"] <= last_date)]
        return pd.DataFrame(
            {
                "ticker": ticker,
                "ref_date": df["ref_date"].to_numpy(),
                "price_open": df["open"].to_numpy(),
                "price_high": df["high"].to_numpy(),
                "price_low": df["low"].to_numpy(),
                "price_close": df["close"].to_numpy(),
                "volume": df["volume"].astype("Int64").to_numpy(),
                "price_adjusted": df.get("adjustedClose", df["close"]).to_numpy(),
            }
        ).reset_index(drop=True)

    def fetch_dividends(
        self,
        ticker: str,
        first_date: _dt.date,
        last_date: _dt.date,
    ) -> pd.DataFrame:
        return pd.DataFrame(columns=["ticker", "ref_date", "dividend"])


def resolve_backend(spec: HttpBackend | str | None) -> HttpBackend:
    if spec is None:
        spec = os.environ.get("YFR_PY_BACKEND", "yfinance")
    if isinstance(spec, HttpBackend):
        return spec
    if spec == "yfinance":
        return YFinanceBackend()
    if spec == "brapi":
        return BrapiBackend(token=os.environ.get("BRAPI_TOKEN"))
    raise ValueError(f"Unknown backend spec: {spec!r}")
