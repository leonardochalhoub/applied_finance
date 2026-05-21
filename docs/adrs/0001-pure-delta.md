# ADR-0001 — Pure Delta (no DLT, no Materialized Views)

**Status:** Accepted · **Date:** 2026-05-21

## Contexto

Databricks oferece DLT (Delta Live Tables) e Materialized Views como alternativas
declarativas. Mirante dos Dados (mesmo workspace, mesma Free Edition, mesmo dono)
escolheu Pure Delta deliberadamente.

## Decisão

Pure Delta. Bronze usa `MERGE INTO` idempotente em `(ticker, trading_date)`. Silver
e Gold usam `INSERT OVERWRITE` (tabelas pequenas, sub-milhão de linhas).

## Razão

- Volume real (~2.6M Bronze, sub-milhão downstream) é trivial para Spark; DLT
  acrescenta orquestração opaca por zero ganho observável.
- Notebooks-as-source são triviais de debugar célula-por-célula; DLT esconde o
  grafo em runtime.
- Mantém portabilidade — esses notebooks rodam em qualquer Spark, não só Databricks.

## Alternativas rejeitadas

1. **DLT** — opaco, incerto em Free Edition, sem ganho.
2. **Materialized Views** — Gold é arquivo-publicada (JSON/Parquet), não consultada;
   MVs adicionam uma camada não usada.

## Consequências

- Idempotência é responsabilidade nossa (já garantida pelo MERGE).
- Expectations / DQ são asserts Python explícitos (`pipelines/notebooks/quality/`),
  não `EXPECT` declarativos.
