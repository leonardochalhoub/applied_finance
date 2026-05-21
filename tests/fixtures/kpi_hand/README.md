# KPI hand fixtures

Shared ground truth for both Python (`pipelines/notebooks/gold/kpis_per_ticker.py` /
`yfr_py/yf_utils.py`) and TypeScript (`app/lib/kpi.ts`).

## Files

- `synthetic_5day.json` — small synthetic series, values derivable on paper. Both
  implementations must match within `tolerance_rel` (1e-6). Use this as a smoke test.
- `petr4_2023.json` — TO BE GENERATED after first real Bronze refresh. Capture
  hand-computed YTD return / vol / drawdown / Sharpe over 2023-01-01 → 2023-12-29
  for PETR4 using yfR in R; store here as the parity contract.
- `vale3_2023.json` — same for VALE3.
- `itub4_2023.json` — same for ITUB4.

## Capture recipe (R-side)

```r
library(yfR)
df <- yf_get("PETR4.SA", "2023-01-01", "2023-12-29", freq_data = "daily")
# compute the four KPIs the same way as docs/METHODOLOGY.md
# emit JSON matching the synthetic_5day.json shape (without trading_dates if not needed)
```

The three real-ticker fixtures unblock acceptance test AT-006 from
[DEFINE_MERCADO_BR.md](../../../.claude/sdd/features/DEFINE_MERCADO_BR.md).
