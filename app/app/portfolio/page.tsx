import { MarkowitzEquationCard } from "@/components/MarkowitzEquationCard";
import { PortfolioShell } from "@/components/PortfolioShell";
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
        <p className="mt-2 max-w-3xl text-xs text-muted">
          Baseado em{" "}
          <a
            href="https://www.jstor.org/stable/2975974"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Markowitz (1952), &ldquo;Portfolio Selection&rdquo;, Journal of Finance
          </a>{" "}
          · ver também a{" "}
          <a
            href="https://www.nobelprize.org/prizes/economic-sciences/1990/markowitz/facts/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            página oficial do Prêmio Nobel de Economia (1990)
          </a>
          {" "}— Harry M. Markowitz, William F. Sharpe e Merton H. Miller, pelo
          trabalho pioneiro na teoria da economia financeira.
        </p>
      </header>

      <MarkowitzEquationCard />

      <PortfolioShell prices={prices} closes={closes} kpis={kpis} cdi={cdi} ibov={ibov} />

      <section className="card px-6 py-5 text-sm text-body">
        <div className="eyebrow">Notas metodológicas</div>
        <ul className="mt-3 space-y-2">
          <li>
            • <strong>μ (retornos esperados)</strong> e <strong>Σ (covariância)</strong> são
            estimados a partir dos log-retornos diários (com correção de
            Jensen para μ_simples), anualizados via ×252.
          </li>
          <li>
            • <strong>Σ</strong> passa por <strong>shrinkage Ledoit-Wolf (2004)</strong>{" "}
            data-driven com alvo de correlação constante. Intensidade ótima
            δ* é mostrada no badge da tela de Sugestões.
          </li>
          <li>
            • <strong>μ</strong> passa por <strong>duas camadas de shrinkage</strong>:
            (1) Bayes-Stein / Jorion (1986) toward grand mean com ψ*
            data-driven; (2) macro-anchor toward rf + ERP (Damodaran ≈ 6%)
            com α = 0,5. Sem isso, a fronteira mostra retornos esperados
            irrealisticamente altos (viés de máxima ordem). Detalhes em{" "}
            <a href="/metodologia" className="underline decoration-dotted underline-offset-2 hover:text-strong">
              /metodologia
            </a>.
          </li>
          <li>
            • <strong>Eixo Y do gráfico</strong> fixado em 0–35%. Ativos
            individuais acima desse teto saem da vista por design — a stack
            de shrinkage acima já garante que o ótimo viva em <span className="mono">[rf, rf + σ_mkt]</span>.
          </li>
          <li>
            • <strong>Taxa livre de risco</strong> = média do CDI da BCB SGS
            série 12 sobre a janela (cdi.json). <strong>Poupança</strong>{" "}
            (≈ 6,17% a.a. com SELIC &gt; 8,5%) aparece como reta de
            referência adicional, dominada pelo CDI.
          </li>
          <li>
            • <strong>CAL / Linha do Mercado de Capitais (CML)</strong>:
            reta tangente à fronteira no ponto de máximo Sharpe, partindo de{" "}
            <span className="mono">(0, rf)</span>. Inclinação = Sharpe da
            carteira de tangência = preço de mercado do risco.
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
