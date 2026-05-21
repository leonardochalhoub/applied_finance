"""Content-addressed Parquet cache for OHLCV fetches."""
from __future__ import annotations

import datetime as _dt
import hashlib
import os
import shutil
import tempfile
from pathlib import Path

import pandas as pd

_DEFAULT_FOLDER = Path(os.environ.get("YFR_PY_CACHE_FOLDER", str(Path.home() / ".cache" / "yfr_py")))


def cache_folder_get() -> Path:
    return _DEFAULT_FOLDER


def _hash_key(
    ticker: str,
    first_date: _dt.date,
    last_date: _dt.date,
    freq: str,
    type_return: str,
    backend_name: str,
) -> str:
    raw = f"{backend_name}|{ticker}|{first_date.isoformat()}|{last_date.isoformat()}|{freq}|{type_return}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


class Cache:
    def __init__(self, folder: str | os.PathLike | None = None):
        self.folder = Path(folder) if folder is not None else _DEFAULT_FOLDER
        self.folder.mkdir(parents=True, exist_ok=True)

    def path(self, key: str) -> Path:
        return self.folder / f"{key}.parquet"

    def get(self, key: str) -> pd.DataFrame | None:
        p = self.path(key)
        if not p.exists():
            return None
        try:
            return pd.read_parquet(p)
        except Exception:
            p.unlink(missing_ok=True)
            return None

    def put(self, key: str, df: pd.DataFrame) -> None:
        p = self.path(key)
        with tempfile.NamedTemporaryFile(
            "wb", dir=self.folder, delete=False, suffix=".tmp"
        ) as fh:
            tmp = Path(fh.name)
        try:
            df.to_parquet(tmp, index=False)
            os.replace(tmp, p)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise

    def has(self, key: str) -> bool:
        return self.path(key).exists()


def cache_clear(folder: str | os.PathLike | None = None) -> int:
    """Remove all cache files. Returns count of files removed."""
    target = Path(folder) if folder is not None else _DEFAULT_FOLDER
    if not target.exists():
        return 0
    count = sum(1 for _ in target.glob("*.parquet"))
    shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    return count
