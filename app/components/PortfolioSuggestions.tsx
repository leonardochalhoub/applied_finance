"use client";

import { useMemo, useState } from "react";

import { cdiMeanForWindow } from "@/lib/cdi";
import type {
  CdiArtifact,
  KpiArtifact,
  PricesArtifact,
  PricesCloseArtifact,
} from "@/lib/data";
import { buildFrontier, type PortfolioPoint } from "@/lib/markowitz";
import { fmtBRL, fmtNum2, fmtPctSigned, signedClass } from "@/lib/format";
import { windowStartIndex, type WindowLabel } from "@/lib/windowed";

type Universe = "ibov" | "all";

type Props = {
  prices: PricesArtifact;
  closes: PricesCloseArtifact | null;
  kpis: KpiArtifact;
  cdi: CdiArtifact | null;
  ibovTickers: string[];
};

const WINDOWS: WindowLabel[] = ["3M", "6M", "1Y", "MAX"];

type Suggestion = {
  label: string;
  blurb: string;
  point: PortfolioPoint;
};

export function PortfolioSuggestions({ prices, closes, kpis, cdi, ibovTickers }: Props) {
  const [amount, setAmount] = useState<number>(10000);
  const [window, setWindow] = useState<WindowLabel>("1Y");
  const [universe, setUniverse] = useState<Universe>("ibov");
  const [longOnly, setLongOnly] = useState<boolean>(true);

  const candidates = useMemo(() => {
    const all = Object.keys(prices.series);
    if (universe === "ibov") return all.filter((t) => ibovTickers.includes(t));
    return all;
  }, [prices, ibovTickers, universe]);

  // Estimate μ + Σ over chosen window with full coverage requirement
  const stats = useMemo(() => {
    const start = windowStartIndex(prices.dates, window);
    const span = prices.dates.length - start;
    if (span < 30) return null;
    const valid = candidates.filter((t) => {
      const arr = prices.series[t];
      if (!arr) return false;
      for (let i = start; i < prices.dates.length; i++) {
        if (arr[i] == null) return false;
      }
      return true;
    });
    if (valid.length < 2) return null;

    const seriesData: number[][] = [];
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
    const mean = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < Tn; t++) mean[i] += seriesData[i][t];
      mean[i] /= Tn;
    }
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
    const mu = mean.map((m) => m * 252);
    const sigma = cov.map((row) => row.map((v) => v * 252));
    // light shrinkage to diagonal for numerical stability
    const trace = sigma.reduce((s, r, i) => s + r[i], 0) / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sigma[i][j] = 0.95 * sigma[i][j] + (i === j ? 0.05 * trace : 0);
      }
    }
    return { mu, sigma, n, Tn, tickers: valid, startIdx: start };
  }, [prices, candidates, window]);

  const rf = useMemo(() => {
    if (!stats) return kpis.cdi_global_mean ?? 0.13;
    const startDate = prices.dates[stats.startIdx];
    const endDate = prices.dates[prices.dates.length - 1];
    return cdiMeanForWindow(cdi, startDate, endDate, kpis.cdi_global_mean ?? 0.13);
  }, [cdi, prices, kpis, stats]);

  // Build the suggested portfolios with proper long-only handling
  // and re-rank so labels match actual properties
  const suggestions: Suggestion[] | null = useMemo(() => {
    if (!stats) return null;
    try {
      const r = buildFrontier(stats.mu, stats.sigma, rf, {
        longOnly,
        frontierSteps: 60,
        cloudSize: 0,
      });
      // Build candidates from frontier + halfway point
      const halfwayW = r.minVariance.weights.map(
        (w, i) => 0.5 * w + 0.5 * r.maxSharpe.weights[i],
      );
      // Normalize halfway
      const hSum = halfwayW.reduce((a, b) => a + b, 0) || 1;
      const halfwayNorm = halfwayW.map((x) => x / hSum);
      let ret = 0,
        variance = 0;
      for (let i = 0; i < halfwayNorm.length; i++) ret += halfwayNorm[i] * stats.mu[i];
      for (let i = 0; i < halfwayNorm.length; i++) {
        for (let j = 0; j < halfwayNorm.length; j++) {
          variance += halfwayNorm[i] * stats.sigma[i][j] * halfwayNorm[j];
        }
      }
      const halfwayVol = Math.sqrt(Math.max(0, variance));
      const halfway: PortfolioPoint = {
        weights: halfwayNorm,
        ret,
        vol: halfwayVol,
        sharpe: halfwayVol > 0 ? (ret - rf) / halfwayVol : 0,
      };

      // Collect 3 candidates and rank them — lowest vol = conservative,
      // highest Sharpe = aggressive, the remaining = balanced
      const cands: PortfolioPoint[] = [r.minVariance, halfway, r.maxSharpe];
      const conservative = cands.reduce((a, b) => (a.vol <= b.vol ? a : b));
      const aggressive = cands.reduce((a, b) => (a.sharpe >= b.sharpe ? a : b));
      const balanced = cands.find((p) => p !== conservative && p !== aggressive) ?? halfway;

      return [
        {
          label: "Conservadora",
          blurb: "menor risco · ideal para quem prioriza estabilidade",
          point: conservative,
        },
        {
          label: "Balanceada",
          blurb: "meio do caminho · equilibra retorno e risco",
          point: balanced,
        },
        {
          label: "Agressiva",
          blurb: "maior Sharpe · melhor retorno por unidade de risco",
          point: aggressive,
        },
      ];
    } catch (e) {
      console.warn("frontier build failed", e);
      return null;
    }
  }, [stats, rf, longOnly]);

  const recommended = useMemo(() => {
    if (!suggestions) return null;
    // Recommend the highest-Sharpe portfolio (textbook tangency)
    return suggestions.reduce((a, b) => (a.point.sharpe >= b.point.sharpe ? a : b));
  }, [suggestions]);

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
            ? `${stats.tickers.length} tickers · ${stats.Tn} dias úteis · CDI ${(rf * 100).toFixed(2).replace(".", ",")}%`
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
        <>
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
                closes={closes}
                rf={rf}
                window={window}
                recommended={s.label === recommended?.label}
              />
            ))}
          </div>

          {/* Recommendation explanation */}
          {recommended ? (
            <div className="card relative overflow-hidden px-6 py-5">
              <div
                aria-hidden
                className="absolute inset-0 opacity-60"
                style={{
                  background:
                    "radial-gradient(ellipse at top right, color-mix(in srgb, var(--accent) 18%, transparent), transparent 60%)",
                }}
              />
              <div className="relative">
                <div className="eyebrow">Recomendação</div>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-body">
                  Pela teoria de Markowitz, a carteira ótima é a de{" "}
                  <strong className="text-strong">máximo Sharpe</strong> — entrega o melhor
                  retorno por unidade de risco. Para esta janela e universo, isso aponta
                  a carteira{" "}
                  <strong className="text-strong">{recommended.label}</strong> (Sharpe{" "}
                  <span className="tabular">{fmtNum2(recommended.point.sharpe)}</span>,
                  retorno esperado{" "}
                  <span className={`tabular ${signedClass(recommended.point.ret)}`}>
                    {fmtPctSigned(recommended.point.ret)}
                  </span>
                  , vol{" "}
                  <span className="tabular">
                    {fmtPctSigned(recommended.point.vol).replace("+", "")}
                  </span>
                  ).
                </p>
                <p className="mt-2 max-w-3xl text-xs text-muted">
                  Caveats: (a) μ e Σ são <em>estimados</em> a partir do passado — Markowitz é
                  notoriamente sensível a erro de estimação; (b) o ranking pode mudar com a
                  janela; (c) sob restrição long-only as carteiras são aproximações
                  greedy do ótimo — para grandes universos um solver QP convexo (CVXPY-eq) é
                  recomendado. Em geral, prefira a janela mais longa (1Y/MAX) e veja se a
                  recomendação se mantém estável antes de agir.
                </p>
              </div>
            </div>
          ) : null}
        </>
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
  closes,
  rf,
  window,
  recommended,
}: {
  label: string;
  blurb: string;
  point: PortfolioPoint;
  tickers: string[];
  amount: number;
  prices: PricesArtifact;
  closes: PricesCloseArtifact | null;
  rf: number;
  window: WindowLabel;
  recommended?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [orderText, setOrderText] = useState<string | null>(null);

  // Allocations using REAL BRL closes (not the rebased series)
  const allocations = useMemo(() => {
    const rows: { ticker: string; weight: number; alloc: number; price: number; shares: number }[] = [];
    for (let i = 0; i < tickers.length; i++) {
      const w = point.weights[i];
      if (Math.abs(w) < 0.001) continue;
      const arrClose = closes?.series[tickers[i]];
      const arrNorm = prices.series[tickers[i]];
      let last: number | undefined;
      if (arrClose) {
        last = [...arrClose].reverse().find((v): v is number => v != null);
      }
      if (last == null && arrNorm) {
        // fallback — only for old artifacts without prices_close
        last = [...arrNorm].reverse().find((v): v is number => v != null);
      }
      if (last == null || last <= 0) continue;
      const alloc = w * amount;
      const shares = alloc / last;
      rows.push({ ticker: tickers[i], weight: w, alloc, price: last, shares });
    }
    return rows.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  }, [point, tickers, amount, prices, closes]);

  function buildOrderText(): string {
    const date = new Date().toLocaleDateString("pt-BR");
    const lines: string[] = [];
    lines.push(`ORDEM DE COMPRA — Carteira ${label}`);
    lines.push(`Data: ${date}`);
    lines.push(`Valor total: R$ ${amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
    lines.push(`Janela de estimação: ${window} · Taxa livre (CDI): ${(rf * 100).toFixed(2).replace(".", ",")}%`);
    lines.push(`Retorno esperado: ${fmtPctSigned(point.ret)} · Vol. anual: ${fmtPctSigned(point.vol).replace("+", "")} · Sharpe: ${fmtNum2(point.sharpe)}`);
    lines.push("");
    lines.push("ATIVO     QTD   PREÇO        TOTAL          PESO");
    lines.push("-".repeat(60));
    for (const a of allocations) {
      const qty = a.shares >= 1 ? a.shares.toFixed(0) : a.shares.toFixed(2);
      const t = a.ticker.replace(/\.SA$/, "").padEnd(8);
      const p = `R$ ${a.price.toFixed(2).replace(".", ",")}`.padEnd(12);
      const total = `R$ ${a.alloc.toFixed(2).replace(".", ",")}`.padEnd(14);
      const pct = `${(a.weight * 100).toFixed(1).replace(".", ",")}%`;
      lines.push(`${t} ${qty.padStart(5)} ${p} ${total} ${pct}`);
    }
    lines.push("-".repeat(60));
    lines.push(`Observações:`);
    lines.push(`  • Quantidades fracionárias (use o lote padrão da B3, geralmente 100 ações).`);
    lines.push(`  • Considere taxa de corretagem e custos operacionais.`);
    lines.push(`  • Markowitz é sensível a erros de estimação — revise antes de operar.`);
    return lines.join("\n");
  }

  function copyOrder() {
    const text = buildOrderText();
    setOrderText(text);
    if (typeof window !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }

  const visible = showAll ? allocations : allocations.slice(0, 10);

  return (
    <div
      className={`card overflow-hidden ${
        recommended ? "ring-2 ring-[color:var(--accent)]/50" : ""
      }`}
    >
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="eyebrow">{label}</div>
          {recommended ? (
            <span className="chip" style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)" }}>
              recomendada
            </span>
          ) : null}
        </div>
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
        {visible.map((a) => (
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
              {(a.weight * 100).toFixed(1).replace(".", ",")}%
            </span>
            <span className="text-right text-xs text-body tabular">{fmtBRL(a.alloc)}</span>
            <span className="text-right text-xs text-muted tabular">
              {a.shares >= 1 ? a.shares.toFixed(0) : a.shares.toFixed(2)} aç.
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <div className="text-[10px] text-muted">
          {allocations.length > 10 ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="hover:text-strong"
            >
              {showAll ? "ocultar menores" : `mostrar todos (${allocations.length})`}
            </button>
          ) : (
            <span>{allocations.length} ativos</span>
          )}
        </div>
        <button
          type="button"
          onClick={copyOrder}
          className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          Gerar ordem
        </button>
      </div>

      {orderText ? (
        <div className="border-t border-border bg-[color:var(--bg-subtle)] px-5 py-4">
          <div className="mb-1 flex items-center justify-between">
            <div className="eyebrow">Ordem copiada para o clipboard ✓</div>
            <button
              type="button"
              onClick={() => setOrderText(null)}
              className="text-[10px] text-muted hover:text-strong"
            >
              fechar
            </button>
          </div>
          <pre className="mono whitespace-pre-wrap break-words text-[10px] text-body">{orderText}</pre>
        </div>
      ) : null}
    </div>
  );
}
