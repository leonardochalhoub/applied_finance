"""Unit tests for the Parquet content-addressed cache."""
from __future__ import annotations

import datetime as _dt
from pathlib import Path

import pandas as pd
import pytest
from yfr_py._cache import Cache, _hash_key, cache_clear, cache_folder_get


@pytest.fixture()
def tmp_cache(tmp_path: Path) -> Cache:
    return Cache(tmp_path)


def test_hash_key_is_deterministic() -> None:
    k1 = _hash_key("PETR4.SA", _dt.date(2024, 1, 1), _dt.date(2024, 12, 31), "daily", "arit", "yfinance")
    k2 = _hash_key("PETR4.SA", _dt.date(2024, 1, 1), _dt.date(2024, 12, 31), "daily", "arit", "yfinance")
    assert k1 == k2


def test_hash_key_changes_with_backend() -> None:
    k1 = _hash_key("PETR4.SA", _dt.date(2024, 1, 1), _dt.date(2024, 12, 31), "daily", "arit", "yfinance")
    k2 = _hash_key("PETR4.SA", _dt.date(2024, 1, 1), _dt.date(2024, 12, 31), "daily", "arit", "brapi")
    assert k1 != k2


def test_put_and_get_roundtrip(tmp_cache: Cache) -> None:
    df = pd.DataFrame({"ticker": ["X"], "ref_date": [_dt.date(2024, 1, 2)], "price_close": [10.5]})
    key = "abc123"
    assert tmp_cache.get(key) is None
    tmp_cache.put(key, df)
    assert tmp_cache.has(key)
    out = tmp_cache.get(key)
    assert out is not None
    pd.testing.assert_frame_equal(out, df)


def test_get_corrupt_file_returns_none(tmp_cache: Cache) -> None:
    key = "corrupt"
    tmp_cache.path(key).write_bytes(b"not parquet")
    assert tmp_cache.get(key) is None
    assert not tmp_cache.has(key)


def test_cache_clear(tmp_path: Path) -> None:
    c = Cache(tmp_path)
    df = pd.DataFrame({"a": [1]})
    c.put("k1", df)
    c.put("k2", df)
    n = cache_clear(tmp_path)
    assert n == 2
    assert not c.has("k1")


def test_default_folder_is_under_home() -> None:
    folder = cache_folder_get()
    assert "yfr_py" in folder.as_posix()
