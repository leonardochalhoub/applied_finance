import { PortfolioBuilder } from "@/components/PortfolioBuilder";
import { loadKpis, loadPrices } from "@/lib/data";

export const dynamic = "force-static";

export default async function PortfolioPage() {
  const [prices, kpis] = await Promise.all([loadPrices(), loadKpis()]);
  if (!prices || !kpis) {
    return (
      <p className="text-sm text-muted">
        Série de preços ou KPIs não disponíveis — aguarde o próximo refresh.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <div className="eyebrow">Carteira · Markowitz</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Construa sua carteira e veja a fronteira eficiente
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Solução analítica de Markowitz (Black 1972) calculada no seu navegador
          sobre log-retornos diários. Selecione tickers à esquerda, ajuste os
          pesos com os sliders, e compare sua carteira contra os portfólios de
          mínima variância e máximo Sharpe sobre a fronteira eficiente. O link
          da URL guarda a sua seleção — copie e compartilhe.
        </p>
      </header>

      <PortfolioBuilder prices={prices} kpis={kpis} />

      <section className="card px-6 py-5 text-sm text-body">
        <div className="eyebrow">Notas metodológicas</div>
        <ul className="mt-3 space-y-2">
          <li>
            • <strong>μ (retornos esperados)</strong> e <strong>Σ (covariância)</strong> são
            estimados a partir dos log-retornos diários da janela disponível,
            anualizados via ×252 (variância) / ×√252 (vol).
          </li>
          <li>
            • <strong>Taxa livre de risco</strong> = média do CDI da BCB SGS
            série 12 sobre a janela (publicada em <code className="mono">cdi_global_mean</code>).
          </li>
          <li>
            • <strong>Shrinkage</strong> 1% para a diagonal aplicado por padrão
            (estabiliza Σ em N pequeno; lembrar de Ledoit-Wolf no notebook Gold).
          </li>
          <li>
            • <strong>Sem restrição de long-only</strong> nesta versão analítica
            — pesos podem ser negativos (short). Solver QP para long-only é
            uma próxima entrega.
          </li>
          <li>
            • <strong>Compartilhamento</strong> via base64 na query string
            <code className="mono">?p=</code>. Sem servidor, sem login.
          </li>
        </ul>
      </section>
    </div>
  );
}
