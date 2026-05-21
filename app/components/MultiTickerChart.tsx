"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PricesArtifact } from "@/lib/data";

const PALETTE = [
  "#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#a78bfa",
  "#f87171", "#22d3ee", "#fb923c", "#84cc16", "#e879f9",
];

type Range = "1M" | "3M" | "6M" | "YTD" | "1Y" | "MAX";

const RANGE_DAYS: Record<Exclude<Range, "YTD" | "MAX">, number> = {
  "1M": 22, "3M": 66, "6M": 132, "1Y": 252,
};

type Props = {
  data: PricesArtifact;
  initialTickers: string[];
  allTickers: string[];
};

export function MultiTickerChart({ data, initialTickers, allTickers }: Props) {
  const [selected, setSelected] = useState<string[]>(initialTickers.slice(0, 5));
  const [range, setRange] = useState<Range>("6M");
  const [logScale, setLogScale] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return allTickers;
    return allTickers.filter((t) => t.includes(q));
  }, [query, allTickers]);

  const slicedDates = useMemo(() => {
    if (range === "MAX") return data.dates;
    if (range === "YTD") {
      const ytdStart = `${data.as_of.slice(0, 4)}-01-01`;
      const startIdx = data.dates.findIndex((d) => d >= ytdStart);
      return startIdx === -1 ? data.dates : data.dates.slice(startIdx);
    }
    const n = RANGE_DAYS[range];
    return data.dates.slice(-n);
  }, [range, data]);

  const chartRows = useMemo(() => {
    const startIdx = data.dates.length - slicedDates.length;
    return slicedDates.map((d, i) => {
      const row: Record<string, number | string | null> = { date: d };
      for (const t of selected) {
        const arr = data.series[t];
        if (!arr) continue;
        const raw = arr[startIdx + i];
        if (raw == null) continue;
        // Rebase to 100 at the start of the selected window
        const baseRaw = arr[startIdx];
        if (baseRaw == null || baseRaw <= 0) continue;
        row[t] = (raw / baseRaw) * 100;
      }
      return row;
    });
  }, [slicedDates, selected, data]);

  function toggle(t: string) {
    setSelected((prev) =>
      prev.includes(t) ? prev.filter((p) => p !== t) : [...prev, t].slice(-10)
    );
  }

  const lastRow = chartRows[chartRows.length - 1];
  const summary = selected
    .map((t) => {
      const v = lastRow?.[t];
      const num = typeof v === "number" ? v : null;
      const pct = num != null ? (num - 100) / 100 : null;
      return { ticker: t, last: num, pct };
    })
    .filter((s) => s.last != null);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Comparação de preços</span>
          <span className="text-[10px] text-muted">
            rebaseado a 100 no início da janela
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(["1M", "3M", "6M", "YTD", "1Y", "MAX"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 transition ${
                range === r
                  ? "bg-[color:var(--accent)] text-white"
                  : "text-muted hover:bg-[color:var(--bg-subtle)] hover:text-strong"
              }`}
            >
              {r}
            </button>
          ))}
          <label className="ml-3 flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={logScale}
              onChange={(e) => setLogScale(e.target.checked)}
              className="accent-[color:var(--accent)]"
            />
            log
          </label>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-border lg:border-b-0 lg:border-r">
          <div className="px-4 py-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ticker…"
              className="w-full rounded-md border border-border bg-[color:var(--bg-base)] px-3 py-1.5 text-sm placeholder:text-muted focus:border-[color:var(--accent)] focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
              <span>{selected.length} selecionado(s) · máx 10</span>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="hover:text-strong"
              >
                limpar
              </button>
            </div>
          </div>
          <ul className="max-h-[360px] divide-y divide-border overflow-auto">
            {filtered.map((t) => {
              const active = selected.includes(t);
              const idx = selected.indexOf(t);
              const color = idx >= 0 ? PALETTE[idx % PALETTE.length] : undefined;
              return (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => toggle(t)}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-left text-xs transition ${
                      active ? "bg-[color:var(--bg-subtle)]" : "hover:bg-[color:var(--bg-subtle)]"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: color ?? "var(--border-strong)" }}
                    />
                    <span className="mono text-strong">{t.replace(/\.SA$/, "")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="min-h-[420px] p-4">
          <div style={{ width: "100%", height: 380 }}>
            <ResponsiveContainer>
              <LineChart data={chartRows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  stroke="var(--border)"
                  minTickGap={32}
                />
                <YAxis
                  scale={logScale ? "log" : "linear"}
                  domain={logScale ? [1, "auto"] : ["auto", "auto"]}
                  allowDataOverflow={logScale}
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  stroke="var(--border)"
                  width={48}
                  tickFormatter={(v) => (typeof v === "number" ? v.toFixed(0) : v)}
                />
                <ReferenceLine
                  y={100}
                  stroke="var(--border-strong)"
                  strokeDasharray="2 3"
                  label={{
                    value: "rebase 100",
                    position: "insideTopRight",
                    fill: "var(--muted)",
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--strong)",
                  }}
                  labelStyle={{ color: "var(--muted)", fontWeight: 600 }}
                  formatter={(value: unknown) =>
                    typeof value === "number" ? value.toFixed(2) : "—"
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  formatter={(value: string) => value.replace(/\.SA$/, "")}
                />
                {selected.map((t, idx) => (
                  <Line
                    key={t}
                    type="monotone"
                    dataKey={t}
                    stroke={PALETTE[idx % PALETTE.length]}
                    strokeWidth={1.75}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {summary.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-3 lg:grid-cols-5">
              {summary.map((s, idx) => (
                <div key={s.ticker} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: PALETTE[selected.indexOf(s.ticker) % PALETTE.length],
                    }}
                  />
                  <span className="mono text-strong">{s.ticker.replace(/\.SA$/, "")}</span>
                  <span className="text-muted">{s.last?.toFixed(1)}</span>
                  <span
                    className={`tabular ${
                      (s.pct ?? 0) >= 0 ? "kpi-positive" : "kpi-negative"
                    }`}
                  >
                    {((s.pct ?? 0) * 100).toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-6 text-center text-sm text-muted">
              Selecione um ou mais tickers à esquerda para começar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
