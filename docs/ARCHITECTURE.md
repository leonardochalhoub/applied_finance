# Arquitetura — Mercado BR

> Visão de alto nível. Para a especificação completa, ver
> [.claude/sdd/features/DESIGN_MERCADO_BR.md](../.claude/sdd/features/DESIGN_MERCADO_BR.md).

## Diagrama

```
yfr_py (Python) ──► Databricks Free Edition (finance_prd)
                     ├── BRONZE   delta append/MERGE (raw OHLCV)
                     ├── SILVER   adjusted prices · SCD2 ticker dim · index members
                     └── GOLD     returns_wide · 3× cov matrices · KPIs · sector aggs
                                  · correlation heatmap · IBOV overview
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
| Asset Bundle | `pipelines/databricks.yml` | DAG de 19 tasks Bronze→Silver→Gold→quality→export |
| Catálogo UC | `finance_prd` | Tabelas Delta + Volume `/gold/artifacts/` |
| Contratos | `pipelines/contracts/*.schema.json` | JSON-Schema validado antes do deploy |
| Frontend | Next.js 16 · React 19 · Tailwind v4 · Recharts | Static export para `gh-pages` |
| CI/CD | GitHub Actions | `ci.yml` (PR), `refresh-pipelines.yml` (diário), `deploy-pages.yml` (push) |

## Decisões-chave

Resumo dos 12 ADRs (ver [adrs/](adrs/)):

1. **Pure Delta** (sem DLT, sem Materialized Views) — alinha com Mirante e simplifica debug.
2. **API yfR estilo R** preservada; aliases pythônicos como secundários.
3. **HTTP backend abstrato** — yfinance default, Brapi.dev fallback.
4. **Cache Parquet content-addressed** com escritas atômicas.
5. **SCD2 com `sha1(canonical_root)`** — preserva continuidade pós-renames.
6. **3 matrizes de covariância** (1y/5y/full) pré-computadas para Markowitz cliente.
7. **`gh-pages` órfão com force-push** — repo não infla com snapshots.
8. **Universo de tickers hand-curated** em CSV no repo.
9. **Sem shadcn/ui na v1** — só Tailwind + Recharts.
10. **Matemática de KPIs duplicada** Python ↔ TypeScript contra fixtures comuns.
11. **Uma feature (`MERCADO_BR`)**; portfolio fica em `MERCADO_BR_PORTFOLIO`.
12. **polars + Spark híbrido** — Spark nos notebooks para tabelas grandes, polars onde brilha.

## Custo

Meta lifetime: **≤ US$ 50** em 12 meses. Tracking em [FINOPS.md](FINOPS.md).
