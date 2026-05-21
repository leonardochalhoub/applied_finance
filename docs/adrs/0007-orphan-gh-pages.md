# ADR-0007 — `gh-pages` órfão com force-push

**Status:** Accepted · **Date:** 2026-05-21

## Contexto

GitHub Pages serve de uma única branch. Mirante usa orphan + force-push. Com 26 anos
de histórico Parquet + refresh diário, manter histórico da branch faria o repo
crescer monotonicamente.

## Decisão

`refresh-pipelines.yml` faz `git init` numa pasta nova, `git checkout --orphan
gh-pages`, commita o estado completo, e `git push --force` para `gh-pages`.
Sem histórico mantido. Procedência canônica fica:

- nas tabelas Delta Bronze (append log imutável dentro do Databricks);
- nos campos `source_run_id` + `bronze_max_trading_date` embarcados em cada JSON.

## Razão

- Pages fica sob o limite suave de 1 GB do repositório indefinidamente.
- Deploy time é limitado (sem diff crescente).
- Procedência autoritativa fica no lakehouse, não no servidor web.

## Alternativas rejeitadas

1. **Commits incrementais em `gh-pages`** — repo infla sem limite.
2. **GH Releases para artefatos** — não são servidos via CDN como Pages.

## Consequências

- "Time-travel do dashboard público" não é um feature.
- A tip da branch muda a cada refresh; consumidores que precisam pinar SHA usam
  as tabelas Delta diretamente, não as URLs do Pages.
