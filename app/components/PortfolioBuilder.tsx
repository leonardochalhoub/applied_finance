"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { cdiMeanForWindow } from "@/lib/cdi";
import type { CdiArtifact, KpiArtifact, PricesArtifact } from "@/lib/data";
import { buildFrontier, evaluatePortfolio, type FrontierResult } from "@/lib/markowitz";
import { decodeConfig, encodeConfig } from "@/lib/urlState";
import { fmtAxisPct, fmtNum2, fmtPctSigned } from "@/lib/format";

type Props = {
  prices: PricesArtifact;
  kpis: KpiArtifact;
  cdi?: CdiArtifact | null;
};

const DEFAULT_PICKS = ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBAS3.SA", "WEGE3.SA"];

export function PortfolioBuilder({ prices, kpis, cdi }: Props) {
  const allTickers = useMemo(() => Object.keys(prices.series).sort(), [prices]);

  // ── State ───────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");

  // Initialize from URL ?p= or defaults
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const cfg = decodeConfig(params.get("p"));
    if (cfg) {
      const picks = cfg.picks.filter((p) => allTickers.includes(p.t));
      setSelected(picks.map((p) => p.t));
      const w: Record<string, number> = {};
      picks.forEach((p) => (w[p.t] = p.w));
      setWeights(w);
    } else {
      const init = DEFAULT_PICKS.filter((t) => allTickers.includes(t));
      setSelected(init);
      const w: Record<string, number> = {};
      init.forEach((t) => (w[t] = 1 / init.length));
      setWeights(w);
    }
  }, [allTickers]);

  // ── Derived: estimate μ + Σ from price series ───────────────────────────
  const stats = useMemo(() => {
    if (selected.length < 2) return null;
    const T = prices.dates.length;
    if (T < 60) return null;
    // Daily log returns per selected ticker
    const seriesData: number[][] = []; // [ticker][t]
    for (const tk of selected) {
      const px = prices.series[tk];
      if (!px) return null;
      const r: number[] = [];
      for (let i = 1; i < T; i++) {
        const p1 = px[i];
        const p0 = px[i - 1];
        if (p1 != null && p0 != null && p0 > 0 && p1 > 0) {
          r.push(Math.log(p1 / p0));
        } else {
          r.push(NaN);
        }
      }
      seriesData.push(r);
    }
    // Filter rows where any ticker is NaN (coterminous obs)
    const len = seriesData[0].length;
    const okRows: number[] = [];
    for (let t = 0; t < len; t++) {
      let ok = true;
      for (const arr of seriesData) {
        if (!Number.isFinite(arr[t])) {
          ok = false;
          break;
        }
      }
      if (ok) okRows.push(t);
    }
    if (okRows.length < 30) return null;

    const n = selected.length;
    const X: number[][] = []; // [t][i]
    for (const t of okRows) {
      const row: number[] = new Array(n);
      for (let i = 0; i < n; i++) row[i] = seriesData[i][t];
      X.push(row);
    }
    const Tn = X.length;
    // Mean
    const mean = new Array(n).fill(0);
    for (const row of X) {
      for (let i = 0; i < n; i++) mean[i] += row[i];
    }
    for (let i = 0; i < n; i++) mean[i] /= Tn;
    // Covariance (sample, ddof=1)
    const cov: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(0);
      cov.push(row);
    }
    for (const r of X) {
      for (let i = 0; i < n; i++) {
        const di = r[i] - mean[i];
        for (let j = i; j < n; j++) {
          cov[i][j] += di * (r[j] - mean[j]);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        cov[i][j] /= Tn - 1;
        if (j !== i) cov[j][i] = cov[i][j];
      }
    }
    // Annualize
    const mu = mean.map((m) => m * 252);
    const sigma = cov.map((row) => row.map((v) => v * 252));
    // small shrinkage toward diagonal to keep PSD on small N (1%)
    const trace = sigma.reduce((s, r, i) => s + r[i], 0) / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sigma[i][j] = 0.99 * sigma[i][j] + (i === j ? 0.01 * trace : 0);
      }
    }
    return { mu, sigma, n, Tn };
  }, [selected, prices]);

  const rf = useMemo(() => {
    const startDate = prices.dates[0];
    const endDate = prices.dates[prices.dates.length - 1];
    return cdiMeanForWindow(cdi, startDate, endDate, kpis.cdi_global_mean ?? 0.13);
  }, [cdi, prices, kpis]);

  // ── Markowitz frontier (unconstrained closed-form + MC cloud) ──────────
  const frontierResult: FrontierResult | null = useMemo(() => {
    if (!stats) return null;
    try {
      return buildFrontier(stats.mu, stats.sigma, rf, {
        longOnly: false,
        frontierSteps: 80,
        cloudSize: 1500,
      });
    } catch (e) {
      console.warn("frontier failed", e);
      return null;
    }
  }, [stats, rf]);

  // ── User portfolio point ────────────────────────────────────────────────
  const userPoint = useMemo(() => {
    if (!stats) return null;
    const w = selected.map((t) => weights[t] ?? 0);
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) return null;
    const normalized = w.map((x) => x / sum);
    return evaluatePortfolio(normalized, stats.mu, stats.sigma, rf);
  }, [weights, selected, stats, rf]);

  // ── URL sync (push-state, no reload) ────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selected.length === 0) return;
    const totalW = selected.reduce((s, t) => s + (weights[t] ?? 0), 0);
    const picks = selected.map((t) => ({
      t,
      w: totalW > 0 ? +(((weights[t] ?? 0) / totalW)).toFixed(6) : 0,
    }));
    const cfg = encodeConfig({ v: 1, picks });
    const url = new URL(window.location.href);
    url.searchParams.set("p", cfg);
    window.history.replaceState(null, "", url.toString());
  }, [selected, weights]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const filteredTickers = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? allTickers.filter((t) => t.includes(q)) : allTickers;
  }, [query, allTickers]);

  function addTicker(t: string) {
    if (selected.includes(t)) return;
    if (selected.length >= 12) return;
    const newSel = [...selected, t];
    setSelected(newSel);
    setWeights((prev) => {
      const next = { ...prev };
      next[t] = 1 / newSel.length;
      const equal = 1 / newSel.length;
      newSel.forEach((s) => (next[s] = equal));
      return next;
    });
  }

  function removeTicker(t: string) {
    const newSel = selected.filter((s) => s !== t);
    setSelected(newSel);
    setWeights((prev) => {
      const next = { ...prev };
      delete next[t];
      const equal = 1 / Math.max(1, newSel.length);
      newSel.forEach((s) => (next[s] = equal));
      return next;
    });
  }

  function setWeight(t: string, value: number) {
    setWeights((prev) => ({ ...prev, [t]: Math.max(0, value) }));
  }

  function loadFrontierPortfolio(point: { weights: number[] }) {
    const next: Record<string, number> = {};
    selected.forEach((t, i) => (next[t] = Math.max(0, point.weights[i])));
    const sum = Object.values(next).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      Object.keys(next).forEach((k) => (next[k] = next[k] / sum));
    }
    setWeights(next);
  }

  function equalize() {
    const w: Record<string, number> = {};
    const eq = 1 / Math.max(1, selected.length);
    selected.forEach((t) => (w[t] = eq));
    setWeights(w);
  }

  function copyShareLink() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href);
  }

  // ── Chart data ──────────────────────────────────────────────────────────
  const frontierData = (frontierResult?.frontier ?? []).map((p) => ({
    vol: p.vol,
    ret: p.ret,
  }));
  const mvPoint = frontierResult ? [{ vol: frontierResult.minVariance.vol, ret: frontierResult.minVariance.ret }] : [];
  const msPoint = frontierResult ? [{ vol: frontierResult.maxSharpe.vol, ret: frontierResult.maxSharpe.ret }] : [];
  const userPointData = userPoint ? [{ vol: userPoint.vol, ret: userPoint.ret }] : [];

  return (
    <div className="space-y-6">
      {/* ── Controls + ticker picker ─────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="card overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ticker para adicionar…"
              className="w-full rounded-md border border-border bg-[color:var(--bg-base)] px-3 py-1.5 text-sm placeholder:text-muted focus:border-[color:var(--accent)] focus:outline-none"
            />
            <div className="mt-2 text-[10px] uppercase tracking-wider text-muted">
              {selected.length}/12 selecionados · taxa livre = CDI {(rf * 100).toFixed(2)}%
            </div>
          </div>
          <ul className="max-h-[420px] divide-y divide-border overflow-auto">
            {filteredTickers.slice(0, 200).map((t) => {
              const active = selected.includes(t);
              return (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => (active ? removeTicker(t) : addTicker(t))}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left text-xs transition ${
                      active ? "bg-[color:var(--bg-subtle)]" : "hover:bg-[color:var(--bg-subtle)]"
                    }`}
                  >
                    <span className="mono text-strong">{t.replace(/\.SA$/, "")}</span>
                    <span className={`text-[10px] ${active ? "text-loss" : "text-muted"}`}>
                      {active ? "remover" : "adicionar"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="space-y-4">
          {/* Weights table */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="eyebrow">Pesos da carteira</span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={equalize}
                  className="rounded-md border border-border px-2.5 py-1 text-muted hover:text-strong"
                >
                  Equal-weight
                </button>
                {frontierResult ? (
                  <>
                    <button
                      type="button"
                      onClick={() => loadFrontierPortfolio(frontierResult.minVariance)}
                      className="rounded-md border border-border px-2.5 py-1 text-muted hover:text-strong"
                    >
                      Min variance
                    </button>
                    <button
                      type="button"
                      onClick={() => loadFrontierPortfolio(frontierResult.maxSharpe)}
                      className="rounded-md border border-border px-2.5 py-1 text-muted hover:text-strong"
                    >
                      Max Sharpe
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={copyShareLink}
                  className="rounded-md bg-[color:var(--accent)] px-2.5 py-1 text-white"
                >
                  Copiar link
                </button>
              </div>
            </div>
            {selected.length === 0 ? (
              <div className="p-5 text-sm text-muted">
                Selecione tickers ao lado para montar a carteira.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {selected.map((t) => {
                  const w = weights[t] ?? 0;
                  const totalW = selected.reduce((s, x) => s + (weights[x] ?? 0), 0);
                  const display = totalW > 0 ? w / totalW : 0;
                  return (
                    <li key={t} className="grid items-center gap-4 px-5 py-3"
                      style={{ gridTemplateColumns: "96px 1fr 80px 28px" }}
                    >
                      <span className="mono text-sm font-semibold">
                        {t.replace(/\.SA$/, "")}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={Math.min(1, Math.max(0, w))}
                        onChange={(e) => setWeight(t, parseFloat(e.target.value))}
                        className="accent-[color:var(--accent)]"
                      />
                      <span className="text-right text-sm tabular">
                        {(display * 100).toFixed(1)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => removeTicker(t)}
                        className="text-muted hover:text-loss"
                        aria-label={`Remover ${t}`}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Summary KPIs */}
          {userPoint && frontierResult ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SummaryCard label="Retorno esp. (anual)" value={fmtPctSigned(userPoint.ret)} positive={userPoint.ret >= 0} />
              <SummaryCard label="Volatilidade (anual)" value={fmtPctSigned(userPoint.vol).replace("+", "")} muted />
              <SummaryCard label="Sharpe vs CDI" value={fmtNum2(userPoint.sharpe)} positive={userPoint.sharpe >= 0} />
              <SummaryCard
                label="Sharpe máx. (frontier)"
                value={fmtNum2(frontierResult.maxSharpe.sharpe)}
                muted
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Efficient frontier chart (closed-form hyperbola + MC cloud) ──── */}
      {frontierResult ? (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div>
              <span className="eyebrow">Fronteira eficiente</span>
              <span className="ml-3 text-[10px] uppercase tracking-wider text-muted">
                σ × E[r] · {stats?.Tn ?? 0} dias úteis · {stats?.n ?? 0} ativos
              </span>
            </div>
            {/* Inline legend (no overlap with axis label) */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-body">
              <LegendDot color="var(--muted)" /> nuvem aleatória
              <LegendDot color="var(--accent)" line /> fronteira
              <LegendDot color="var(--muted)" shape="circle-outline" /> mín. variância
              <LegendDot color="var(--gain)" shape="star" /> máx. Sharpe
              <LegendDot color="var(--loss)" shape="diamond" /> sua carteira
            </div>
          </div>
          <div className="p-4">
            <div style={{ width: "100%", height: 420 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 12, right: 20, left: 12, bottom: 36 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="vol"
                    name="vol"
                    label={{
                      value: "Volatilidade anualizada (σ)",
                      position: "insideBottom",
                      offset: -10,
                      fill: "var(--muted)",
                      fontSize: 11,
                    }}
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    stroke="var(--border)"
                    tickFormatter={fmtAxisPct}
                  />
                  <YAxis
                    type="number"
                    dataKey="ret"
                    name="ret"
                    label={{
                      value: "Retorno esperado E[r]",
                      angle: -90,
                      position: "insideLeft",
                      fill: "var(--muted)",
                      fontSize: 11,
                    }}
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    stroke="var(--border)"
                    tickFormatter={fmtAxisPct}
                    width={60}
                  />
                  <ZAxis range={[12, 12]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--strong)",
                    }}
                    formatter={(value: unknown, name: string) =>
                      typeof value === "number"
                        ? [fmtAxisPct(value), name === "vol" ? "Vol" : "Retorno"]
                        : [value as string, name]
                    }
                  />
                  {/* Monte Carlo cloud — low opacity dots */}
                  <Scatter
                    name="cloud"
                    data={frontierResult.cloud}
                    fill="var(--muted)"
                    fillOpacity={0.25}
                    shape="circle"
                  />
                  {/* Frontier curve as a line via 'line' on a Scatter */}
                  <Scatter
                    name="frontier"
                    data={frontierData}
                    line={{ stroke: "var(--accent)", strokeWidth: 2 }}
                    lineType="joint"
                    shape={() => <g />}
                  />
                  <Scatter
                    name="min variance"
                    data={mvPoint}
                    fill="transparent"
                    stroke="var(--strong)"
                    strokeWidth={2}
                    shape="circle"
                  />
                  <Scatter name="max Sharpe" data={msPoint} fill="var(--gain)" shape="star" />
                  <Scatter
                    name="sua carteira"
                    data={userPointData}
                    fill="var(--loss)"
                    shape="diamond"
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : null}

      {frontierResult?.hasNegativeWeights ? (
        <p className="text-xs text-muted">
          ⚠ A solução analítica permite pesos negativos (short positions). Para
          long-only, será necessário um solver QP — planejado em entrega futura.
        </p>
      ) : null}

      {!stats ? (
        <p className="text-sm text-muted">
          Selecione ao menos 2 tickers com histórico suficiente para calcular a fronteira.
        </p>
      ) : null}
    </div>
  );
}

function LegendDot({
  color,
  line,
  shape = "dot",
}: {
  color: string;
  line?: boolean;
  shape?: "dot" | "circle-outline" | "star" | "diamond";
}) {
  if (line) {
    return (
      <span aria-hidden className="inline-flex items-center gap-1">
        <span
          className="inline-block h-[2px] w-4 rounded-full"
          style={{ background: color }}
        />
      </span>
    );
  }
  if (shape === "circle-outline") {
    return (
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full border-2"
        style={{ borderColor: color, background: "transparent" }}
      />
    );
  }
  if (shape === "star") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden style={{ display: "inline-block" }}>
        <path d="M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 20l2-7L2 9h7z" fill={color} />
      </svg>
    );
  }
  if (shape === "diamond") {
    return (
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rotate-45"
        style={{ background: color }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: color }}
    />
  );
}

function SummaryCard({
  label,
  value,
  positive,
  muted,
}: {
  label: string;
  value: string;
  positive?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold tabular ${
          muted ? "text-strong" : positive ? "kpi-positive" : "kpi-negative"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
