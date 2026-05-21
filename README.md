<div align="center">

# Mercado BR — Plataforma de Análise do Mercado Acionário Brasileiro

**Lakehouse aberta e dashboard estático sobre o universo completo de ações da B3.**
**Databricks Free · Delta Lake · Asset Bundles · Next.js 16 · GitHub Pages.**

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-black.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](pyproject.toml)
[![pt-BR](https://img.shields.io/badge/idioma-pt--BR-green.svg)](#)

</div>

---

## O que é

Plataforma **aberta, gratuita e auditável** que ingere o universo completo de ações da B3
(~400 tickers, ~26 anos de histórico) via uma porta Python do pacote R `yfR`, organiza
tudo numa **arquitetura medallion Bronze → Silver → Gold** sobre Delta Lake, e publica
artefatos versionados consumidos por um dashboard estático em Next.js 16, sem banco de
dados, sem servidor, sem login.

**Fase 1 (este escopo):** dashboard público com KPIs por ticker, comparação setorial,
mapa de correlações e visão IBOV.

**Fase 2 (arquitetura acomodada, build futuro):** fundamentos (CVM via porta Python do
`GetDFPData2`), macro (BCB via `GetBCBData`), e construção de carteira com **Markowitz
no navegador** sobre matrizes de covariância pré-computadas.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Ingestão | `yfr_py` (porta Python do `msperlin/yfR`, MIT) |
| Compute | Databricks Free Edition · Delta Lake · Asset Bundles |
| Catálogo | Unity Catalog (`finance_prd`) |
| Orquestração | GitHub Actions (cron diário pós-fechamento B3) |
| Contratos | JSON Schema versionado em `pipelines/contracts/` |
| Frontend | Next.js 16 (static export) · React 19 · Recharts · Tailwind v4 |
| Hospedagem | GitHub Pages (branch `gh-pages`, órfão, force-push) |

---

## Quick start

```bash
# Pré-requisitos
uv --version          # uv 0.5+ recomendado
node --version        # Node 20+
databricks --version  # Databricks CLI

# Instalar dependências Python
uv sync

# Configurar credenciais (não comite!)
cp .env.example .env
# Edite .env e preencha DATABRICKS_HOST + DATABRICKS_TOKEN

# Rodar testes do yfr_py
uv run pytest

# Validar bundle (sem deploy)
cd pipelines && databricks bundle validate --target dev

# Frontend
cd app && pnpm install && pnpm dev
```

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Visão geral + diagrama + decisões |
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | Fórmulas: retorno, vol, drawdown, Sharpe |
| [docs/FINOPS.md](docs/FINOPS.md) | Custo lifetime, snapshots mensais |
| [docs/adrs/](docs/adrs/) | Registros de decisão arquitetural |
| [.claude/sdd/features/](.claude/sdd/features/) | BRAINSTORM · DEFINE · DESIGN |

---

## Licença

MIT. Veja [LICENSE](LICENSE).
