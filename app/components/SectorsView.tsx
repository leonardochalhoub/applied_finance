"use client";

import { useMemo, useState } from "react";

import type { KpiArtifact, PricesArtifact, SectorArtifact } from "@/lib/data";
import { fmtPctSigned, signedClass } from "@/lib/format";
import {
  aggregateSectorsForWindow,
  recomputeStatsForWindow,
  windowLabelPt,
  type WindowLabel,
} from "@/lib/windowed";

import { SectorPanels } from "./SectorPanels";

const WINDOWS: WindowLabel[] = ["1M", "3M", "6M", "YTD", "1Y", "MAX"];

export function SectorsView({
  kpis,
  sectorsSnapshot,
  prices,
}: {
  kpis: KpiArtifact;
  sectorsSnapshot: SectorArtifact;
  prices: PricesArtifact;
}) {
  const [window, setWindow] = useState<WindowLabel>("YTD");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"return" | "members" | "vol" | "name">("return");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sectors = useMemo(() => {
    const stats = recomputeStatsForWindow(prices, kpis, window);
    return aggregateSectorsForWindow(stats, sectorsSnapshot.sectors);
  }, [prices, kpis, sectorsSnapshot, window]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = q ? sectors.filter((s) => s.sector_b3.toLowerCase().includes(q)) : sectors;
    r = [...r].sort((a, b) => {
      let va: number | string;
      let vb: number | string;
      if (sortKey === "name") {
        va = a.sector_b3;
        vb = b.sector_b3;
      } else if (sortKey === "members") {
        va = a.member_count;
        vb = b.member_count;
      } else if (sortKey === "vol") {
        va = a.vol_annual_mean;
        vb = b.vol_annual_mean;
      } else {
        va = a.return_ytd_mean;
        vb = b.return_ytd_mean;
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return r;
  }, [sectors, query, sortKey, sortDir]);

  const maxAbs = Math.max(1e-9, ...filtered.map((s) => Math.abs(s.return_ytd_mean)));

  function toggleSort(k: typeof sortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  return (
    <div className="space-y-10">
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
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar setor…"
          className="w-64 rounded-md border border-border bg-[color:var(--bg-base)] px-3 py-1.5 text-sm placeholder:text-muted focus:border-[color:var(--accent)] focus:outline-none"
        />
        <div className="ml-auto text-[10px] text-muted">{filtered.length} setores</div>
      </div>

      <section>
        <SectorPanels sectors={filtered} prices={prices} />
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3 flex items-center justify-between">
          <span className="eyebrow">Tabela detalhada · {windowLabelPt(window)}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted">
            clique no cabeçalho para ordenar
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted">
              <Th label="Setor" k="name" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <Th label="Tickers" k="members" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              <Th label="Retorno médio" k="return" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              <th className="px-5 py-3 text-right">Mediana</th>
              <Th label="Vol. anual média" k="vol" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((s) => {
              const pct = (Math.abs(s.return_ytd_mean) / maxAbs) * 100;
              const direction = s.return_ytd_mean >= 0 ? "left" : "right";
              return (
                <tr key={s.sector_b3} className="hover:bg-[color:var(--bg-subtle)]">
                  <td className="px-5 py-3 text-strong">{s.sector_b3}</td>
                  <td className="px-5 py-3 text-right tabular text-body">{s.member_count}</td>
                  <td className="px-5 py-3">
                    <div className="relative">
                      <div
                        aria-hidden
                        className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full opacity-60 ${
                          s.return_ytd_mean >= 0
                            ? "bg-[color:var(--gain)]"
                            : "bg-[color:var(--loss)]"
                        }`}
                        style={{
                          width: `${pct / 2}%`,
                          [direction]: "50%",
                        } as React.CSSProperties}
                      />
                      <span
                        className={`relative inline-block w-24 text-right tabular font-semibold ${signedClass(
                          s.return_ytd_mean,
                        )}`}
                      >
                        {fmtPctSigned(s.return_ytd_mean)}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right tabular text-body">
                    {fmtPctSigned(s.return_ytd_median)}
                  </td>
                  <td className="px-5 py-3 text-right tabular text-body">
                    {fmtPctSigned(s.vol_annual_mean)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Th({
  label,
  k,
  sortKey,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  k: "return" | "members" | "vol" | "name";
  sortKey: "return" | "members" | "vol" | "name";
  dir: "asc" | "desc";
  onClick: (k: "return" | "members" | "vol" | "name") => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`px-5 py-3 ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 hover:text-strong ${active ? "text-strong" : ""}`}
      >
        <span>{label}</span>
        {active ? <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
}
