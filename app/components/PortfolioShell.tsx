"use client";

import { useState } from "react";

import type {
  CdiArtifact,
  IbovArtifact,
  KpiArtifact,
  PricesArtifact,
  PricesCloseArtifact,
} from "@/lib/data";

import { FrontierChart } from "./FrontierChart";
import { PortfolioBuilder, type ChartSnapshot } from "./PortfolioBuilder";
import { PortfolioSuggestions } from "./PortfolioSuggestions";

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
  const ibovTickers = (ibov?.members ?? []).map((m) => m.ticker);

  return (
    <div className="space-y-12">
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

      {/* Frontier chart sits BETWEEN sections — shows the manual portfolio as
          a marker on its own focused frontier (selected tickers + full history). */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Fronteira eficiente da sua seleção
          </h2>
          <p className="text-xs text-muted">
            Calculada sobre os tickers escolhidos no construtor manual abaixo,
            com toda a história disponível. Sua carteira aparece como{" "}
            <span className="kpi-positive">◆ losango azul</span>. Clique em
            qualquer ponto para inspecionar e carregar.
          </p>
        </div>
        {chart ? (
          <FrontierChart
            mu={chart.mu}
            sigma={chart.sigma}
            rf={chart.rf}
            tickers={chart.tickers}
            longOnly={true}
            userPoint={chart.userPoint}
            comparePoint={chart.comparePoint ?? null}
            caption={chart.caption}
            onLoad={(w) => setExternalWeights(w)}
          />
        ) : (
          <div className="card px-6 py-12 text-center text-sm text-muted">
            Selecione pelo menos 2 tickers no construtor abaixo para calcular a
            fronteira eficiente da sua carteira.
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
          onChartData={setChart}
        />
      </section>
    </div>
  );
}
