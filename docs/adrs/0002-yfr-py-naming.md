# ADR-0002 — `yfr_py` preserva nomes R-style + adiciona aliases pythônicos

**Status:** Accepted · **Date:** 2026-05-21

## Contexto

yfR exporta `yf_get`, `yf_get_dividends`, `yf_get_index_components`, `yf_live_price`.
Idiomatic Python preferiria `get_market_data`. Mas a proposta de valor é parity
explícita com yfR, não "mais um wrapper de yfinance".

## Decisão

API primária mantém nomes R-style (`yf_get`, etc.). Aliases pythônicos
(`get_market_data = yf_get`) são exportados como secundários no `__init__.py`.

## Razão

- Quem está portando um script R encontra a função pelo nome 1:1.
- Aliases são gratuitos, descobríveis via IDE.
- Os testes de paridade golden-file referenciam os nomes yfR — manter o mesmo
  identificador torna diffs triviais.

## Alternativas rejeitadas

1. **Renomear tudo para Python idiomático** — quebra a mensagem "este é o yfR em Python".
2. **Snake-case do CamelCase do yfR** — não aplicável, yfR já é snake_case.

## Consequências

- `ruff` é configurado para permitir `yf_*` apenas neste pacote (`pyproject.toml`
  do root, `per-file-ignores`).
- README documenta as duas formas.
