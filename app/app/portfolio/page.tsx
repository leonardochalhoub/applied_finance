import { PortfolioBuilder } from "@/components/PortfolioBuilder";
import { PortfolioSuggestions } from "@/components/PortfolioSuggestions";
import { loadIbov, loadKpis, loadPrices } from "@/lib/data";

export const dynamic = "force-static";

export default async function PortfolioPage() {
  const [prices, kpis, ibov] = await Promise.all([loadPrices(), loadKpis(), loadIbov()]);
  if (!prices || !kpis) {
    return (
      <p className="text-sm text-muted">
        Série de preços ou KPIs não disponíveis — aguarde o próximo refresh.
      </p>
    );
  }
  const ibovTickers = (ibov?.members ?? []).map((m) => m.ticker);

  return (
    <div className="space-y-12">
      <header>
        <div className="eyebrow">Carteira · Markowitz</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Carteiras sugeridas e construtor manual
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Otimização Markowitz analítica (Black 1972) calculada no navegador. Use
          as carteiras sugeridas para começar (3 perfis de risco em até 10
          tickers) ou monte a sua manualmente com sliders de peso. O link da URL
          guarda a sua carteira — copie e compartilhe.
        </p>
      </header>

      {/* ── Sugestões automáticas ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sugestões</h2>
          <p className="text-xs text-muted">
            Otimizadas sobre todo o universo (ou apenas IBOV) usando uma janela
            de estimação configurável. Define quanto investir e veja o número de
            ações de cada papel.
          </p>
        </div>
        <PortfolioSuggestions prices={prices} kpis={kpis} ibovTickers={ibovTickers} />
      </section>

      {/* ── Construtor manual ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Construtor manual</h2>
          <p className="text-xs text-muted">
            Escolha tickers e pesos. Compare contra as carteiras de mínima
            variância e máximo Sharpe na fronteira eficiente.
          </p>
        </div>
        <PortfolioBuilder prices={prices} kpis={kpis} />
      </section>

      <section className="card px-6 py-5 text-sm text-body">
        <div className="eyebrow">Notas metodológicas</div>
        <ul className="mt-3 space-y-2">
          <li>
            • <strong>μ (retornos esperados)</strong> e <strong>Σ (covariância)</strong> são
            estimados a partir dos log-retornos diários da janela escolhida,
            anualizados via ×252 (variância) / ×√252 (vol).
          </li>
          <li>
            • <strong>Taxa livre de risco</strong> = média do CDI da BCB SGS
            série 12 sobre a janela (publicada em <code className="mono">cdi_global_mean</code>).
          </li>
          <li>
            • <strong>Shrinkage</strong> 5% para a diagonal aplicado nas sugestões
            (estabiliza Σ em N grande); 1% no construtor manual.
          </li>
          <li>
            • <strong>Long-only</strong> nas sugestões é aproximado por zerar pesos
            negativos e renormalizar. Solução exata requer um QP solver (próxima
            entrega). No construtor manual a solução analítica permite shorts.
          </li>
          <li>
            • <strong>Número de ações</strong> = peso × valor / último preço
            ajustado. Lotes mínimos da B3 (geralmente 100) <em>não</em> são respeitados —
            sugestões em frações refletem realocação fracionária ideal.
          </li>
        </ul>
      </section>
    </div>
  );
}
