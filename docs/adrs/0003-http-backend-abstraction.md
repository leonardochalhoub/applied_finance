# ADR-0003 — Backend HTTP plugável (`HttpBackend` protocol)

**Status:** Accepted · **Date:** 2026-05-21

## Contexto

Assumption A-001 do DEFINE alertou para o risco de Yahoo bloquear ou rate-limitar
`yfinance`. Já aconteceu historicamente (2022 e 2023).

## Decisão

Todo código de fetch passa por um `HttpBackend` protocol. Embarcamos duas
implementações: `YFinanceBackend` (default) e `BrapiBackend` (api.brapi.dev, free
tier). Seletor via `yf_get(..., backend="yfinance" | "brapi" | HttpBackend())`.

## Razão

- Isola produção contra bloqueios upstream.
- Brapi.dev tem free tier suficiente para um modo de emergência.
- Superfície do protocol é pequena (`fetch_ohlcv`, `fetch_dividends`); escrever
  um terceiro backend é horas, não dias.

## Alternativas rejeitadas

1. **Hardcoded `yfinance`** — viola a assumption A-001.
2. **HTTP cliente próprio contra endpoints Yahoo** — `yfinance` já faz o trabalho
   sujo de engenharia reversa.

## Consequências

- Testes stubam `HttpBackend` em vez de mockar HTTP — mais limpo.
- Uma dependência extra: `httpx` (apenas para o BrapiBackend).
