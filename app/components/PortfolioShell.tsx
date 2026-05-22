"use client";

import { useMemo, useState } from "react";

import type {
  CdiArtifact,
  IbovArtifact,
  KpiArtifact,
  PricesArtifact,
  PricesCloseArtifact,
} from "@/lib/data";

import { FrontierChart } from "./FrontierChart";
import { PortfolioBuilder, type ChartSnapshot } from "./PortfolioBuilder";
import { PortfolioSuggestions, type ReferenceStats } from "./PortfolioSuggestions";

type Props = {
  prices: PricesArtifact;
  closes: PricesCloseArtifact | null;
  kpis: KpiArtifact;
  cdi: CdiArtifact | null;
  ibov: IbovArtifact | null;
};

export function PortfolioShell({ prices, closes, kpis, cdi, ibov }: Props) {
  const [externalWeights, setExternalWeights] = useState<Record<string, number> | null>(null);
  const [chart, setChart] = useState<ChartSnapshot | null>(null);
  // Reference μ/Σ from Sugestões — gives the FrontierChart a stable coordinate
  // frame across pre/post-import. Updates when user changes Sugestões' window
  // or universe (so the chart still reacts when you intentionally change the
  // optimisation context), but stays constant when you just import a JSON.
  const [referenceStats, setReferenceStats] = useState<ReferenceStats | null>(null);
  // CRITICAL: memoize ibovTickers. Without this, every shell re-render creates
  // a new array reference, which busts PortfolioSuggestions' candidates/stats
  // useMemos, triggers its emit-stats effect, which calls setReferenceStats
  // here — infinite loop.
  const ibovTickers = useMemo(
    () => (ibov?.members ?? []).map((m) => m.ticker),
    [ibov],
  );

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sugestões</h2>
          <p className="text-xs text-muted">
            Otimizadas sobre todo o universo (ou apenas B3) usando uma janela
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
          onStatsChange={setReferenceStats}
        />
      </section>

      {/* Frontier chart sits BETWEEN sections — uses Sugestões' μ/Σ as a
          STABLE reference frame so the cloud stays constant before/after
          import; only the marker moves as you edit weights or import a JSON. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Fronteira eficiente —{" "}
            {referenceStats
              ? `${referenceStats.universe === "ibov" ? "B3" : "todo o universo"} · janela ${referenceStats.window}`
              : "carregando…"}
          </h2>
          <p className="text-xs text-muted">
            Mesma μ/Σ usada nas Sugestões acima — a nuvem é constante. Importe
            um JSON ou monte uma carteira manualmente e ela aparece como{" "}
            <span className="kpi-positive">◆ losango azul</span> sobre a
            fronteira. Clique em qualquer ponto para inspecionar e carregar.
          </p>
        </div>
        {chart || referenceStats ? (
          <FrontierChart
            mu={chart?.mu ?? referenceStats!.mu}
            sigma={chart?.sigma ?? referenceStats!.sigma}
            rf={chart?.rf ?? referenceStats!.rf}
            tickers={chart?.tickers ?? referenceStats!.tickers}
            longOnly={true}
            userPoint={chart?.userPoint ?? null}
            comparePoint={chart?.comparePoint ?? null}
            caption={
              chart?.caption ??
              `${referenceStats!.universe === "ibov" ? "B3" : "Todos"} · janela ${referenceStats!.window} · ${referenceStats!.tickers.length} ativos`
            }
            onLoad={(w) => setExternalWeights(w)}
          />
        ) : (
          <div className="card px-6 py-12 text-center text-sm text-muted">
            Carregando contexto de otimização…
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Construtor manual</h2>
          <p className="text-xs text-muted">
            Escolha tickers e pesos manualmente. A carteira é refletida no
            gráfico de fronteira acima em tempo real. Você também pode importar
            uma carteira em JSON para comparar com a fronteira ótima.
          </p>
        </div>
        <PortfolioBuilder
          prices={prices}
          kpis={kpis}
          cdi={cdi}
          externalWeights={externalWeights}
          referenceStats={referenceStats}
          onChartData={setChart}
        />
      </section>
    </div>
  );
}
