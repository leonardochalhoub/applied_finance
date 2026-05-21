import { ScreenerTable } from "@/components/ScreenerTable";
import { loadKpis } from "@/lib/data";

export const dynamic = "force-static";

export default async function ScreenerPage() {
  const kpis = await loadKpis();
  if (!kpis) {
    return <p className="text-sm text-muted">KPIs ainda não disponíveis.</p>;
  }
  const sectors = Array.from(
    new Set(kpis.tickers.map((t) => t.sector_b3).filter((s): s is string => Boolean(s))),
  ).sort();

  return (
    <div className="space-y-8">
      <header>
        <div className="eyebrow">Triagem</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Filtre ações por retorno, volatilidade, Sharpe e drawdown
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Combine filtros para encontrar oportunidades. Clique no cabeçalho para
          ordenar. Clique no ticker para abrir o detalhe.
        </p>
      </header>

      <ScreenerTable rows={kpis.tickers} sectors={sectors} />
    </div>
  );
}
