"""Unit tests for date parsing, aggregation, and return computation."""
from __future__ import annotations

import datetime as _dt

import numpy as np
import pandas as pd
import pytest
from yfr_py.yf_utils import (
    aggregate_frequency,
    compute_returns,
    filter_bad_data,
    parse_date,
)


def test_parse_date_string() -> None:
    assert parse_date("2024-03-15", default=_dt.date(2000, 1, 1)) == _dt.date(2024, 3, 15)


def test_parse_date_none_uses_default() -> None:
    default = _dt.date(2023, 1, 1)
    assert parse_date(None, default=default) == default


def test_parse_date_passthrough() -> None:
    d = _dt.date(2024, 1, 1)
    assert parse_date(d, default=_dt.date(2000, 1, 1)) == d


def _sample_daily() -> pd.DataFrame:
    dates = [_dt.date(2024, 1, 2 + i) for i in range(5)]
    return pd.DataFrame(
        {
            "ticker": ["A"] * 5,
            "ref_date": dates,
            "price_open": [10.0, 11.0, 12.0, 13.0, 14.0],
            "price_high": [11.0, 12.0, 13.0, 14.0, 15.0],
            "price_low": [9.0, 10.0, 11.0, 12.0, 13.0],
            "price_close": [10.5, 11.5, 12.5, 13.5, 14.5],
            "volume": [100, 110, 120, 130, 140],
            "price_adjusted": [10.5, 11.5, 12.5, 13.5, 14.5],
        }
    )


def test_compute_returns_arit() -> None:
    df = compute_returns(_sample_daily(), "arit")
    assert pd.isna(df["ret_adjusted_prices"].iloc[0])
    assert df["ret_adjusted_prices"].iloc[1] == pytest.approx(11.5 / 10.5 - 1)
    assert df["ret_closing_prices"].iloc[2] == pytest.approx(12.5 / 11.5 - 1)


def test_compute_returns_log() -> None:
    df = compute_returns(_sample_daily(), "log")
    assert df["ret_adjusted_prices"].iloc[1] == pytest.approx(np.log(11.5 / 10.5))


def test_compute_returns_cumret_starts_near_one() -> None:
    df = compute_returns(_sample_daily(), "arit")
    last_cum = df["cumret_adjusted_prices"].iloc[-1]
    expected = (14.5 / 10.5)
    assert last_cum == pytest.approx(expected, rel=1e-6)


def test_aggregate_frequency_monthly() -> None:
    dates = [_dt.date(2024, m, 15) for m in range(1, 7)]
    df = pd.DataFrame(
        {
            "ticker": ["A"] * 6,
            "ref_date": dates,
            "price_open": [10.0] * 6,
            "price_high": [11.0] * 6,
            "price_low": [9.0] * 6,
            "price_close": list(range(1, 7)),
            "volume": [100] * 6,
            "price_adjusted": list(range(1, 7)),
        }
    )
    monthly = aggregate_frequency(df, "monthly", "last")
    assert len(monthly) == 6
    assert monthly["price_close"].tolist() == [1, 2, 3, 4, 5, 6]


def test_filter_bad_data_drops_low_coverage() -> None:
    bench_dates = [_dt.date(2024, 1, 2 + i) for i in range(10)]
    df = pd.DataFrame(
        {
            "ticker": ["GOOD"] * 9 + ["BAD"] * 1,
            "ref_date": bench_dates[:9] + bench_dates[:1],
            "price_open": [1.0] * 10,
            "price_high": [1.0] * 10,
            "price_low": [1.0] * 10,
            "price_close": [1.0] * 10,
            "volume": [1] * 10,
            "price_adjusted": [1.0] * 10,
        }
    )
    kept, dropped = filter_bad_data(df, bench_dates, thresh=0.75)
    assert "BAD" in dropped
    assert "GOOD" not in dropped
    assert set(kept["ticker"]) == {"GOOD"}
