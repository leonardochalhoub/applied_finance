import { MultiTickerChart } from "@/components/MultiTickerChart";
import { loadKpis, loadPrices } from "@/lib/data";

export const dynamic = "force-static";

export default async function CompararPage() {
  const [prices, kpis] = await Promise.all([loadPrices(), loadKpis()]);
  if (!prices) {
    return (
      <p className="text-sm text-muted">
        Série histórica ainda não disponível — aguarde o próximo refresh.
      </p>
    );
  }

  const allTickers = Object.keys(prices.series).sort();
  // Seed selection with a few liquid IBOV majors that exist in the dataset
  const candidates = ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBAS3.SA", "WEGE3.SA"];
  const initial = candidates.filter((t) => allTickers.includes(t));

  return (
    <div className="space-y-8">
      <header>
        <div className="eyebrow">Comparador</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Preços ao longo do tempo
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Selecione até 10 tickers para comparar. Os preços são rebaseados a 100
          no início da janela escolhida — ideal para comparar trajetória
          relativa, não níveis absolutos.
        </p>
      </header>

      <MultiTickerChart
        data={prices}
        initialTickers={initial}
        allTickers={allTickers}
      />

      {kpis ? (
        <div className="text-xs text-muted">
          Snapshot dos KPIs em {kpis.as_of} · {allTickers.length} tickers com
          série completa.
        </div>
      ) : null}
    </div>
  );
}
