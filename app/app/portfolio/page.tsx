import { PortfolioBuilder } from "@/components/PortfolioBuilder";
import { PortfolioSuggestions } from "@/components/PortfolioSuggestions";
import { loadCdi, loadIbov, loadKpis, loadPrices, loadPricesClose } from "@/lib/data";

export const dynamic = "force-static";

export default async function PortfolioPage() {
  const [prices, closes, kpis, ibov, cdi] = await Promise.all([
    loadPrices(),
    loadPricesClose(),
    loadKpis(),
    loadIbov(),
    loadCdi(),
  ]);
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
          Otimização Markowitz analítica calculada no navegador. Use as carteiras
          sugeridas para começar (3 perfis de risco) ou monte a sua manualmente
          com sliders de peso. O link da URL guarda a sua carteira — copie e
          compartilhe.
        </p>
      </header>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sugestões</h2>
          <p className="text-xs text-muted">
            Otimizadas sobre todo o universo (ou apenas IBOV) usando uma janela
            de estimação configurável. Define quanto investir e gere a ordem de
            compra com um clique.
          </p>
        </div>
        <PortfolioSuggestions
          prices={prices}
          closes={closes}
          kpis={kpis}
          cdi={cdi}
          ibovTickers={ibovTickers}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Construtor manual</h2>
          <p className="text-xs text-muted">
            Escolha tickers e pesos. Compare contra as carteiras de mínima
            variância e máximo Sharpe na fronteira eficiente.
          </p>
        </div>
        <PortfolioBuilder prices={prices} kpis={kpis} cdi={cdi} />
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
            série 12 sobre a janela (cdi.json).
          </li>
          <li>
            • <strong>Shrinkage</strong> 5% para a diagonal nas sugestões;
            estabiliza Σ em N grande.
          </li>
          <li>
            • <strong>Long-only</strong> usa projeção iterativa active-set
            (drop most-negative, re-solve). Aproxima o QP convexo com erro
            pequeno no caso típico.
          </li>
          <li>
            • <strong>Quantidade de ações</strong> = peso × valor / último
            adjusted close. Lotes da B3 (geralmente 100) <em>não</em> são
            respeitados — frações são realocação ótima fracionária.
          </li>
        </ul>
      </section>
    </div>
  );
}
