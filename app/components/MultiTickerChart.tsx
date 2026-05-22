"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

import { downloadSvgChart } from "@/lib/chartDownload";
import type { PricesArtifact, PricesCloseArtifact } from "@/lib/data";
import { fmtAxisBRL, fmtAxisNum, fmtNum2 } from "@/lib/format";
import type { WindowLabel } from "@/lib/windowed";
import { windowStartIndex } from "@/lib/windowed";

const PALETTE = [
  "#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#a78bfa",
  "#f87171", "#22d3ee", "#fb923c", "#84cc16", "#e879f9",
];

type DisplayMode = "rebase" | "absolute";

type Props = {
  data: PricesArtifact;
  closes?: PricesCloseArtifact | null;
  initialTickers: string[];
  allTickers: string[];
  window?: WindowLabel;
  onWindowChange?: (w: WindowLabel) => void;
  showWindowControls?: boolean;
};

export function MultiTickerChart({
  data,
  closes,
  initialTickers,
  allTickers,
  window: windowProp,
  onWindowChange,
  showWindowControls = true,
}: Props) {
  const [selected, setSelected] = useState<string[]>(initialTickers.slice(0, 5));
  const [internalWindow, setInternalWindow] = useState<WindowLabel>("6M");
  const window = windowProp ?? internalWindow;
  const [logScale, setLogScale] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("rebase");
  const [query, setQuery] = useState("");
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (windowProp !== undefined) setInternalWindow(windowProp);
  }, [windowProp]);

  function setWindow(w: WindowLabel) {
    setInternalWindow(w);
    onWindowChange?.(w);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return allTickers;
    return allTickers.filter((t) => t.includes(q));
  }, [query, allTickers]);

  const startIdx = useMemo(() => windowStartIndex(data.dates, window), [data.dates, window]);
  const slicedDates = useMemo(() => data.dates.slice(startIdx), [data.dates, startIdx]);

  // First non-null base per ticker within the window — tickers that started
  // trading mid-window (ABEV3 pre-2013, ALOS3 pre-2018, etc.) still render
  // from their listing date instead of being skipped entirely.
  const basePerTicker = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of selected) {
      const arr = data.series[t];
      if (!arr) continue;
      for (let i = startIdx; i < data.dates.length; i++) {
        const v = arr[i];
        if (v != null && v > 0) {
          map[t] = v;
          break;
        }
      }
    }
    return map;
  }, [selected, data, startIdx]);

  const chartRows = useMemo(() => {
    return slicedDates.map((d, i) => {
      const row: Record<string, number | string | null> = { date: d };
      for (const t of selected) {
        if (displayMode === "absolute" && closes) {
          const arr = closes.series[t];
          if (!arr) continue;
          const raw = arr[startIdx + i];
          if (raw == null) continue;
          row[t] = raw;
        } else {
          const arr = data.series[t];
          if (!arr) continue;
          const raw = arr[startIdx + i];
          if (raw == null) continue;
          const baseRaw = basePerTicker[t];
          if (baseRaw == null || baseRaw <= 0) continue;
          row[t] = (raw / baseRaw) * 100;
        }
      }
      return row;
    });
  }, [slicedDates, selected, data, closes, displayMode, startIdx, basePerTicker]);

  function toggle(t: string) {
    setSelected((prev) =>
      prev.includes(t) ? prev.filter((p) => p !== t) : [...prev, t].slice(-10),
    );
  }

  const lastRow = chartRows[chartRows.length - 1];
  const firstRow = chartRows[0];
  const summary = selected
    .map((t) => {
      const v = lastRow?.[t];
      const v0 = firstRow?.[t];
      const num = typeof v === "number" ? v : null;
      const num0 = typeof v0 === "number" ? v0 : null;
      let pct: number | null = null;
      if (displayMode === "rebase") {
        pct = num != null ? (num - 100) / 100 : null;
      } else if (num != null && num0 != null && num0 > 0) {
        pct = (num - num0) / num0;
      }
      return { ticker: t, last: num, pct };
    })
    .filter((s) => s.last != null);

  const isAbsolute = displayMode === "absolute";
  const tickFmt = isAbsolute ? fmtAxisBRL : fmtAxisNum;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Comparação de preços</span>
          <div className="inline-flex rounded-md border border-border p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setDisplayMode("rebase")}
              className={`rounded-sm px-2 py-0.5 transition ${
                displayMode === "rebase"
                  ? "bg-[color:var(--accent)] text-white"
                  : "text-muted hover:text-strong"
              }`}
            >
              rebase 100
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("absolute")}
              disabled={!closes}
              className={`rounded-sm px-2 py-0.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                displayMode === "absolute"
                  ? "bg-[color:var(--accent)] text-white"
                  : "text-muted hover:text-strong"
              }`}
            >
              R$ real
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {showWindowControls
            ? (["1M", "3M", "6M", "YTD", "1Y", "5Y", "10Y", "15Y", "20Y", "MAX"] as WindowLabel[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setWindow(r)}
                  className={`rounded-md px-2.5 py-1 transition ${
                    window === r
                      ? "bg-[color:var(--accent)] text-white"
                      : "text-muted hover:bg-[color:var(--bg-subtle)] hover:text-strong"
                  }`}
                >
                  {r}
                </button>
              ))
            : null}
          <label className="ml-3 flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={logScale}
              onChange={(e) => setLogScale(e.target.checked)}
              className="accent-[color:var(--accent)]"
            />
            log
          </label>
          <button
            type="button"
            onClick={() => {
              void downloadSvgChart(
                chartRef.current,
                `applied-finance-comparacao-${new Date().toISOString().slice(0, 10)}.png`,
                "png",
              ).catch((e) => console.warn("download failed", e));
            }}
            className="ml-2 rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted hover:text-strong"
            title="Baixar PNG do gráfico"
          >
            ↓ baixar
          </button>
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
          <div ref={chartRef} style={{ width: "100%", height: 380 }}>
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
                  width={isAbsolute ? 70 : 48}
                  tickFormatter={tickFmt}
                />
                {!isAbsolute ? (
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
                ) : null}
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
                    typeof value === "number"
                      ? isAbsolute
                        ? fmtAxisBRL(value)
                        : fmtNum2(value)
                      : "—"
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
              {summary.map((s) => (
                <div key={s.ticker} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: PALETTE[selected.indexOf(s.ticker) % PALETTE.length],
                    }}
                  />
                  <a
                    className="mono text-strong hover:underline"
                    href={`/ticker/${encodeURIComponent(s.ticker)}/`}
                  >
                    {s.ticker.replace(/\.SA$/, "")}
                  </a>
                  <span className="text-muted">
                    {isAbsolute ? fmtAxisBRL(s.last ?? 0) : fmtNum2(s.last ?? 0)}
                  </span>
                  <span
                    className={`tabular ${
                      (s.pct ?? 0) >= 0 ? "kpi-positive" : "kpi-negative"
                    }`}
                  >
                    {((s.pct ?? 0) * 100).toFixed(2).replace(".", ",")}%
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
