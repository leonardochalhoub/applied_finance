# pipelines/

Databricks Asset Bundle for Mercado BR's medallion lakehouse.

## Layout

```
pipelines/
├── databricks.yml           # Bundle definition (jobs, schedule, targets)
├── contracts/               # JSON Schemas for published artifacts
│   ├── kpis_per_ticker.schema.json
│   ├── sector_aggregates.schema.json
│   ├── correlation_heatmap.schema.json
│   ├── ibov_overview.schema.json
│   └── valid_tickers.schema.json
└── notebooks/
    ├── ingest/yf_ohlcv.py
    ├── bronze/{b3_ohlcv_raw, b3_universe, b3_index_members}.py
    ├── silver/{b3_ohlcv_adjusted, b3_ticker_dim, b3_index_members_long}.py
    ├── gold/{returns_wide, cov_matrix, kpis_per_ticker, sector_aggregates, correlation_heatmap, ibov_overview}.py
    ├── quality/contracts_assert.py
    └── export/{json_artifacts, parquet_artifacts}.py
```

## Validate

```bash
cd pipelines
databricks bundle validate --target dev
```

## Deploy (dev)

```bash
databricks bundle deploy --target dev
```

## Run end-to-end

```bash
databricks bundle run --target dev job_mercado_br_daily_refresh
```

## Catalog

All tables live under `finance_prd.{bronze,silver,gold}.<table>`.
The catalog was created via:

```sql
CREATE CATALOG IF NOT EXISTS finance_prd
COMMENT 'Mercado BR — B3 market analytics platform';
```

## Bronze idempotency

`bronze.b3_ohlcv_raw` uses `MERGE INTO ... ON (ticker, trading_date)` so re-running
the refresh job is safe — no duplicate rows.

## Silver SCD2

`silver.b3_ticker_dim` carries a stable `ticker_key = sha1("b3:" + canonical_root)`
where `canonical_root` is the oldest symbol the entity ever used (walking the
`prior_tickers` chain in `data/ticker_universe.csv`).
