"use client";

import { useMemo, useState } from "react";

import type { KpiRow } from "@/lib/data";
import { fmtNum2, fmtPctSigned, signedClass } from "@/lib/format";
import { withBase } from "@/lib/links";

type Props = {
  rows: KpiRow[];
  sectors: string[];
};

type SortKey = "ticker" | "return_ytd" | "vol_annual" | "max_drawdown" | "sharpe_vs_cdi" | "last_close";
type SortDir = "asc" | "desc";

export function ScreenerTable({ rows, sectors }: Props) {
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState<string>("all");
  const [minReturn, setMinReturn] = useState<string>("");
  const [maxVol, setMaxVol] = useState<string>("");
  const [minSharpe, setMinSharpe] = useState<string>("");
  const [maxDD, setMaxDD] = useState<string>(""); // user enters positive %, we use as -threshold
  const [sortKey, setSortKey] = useState<SortKey>("sharpe_vs_cdi");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const minR = minReturn ? parseFloat(minReturn) / 100 : null;
    const maxV = maxVol ? parseFloat(maxVol) / 100 : null;
    const minS = minSharpe ? parseFloat(minSharpe) : null;
    const maxDDVal = maxDD ? -Math.abs(parseFloat(maxDD)) / 100 : null;

    let r = rows.filter((row) => {
      if (q && !row.ticker.includes(q) && !(row.company_name ?? "").toUpperCase().includes(q)) return false;
      if (sector !== "all" && row.sector_b3 !== sector) return false;
      if (minR != null && (row.return_ytd ?? -Infinity) < minR) return false;
      if (maxV != null && (row.vol_annual ?? Infinity) > maxV) return false;
      if (minS != null && (row.sharpe_vs_cdi ?? -Infinity) < minS) return false;
      if (maxDDVal != null && (row.max_drawdown ?? -Infinity) < maxDDVal) return false;
      return true;
    });

    r = [...r].sort((a, b) => {
      let va: number | string = a[sortKey] ?? -Infinity;
      let vb: number | string = b[sortKey] ?? -Infinity;
      if (sortKey === "ticker") {
        va = String(va);
        vb = String(vb);
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return r;
  }, [rows, search, sector, minReturn, maxVol, minSharpe, maxDD, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  function reset() {
    setSearch("");
    setSector("all");
    setMinReturn("");
    setMaxVol("");
    setMinSharpe("");
    setMaxDD("");
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-5 py-4">
          <FilterInput label="Buscar (ticker ou nome)" value={search} onChange={setSearch} placeholder="PETR4, Vale, …" wide />
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted">Setor</label>
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="mt-1 rounded-md border border-border bg-[color:var(--bg-base)] px-3 py-1.5 text-sm focus:border-[color:var(--accent)] focus:outline-none"
            >
              <option value="all">Todos</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <FilterInput label="YTD mín. (%)" value={minReturn} onChange={setMinReturn} placeholder="10" />
          <FilterInput label="Vol. máx. (%)" value={maxVol} onChange={setMaxVol} placeholder="35" />
          <FilterInput label="Sharpe mín." value={minSharpe} onChange={setMinSharpe} placeholder="0.5" />
          <FilterInput label="DD máx. (%)" value={maxDD} onChange={setMaxDD} placeholder="25" />
          <button
            type="button"
            onClick={reset}
            className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-strong"
          >
            Limpar
          </button>
        </div>
        <div className="px-5 py-2 text-[10px] uppercase tracking-wider text-muted">
          {filtered.length} de {rows.length} tickers
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted">
                <HeaderCell label="Ticker" k="ticker" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <th className="px-3 py-3">Empresa</th>
                <th className="px-3 py-3">Setor</th>
                <HeaderCell label="YTD" k="return_ytd" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <HeaderCell label="Vol." k="vol_annual" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <HeaderCell label="DD máx" k="max_drawdown" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <HeaderCell label="Sharpe" k="sharpe_vs_cdi" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <HeaderCell label="Fech." k="last_close" sortKey={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row) => (
                <tr key={row.ticker} className="hover:bg-[color:var(--bg-subtle)]">
                  <td className="px-3 py-2.5">
                    <a
                      className="mono text-sm font-semibold hover:underline"
                      href={withBase(`/ticker/${encodeURIComponent(row.ticker)}/`)}
                    >
                      {row.ticker.replace(/\.SA$/, "")}
                    </a>
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2.5 text-body">{row.company_name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{row.sector_b3 ?? "—"}</td>
                  <td className={`px-3 py-2.5 text-right tabular ${signedClass(row.return_ytd)}`}>
                    {fmtPctSigned(row.return_ytd)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular text-body">
                    {fmtPctSigned(row.vol_annual).replace("+", "")}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular ${signedClass(row.max_drawdown)}`}>
                    {fmtPctSigned(row.max_drawdown)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular ${signedClass(row.sharpe_vs_cdi)}`}>
                    {fmtNum2(row.sharpe_vs_cdi)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular text-body">
                    R$ {row.last_close?.toFixed(2) ?? "—"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-muted">
                    Nenhum ticker atende aos filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "min-w-[220px]" : ""}>
      <label className="block text-[10px] uppercase tracking-wider text-muted">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1 rounded-md border border-border bg-[color:var(--bg-base)] px-3 py-1.5 text-sm placeholder:text-muted focus:border-[color:var(--accent)] focus:outline-none ${
          wide ? "w-full" : "w-28"
        }`}
      />
    </div>
  );
}

function HeaderCell({
  label,
  k,
  sortKey,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`px-3 py-3 ${align === "right" ? "text-right" : ""}`}>
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
