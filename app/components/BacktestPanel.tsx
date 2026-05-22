"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { walkForwardBacktest, type BacktestSummary } from "@/lib/backtest";
import type { PricesArtifact } from "@/lib/data";
import { fmtAxisPct, fmtNum2, fmtPctAA, fmtPctSigned, signedClass } from "@/lib/format";

type Props = {
  tickers: string[];
  prices: PricesArtifact;
  rf: number;
  /** Optional IBOV daily log returns for benchmarking. */
  ibovDailyLogRet?: (number | null)[];
};

/**
 * Walk-forward out-of-sample backtest panel. Compares the platform's
 * Markowitz max-Sharpe portfolio against equal-weight 1/N and IBOV over
 * rolling 5-year-train / 1-quarter-test windows.
 *
 * This is the DeMiguel-Garlappi-Uppal (2009) test in miniature: if the
 * Markowitz allocator can't beat 1/N here, the user deserves to see that.
 */
export function BacktestPanel({ tickers, prices, rf, ibovDailyLogRet }: Props) {
  const [trainYears, setTrainYears] = useState<number>(5);
  const [testQuarters, setTestQuarters] = useState<number>(1);

  const X = useMemo(() => {
    const T = prices.dates.length;
    if (T < 60 || tickers.length < 2) return null;
    // Build full T×N matrix of daily log returns. Use null-safe fallback to NaN.
    const m: number[][] = [];
    for (let t = 1; t < T; t++) {
      const row: number[] = new Array(tickers.length);
      let allOk = true;
      for (let i = 0; i < tickers.length; i++) {
        const px = prices.series[tickers[i]];
        if (!px) {
          allOk = false;
          break;
        }
        const p1 = px[t];
        const p0 = px[t - 1];
        if (p1 != null && p0 != null && p0 > 0 && p1 > 0) {
          row[i] = Math.log(p1 / p0);
        } else {
          row[i] = NaN;
        }
      }
      if (allOk) m.push(row);
    }
    // Drop rows with any NaN (require coterminous observations across tickers)
    return m.filter((row) => row.every((v) => Number.isFinite(v)));
  }, [prices, tickers]);

  const dates = useMemo(() => prices.dates.slice(1).slice(-(X?.length ?? 0)), [prices, X]);

  const result = useMemo(() => {
    if (!X || X.length < 252) return null;
    return walkForwardBacktest({
      X,
      dates,
      benchmark: ibovDailyLogRet?.slice(1).slice(-X.length),
      trainDays: trainYears * 252,
      testDays: testQuarters * 63,
      rf,
    });
  }, [X, dates, trainYears, testQuarters, rf, ibovDailyLogRet]);

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.series.map((p) => ({
      date: p.date,
      Markowitz: p.markowitz * 100,
      "1/N": p.equalWeight * 100,
      B3: p.benchmark != null ? p.benchmark * 100 : null,
    }));
  }, [result]);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <span className="eyebrow">Backtest out-of-sample</span>
          <span className="ml-3 text-[10px] uppercase tracking-wider text-muted">
            walk-forward · {result?.trainDays ?? trainYears * 252}d treino /{" "}
            {result?.testDays ?? testQuarters * 63}d teste · vs 1/N (DeMiguel-Garlappi-Uppal 2009)
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-body">
          <label className="flex items-center gap-1">
            treino:
            <select
              value={trainYears}
              onChange={(e) => setTrainYears(Number(e.target.value))}
              className="rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-xs"
            >
              <option value={3}>3 anos</option>
              <option value={5}>5 anos</option>
              <option value={10}>10 anos</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            teste:
            <select
              value={testQuarters}
              onChange={(e) => setTestQuarters(Number(e.target.value))}
              className="rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-xs"
            >
              <option value={1}>1 trim.</option>
              <option value={2}>2 trim.</option>
              <option value={4}>1 ano</option>
            </select>
          </label>
        </div>
      </div>

      {!result ? (
        <div className="px-5 py-8 text-center text-sm text-muted">
          Histórico insuficiente para o backtest com esta combinação.
          {X != null ? ` (${X.length} dias úteis disponíveis, precisa de ${trainYears * 252 + testQuarters * 63}).` : ""}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 border-b border-border px-5 py-4">
            <SummaryCard label="Markowitz" data={result.markowitz} highlight />
            <SummaryCard label="1/N (equal-weight)" data={result.equalWeight} />
            {result.benchmark ? <SummaryCard label="B3" data={result.benchmark} /> : <div />}
          </div>
          <div className="p-4">
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 12, right: 20, left: 8, bottom: 28 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    stroke="var(--border)"
                    minTickGap={32}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    stroke="var(--border)"
                    tickFormatter={(v) => fmtAxisPct(v / 100)}
                    width={56}
                  />
                  <ReferenceLine y={0} stroke="var(--border-strong)" strokeDasharray="2 3" />
                  <Tooltip content={<BacktestTooltip />} cursor={{ stroke: "var(--border-strong)", strokeDasharray: "2 3" }} />
                  <Line
                    type="monotone"
                    dataKey="Markowitz"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="1/N"
                    stroke="var(--gain)"
                    strokeWidth={1.75}
                    strokeDasharray="6 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  {ibovDailyLogRet ? (
                    <Line
                      type="monotone"
                      dataKey="B3"
                      stroke="var(--muted)"
                      strokeWidth={1.5}
                      strokeDasharray="2 3"
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-center text-[10px] text-muted">
              Retorno cumulado das três estratégias rebalanceadas a cada{" "}
              {testQuarters === 4 ? "1 ano" : `${testQuarters} trim.`}
              , usando μ/Σ estimados nos{" "}
              {trainYears} anos anteriores ao período de teste.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  data,
  highlight,
}: {
  label: string;
  data: BacktestSummary;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        highlight ? "border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]" : "border-border"
      }`}
    >
      <div className="eyebrow">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
        <span className="text-muted">retorno</span>
        <span className={`text-right tabular font-semibold ${signedClass(data.retAnn)}`}>
          {fmtPctAA(data.retAnn)}
        </span>
        <span className="text-muted">vol</span>
        <span className="text-right tabular text-body">{fmtPctAA(data.volAnn).replace("+", "")}</span>
        <span className="text-muted">Sharpe</span>
        <span className={`text-right tabular font-semibold ${signedClass(data.sharpe)}`}>
          {fmtNum2(data.sharpe)}
        </span>
        <span className="text-muted">max DD</span>
        <span className="text-right tabular text-[color:var(--loss)]">
          {fmtPctSigned(data.maxDD)}
        </span>
      </div>
    </div>
  );
}

function BacktestTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 11,
        boxShadow: "0 6px 24px -8px rgba(0,0,0,0.5)",
      }}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }}>{p.dataKey}</span>
          <span className="tabular font-semibold" style={{ color: "var(--strong)" }}>
            {p.value != null ? `${p.value >= 0 ? "+" : ""}${p.value.toFixed(1).replace(".", ",")}%` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}
