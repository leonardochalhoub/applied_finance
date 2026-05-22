import { VERSION } from "@/lib/version";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 text-xs md:grid-cols-3">
        <section>
          <div className="eyebrow mb-3">Fontes primárias</div>
          <ul className="space-y-3 text-body">
            <li>
              <a
                href="https://finance.yahoo.com/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-strong hover:underline"
              >
                Yahoo Finance · B3 (.SA)
              </a>
              <div className="mt-0.5 text-muted">
                OHLCV diário, adjusted close (splits + dividendos). Histórico
                desde ~2000.
              </div>
            </li>
            <li>
              <a
                href="https://www.bcb.gov.br/estatisticas/serie/sgs/12"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-strong hover:underline"
              >
                BCB · SGS série 12 (CDI Over)
              </a>
              <div className="mt-0.5 text-muted">
                Taxa CDI diária anualizada — usada como taxa livre de risco no
                Sharpe e na fronteira eficiente.
              </div>
            </li>
            <li>
              <a
                href="https://www.b3.com.br/pt_br/produtos-e-servicos/negociacao/renda-variavel/indices/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-strong hover:underline"
              >
                B3 · setores e composição de índices
              </a>
              <div className="mt-0.5 text-muted">
                Universo de tickers, sector_b3, composição IBOV (curado manualmente
                em <span className="mono">data/ticker_universe.csv</span>).
              </div>
            </li>
          </ul>
        </section>

        <section>
          <div className="eyebrow mb-3">Metodologia</div>
          <ul className="space-y-2 text-body">
            <li>
              Retornos: <span className="mono">ln(P_t / P_{"{t-1}"})</span> · anualização ×252
              (variância) ou ×√252 (volatilidade).
            </li>
            <li>
              Sharpe: <span className="mono">(μ − rf) / σ</span>, com{" "}
              <span className="mono">rf</span> = média CDI sobre a janela do
              ticker.
            </li>
            <li>
              Markowitz: solução fechada (Merton/Black) ·{" "}
              <span className="mono">w(r) = λ·Σ⁻¹·1 + γ·Σ⁻¹·μ</span> · cloud de
              Monte Carlo + projeção long-only via active-set.
            </li>
            <li>
              <a href="/metodologia/" className="text-strong hover:underline">
                Página de metodologia completa →
              </a>
            </li>
          </ul>
        </section>

        <section>
          <div className="eyebrow mb-3">Versão e código</div>
          <div className="space-y-2 text-body">
            <div className="flex items-center gap-2">
              <span className="chip mono">v{VERSION}</span>
              <span className="chip">MIT</span>
              <span className="chip">pt-BR</span>
            </div>
            <p className="mt-2 text-muted">
              Plataforma aberta, gratuita, sem login. Lakehouse no Databricks
              Free, frontend estático no GitHub Pages.
            </p>
            <p className="mono mt-3">
              <a
                href="https://github.com/leonardochalhoub/applied_finance"
                target="_blank"
                rel="noreferrer"
                className="text-strong hover:underline"
              >
                github.com/leonardochalhoub/applied_finance
              </a>
            </p>
            <p className="mt-2 text-muted">
              Atribuição: Leonardo Chalhoub — feito como portfolio aberto em
              Finance Engineering / Quant Data.
            </p>
          </div>
        </section>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-4 text-[10px] text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            Este conteúdo é informativo. Nada aqui constitui recomendação de
            investimento, oferta ou solicitação para compra ou venda de valores
            mobiliários.
          </p>
          <p className="mono">© {new Date().getFullYear()} Applied Finance</p>
        </div>
      </div>
    </footer>
  );
}
