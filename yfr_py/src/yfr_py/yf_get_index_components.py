"""Index composition lookup.

For the Brazilian market, B3 doesn't expose a clean public endpoint; we rely on
the local hand-curated CSV under `data/index_membership.csv` of the consumer
project. The function below loads that CSV if available; otherwise returns an
empty frame.
"""
from __future__ import annotations

import datetime as _dt
import os
from pathlib import Path

import pandas as pd

DEFAULT_MEMBERSHIP_CSV = Path(
    os.environ.get(
        "YFR_PY_INDEX_MEMBERSHIP_CSV",
        str(Path.cwd() / "data" / "index_membership.csv"),
    )
)


def yf_get_index_components(
    index: str,
    as_of: _dt.date | str | None = None,
    *,
    membership_csv: str | os.PathLike | None = None,
) -> pd.DataFrame:
    """Return the constituent tickers of an index as of a date.

    Index codes: 'IBOV', 'IBRX100', 'IBRA' (B3 indices); 'GSPC' (S&P 500) is not
    supported by this Brazilian-focused port.

    Output columns: `index, ticker, weight, valid_from, valid_to`.
    """
    path = Path(membership_csv) if membership_csv is not None else DEFAULT_MEMBERSHIP_CSV
    if not path.exists():
        return pd.DataFrame(columns=["index", "ticker", "weight", "valid_from", "valid_to"])

    df = pd.read_csv(path, parse_dates=["valid_from", "valid_to"])
    df = df[df["index"].str.upper() == index.upper()]
    if as_of is not None:
        if isinstance(as_of, str):
            as_of_d = _dt.date.fromisoformat(as_of)
        elif isinstance(as_of, _dt.date):
            as_of_d = as_of
        else:
            raise TypeError(f"as_of must be date or YYYY-MM-DD string, got {type(as_of)}")
        as_of_ts = pd.Timestamp(as_of_d)
        df = df[
            (df["valid_from"] <= as_of_ts)
            & (df["valid_to"].isna() | (df["valid_to"] >= as_of_ts))
        ]
    return df.reset_index(drop=True)
