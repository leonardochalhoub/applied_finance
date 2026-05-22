"use client";

import { useMemo, useState } from "react";

import { cdiMeanForWindow } from "@/lib/cdi";
import type {
  CdiArtifact,
  IbovArtifact,
  KpiArtifact,
  PricesArtifact,
  PricesCloseArtifact,
  SectorArtifact,
} from "@/lib/data";
import { fmtDate, fmtPctSigned, signedClass } from "@/lib/format";
import {
  aggregateSectorsForWindow,
  recomputeStatsForWindow,
  windowLabelPt,
  windowStartIndex,
  type WindowLabel,
} from "@/lib/windowed";

import { MultiTickerChart } from "./MultiTickerChart";
import { RankedBars } from "./RankedBars";
import { SectorPanels } from "./SectorPanels";

type Props = {
  kpis: KpiArtifact;
  sectors: SectorArtifact;
  ibov: IbovArtifact;
  prices: PricesArtifact;
  closes: PricesCloseArtifact | null;
  cdi: CdiArtifact | null;
};

const WINDOWS: WindowLabel[] = ["1M", "3M", "6M", "YTD", "1Y", "5Y", "10Y", "15Y", "20Y", "MAX"];

const DEFAULT_PICKS = ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBAS3.SA", "WEGE3.SA"];

