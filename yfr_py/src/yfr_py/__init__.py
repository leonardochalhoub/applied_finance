"""yfr_py — Python port of msperlin/yfR.

Primary public surface mirrors yfR's R API (snake_case already). Pythonic aliases
are exported as secondary names for ergonomics.
"""
from __future__ import annotations

from ._cache import Cache, cache_clear, cache_folder_get
from ._http import BrapiBackend, HttpBackend, YFinanceBackend, resolve_backend
from .yf_get import yf_get
from .yf_get_dividends import yf_get_dividends
from .yf_get_index_components import yf_get_index_components
from .yf_live_price import yf_live_price

get_market_data = yf_get

__version__ = "0.1.0"

__all__ = [
    "BrapiBackend",
    "Cache",
    "HttpBackend",
    "YFinanceBackend",
    "__version__",
    "cache_clear",
    "cache_folder_get",
    "get_market_data",
    "resolve_backend",
    "yf_get",
    "yf_get_dividends",
    "yf_get_index_components",
    "yf_live_price",
]
