# yfr_py

Python port of [msperlin/yfR](https://github.com/ropensci/yfR) — a typed,
opinionated ingestion library for financial data from Yahoo Finance with a
B3-friendly default benchmark (`^BVSP`).

## Install

```bash
uv add "yfr_py @ git+https://github.com/leonardochalhoub/applied_finance.git#subdirectory=yfr_py"
```

## Usage

```python
import datetime as dt
from yfr_py import yf_get

df = yf_get(
    tickers=["PETR4.SA", "VALE3.SA", "ITUB4.SA"],
    first_date="2024-01-01",
    last_date="2024-12-31",
    freq_data="daily",
    type_return="arit",
    do_cache=True,
    do_parallel=True,
)
print(df.head())
```

Output schema (long format) mirrors yfR's:

| Column | Type | Notes |
|---|---|---|
| `ticker` | str | |
| `ref_date` | date | |
| `price_open / high / low / close` | float | raw, unadjusted |
| `volume` | int | |
| `price_adjusted` | float | Yahoo's split/dividend adjusted close |
| `ret_adjusted_prices` | float | arithmetic or log, per `type_return` |
| `ret_closing_prices` | float | same as above on raw close |
| `cumret_adjusted_prices` | float | cumulative product since first row |

## Backends

The HTTP layer is abstracted behind a protocol. Two implementations ship:

- `YFinanceBackend` (default) — uses the `yfinance` library
- `BrapiBackend` — uses [brapi.dev](https://brapi.dev), useful when Yahoo blocks

Select via `yf_get(..., backend="yfinance" | "brapi")` or pass a custom
`HttpBackend` instance.

## Cache

Content-addressed Parquet cache under `~/.cache/yfr_py/` by default
(overridable via `YFR_PY_CACHE_FOLDER` env var or `cache_folder` argument).
Atomic writes; corrupted files are auto-deleted on read.

## Pythonic alias

```python
from yfr_py import get_market_data  # identical to yf_get
```
