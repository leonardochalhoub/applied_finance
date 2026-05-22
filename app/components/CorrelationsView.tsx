"use client";

import { useMemo, useState } from "react";

import { CorrelationGrid } from "@/components/CorrelationGrid";
import { CorrelationHeatmap } from "@/components/CorrelationHeatmap";
import type { CorrelationArtifact, CorrelationPair, KpiArtifact, PricesArtifact } from "@/lib/data";
import { type WindowLabel, windowStartIndex, windowLabelPt } from "@/lib/windowed";

const WINDOWS: WindowLabel[] = ["6M", "1Y", "5Y", "10Y", "15Y", "20Y", "MAX"];

type Props = {
  prices: PricesArtifact;
  kpis: KpiArtifact;
  precomputed: CorrelationArtifact;
};

/**
 * Compute Pearson correlations of daily log returns over `[startIdx, end)`.
 * Returns ranked top-N and bottom-N pairs.
 */
function correlatePairs(
  prices: PricesArtifact,
  startIdx: number,
  topN: number,
  sectorByTicker: Map<string, string | undefined>,
): { top: CorrelationPair[]; anti: CorrelationPair[]; coveredTickers: string[] } {
  const dates = prices.dates;
  const n = dates.length;
  const allTickers = Object.keys(prices.series).sort();

  // Compute daily log returns over window for each ticker, dropping null gaps
  const series: Map<string, number[]> = new Map();
  for (const t of allTickers) {
    const arr = prices.series[t];
    if (!arr) continue;
    const r: number[] = [];
    for (let i = startIdx + 1; i < n; i++) {
      const p = arr[i];
      const q = arr[i - 1];
      if (p != null && q != null && p > 0 && q > 0) {
        const lr = Math.log(p / q);
        if (Math.abs(lr) <= 0.5) r.push(lr);
        else r.push(NaN);
      } else {
        r.push(NaN);
      }
    }
    // Only keep tickers with >= 50% coverage
    const validCount = r.filter((x) => Number.isFinite(x)).length;
    if (validCount > Math.max(30, 0.5 * (n - startIdx - 1))) {
      series.set(t, r);
    }
  }

  const tickers = Array.from(series.keys());
  // Z-score each series (use mean/std of valid observations)
  const z: Map<string, number[]> = new Map();
  for (const t of tickers) {
    const arr = series.get(t)!;
    const valid = arr.filter((x) => Number.isFinite(x));
    const m = valid.reduce((a, b) => a + b, 0) / valid.length;
    const v =
      valid.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, valid.length - 1);
    const sd = Math.sqrt(Math.max(v, 1e-18));
    z.set(
      t,
      arr.map((x) => (Number.isFinite(x) ? (x - m) / sd : NaN)),
    );
  }

  // Pairwise correlation over coterminous valid observations
  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const a = z.get(tickers[i])!;
      const b = z.get(tickers[j])!;
      let sum = 0;
      let cnt = 0;
      for (let k = 0; k < a.length; k++) {
        if (Number.isFinite(a[k]) && Number.isFinite(b[k])) {
          sum += a[k] * b[k];
          cnt++;
        }
      }
      if (cnt < 30) continue;
      const corr = sum / Math.max(1, cnt - 1);
      // numerical guard
      const c = Math.max(-1, Math.min(1, corr));
      pairs.push({
        ticker_i: tickers[i],
        ticker_j: tickers[j],
        correlation: c,
        sector_i: sectorByTicker.get(tickers[i]),
        sector_j: sectorByTicker.get(tickers[j]),
      });
    }
  }

  pairs.sort((a, b) => b.correlation - a.correlation);
  const top = pairs.slice(0, topN);
  const anti = pairs.slice(-topN).reverse();
  return { top, anti, coveredTickers: tickers };
}

export function CorrelationsView({ prices, kpis, precomputed }: Props) {
  const [window, setWindow] = useState<WindowLabel>("1Y");

  const sectorByTicker = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const r of kpis.tickers) m.set(r.ticker, r.sector_b3);
    return m;
  }, [kpis]);

  const startIdx = useMemo(
    () => windowStartIndex(prices.dates, window),
    [prices.dates, window],
  );

  const live = useMemo(
    () => correlatePairs(prices, startIdx, 300, sectorByTicker),
    [prices, startIdx, sectorByTicker],
  );

  const allPairs = useMemo(() => [...live.top, ...live.anti], [live]);

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Janela {windowLabelPt(window)}</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Mapa de correlações
          </h1>
          <p className="mt-1 text-sm text-muted">
            Correlação dos log-retornos diários (adjusted close), janela{" "}
            {windowLabelPt(window)}. Mais verde = mais correlacionados; mais
            vermelho = mais anti-correlacionados.
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wider text-muted">
            {live.coveredTickers.length} tickers · recomputado no navegador ·
            artefato pré-computado base: {precomputed.window_label}
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindow(w)}
              className={`rounded-sm px-2.5 py-1 transition ${
                window === w
                  ? "bg-[color:var(--accent)] text-white"
                  : "text-muted hover:text-strong"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </header>

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="eyebrow">Grid (top 24 tickers por atividade)</span>
        </div>
        <CorrelationGrid pairs={allPairs} size={24} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <CorrelationHeatmap pairs={live.top.slice(0, 15)} title="Mais correlacionados" />
        <CorrelationHeatmap
          pairs={live.anti.slice(0, 15)}
          title="Mais anti-correlacionados"
        />
      </section>
    </div>
  );
}
