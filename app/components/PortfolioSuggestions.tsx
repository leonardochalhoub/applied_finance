"use client";

import { useEffect, useMemo, useState } from "react";

import { cdiMeanForWindow } from "@/lib/cdi";
import type {
  CdiArtifact,
  KpiArtifact,
  PricesArtifact,
  PricesCloseArtifact,
} from "@/lib/data";
import { buildFrontier, type PortfolioPoint } from "@/lib/markowitz";
import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "@/lib/mvEstimators";
import { applyMacroAnchor, ERP_PRIOR } from "@/lib/shrinkage";
import { fmtBRL, fmtNum2, fmtPctSigned, signedClass } from "@/lib/format";
import { withBase } from "@/lib/links";
import { windowStartIndex, type WindowLabel } from "@/lib/windowed";

type Universe = "ibov" | "all";

/** Snapshot emitted to the parent so the FrontierChart can use Sugestões'
 *  μ/Σ as a stable reference frame even before any JSON is imported. */
export type ReferenceStats = {
  tickers: string[];
  mu: number[];
  sigma: number[][];
  rf: number;
  window: WindowLabel;
  universe: Universe;
  /** Bayes-Stein intensity ψ* applied to μ (0 = raw, 1 = grand mean only). */
  shrinkPsi?: number;
  /** Macro-prior intensity α applied to μ (toward rf + ERP). */
  shrinkAlpha?: number;
};

type Props = {
  prices: PricesArtifact;
  closes: PricesCloseArtifact | null;
  kpis: KpiArtifact;
  cdi: CdiArtifact | null;
  ibovTickers: string[];
  /** Lift the current optimisation μ/Σ up to the shell so the manual builder's
   *  chart can use it as a stable reference universe (constant cloud shape
   *  before and after import, only the marker moves). */
  onStatsChange?: (stats: ReferenceStats | null) => void;
};

const WINDOWS: WindowLabel[] = ["6M", "1Y", "5Y", "10Y", "15Y", "20Y", "MAX"];

type Suggestion = {
  label: string;
  blurb: string;
  point: PortfolioPoint;
};