export function HomeShell({ kpis, sectors, ibov, prices, closes, cdi }: Props) {
  const [window, setWindow] = useState<WindowLabel>("6M");
  const [sectorFilter, setSectorFilter] = useState<string>("all");

  const allTickers = useMemo(() => Object.keys(prices.series).sort(), [prices]);
  const initialPicks = useMemo(
    () => DEFAULT_PICKS.filter((t) => allTickers.includes(t)),
    [allTickers],
  );

  // Recompute everything from prices over the chosen window
  const windowedStats = useMemo(
    () => recomputeStatsForWindow(prices, kpis, window),
    [prices, kpis, window],
  );
  const sectorOptions = useMemo(
    () => Array.from(new Set(windowedStats.map((r) => r.sector_b3).filter(Boolean))).sort() as string[],
    [windowedStats],
  );

  // Apply sector filter to per-ticker stats; sector aggregates are computed
  // on the unfiltered set (otherwise filtering a sector hides the others entirely)
  const filteredStats = useMemo(() => {
    if (sectorFilter === "all") return windowedStats;
    return windowedStats.filter((r) => r.sector_b3 === sectorFilter);
  }, [windowedStats, sectorFilter]);

  const windowedSectors = useMemo(
    () => aggregateSectorsForWindow(windowedStats, sectors.sectors),
    [windowedStats, sectors],
  );

  const filteredSectors = useMemo(
    () => (sectorFilter === "all" ? windowedSectors : windowedSectors.filter((s) => s.sector_b3 === sectorFilter)),
    [windowedSectors, sectorFilter],
  );

  // Index-level return for the window: weighted by IBOV members' weights
  const indexReturnWindow = useMemo(() => {
    let sum = 0;
    let totalW = 0;
    for (const member of ibov.members) {
      const s = windowedStats.find((r) => r.ticker === member.ticker);
      if (!s?.return_window) continue;
      sum += member.weight * s.return_window;
      totalW += member.weight;
    }
    return totalW > 0 ? sum / totalW : null;
  }, [ibov, windowedStats]);

  // Breadth: how many tickers with positive return in window
  const validRows = filteredStats.filter((r) => r.return_window != null);
  const advancers = validRows.filter((r) => (r.return_window ?? 0) > 0).length;
  const decliners = validRows.filter((r) => (r.return_window ?? 0) < 0).length;
  const breadth = decliners === 0 ? Infinity : advancers / decliners;

  // Top / bottom movers
  const sortedByReturn = [...validRows].sort(
    (a, b) => (b.return_window ?? 0) - (a.return_window ?? 0),
  );
  const winners = sortedByReturn.slice(0, 8).map((t) => ({
    ticker: t.ticker,
    company_name: t.company_name,
    sector_b3: t.sector_b3,
    value: t.return_window,
  }));
  const losers = sortedByReturn.slice(-8).reverse().map((t) => ({
    ticker: t.ticker,
    company_name: t.company_name,
    sector_b3: t.sector_b3,
    value: t.return_window,
  }));

  // Editorial copy
  const sortedSectors = [...filteredSectors].sort((a, b) => b.return_ytd_mean - a.return_ytd_mean);
  const topSector = sortedSectors[0];
  const bottomSector = sortedSectors[sortedSectors.length - 1];

  const startIdx = windowStartIndex(prices.dates, window);
  const startDate = prices.dates[startIdx];
  const endDate = prices.dates[prices.dates.length - 1];

  const cdiWindow = useMemo(
    () => cdiMeanForWindow(cdi, startDate, endDate, kpis.cdi_global_mean ?? 0.13),
    [cdi, startDate, endDate, kpis],
  );

  // IBOV composition rows with window-recomputed returns and a sector filter
  const ibovRows = useMemo(() => {
    const tickByStat = new Map(windowedStats.map((s) => [s.ticker, s]));
    return ibov.members
      .filter((m) => sectorFilter === "all" || tickByStat.get(m.ticker)?.sector_b3 === sectorFilter)
      .map((m) => {
        const s = tickByStat.get(m.ticker);
        const r = s?.return_window ?? null;
        return {
          ticker: m.ticker,
          company_name: m.company_name ?? s?.company_name,
          sector_b3: m.sector_b3 ?? s?.sector_b3,
          weight: m.weight,
          return_window: r,
          contribution: r != null ? m.weight * r : null,
        };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12);
  }, [ibov, windowedStats, sectorFilter]);

  return (
    <div className="space-y-10">
      {/* ── Global filter bar (sticky-ish, above the fold) ────────────────── */}
      <section>
        <div className="card flex flex-wrap items-center gap-4 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted">janela</span>
            <div className="inline-flex rounded-md border border-border p-0.5">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWindow(w)}
                  className={`rounded-sm px-2.5 py-1 text-xs transition ${
                    window === w
                      ? "bg-[color:var(--accent)] text-white"
                      : "text-muted hover:text-strong"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted">setor</span>
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="rounded-md border border-border bg-[color:var(--bg-base)] px-3 py-1 text-xs focus:border-[color:var(--accent)] focus:outline-none"
            >
              <option value="all">Todos</option>
              {sectorOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto text-[10px] text-muted">
            {startDate} → {endDate} · {validRows.length} tickers válidos
          </div>
        </div>
      </section>

      {/* ── Trajectory chart (now the primary viz, at the top) ────────────── */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Trajetória de preços ({windowLabelPt(window)})
            </h2>
            <p className="text-xs text-muted">
              Multi-ticker · rebase a 100 ou R$ real · até 10 séries
            </p>
          </div>
        </div>
        <MultiTickerChart
          data={prices}
          closes={closes}
          initialTickers={initialPicks}
          allTickers={
            sectorFilter === "all"
              ? allTickers
              : windowedStats
                  .filter((r) => r.sector_b3 === sectorFilter)
                  .map((r) => r.ticker)
          }
          window={window}
          onWindowChange={setWindow}
          showWindowControls={false}
        />
      </section>

      {/* ── Stats block (was hero — now below the chart) ──────────────────── */}
      <section className="card px-6 py-5">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="eyebrow">IBOV · retorno {windowLabelPt(window)}</div>
            <div className={`display-stat mt-2 ${signedClass(indexReturnWindow)}`}>
              {fmtPctSigned(indexReturnWindow)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="chip">snapshot {fmtDate(kpis.as_of)}</span>
            <span className="chip">{validRows.length} tickers</span>
            <span className="chip">{filteredSectors.length} setores</span>
            <span className="chip">
              breadth {Number.isFinite(breadth) ? breadth.toFixed(2) : "∞"} (
              <span className="kpi-positive">{advancers}↑</span>
              <span className="mx-1 text-muted">/</span>
              <span className="kpi-negative">{decliners}↓</span>)
            </span>
            <span className="chip">
              CDI {windowLabelPt(window)} {fmtPctSigned(cdiWindow).replace("+", "")}
            </span>
          </div>
        </div>
        {topSector && bottomSector ? (
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-body">
            Puxado por{" "}
            <span className="font-semibold text-strong">{topSector.sector_b3}</span>{" "}
            <span className={signedClass(topSector.return_ytd_mean)}>
              ({fmtPctSigned(topSector.return_ytd_mean)})
            </span>
            , freado por{" "}
            <span className="font-semibold text-strong">{bottomSector.sector_b3}</span>{" "}
            <span className={signedClass(bottomSector.return_ytd_mean)}>
              ({fmtPctSigned(bottomSector.return_ytd_mean)})
            </span>
            . {advancers} de {validRows.length} tickers cobertos sobem na janela.
          </p>
        ) : null}
      </section>

      {/* ── Setores ───────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Setores</h2>
            <p className="text-xs text-muted">
              Retorno médio {windowLabelPt(window)} · sparkline 60d · clique para abrir a tabela
            </p>
          </div>
          <a href="/setores/" className="nav-link">ver tabela →</a>
        </div>
        <SectorPanels sectors={filteredSectors} prices={prices} />
      </section>

      {/* ── Líderes e retardatários (window-recomputed) ───────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Líderes e retardatários</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <RankedBars title={`Top 8 — maior retorno (${windowLabelPt(window)})`} rows={winners} variant="gain" />
          <RankedBars title={`Bottom 8 — menor retorno (${windowLabelPt(window)})`} rows={losers} variant="loss" />
        </div>
      </section>

      {/* ── IBOV composição (window-recomputed) ───────────────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">
          IBOV — composição e contribuição ({windowLabelPt(window)})
        </h2>
        <IbovContribution members={ibovRows} />
      </section>
    </div>
  );
}

function IbovContribution({
  members,
}: {
  members: {
    ticker: string;
    company_name?: string;
    sector_b3?: string;
    weight: number;
    return_window: number | null;
    contribution: number | null;
  }[];
}) {
  const max = Math.max(1e-9, ...members.map((m) => Math.abs(m.contribution ?? 0)));
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3 flex items-center justify-between">
        <span className="eyebrow">Top 12 por peso</span>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          contribuição p/ índice
        </span>
      </div>
      <ul className="divide-y divide-border">
        {members.map((m) => {
          const c = m.contribution ?? 0;
          const pct = (Math.abs(c) / max) * 100;
          const direction = c >= 0 ? "left" : "right";
          return (
            <li key={m.ticker} className="relative px-5 py-3">
              <div
                aria-hidden
                className={`absolute inset-y-0 ${
                  c >= 0
                    ? "left-1/2 bg-[color:var(--gain)]"
                    : "right-1/2 bg-[color:var(--loss)]"
                } opacity-[0.10]`}
                style={{ width: `${pct / 2}%`, [direction]: "50%" } as React.CSSProperties}
              />
              <div className="relative grid grid-cols-[120px_1fr_120px_100px] items-center gap-3">
                <a
                  className="mono text-sm font-semibold hover:underline"
                  href={`/ticker/${encodeURIComponent(m.ticker)}/`}
                >
                  {m.ticker.replace(/\.SA$/, "")}
                </a>
                <span className="truncate text-xs text-muted">{m.company_name}</span>
                <span className="text-right text-xs text-muted tabular">
                  peso {(m.weight * 100).toFixed(2)}%
                </span>
                <span className={`text-right text-sm font-semibold tabular ${signedClass(c)}`}>
                  {fmtPctSigned(c)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
