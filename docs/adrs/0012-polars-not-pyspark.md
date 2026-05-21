# ADR-0012 — Spark nos notebooks, com polars/numpy onde brilha

**Status:** Accepted · **Date:** 2026-05-21

## Contexto

DESIGN inicial cogitou polars-first em toda a pipeline. Na prática, Asset Bundles
+ Unity Catalog + Volumes funcionam mais limpos com PySpark; e `spark.sql` para
DDL de Delta tables é mais explícito que `deltalake-rs`.

## Decisão

Notebooks usam **PySpark + `spark.sql`** para DDL Delta + Bronze MERGE + leitura
das tabelas. Transformações pesadas em-memória (covariância, KPIs, drawdown) usam
**numpy + pandas** após `.toPandas()`, dado que cada Gold table é sub-milhão de
linhas.

`polars` foi descartado em favor de **pandas** por compatibilidade direta com
`spark.createDataFrame` e por já estar nas dependências de `yfr_py`. Em uma
escala futura (>10M rows em Gold), revisitar.

## Razão

- Bronze MERGE quer SQL Delta — Spark é o caminho natural.
- pandas é "good enough" e evita uma dependência extra.
- Os notebooks ficam legíveis, mistos SQL + Python.

## Alternativas rejeitadas

1. **PySpark puro com `pyspark.pandas`** — API menos madura, mais armadilhas.
2. **deltalake-rs Python sem Spark** — ótimo mas perderia o `spark.sql` direto
   para `MERGE INTO`.

## Consequências

- A Gold se quebra se um único ticker tiver mais que `O(1 GB)` em adjusted close
  (não acontece — IBOV inteiro com 26y cabe em ~50 MB).
- Migração para polars/Spark-puro é local e cosmética se a escala mudar.
