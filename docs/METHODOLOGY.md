# Metodologia — Mercado BR

> Todas as fórmulas vivem em **dois lugares** simultaneamente: o notebook Python
> que produz a Gold e o módulo TypeScript do frontend. Ambas as implementações são
> validadas contra os mesmos arquivos de fixture em
> `tests/fixtures/kpi_hand/*.json`. Se uma das duas mudar sem a outra, o CI quebra.

## Convenções

- **Preço de referência:** sempre `close` (ajustado por splits e proventos via Yahoo).
- **Frequência:** diária, baseada nos dias úteis de pregão da B3.
- **Retornos:** log-retornos (`ln(p_t / p_{t-1})`) em toda a pipeline. Diferença
  com yfR padrão (`type_return = "arit"`): yfr_py preserva ambos os parâmetros, mas
  a Gold do projeto usa `log` por consistência aditiva no tempo.
- **Anualização:** ×252 para variâncias, ×√252 para volatilidades.

## KPIs publicados em `gold.kpis_per_ticker`

| KPI | Fórmula | Notas |
|---|---|---|
| `return_ytd` | `ln(close_last / close_first_trading_day_of_year)` | Calculado apenas se houver ≥ 1 dia útil desde 1º de janeiro. |
| `vol_annual` | `std(log_returns_diarios, ddof=1) × √252` | Janela: todo o histórico disponível do ticker; mínimo 20 observações. |
| `max_drawdown` | `min((close − cummax(close)) / cummax(close))` | Sempre ≤ 0; janela: histórico completo. |
| `sharpe_vs_cdi` | `(mean(log_returns) × 252 − CDI_anual) / vol_annual` | `CDI_anual` é parâmetro do notebook (default 10.75%). |
| `last_close` | Última observação adjusted close | |

## Matriz de correlações

- **Cálculo:** `corr(log_returns_diarios)` em forma matricial sobre as colunas
  da `gold.returns_wide`.
- **Janela:** 1 ano (252 dias úteis mais recentes) por padrão na visão pública;
  matrizes de 5y e full também produzidas.
- **Apresentação:** top 50 mais correlacionados e top 50 mais anti-correlacionados
  são publicados em `correlation_heatmap.json` para evitar trafegar uma matriz
  400×400 no frontend público.

## Matrizes de covariância (para Markowitz Fase 2)

- **Fórmula:** `cov_anual = cov(log_returns_diarios) × 252`, simetrizada via
  `0.5 × (Σ + Σᵀ)`.
- **Janelas:** `1y` (252 dias), `5y` (1 260 dias), `full` (histórico completo).
- **Cobertura:** apenas tickers com todas as observações na janela entram na
  matriz. Os excluídos são registrados em `valid_tickers_<janela>.json` com a
  razão (`insufficient_history` / `delisted` / `low_liquidity`).
- **Sanidade:** asserto PSD (autovalor mínimo ≥ −1e-10) no notebook de qualidade.

## Limitações conhecidas

1. **CDI constante:** valor é fixado por widget no build. A integração com a série
   BCB SGS chega na Fase 2 (`GetBCBData`-py).
2. **Ajustes Yahoo:** confiáveis para splits/dividendos comuns; grupamentos
   raros podem divergir vs B3 oficial. A camada Bronze preserva o close bruto
   para reauditoria.
3. **Tickers de IPO recente:** `vol_annual` e `sharpe_vs_cdi` podem ser instáveis
   com < 60 observações; recomendamos filtrar `member_count` ou histórico mínimo
   na análise.
4. **Sobrevivência:** o histórico de delistados depende da curadoria de
   `data/ticker_universe.csv`. Tickers removidos da B3 sem entrada explícita
   no CSV não aparecem na Gold.
