"use client";

import { useMemo, useState } from "react";

import type { KpiArtifact, PricesArtifact } from "@/lib/data";
import { buildFrontier, type PortfolioPoint } from "@/lib/markowitz";
import { fmtBRL, fmtNum2, fmtPctSigned, signedClass } from "@/lib/format";
import { windowStartIndex, type WindowLabel } from "@/lib/windowed";

type Universe = "ibov" | "all";

type Props = {
  prices: PricesArtifact;
  kpis: KpiArtifact;
  ibovTickers: string[]; // current IBOV constituents
};

const WINDOWS: WindowLabel[] = ["3M", "6M", "1Y", "MAX"];

export function PortfolioSuggestions({ prices, kpis, ibovTickers }: Props) {
  const [amount, setAmount] = useState<number>(10000);
  const [window, setWindow] = useState<WindowLabel>("1Y");
  const [universe, setUniverse] = useState<Universe>("ibov");
  const [longOnly, setLongOnly] = useState<boolean>(true);

  // Pick candidate universe
  const candidates = useMemo(() => {
    const all = Object.keys(prices.series);
    if (universe === "ibov") return all.filter((t) => ibovTickers.includes(t));
    return all;
  }, [prices, ibovTickers, universe]);

  // Estimate μ + Σ over chosen window with sufficient coverage
  const stats = useMemo(() => {
    const start = windowStartIndex(prices.dates, window);
    const span = prices.dates.length - start;
    if (span < 30) return null;
    // Filter to tickers with full coverage in window
    const valid = candidates.filter((t) => {
      const arr = prices.series[t];
      if (!arr) return false;
      for (let i = start; i < prices.dates.length; i++) {
        if (arr[i] == null) return false;
      }
      return true;
    });
    if (valid.length < 2) return null;

    const T = prices.dates.length - start;
    const seriesData: number[][] = []; // [ticker][t]
    for (const tk of valid) {
      const px = prices.series[tk]!;
      const r: number[] = [];
      for (let i = start + 1; i < prices.dates.length; i++) {
        r.push(Math.log(px[i]! / px[i - 1]!));
      }
      seriesData.push(r);
    }
    const Tn = seriesData[0].length;
    const n = valid.length;
    // mean
    const mean = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < Tn; t++) mean[i] += seriesData[i][t];
      mean[i] /= Tn;
    }
    // cov (sample, ddof=1)
    const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let t = 0; t < Tn; t++) {
      for (let i = 0; i < n; i++) {
        const di = seriesData[i][t] - mean[i];
        for (let j = i; j < n; j++) {
          cov[i][j] += di * (seriesData[j][t] - mean[j]);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        cov[i][j] /= Tn - 1;
        if (j !== i) cov[j][i] = cov[i][j];
      }
    }
    // annualize
    const mu = mean.map((m) => m * 252);
    const sigma = cov.map((row) => row.map((v) => v * 252));
    // light shrinkage to diagonal
    const trace = sigma.reduce((s, r, i) => s + r[i], 0) / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sigma[i][j] = 0.95 * sigma[i][j] + (i === j ? 0.05 * trace : 0);
      }
    }
    return { mu, sigma, n, Tn, tickers: valid };
  }, [prices, candidates, window]);

  const rf = kpis.cdi_global_mean ?? 0.1;

  // Build the frontier and pick 3 suggested portfolios:
  // conservative = min-variance, balanced = midway, aggressive = max-Sharpe
  const suggestions = useMemo(() => {
    if (!stats) return null;
    try {
      const r = buildFrontier(stats.mu, stats.sigma, rf, { steps: 41 });
      // Find a balanced portfolio: 50/50 between min-var and max-Sharpe
      const balanced: PortfolioPoint = {
        weights: stats.tickers.map((_, i) => 0.5 * r.minVariance.weights[i] + 0.5 * r.maxSharpe.weights[i]),
        ret: (r.minVariance.ret + r.maxSharpe.ret) / 2,
        vol: 0,
        sharpe: 0,
      };
      // recompute balanced's vol+sharpe via the matrix
      const w = balanced.weights;
      let variance = 0;
      for (let i = 0; i < w.length; i++) {
        for (let j = 0; j < w.length; j++) variance += w[i] * stats.sigma[i][j] * w[j];
      }
      balanced.vol = Math.sqrt(Math.max(0, variance));
      balanced.sharpe = balanced.vol > 0 ? (balanced.ret - rf) / balanced.vol : 0;

      let candidates = [
        { label: "Conservadora", point: r.minVariance, blurb: "menor variância — risco mínimo" },
        { label: "Balanceada", point: balanced, blurb: "meio do caminho entre mín-var e máx-Sharpe" },
        { label: "Agressiva", point: r.maxSharpe, blurb: "máximo Sharpe — melhor retorno por unidade de risco" },
      ];

      if (longOnly) {
        // Cap negative weights to 0 and renormalize per suggestion
        candidates = candidates.map((s) => {
          const w0 = s.point.weights;
          const wPos = w0.map((x) => Math.max(0, x));
          const sum = wPos.reduce((a, b) => a + b, 0) || 1;
          const normalized = wPos.map((x) => x / sum);
          // recompute ret, vol, sharpe with normalized weights
          let ret = 0;
          for (let i = 0; i < normalized.length; i++) ret += normalized[i] * stats.mu[i];
          let variance = 0;
          for (let i = 0; i < normalized.length; i++) {
            for (let j = 0; j < normalized.length; j++) {
              variance += normalized[i] * stats.sigma[i][j] * normalized[j];
            }
          }
          const vol = Math.sqrt(Math.max(0, variance));
          const sharpe = vol > 0 ? (ret - rf) / vol : 0;
          return {
            ...s,
            point: { weights: normalized, ret, vol, sharpe },
          };
        });
      }
      return candidates;
    } catch (e) {
      console.warn("frontier build failed", e);
      return null;
    }
  }, [stats, rf, longOnly]);

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-end gap-4 px-5 py-4">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-muted">Valor a investir</label>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-muted">R$</span>
            <input
              type="number"
              min={100}
              step={100}
              value={amount}
              onChange={(e) => setAmount(Math.max(100, Number(e.target.value) || 0))}
              className="w-32 rounded-md border border-border bg-[color:var(--bg-base)] px-3 py-1.5 text-sm focus:border-[color:var(--accent)] focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-muted">Janela de estimação</label>
          <div className="mt-1 inline-flex rounded-md border border-border p-0.5">
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
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-muted">Universo</label>
          <div className="mt-1 inline-flex rounded-md border border-border p-0.5">
            {(["ibov", "all"] as Universe[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUniverse(u)}
                className={`rounded-sm px-2.5 py-1 text-xs transition ${
                  universe === u
                    ? "bg-[color:var(--accent)] text-white"
                    : "text-muted hover:text-strong"
                }`}
              >
                {u === "ibov" ? "IBOV" : "Todos"}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-body">
          <input
            type="checkbox"
            checked={longOnly}
            onChange={(e) => setLongOnly(e.target.checked)}
            className="accent-[color:var(--accent)]"
          />
          long-only (sem short)
        </label>
        <div className="ml-auto text-[10px] text-muted">
          {stats
            ? `${stats.tickers.length} tickers · ${stats.Tn} dias úteis`
            : "aguardando dados…"}
        </div>
      </div>

      {!stats ? (
        <p className="text-sm text-muted">
          Sem cobertura suficiente nesta janela. Tente uma janela menor ou universo maior.
        </p>
      ) : !suggestions ? (
        <p className="text-sm text-muted">Não foi possível resolver a fronteira eficiente.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.label}
              label={s.label}
              blurb={s.blurb}
              point={s.point}
              tickers={stats.tickers}
              amount={amount}
              prices={prices}
              rf={rf}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  label,
  blurb,
  point,
  tickers,
  amount,
  prices,
  rf,
}: {
  label: string;
  blurb: string;
  point: { weights: number[]; ret: number; vol: number; sharpe: number };
  tickers: string[];
  amount: number;
  prices: PricesArtifact;
  rf: number;
}) {
  // Translate weights → number of shares using latest close
  const allocations = useMemo(() => {
    const rows: { ticker: string; weight: number; alloc: number; price: number; shares: number }[] = [];
    for (let i = 0; i < tickers.length; i++) {
      const w = point.weights[i];
      if (Math.abs(w) < 0.005) continue; // hide < 0.5%
      const series = prices.series[tickers[i]] ?? [];
      const last = [...series].reverse().find((v) => v != null) as number | undefined;
      if (last == null || last <= 0) continue;
      const alloc = w * amount;
      const shares = alloc / last;
      rows.push({ ticker: tickers[i], weight: w, alloc, price: last, shares });
    }
    return rows.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  }, [point, tickers, amount, prices]);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <div className="eyebrow">{label}</div>
        <div className="mt-1 text-xs text-muted">{blurb}</div>
      </div>
      <div className="grid grid-cols-3 gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Retorno esp.</div>
          <div className={`mt-1 text-sm font-semibold tabular ${signedClass(point.ret)}`}>
            {fmtPctSigned(point.ret)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Vol. anual</div>
          <div className="mt-1 text-sm font-semibold tabular">
            {fmtPctSigned(point.vol).replace("+", "")}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Sharpe</div>
          <div className={`mt-1 text-sm font-semibold tabular ${signedClass(point.sharpe)}`}>
            {fmtNum2(point.sharpe)}
          </div>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {allocations.slice(0, 10).map((a) => (
          <li
            key={a.ticker}
            className="grid items-center gap-3 px-5 py-2.5"
            style={{ gridTemplateColumns: "60px 1fr 80px 80px 60px" }}
          >
            <a
              href={`/ticker/${encodeURIComponent(a.ticker)}/`}
              className="mono text-sm font-semibold hover:underline"
            >
              {a.ticker.replace(/\.SA$/, "")}
            </a>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--bg-subtle)]">
              <div
                aria-hidden
                className={`absolute inset-y-0 left-0 rounded-full ${
                  a.weight >= 0 ? "bg-[color:var(--accent)]" : "bg-[color:var(--loss)]"
                }`}
                style={{ width: `${Math.min(100, Math.abs(a.weight) * 100)}%`, opacity: 0.7 }}
              />
            </div>
            <span className="text-right text-xs text-body tabular">
              {(a.weight * 100).toFixed(1)}%
            </span>
            <span className="text-right text-xs text-body tabular">{fmtBRL(a.alloc)}</span>
            <span className="text-right text-xs text-muted tabular">
              {a.shares >= 1 ? a.shares.toFixed(0) : a.shares.toFixed(2)} aç.
            </span>
          </li>
        ))}
        {allocations.length > 10 ? (
          <li className="px-5 py-2 text-[10px] text-muted">
            + {allocations.length - 10} ativos menores (não mostrados)
          </li>
        ) : null}
      </ul>
      <div className="border-t border-border px-5 py-3 text-[10px] text-muted">
        Total: {fmtBRL(amount)} · taxa livre = {(rf * 100).toFixed(2)}% (CDI médio)
      </div>
    </div>
  );
}
