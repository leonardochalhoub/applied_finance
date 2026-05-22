"use client";

import { useMemo, useState } from "react";

import type { PricesArtifact, SectorRow } from "@/lib/data";
import { cellColor, fmtNum2, fmtPctSigned, signedClass } from "@/lib/format";
import type { WindowedTickerStats } from "@/lib/windowed";

type SortKey = "return" | "members" | "vol";

export function SectorPanels({
  sectors,
  prices,
  tickerStats,
}: {
  sectors: SectorRow[];
  prices: PricesArtifact | null;
  /** Optional per-ticker windowed stats — enables click-to-expand member detail. */
  tickerStats?: WindowedTickerStats[];
}) {
  const [openSector, setOpenSector] = useState<string | null>(null);
  const statsByTicker = useMemo(() => {
    const m = new Map<string, WindowedTickerStats>();
    for (const s of tickerStats ?? []) m.set(s.ticker, s);
    return m;
  }, [tickerStats]);
  const [sortKey, setSortKey] = useState<SortKey>("return");

  const sorted = useMemo(() => {
    const copy = [...sectors];
    if (sortKey === "return") {
      copy.sort((a, b) => b.return_ytd_mean - a.return_ytd_mean);
    } else if (sortKey === "members") {
      copy.sort((a, b) => b.member_count - a.member_count);
    } else {
      copy.sort((a, b) => b.vol_annual_mean - a.vol_annual_mean);
    }
    return copy;
  }, [sectors, sortKey]);

  // Precompute a 60d sector-average price trajectory (mean of member series,
  // each rebased to 100 at window start)
  const sectorPaths = useMemo(() => {
    if (!prices) return new Map<string, number[]>();
    const window = 60;
    const startIdx = Math.max(0, prices.dates.length - window);
    const out = new Map<string, number[]>();
    for (const s of sectors) {
      const members = s.members ?? [];
      const series = members
        .map((m) => prices.series[m])
        .filter((arr): arr is (number | null)[] => Array.isArray(arr));
      if (series.length === 0) continue;
      const path: number[] = [];
      for (let i = startIdx; i < prices.dates.length; i++) {
        const vals: number[] = [];
        for (const arr of series) {
          const v = arr[i];
          const v0 = arr[startIdx];
          if (v != null && v0 != null && v0 > 0) vals.push((v / v0) * 100);
        }
        if (vals.length === 0) {
          path.push(NaN);
        } else {
          path.push(vals.reduce((a, b) => a + b, 0) / vals.length);
        }
      }
      out.set(s.sector_b3, path);
    }
    return out;
  }, [prices, sectors]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted">
          {sectors.length} setores · sparkline 60d · clique numa carta para abrir o detalhe.
        </div>
        <div className="inline-flex items-center gap-1 text-xs">
          <span className="mr-2 text-muted">ordenar por</span>
          {(["return", "members", "vol"] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSortKey(k)}
              className={`rounded-md px-2.5 py-1 transition ${
                sortKey === k
                  ? "bg-[color:var(--accent)] text-white"
                  : "text-muted hover:bg-[color:var(--bg-subtle)] hover:text-strong"
              }`}
            >
              {k === "return" ? "retorno" : k === "members" ? "nº tickers" : "volatilidade"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
        {sorted.map((s) => (
          <SectorCard
            key={s.sector_b3}
            sector={s}
            path={sectorPaths.get(s.sector_b3)}
            open={openSector === s.sector_b3}
            onClick={() =>
              setOpenSector((cur) => (cur === s.sector_b3 ? null : s.sector_b3))
            }
          />
        ))}
      </div>

      {(() => {
        const openS = openSector ? sorted.find((s) => s.sector_b3 === openSector) : null;
        if (!openS) return null;
        return (
          <SectorDetail
            sector={openS}
            statsByTicker={statsByTicker}
            onClose={() => setOpenSector(null)}
          />
        );
      })()}
    </div>
  );
}

function SectorCard({
  sector,
  path,
  open,
  onClick,
}: {
  sector: SectorRow;
  path: number[] | undefined;
  open: boolean;
  onClick: () => void;
}) {
  const memberPreview = (sector.members ?? []).slice(0, 4);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`card card-hover group relative block w-full overflow-hidden p-5 text-left ${
        open ? "ring-2 ring-[color:var(--accent)]/60" : ""
      }`}
      style={{
        background: `linear-gradient(135deg, ${cellColor(sector.return_ytd_mean)} 0%, var(--bg-elevated) 100%)`,
      }}
    >
      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-tight text-strong">
            {sector.sector_b3}
          </h3>
          <span
            aria-hidden
            className={`text-xs transition ${open ? "rotate-180" : ""}`}
            style={{ color: "var(--muted)" }}
          >
            ▾
          </span>
        </div>

        <div className={`mt-3 text-2xl font-semibold tabular ${signedClass(sector.return_ytd_mean)}`}>
          {fmtPctSigned(sector.return_ytd_mean)}
        </div>

        <SectorSparkline path={path} positive={sector.return_ytd_mean >= 0} />

        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase tracking-wider text-muted">
          <div>
            <div>tickers</div>
            <div className="mt-0.5 text-sm font-semibold tabular text-body">
              {sector.member_count}
            </div>
          </div>
          <div>
            <div>vol. anual</div>
            <div className="mt-0.5 text-sm font-semibold tabular text-body">
              {fmtPctSigned(sector.vol_annual_mean).replace("+", "")}
            </div>
          </div>
        </div>

        {memberPreview.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {memberPreview.map((m) => (
              <span
                key={m}
                className="mono text-[10px] rounded-md border border-border bg-[color:var(--bg-base)]/60 px-1.5 py-0.5 text-body"
              >
                {m.replace(/\.SA$/, "")}
              </span>
            ))}
            {(sector.members?.length ?? 0) > memberPreview.length ? (
              <span className="text-[10px] text-muted">
                +{(sector.members?.length ?? 0) - memberPreview.length}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function SectorDetail({
  sector,
  statsByTicker,
  onClose,
}: {
  sector: SectorRow;
  statsByTicker: Map<string, WindowedTickerStats>;
  onClose: () => void;
}) {
  const members = sector.members ?? [];
  const rows = members
    .map((t) => {
      const s = statsByTicker.get(t);
      return {
        ticker: t,
        return_window: s?.return_window ?? null,
        vol_window: s?.vol_window ?? null,
        sharpe_window: s?.sharpe_window ?? null,
        drawdown_window: s?.drawdown_window ?? null,
      };
    })
    .sort((a, b) => (b.return_window ?? -Infinity) - (a.return_window ?? -Infinity));

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <span className="eyebrow">{sector.sector_b3}</span>
          <span className="ml-3 text-[10px] uppercase tracking-wider text-muted">
            {members.length} {members.length === 1 ? "ticker" : "tickers"} ·
            retorno médio {fmtPctSigned(sector.return_ytd_mean)} ·
            vol. média {fmtPctSigned(sector.vol_annual_mean).replace("+", "")}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] uppercase tracking-wider text-muted hover:text-strong"
        >
          fechar ×
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="px-5 py-3">Ticker</th>
              <th className="px-3 py-3 text-right">Retorno</th>
              <th className="px-3 py-3 text-right">Vol. anual</th>
              <th className="px-3 py-3 text-right">Sharpe</th>
              <th className="px-3 py-3 text-right">Max DD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.ticker} className="hover:bg-[color:var(--bg-subtle)]">
                <td className="whitespace-nowrap px-5 py-2.5">
                  <a
                    href={`/ticker/${encodeURIComponent(r.ticker)}/`}
                    className="mono text-sm font-semibold text-strong hover:underline"
                  >
                    {r.ticker.replace(/\.SA$/, "")}
                  </a>
                </td>
                <td
                  className={`px-3 py-2.5 text-right tabular font-semibold ${
                    r.return_window != null ? signedClass(r.return_window) : "text-muted"
                  }`}
                >
                  {r.return_window != null ? fmtPctSigned(r.return_window) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular text-body">
                  {r.vol_window != null ? fmtPctSigned(r.vol_window).replace("+", "") : "—"}
                </td>
                <td
                  className={`px-3 py-2.5 text-right tabular ${
                    r.sharpe_window != null ? signedClass(r.sharpe_window) : "text-muted"
                  }`}
                >
                  {r.sharpe_window != null ? fmtNum2(r.sharpe_window) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular text-body">
                  {r.drawdown_window != null ? fmtPctSigned(r.drawdown_window) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectorSparkline({
  path,
  positive,
}: {
  path: number[] | undefined;
  positive: boolean;
}) {
  if (!path || path.length < 2) return <div className="mt-2 h-10" />;
  const clean = path.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return <div className="mt-2 h-10" />;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = Math.max(max - min, 1e-9);
  const W = 220;
  const H = 36;
  const pts = path.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    const x = (i / (path.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const d = "M " + pts.filter((p): p is string => p !== null).join(" L ");
  const color = positive ? "var(--gain)" : "var(--loss)";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-2 h-10 w-full"
      aria-hidden
    >
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