export function PortfolioSuggestions({
  prices,
  closes,
  kpis,
  cdi,
  ibovTickers,
  onStatsChange,
}: Props) {
  const [amount, setAmount] = useState<number>(10000);
  // 5Y default: SE(μ̂) ∝ 1/√T, so 5y trims standard error by √5 ≈ 2.24×
  // vs. 1y. The Jorion + macro-prior layers do the rest of the work.
  const [window, setWindow] = useState<WindowLabel>("5Y");
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

    // Build X (T × N) matrix of daily log returns over the window
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
    // Transpose to T × N (rows = observations, cols = tickers) for ledoitWolf
    const X: number[][] = [];
    for (let t = 0; t < Tn; t++) {
      const row: number[] = new Array(n);
      for (let i = 0; i < n; i++) row[i] = seriesData[i][t];
      X.push(row);
    }
    // ── Ledoit-Wolf shrinkage on daily Σ ──
    const lw = ledoitWolf(X);
    // ── Sample mean of daily log returns ──
    const meanLog = new Array(n).fill(0);
    for (const row of X) {
      for (let i = 0; i < n; i++) meanLog[i] += row[i];
    }
    for (let i = 0; i < n; i++) meanLog[i] /= Tn;
    // ── Jensen correction: μ_simple ≈ μ_log + σ²/2 ──
    const meanSimpleDaily = jensenCorrectMu(meanLog, lw.sigma);
    // ── Annualize ──
    const muRaw = meanSimpleDaily.map((m) => m * 252);
    const sigmaAnnual = lw.sigma.map((row) => row.map((v) => v * 252));
    // ── Bayes-Stein / Jorion (1986) μ shrinkage toward the grand mean ──
    //
    // SE(μ̂_annual) = σ_annual / √T_years. For Brazilian equities with
    // σ ≈ 30% and a 1-year window, that's ±30% standard error on EACH
    // ticker's annual return — the cross-sectional max of N noisy estimates
    // routinely lands at +50–80% by pure luck (max-of-N order statistic).
    //
    // Shrinking toward μ_g = (𝟙ᵀΣ⁻¹μ̂)/(𝟙ᵀΣ⁻¹𝟙) with data-driven intensity
    // ψ* is the classical James-Stein remedy. For our typical (T,N) regime
    // ψ* ≈ 0.4–0.8 — the chart collapses from cartoon territory into the
    // realistic [rf, rf + σ_mkt] band where actual equity premia live.
    const js = jorionShrinkMu(muRaw, sigmaAnnual, Tn);
    // Detect data-starved window: e.g. user picks 5Y/10Y/MAX but the
    // deployed `prices_normalized.json` only spans ~1 year. In that case
    // `start = max(0, dates.length - requested)` saturates at 0 and EVERY
    // long window collapses to the same effective Tn, making the window
    // selector visually inert (5Y == 10Y == 15Y == MAX). Flag it so the
    // UI can warn the user and explain why selecting a longer window
    // doesn't change the numbers.
    const REQUIRED_DAYS: Partial<Record<WindowLabel, number>> = {
      "1M": 22, "3M": 66, "6M": 126, "1Y": 252,
      "5Y": 1260, "10Y": 2520, "15Y": 3780, "20Y": 5040,
    };
    const requestedDays = REQUIRED_DAYS[window] ?? 0;
    const availableDays = prices.dates.length - 1; // returns = dates.length - 1
    const windowClipped =
      window !== "MAX" && requestedDays > 0 && availableDays < requestedDays;

    return {
      mu: js.mu,
      muRaw,
      sigma: sigmaAnnual,
      n,
      Tn,
      tickers: valid,
      startIdx: start,
      shrinkDelta: lw.delta,
      shrinkPsi: js.psi,
      muGrand: js.muGrand,
      windowClipped,
      requestedDays,
      availableDays,
    };
  }, [prices, candidates, window]);

  const rf = useMemo(() => {
    if (!stats) return kpis.cdi_global_mean ?? 0.13;
    const startDate = prices.dates[stats.startIdx];
    const endDate = prices.dates[prices.dates.length - 1];
    return cdiMeanForWindow(cdi, startDate, endDate, kpis.cdi_global_mean ?? 0.13);
  }, [cdi, prices, kpis, stats]);

  // ── Macro-anchored second-stage shrinkage of μ ─────────────────────────
  //
  // Even after Jorion (Stage 1) pulls μ̂ toward the cross-sectional grand
  // mean μ_g, μ_g itself is a noisy estimate that inherits the max-order-
  // statistic bias (max-Sharpe always concentrates on whichever asset got
  // luckiest in-sample). Stage 2 shrinks each component of μ_BS toward the
  // *macro prior* (rf + ERP)·𝟙 — independent of the realized cross-section:
  //
  //     μ_after = (1 − α) μ_BS + α (rf + ERP) · 𝟙
  //
  // This is a hierarchical-Bayes step: the prior on μ_g is "the market
  // portfolio's expected return is rf + ERP, period." Lets the chart land
  // in the realistic [rf, rf + σ_mkt] band at every window length, not just
  // long ones.
  //
  // Stage 3 — per-asset CEILING (Black-Litterman-style sanity bound).
  // After two shrinkage stages, individual μ_i can still land above what
  // is empirically realistic for Brazilian equities:
  //   • Ibovespa long-run CAGR in BRL: ~8–11% nominal (Economatica 50y,
  //     Clube dos Poupadores 2000–2024).
  //   • Damodaran 2026 Brazil ERP: ~6% forward.
  //   • Best 5y rolling Ibovespa annualised: ~40% (and that's the *index*
  //     after the fact, not a forward expectation).
  // We therefore cap each μ_i (post-anchor) at rf + MU_CEILING_K · ERP,
  // i.e. no single asset is allowed to *expect* more than 3 equity-risk-
  // premia of excess return. With rf=13%, ERP=6%, ceiling = 31% — strictly
  // above the empirical Ibov long-run but strictly below cartoon territory.
  const effectiveStats = useMemo(() => {
    if (!stats) return null;
    const { mu: muFinal, alpha } = applyMacroAnchor(stats.mu, rf, stats.Tn);
    return { ...stats, mu: muFinal, shrinkAlpha: alpha };
  }, [stats, rf]);

  // Lift μ/Σ to the parent shell so the FrontierChart can use it as a stable
  // reference frame (constant cloud across pre/post-import) — only the marker
  // moves when the user imports or edits weights.
  useEffect(() => {
    if (!onStatsChange) return;
    if (!effectiveStats) {
      onStatsChange(null);
      return;
    }
    onStatsChange({
      tickers: effectiveStats.tickers,
      mu: effectiveStats.mu,
      sigma: effectiveStats.sigma,
      rf,
      window,
      universe,
      shrinkPsi: effectiveStats.shrinkPsi,
      shrinkAlpha: effectiveStats.shrinkAlpha,
    });
  }, [effectiveStats, rf, window, universe, onStatsChange]);

  // Build the suggested portfolios with proper long-only handling
  // and re-rank so labels match actual properties
  const suggestions: Suggestion[] | null = useMemo(() => {
    if (!effectiveStats) return null;
    try {
      const r = buildFrontier(effectiveStats.mu, effectiveStats.sigma, rf, {
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
      for (let i = 0; i < halfwayNorm.length; i++) ret += halfwayNorm[i] * effectiveStats.mu[i];
      for (let i = 0; i < halfwayNorm.length; i++) {
        for (let j = 0; j < halfwayNorm.length; j++) {
          variance += halfwayNorm[i] * effectiveStats.sigma[i][j] * halfwayNorm[j];
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
  }, [effectiveStats, rf, longOnly]);

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
            <BrlAmountInput value={amount} onChange={(v) => setAmount(Math.max(100, v))} />
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
                {u === "ibov" ? "B3" : "Todos"}
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
        <div className="ml-auto text-right text-[10px] text-muted">
          {stats && effectiveStats ? (
            <>
              <div>
                {stats.tickers.length} tickers · {stats.Tn} dias úteis · CDI{" "}
                {(rf * 100).toFixed(2).replace(".", ",")}%
              </div>
              <div
                className="mt-0.5"
                title={
                  "Shrinkage data-driven em Σ (Ledoit-Wolf 2004) + duas " +
                  "camadas em μ: ψ* Jorion (Bayes-Stein, dispersão sobre Σ⁻¹) " +
                  `e α macro-anchor toward rf + ERP=${(ERP_PRIOR * 100).toFixed(0)}%.`
                }
              >
                shrink Σ δ*={(stats.shrinkDelta * 100).toFixed(1).replace(".", ",")}% ·{" "}
                μ ψ*={(stats.shrinkPsi * 100).toFixed(0)}% · α={(effectiveStats.shrinkAlpha * 100).toFixed(0)}%
              </div>
            </>
          ) : (
            "aguardando dados…"
          )}
        </div>
      </div>
      {stats?.windowClipped ? (
        <div
          className="mt-3 rounded-md border border-[color:var(--loss)]/40 bg-[color:var(--loss)]/8 px-4 py-2 text-xs text-strong"
          role="alert"
        >
          <strong className="text-[color:var(--loss)]">
            Janela {window} solicitada · apenas {stats.availableDays} dias úteis disponíveis
          </strong>{" "}
          ({(stats.availableDays / 252).toFixed(1)} anos vs ~{(stats.requestedDays / 252).toFixed(0)} pedidos).
          O seletor de janelas mais longas que isso retorna o mesmo dataset
          e portanto a mesma carteira max-Sharpe. Aguarde o próximo refresh
          do pipeline (full-history em <span className="mono">prices_normalized.json</span>)
          para diferenciação real entre 5Y / 10Y / 15Y / 20Y / MAX.
        </div>
      ) : null}

      {!effectiveStats ? (
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
                tickers={effectiveStats.tickers}
                mu={effectiveStats.mu}
                sigma={effectiveStats.sigma}
                amount={amount}
                prices={prices}
                closes={closes}
                rf={rf}
                window={window}
                recommended={s.label === recommended?.label}
              />
            ))}
          </div>

          {/* Fronteira eficiente é renderizada uma única vez, dentro do construtor manual abaixo */}

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

/**
 * Money-masked input that displays values in pt-BR format (10.000,00) and
 * accepts any combination of digits/comma/dot the user types. Internal state
 * is the raw string so the cursor doesn't jump on every keystroke.
 */
function BrlAmountInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const fmt = useMemo(
    () =>
      new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );

  const [text, setText] = useState<string>(() => fmt.format(value));
  const [focused, setFocused] = useState(false);

  // Sync display when external value changes and the input isn't being edited.
  useEffect(() => {
    if (!focused) setText(fmt.format(value));
  }, [value, fmt, focused]);

  function parseBrl(s: string): number {
    // Strip thousands separators (.), convert decimal comma → dot.
    const cleaned = s.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        setFocused(true);
        // Show raw number on focus so user can type cleanly
        setText(value > 0 ? String(value).replace(".", ",") : "");
        // Select all to make replacement easy
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => {
        // Allow digits, commas, dots only
        const raw = e.target.value.replace(/[^\d,.]/g, "");
        setText(raw);
        const n = parseBrl(raw);
        onChange(n);
      }}
      onBlur={() => {
        setFocused(false);
        setText(fmt.format(Math.max(100, value)));
      }}
      className="w-36 rounded-md border border-border bg-[color:var(--bg-base)] px-3 py-1.5 text-right tabular text-sm focus:border-[color:var(--accent)] focus:outline-none"
      placeholder="10.000,00"
    />
  );
}

function SuggestionCard({
  label,
  blurb,
  point,
  tickers,
  mu,
  sigma,
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
  mu: number[];
  sigma: number[][];
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

  function downloadJSON() {
    if (typeof window === "undefined") return;
    // Build a {ticker: weight} map aligned with the suggestion's allocations.
    // Schema matches PortfolioBuilder's "Importar JSON" exactly so the file
    // can be re-imported with no edits.
    const weightsMap: Record<string, number> = {};
    for (let i = 0; i < tickers.length; i++) {
      const w = point.weights[i];
      if (w == null || Math.abs(w) < 0.0001) continue;
      weightsMap[tickers[i]] = w;
    }
    // Renormalize to sum to 1 in case rounding/filtering shifted it
    const sum = Object.values(weightsMap).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      Object.keys(weightsMap).forEach((k) => (weightsMap[k] = +(weightsMap[k] / sum).toFixed(6)));
    }

    // Snapshot the FULL μ/Σ universe used in the original optimisation —
    // tickers, μ and Σ for every asset that participated, not just the ones
    // that ended up with positive weight. This lets PortfolioBuilder rebuild
    // the SAME efficient frontier (same green star, same scatter cloud) so
    // the imported diamond lands precisely on the tangency. Storing only the
    // non-zero sub-matrix collapses the universe to ~8 assets, which produces
    // a compressed top-right curve instead of the original frontier shape.
    const payload = {
      schema: "applied-finance.portfolio.v1",
      name: `Sugestão · ${label}`,
      exportedAt: new Date().toISOString(),
      weights: weightsMap,
      meta: {
        source: "PortfolioSuggestions",
        window,
        amount_brl: amount,
        ret_annual: point.ret,
        vol_annual: point.vol,
        sharpe: point.sharpe,
        cdi: rf,
        snapshot: {
          tickers,
          mu,
          sigma,
          rf,
        },
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `applied-finance-sugestao-${label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          <div
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted"
            title="Estimativa in-sample após a stack de shrinkage (Ledoit-Wolf Σ, Jensen, Jorion, macro-anchor). Não é uma previsão de retorno futuro."
          >
            Retorno esp.
            <span aria-hidden className="cursor-help opacity-70">ⓘ</span>
          </div>
          <div className={`mt-1 text-sm font-semibold tabular ${signedClass(point.ret)}`}>
            {fmtPctSigned(point.ret)}
          </div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted opacity-70">
            in-sample · não é previsão
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
              href={withBase(`/ticker/${encodeURIComponent(a.ticker)}/`)}
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
      {allocations.length > 0 ? (
        <div
          className="grid items-center gap-3 border-t border-border bg-[color:var(--bg-subtle)]/40 px-5 py-2 text-xs"
          style={{ gridTemplateColumns: "60px 1fr 80px 80px 60px" }}
        >
          <span className="text-[10px] uppercase tracking-wider text-muted">Total</span>
          <span />
          <span className="text-right font-semibold tabular text-strong">
            {(allocations.reduce((s, a) => s + a.weight, 0) * 100)
              .toFixed(1)
              .replace(".", ",")}
            %
          </span>
          <span className="text-right font-semibold tabular text-strong">
            {fmtBRL(allocations.reduce((s, a) => s + a.alloc, 0))}
          </span>
          <span />
        </div>
      ) : null}

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadJSON}
            title="Baixar carteira em JSON — pronta para reimportar no construtor manual"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-strong hover:bg-[color:var(--bg-subtle)]"
          >
            Gerar JSON
          </button>
          <button
            type="button"
            onClick={copyOrder}
            className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Gerar ordem
          </button>
        </div>
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
