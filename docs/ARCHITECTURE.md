# Arquitetura — Mercado BR

> Visão de alto nível. Para a especificação completa, ver
> [.claude/sdd/features/DESIGN_MERCADO_BR.md](../.claude/sdd/features/DESIGN_MERCADO_BR.md).
> A seção "Build deltas" no final lista onde a implementação divergiu do DESIGN
> e por quê.

## Diagrama

```
yfr_py (Python) ──► Databricks Free Edition (finance_prd)
                     ├── BRONZE   delta append/MERGE (raw OHLCV)
                     ├── SILVER   adjusted prices · SCD2 ticker dim · index members
                     └── GOLD     returns_wide · 3× cov matrices · KPIs · sector aggs
                                  · correlation heatmap · IBOV overview
                                          │
                          quality_contracts_assert ──► quality_apply_governance
                                          │
                              UC Volume /artifacts/  ──► JSON + Parquet
                                          │
                              GitHub Actions (cron diário)
                                          │
                              gh-pages (orphan, force-push)
                                          │
                              Next.js static export (browser)
```

## Componentes

| Componente | Tech | Responsabilidade |
|---|---|---|
| `yfr_py` | Python 3.11+ · `yfinance` · `pandas` · `httpx` | Ingestão tipada com cache em Parquet, batching e fetch paralelo |
| Asset Bundle | `pipelines/databricks.yml` | DAG de 20 tasks (Bronze→Silver→Gold→quality→governance→export) |
| Catálogo UC | `finance_prd` | Tabelas Delta + Volume `/gold/artifacts/`; COMMENTs e TAGS em todas as tabelas e colunas via `quality_apply_governance` |
| Contratos | `pipelines/contracts/*.schema.json` | JSON-Schema validado antes do deploy |
| CDI (taxa livre) | BCB SGS série 12 (CDI Over) | Buscado pelo notebook `gold/kpis_per_ticker.py` em cada refresh; média sobre a janela de cada ticker entra no Sharpe |
| Frontend | Next.js 16 · React 19 · Tailwind v4 · Recharts | Static export para `gh-pages` |
| CI/CD | GitHub Actions | `ci.yml` (PR), `refresh-pipelines.yml` (diário), `deploy-pages.yml` (push), `pipeline-smoke.yml` (fixture) |

## Decisões-chave

Resumo dos ADRs (ver [adrs/](adrs/)):

1. **Pure Delta** (sem DLT, sem Materialized Views) — alinha com Mirante e simplifica debug.
2. **API yfR estilo R** preservada; aliases pythônicos como secundários.
3. **HTTP backend abstrato** — yfinance default, Brapi.dev fallback.
4. **Cache Parquet content-addressed** com escritas atômicas.
5. **SCD2 com `sha1(canonical_root)`** — canonical_root via primeiro elemento de `prior_tickers` (curado em ordem cronológica), nunca lexicográfico. Preserva continuidade pós-renames.
6. **3 matrizes de covariância** (1y/5y/full) pré-computadas + sidecar `valid_tickers_*.json` listando excluídos por survivorship + opção de shrinkage Ledoit-Wolf.
7. **`gh-pages` órfão com force-push** — repo não infla com snapshots.
8. **Universo de tickers hand-curated** em CSV no repo.
9. **Sem shadcn/ui na v1** — só Tailwind + Recharts.
10. **Matemática de KPIs duplicada** Python ↔ TypeScript contra fixtures comuns (sintética + PETR4/VALE3/ITUB4 reais).
11. **Uma feature (`MERCADO_BR`)**; portfolio Markowitz vive em rota `/portfolio/`.
12. **PySpark + pandas/numpy** nos notebooks. Spark para DDL Delta + leitura; pandas/numpy para a matemática (cov, KPIs, drawdown). polars descartado por overhead de dependência adicional sem ganho na escala atual.
13. **CDI via BCB SGS série 12** — não constante. Média sobre a janela de cada ticker entra no Sharpe; campo `cdi_annual_used` publicado por ticker.
14. **Governança UC centralizada** — `quality_apply_governance.py` aplica COMMENT/TAGS em todas as tabelas e colunas, executado após `quality_contracts_assert`.

## Custo

Meta lifetime: **≤ US$ 50** em 12 meses. Tracking em [FINOPS.md](FINOPS.md).

## Build deltas vs DESIGN_MERCADO_BR.md

Implementação divergiu do DESIGN nos pontos abaixo. A divergência é deliberada — DESIGN agora é referência, não contrato vinculante:

| Item DESIGN | Implementação | Por quê |
|---|---|---|
| `bronze.b3_ohlcv_raw PARTITIONED BY year(trading_date)` | **Sem partição** | Delta não aceita expressão `year(...)` em `PARTITIONED BY`. Volume (~2.6M linhas) é trivial sem partição. Auto-optimize cuida do file sizing. |
| Pattern 4 sugere polars-first para Silver/Gold | **PySpark + pandas/numpy** | PySpark é mais limpo para DDL Delta (`spark.sql`, `MERGE INTO`); a matemática pesada em memória usa numpy (`np.cov`, `np.linalg.eigvalsh`) e pandas (`groupby`, `cumprod`). Ver ADR-0012. |
| `gold_sector_aggregates` depende de `silver.b3_ohlcv_adjusted + silver.b3_ticker_dim` | **Depende de `gold_kpis_per_ticker`** | Agregação setorial agora opera sobre os KPIs já calculados (return_ytd, vol_annual), evitando re-cálculo. |
| Sharpe usa CDI constante 10.75% | **CDI dinâmico via BCB SGS** | Notebook puxa série diária da BCB no `gold/kpis_per_ticker.py`, calcula média sobre a janela de cada ticker. Campo `cdi_annual_used` exposto. |
| `lookback_days=10` no ingest | **`lookback_days=10` (padrão) — para backfill total use task ad-hoc** | Daily refresh continua incremental; backfill histórico via workflow separado quando necessário. |
| Governança UC nos notebooks individuais | **Notebook único `quality_apply_governance.py`** | Centraliza COMMENT/TAGS — um lugar pra alterar, idempotente, roda após DQ gate. |
