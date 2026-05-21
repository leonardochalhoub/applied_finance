# ADR-0005 — SCD2 com surrogate key `sha1("b3:" + canonical_root)`

**Status:** Accepted · **Date:** 2026-05-21

## Contexto

B3 tem dezenas de renames ao longo dos 26 anos (`BRDT3 → VBBR3`, `SUZB5+FIBR3 → SUZB3`,
`HRTP3 → PRIO3`, etc.). Tratar tickers renomeados como entidades distintas dividiria
séries de retorno e quebraria covariância.

## Decisão

`data/ticker_universe.csv` carrega coluna `prior_tickers` (array). O notebook
Silver computa o **`canonical_root`** = menor lexicograficamente da cadeia, e
deriva `ticker_key = sha1("b3:" + canonical_root)`. SCD2 emite uma linha por
símbolo visível com `valid_from` / `valid_to`.

## Razão

- Determinístico, reproduzível entre runs (não depende de ordem de inserção).
- Continuidade da série pós-rename é preservada em joins.
- Acrescentar um rename é uma edição CSV de uma linha.

## Alternativas rejeitadas

1. **CNPJ como chave natural** — muitos FIIs/ETFs não têm CNPJ na nossa fonte.
2. **Surrogate inteiro monotônico** — quebra reprodutibilidade cross-clone.

## Consequências

- `silver.b3_ohlcv_adjusted` se associa via
  `(ticker, trading_date BETWEEN valid_from AND COALESCE(valid_to, '9999-12-31'))`.
- Curador deve manter `prior_tickers` correto. CI lint checa que não há
  janelas sobrepostas para o mesmo `canonical_root`.
