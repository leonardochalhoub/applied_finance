# FinOps — Mercado BR

> Meta: **US$ 50 lifetime em 12 meses**, totalmente dentro de free tiers.

## Estrutura de custo

| Recurso | Plano | Custo esperado |
|---|---|---|
| Databricks Free Edition | Free (com warehouse serverless de 2 CU) | US$ 0 — limites de Free Edition |
| GitHub Actions (cron diário) | Free (2 000 min/mês para repos públicos) | US$ 0 (≤ 30 min × 22 dias úteis = ≤ 660 min) |
| GitHub Pages | Free (100 GB/mês de banda) | US$ 0 |
| Domínio | (opcional) | US$ 12/ano se comprar |

## Tracking

Cada refresh diário grava métricas em `finance_prd.gold.observability_run_metrics`
(implementação futura, Fase 2). Por ora, snapshots manuais:

| Mês | DBU gastas | Refreshes | Custo USD | Lifetime USD |
|---|---|---|---|---|
| 2026-05 | — | 0 | — | — |

## Alertas

- DBU consumido > 80% da cota Free → reduzir cluster ou pausar ingest.
- Bandwidth do gh-pages > 90 GB/mês → considerar GH Releases para Parquet pesado.
- Tempo do job > 30 min → investigar gargalo (yfinance lento ou Spark grande).
