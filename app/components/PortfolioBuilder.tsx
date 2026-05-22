"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { analyze, type AdvisorReport } from "@/lib/advisor";
import { cdiMeanForWindow } from "@/lib/cdi";
import type { CdiArtifact, KpiArtifact, PricesArtifact } from "@/lib/data";
import { buildFrontier, evaluatePortfolio, type FrontierResult } from "@/lib/markowitz";
import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "@/lib/mvEstimators";
import { bootstrapMaxSharpe } from "@/lib/bootstrap";

import { BacktestPanel } from "./BacktestPanel";
import { RiskDecompositionPanel } from "./RiskDecompositionPanel";
import { decodeConfig, encodeConfig } from "@/lib/urlState";
import { fmtNum2, fmtPctSigned, signedClass } from "@/lib/format";
import { withBase } from "@/lib/links";
import type { ReferenceStats } from "./PortfolioSuggestions";

type Preset = "equal" | "minvar" | "maxsharpe" | null;


export type ChartSnapshot = {
  mu: number[];
  sigma: number[][];
  rf: number;
  tickers: string[];
  userPoint: { vol: number; ret: number; sharpe: number; weights: number[] };
  comparePoint?: { vol: number; ret: number; sharpe: number; weights: number[]; label: string } | null;
  caption: string;
};

type Props = {
  prices: PricesArtifact;
  kpis: KpiArtifact;
  cdi?: CdiArtifact | null;
  externalWeights?: Record<string, number> | null;
  /** μ/Σ from the Sugestões section. Used as a stable reference frame for
   *  the chart when the user has not explicitly imported a snapshot. */
  referenceStats?: ReferenceStats | null;
  /** Emits chart-ready data so the parent can render the frontier chart
   *  in a position of its choosing (e.g. between sections). */
  onChartData?: (snap: ChartSnapshot | null) => void;
};

const DEFAULT_PICKS = ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBAS3.SA", "WEGE3.SA"];

type ImportedPortfolio = {
  name: string;
  weights: Record<string, number>;
};

type SnapshotStats = {
  tickers: string[];
  mu: number[];
  sigma: number[][];
  rf: number;
};

export function PortfolioBuilder({
  prices,
  kpis,
  cdi,
  externalWeights,
  referenceStats,
  onChartData,
}: Props) {
  const allTickers = useMemo(() => Object.keys(prices.series).sort(), [prices]);

  const [selected, setSelected] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [activePreset, setActivePreset] = useState<Preset>(null);
  const [imported, setImported] = useState<ImportedPortfolio | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotStats | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Adopt external weights (e.g. from a frontier click in Sugestões)
  useEffect(() => {
    if (!externalWeights) return;
    const validKeys = Object.keys(externalWeights).filter((t) => allTickers.includes(t));
    if (validKeys.length === 0) return;
    const next: Record<string, number> = {};
    validKeys.forEach((t) => (next[t] = externalWeights[t]));
    const sum = Object.values(next).reduce((a, b) => a + b, 0);
    if (sum > 0) Object.keys(next).forEach((k) => (next[k] = next[k] / sum));
    setSelected(validKeys);
    setWeights(next);
    setActivePreset(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  }, [externalWeights, allTickers]);

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
      setActivePreset(null);
    } else {
      const init = DEFAULT_PICKS.filter((t) => allTickers.includes(t));
      setSelected(init);
      const w: Record<string, number> = {};
      init.forEach((t) => (w[t] = 1 / init.length));
      setWeights(w);
      setActivePreset("equal");
    }
  }, [allTickers]);

  // ── Derived: estimate μ + Σ from price series ───────────────────────────
  // Priority order for the chart's μ/Σ:
  //  1. Explicit snapshot (user imported a Sugestão JSON) — exact original
  //     coordinate frame, marker lands on its tangency.
  //  2. referenceStats from PortfolioSuggestions — stable reference universe
  //     so the cloud shape is constant pre/post-import; only the marker
  //     moves when the user edits weights or imports a JSON.
  //  3. Live local computation over `selected` only — last resort, e.g. when
  //     Sugestões hasn't loaded yet or the user has selected tickers outside
  //     the reference universe.
  //
  // In (1) and (2), stats.tickers can be a superset of `selected`. The slider
  // UI iterates `selected`, but userPoint zero-pads weights against
  // stats.tickers (see below) so the math aligns with mu/sigma rows.
  const stats = useMemo(() => {
    if (selected.length < 2) return null;
    if (snapshot) {
      const allInSnap = selected.every((t) => snapshot.tickers.includes(t));
      if (allInSnap) {
        return {
          mu: snapshot.mu,
          sigma: snapshot.sigma,
          n: snapshot.tickers.length,
          Tn: 252,
          tickers: snapshot.tickers.slice(),
        };
      }
      // selected drifted outside the snapshot universe → fall through to live
      // recomputation. We also release the snapshot via the effect below so
      // the UI reflects the change.
    }
    if (referenceStats) {
      const allInRef = selected.every((t) => referenceStats.tickers.includes(t));
      if (allInRef) {
        return {
          mu: referenceStats.mu,
          sigma: referenceStats.sigma,
          n: referenceStats.tickers.length,
          Tn: 252,
          tickers: referenceStats.tickers.slice(),
        };
      }
      // User picked a ticker outside the reference universe (e.g. non-IBOV
      // name when Sugestões is set to "IBOV"). Fall through to live local
      // computation so the marker still reflects the full picks.
    }
    const T = prices.dates.length;
    if (T < 60) return null;
    const seriesData: number[][] = [];
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
    const X: number[][] = [];
    for (const t of okRows) {
      const row: number[] = new Array(n);
      for (let i = 0; i < n; i++) row[i] = seriesData[i][t];
      X.push(row);
    }
    const Tn = X.length;

    // ── Ledoit-Wolf shrinkage on daily Σ (data-driven δ*) ──
    const lw = ledoitWolf(X);
    const sigmaDaily = lw.sigma;

    // ── Sample mean of daily log returns ──
    const meanLog = new Array(n).fill(0);
    for (const row of X) {
      for (let i = 0; i < n; i++) meanLog[i] += row[i];
    }
    for (let i = 0; i < n; i++) meanLog[i] /= Tn;

    // ── Jensen correction: μ_simple ≈ μ_log + σ²/2 (per asset, unannualized) ──
    const meanSimpleDaily = jensenCorrectMu(meanLog, sigmaDaily);

    // ── Annualize ──
    const muRaw = meanSimpleDaily.map((m) => m * 252);
    const sigmaAnnual = sigmaDaily.map((row) => row.map((v) => v * 252));

    // ── Stage 1: Bayes-Stein / Jorion (1986) toward grand mean ───────────
    // SE(μ̂_ann) = σ_ann/√T_years is enormous for short windows — Jorion's
    // data-driven ψ* pulls μ̂ toward the cross-sectional grand mean to fight
    // the max-order-statistic upward bias.
    const js = jorionShrinkMu(muRaw, sigmaAnnual, Tn);

    // ── Stage 2: macro-anchored prior toward rf + ERP ────────────────────
    // Even after Jorion, the cross-sectional grand mean itself is biased
    // upward when the in-sample winners drag the mean with them. Pulling
    // toward (rf + ERP)·𝟙 with intensity α anchors the chart to a realistic
    // equity premium (Damodaran ERP ≈ 6% for emerging Brazil) regardless of
    // which sector rallied in the window. rf is computed inline so the
    // shrinkage is self-contained (no useMemo cascade).
    const startDate = prices.dates[okRows[0] + 1] ?? prices.dates[0];
    const endDate = prices.dates[prices.dates.length - 1];
    const rfLocal = cdiMeanForWindow(cdi, startDate, endDate, kpis.cdi_global_mean ?? 0.13);
    const ERP_PRIOR = 0.06;
    // α adaptive em T (mesma curva de PortfolioSuggestions): janelas curtas
    // recebem mais ancoragem porque o viés do máximo decai devagar.
    const yearsLocal = Math.max(0.05, Tn / 252);
    const macroPriorAlphaLocal = Math.min(
      0.95,
      Math.max(0.30, 0.90 - 0.042 * (yearsLocal - 0.5)),
    );
    const anchor = rfLocal + ERP_PRIOR;
    const muFinal = js.mu.map((m) => (1 - macroPriorAlphaLocal) * m + macroPriorAlphaLocal * anchor);

    return {
      mu: muFinal,
      sigma: sigmaAnnual,
      n,
      Tn,
      tickers: selected.slice(),
      shrinkDelta: lw.delta,
      shrinkPsi: js.psi,
      X,
    };
  }, [selected, prices, snapshot, referenceStats, cdi, kpis]);

  // Auto-release snapshot if user adds a ticker not in the original universe
  useEffect(() => {
    if (!snapshot) return;
    const allIn = selected.every((t) => snapshot.tickers.includes(t));
    if (!allIn) setSnapshot(null);
  }, [selected, snapshot]);

  // rf priority matches the stats priority: snapshot > referenceStats > local
  const rf = useMemo(() => {
    if (snapshot?.rf != null) return snapshot.rf;
    if (referenceStats?.rf != null) return referenceStats.rf;
    const startDate = prices.dates[0];
    const endDate = prices.dates[prices.dates.length - 1];
    return cdiMeanForWindow(cdi, startDate, endDate, kpis.cdi_global_mean ?? 0.13);
  }, [cdi, prices, kpis, snapshot, referenceStats]);

  const frontierResult: FrontierResult | null = useMemo(() => {
    if (!stats) return null;
    try {
      return buildFrontier(stats.mu, stats.sigma, rf, {
        longOnly: true,
        frontierSteps: 80,
        cloudSize: 1500,
      });
    } catch (e) {
      console.warn("frontier failed", e);
      return null;
    }
  }, [stats, rf]);

  const userPoint = useMemo(() => {
    if (!stats) return null;
    // weights live in {ticker: weight}, but stats.tickers may be the FULL
    // snapshot universe (a superset of `selected`). Zero-pad against
    // stats.tickers so the resulting w-vector aligns with mu/sigma rows.
    const w = stats.tickers.map((t) => weights[t] ?? 0);
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) return null;
    const normalized = w.map((x) => x / sum);
    return { ...evaluatePortfolio(normalized, stats.mu, stats.sigma, rf), weights: normalized };
  }, [weights, stats, rf]);

  // Imported portfolio (re-evaluated against this builder's μ/Σ)
  const importedPoint = useMemo(() => {
    if (!stats || !imported) return null;
    const w = stats.tickers.map((t) => imported.weights[t] ?? 0);
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) return null;
    const normalized = w.map((x) => x / sum);
    return { ...evaluatePortfolio(normalized, stats.mu, stats.sigma, rf), weights: normalized };
  }, [imported, stats, rf]);

  // Emit chart-ready data to parent (chart is rendered between sections)
  useEffect(() => {
    if (!onChartData) return;
    if (!stats || !userPoint) {
      onChartData(null);
      return;
    }
    onChartData({
      mu: stats.mu,
      sigma: stats.sigma,
      rf,
      tickers: stats.tickers,
      userPoint,
      comparePoint: importedPoint
        ? { ...importedPoint, label: imported?.name ?? "Importada" }
        : null,
      caption: `Sua carteira · ${stats.tickers.length} ativos · ${stats.Tn} dias úteis`,
    });
  }, [stats, userPoint, importedPoint, imported, rf, onChartData]);

  // Bootstrap the max-Sharpe portfolio to get per-weight noise bands.
  // Skip when in snapshot mode (no X available) or when N is huge.
  const bootstrap = useMemo(() => {
    if (!stats?.X || stats.X.length < 60) return null;
    if (stats.tickers.length > 30) return null; // keep under ~2s
    return bootstrapMaxSharpe(stats.X, rf, 80);
  }, [stats, rf]);

  const advisorReport: AdvisorReport | null = useMemo(() => {
    if (!stats || !userPoint || !frontierResult) return null;
    return analyze({
      tickers: stats.tickers,
      userWeights: userPoint.weights,
      optimalWeights: frontierResult.maxSharpe.weights,
      rf,
      mu: stats.mu,
      sigma: stats.sigma,
      userPoint,
      optimalPoint: frontierResult.maxSharpe,
      bootstrapStd: bootstrap?.weights.map((w) => w.std),
    });
  }, [stats, userPoint, frontierResult, rf, bootstrap]);

  // URL sync
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
    setWeights(() => {
      const next: Record<string, number> = {};
      const equal = 1 / newSel.length;
      newSel.forEach((s) => (next[s] = equal));
      return next;
    });
    setActivePreset("equal");
  }

  function removeTicker(t: string) {
    const newSel = selected.filter((s) => s !== t);
    setSelected(newSel);
    setWeights(() => {
      const next: Record<string, number> = {};
      const equal = 1 / Math.max(1, newSel.length);
      newSel.forEach((s) => (next[s] = equal));
      return next;
    });
    setActivePreset("equal");
  }

  function setWeight(t: string, value: number) {
    setWeights((prev) => ({ ...prev, [t]: Math.max(0, value) }));
    setActivePreset(null);
  }

  function loadFrontierPortfolio(point: { weights: number[] }, preset: Preset) {
    // point.weights aligns with stats.tickers (the optimization universe),
    // which can be a superset of `selected` when a snapshot is loaded.
    // Pick the non-zero positions, top-12 by weight (the slider UI cap), and
    // update both `selected` and `weights` so the sliders match the optimum.
    const universe = stats?.tickers ?? selected;
    const nonZero: { t: string; w: number }[] = [];
    for (let i = 0; i < universe.length; i++) {
      const w = Math.max(0, point.weights[i] ?? 0);
      if (w > 1e-4) nonZero.push({ t: universe[i], w });
    }
    nonZero.sort((a, b) => b.w - a.w);
    const top = nonZero.slice(0, 12);
    const sum = top.reduce((s, x) => s + x.w, 0);
    const next: Record<string, number> = {};
    top.forEach(({ t, w }) => (next[t] = sum > 0 ? w / sum : 0));
    setSelected(top.map((x) => x.t));
    setWeights(next);
    setActivePreset(preset);
  }

  function equalize() {
    const w: Record<string, number> = {};
    const eq = 1 / Math.max(1, selected.length);
    selected.forEach((t) => (w[t] = eq));
    setWeights(w);
    setActivePreset("equal");
  }

  function copyShareLink() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href);
  }

  function exportJSON() {
    if (typeof window === "undefined") return;
    const totalW = selected.reduce((s, t) => s + (weights[t] ?? 0), 0);
    const picks: Record<string, number> = {};
    selected.forEach((t) => {
      picks[t] = totalW > 0 ? (weights[t] ?? 0) / totalW : 0;
    });
    const payload = {
      schema: "applied-finance.portfolio.v1",
      name: "Minha carteira",
      exportedAt: new Date().toISOString(),
      weights: picks,
      meta: userPoint
        ? {
            ret_annual: userPoint.ret,
            vol_annual: userPoint.vol,
            sharpe: userPoint.sharpe,
            cdi: rf,
          }
        : undefined,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `applied-finance-portfolio-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = String(ev.target?.result ?? "");
        const obj = JSON.parse(text);
        const w = obj?.weights;
        if (!w || typeof w !== "object") throw new Error("formato inválido: 'weights' não encontrado");
        const cleaned: Record<string, number> = {};
        let sum = 0;
        for (const [t, v] of Object.entries(w)) {
          const num = Number(v);
          if (!Number.isFinite(num) || num < 0) continue;
          cleaned[t] = num;
          sum += num;
        }
        if (sum <= 0) throw new Error("pesos vazios ou todos zero");
        Object.keys(cleaned).forEach((k) => (cleaned[k] = cleaned[k] / sum));
        const name = typeof obj?.name === "string" && obj.name.trim() ? obj.name : file.name.replace(/\.json$/i, "");
        const tickersInUniverse = Object.keys(cleaned).filter((t) => allTickers.includes(t));
        if (tickersInUniverse.length === 0) {
          throw new Error("nenhum ticker do JSON está no universo atual de preços");
        }
        // Load into the builder, replacing current selection
        setSelected(tickersInUniverse);
        const newW: Record<string, number> = {};
        let renorm = 0;
        tickersInUniverse.forEach((t) => (renorm += cleaned[t]));
        tickersInUniverse.forEach((t) => (newW[t] = cleaned[t] / renorm));
        setWeights(newW);
        setActivePreset(null);
        setImported({ name, weights: newW });

        // If JSON includes a μ/Σ snapshot from the original optimisation,
        // adopt it so the imported portfolio's (vol, ret) on the rebuilt
        // frontier matches the original Sugestão exactly.
        const snap = obj?.meta?.snapshot;
        if (
          snap &&
          Array.isArray(snap.tickers) &&
          Array.isArray(snap.mu) &&
          Array.isArray(snap.sigma) &&
          snap.tickers.length === snap.mu.length &&
          snap.tickers.length === snap.sigma.length
        ) {
          // Validate snapshot tickers are a superset of the loaded weights
          const snapHasAll = tickersInUniverse.every((t: string) =>
            snap.tickers.includes(t),
          );
          if (snapHasAll) {
            setSnapshot({
              tickers: snap.tickers as string[],
              mu: snap.mu as number[],
              sigma: snap.sigma as number[][],
              rf: typeof snap.rf === "number" ? snap.rf : rf,
            });
          } else {
            setSnapshot(null);
          }
        } else {
          setSnapshot(null);
        }
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "JSON inválido");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-6">
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
              {selected.length}/12 selecionados · CDI {(rf * 100).toFixed(2).replace(".", ",")}%
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <span className="eyebrow">Pesos da carteira</span>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <PresetButton label="Equal-weight" active={activePreset === "equal"} onClick={equalize} />
                {frontierResult ? (
                  <>
                    <PresetButton
                      label="Min variance"
                      active={activePreset === "minvar"}
                      onClick={() => loadFrontierPortfolio(frontierResult.minVariance, "minvar")}
                    />
                    <PresetButton
                      label="Max Sharpe"
                      active={activePreset === "maxsharpe"}
                      onClick={() => loadFrontierPortfolio(frontierResult.maxSharpe, "maxsharpe")}
                    />
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={exportJSON}
                  className="rounded-md border border-border px-2.5 py-1 text-muted hover:text-strong"
                  title="Salvar carteira atual como JSON"
                >
                  Exportar JSON
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md border border-border px-2.5 py-1 text-muted hover:text-strong"
                  title="Importar carteira de um JSON exportado"
                >
                  Importar JSON
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportFile}
                />
                <button
                  type="button"
                  onClick={copyShareLink}
                  className="rounded-md bg-[color:var(--accent)] px-2.5 py-1 text-white"
                >
                  Copiar link
                </button>
              </div>
            </div>
            {importError ? (
              <div className="border-b border-border bg-[color:var(--bg-subtle)] px-5 py-2 text-xs text-loss">
                Erro ao importar: {importError}
              </div>
            ) : null}
            {imported ? (
              <div className="flex items-center justify-between border-b border-border bg-[color:var(--bg-subtle)] px-5 py-2 text-xs text-body">
                <span>
                  Carteira de comparação carregada: <strong className="text-strong">{imported.name}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setImported(null)}
                  className="text-muted hover:text-strong"
                >
                  remover comparação ×
                </button>
              </div>
            ) : null}
            {snapshot ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)] px-5 py-2 text-xs text-body">
                <span>
                  <strong className="text-strong">μ/Σ snapshot ativo</strong> ·
                  usando matriz de covariância exportada da Sugestão (
                  {snapshot.tickers.length} tickers) — a sua carteira pousa
                  exatamente sobre a estrela ★ original.
                </span>
                <button
                  type="button"
                  onClick={() => setSnapshot(null)}
                  className="text-muted hover:text-strong"
                  title="Recomputar μ/Σ a partir de todos os preços históricos"
                >
                  liberar snapshot ×
                </button>
              </div>
            ) : null}
            {selected.length === 0 ? (
              <div className="p-5 text-sm text-muted">
                Selecione tickers ao lado para montar a carteira.
              </div>
            ) : (
              <>
                <div
                  className="hidden border-b border-border bg-[color:var(--bg-subtle)]/40 px-5 py-2 text-[10px] uppercase tracking-wider text-muted sm:grid"
                  style={{ gridTemplateColumns: "96px 1fr 78px 60px 60px 24px", gap: "16px" }}
                >
                  <div>ticker</div>
                  <div>seu peso (slider)</div>
                  <div className="text-right">seu %</div>
                  <div className="text-right" title="Carteira ótima de mínima variância — referência">
                    min var
                  </div>
                  <div className="text-right" title="Carteira ótima de máximo Sharpe (tangência)">
                    max Sharpe
                  </div>
                  <div></div>
                </div>
                <ul className="divide-y divide-border">
                  {selected.map((t) => {
                    const w = weights[t] ?? 0;
                    const totalW = selected.reduce((s, x) => s + (weights[x] ?? 0), 0);
                    const display = totalW > 0 ? w / totalW : 0;
                    // mv/ms reference the optimal portfolios from frontierResult,
                    // whose `weights` align with stats.tickers (which may be a
                    // superset of `selected` when a snapshot is loaded). Look up
                    // by ticker, not by selected index.
                    const idxInStats = stats?.tickers.indexOf(t) ?? -1;
                    const mv = idxInStats >= 0 ? frontierResult?.minVariance.weights[idxInStats] ?? null : null;
                    const ms = idxInStats >= 0 ? frontierResult?.maxSharpe.weights[idxInStats] ?? null : null;
                    return (
                      <li
                        key={t}
                        className="grid items-center gap-4 px-5 py-3"
                        style={{ gridTemplateColumns: "96px 1fr 78px 60px 60px 24px" }}
                      >
                        <span className="mono text-sm font-semibold">{t.replace(/\.SA$/, "")}</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={Math.min(1, Math.max(0, w))}
                          onChange={(e) => setWeight(t, parseFloat(e.target.value))}
                          className="accent-[color:var(--accent)]"
                          aria-label={`Peso de ${t.replace(/\.SA$/, "")}`}
                        />
                        <PercentInput
                          value={display * 100}
                          onChange={(pct) => {
                            // Convert % → unnormalized weight. We keep other weights
                            // fixed and let the live "display" %s renormalize naturally.
                            const others = selected.filter((x) => x !== t);
                            const otherSum = others.reduce((s, x) => s + (weights[x] ?? 0), 0);
                            // Target fraction = pct/100 → new_w / (otherSum + new_w) = pct/100
                            // → new_w = (pct/100) * otherSum / (1 - pct/100)
                            const frac = Math.min(0.999, Math.max(0, pct / 100));
                            const newW =
                              frac >= 0.999 || otherSum === 0 ? 1 : (frac * otherSum) / (1 - frac);
                            setWeight(t, newW);
                          }}
                        />
                        <span className="text-right text-xs tabular text-muted">
                          {mv != null ? `${(mv * 100).toFixed(1).replace(".", ",")}%` : "—"}
                        </span>
                        <span className="text-right text-xs tabular text-muted">
                          {ms != null ? `${(ms * 100).toFixed(1).replace(".", ",")}%` : "—"}
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
                {(() => {
                  const totalW = selected.reduce((s, x) => s + (weights[x] ?? 0), 0);
                  const sumUser = totalW > 0
                    ? selected.reduce((s, x) => s + (weights[x] ?? 0) / totalW, 0)
                    : 0;
                  const sumIn = (vec?: number[]) => {
                    if (!vec || !stats) return null;
                    let s = 0;
                    for (const t of selected) {
                      const i = stats.tickers.indexOf(t);
                      if (i >= 0) s += vec[i] ?? 0;
                    }
                    return s;
                  };
                  const sumMv = sumIn(frontierResult?.minVariance.weights);
                  const sumMs = sumIn(frontierResult?.maxSharpe.weights);
                  const fmt = (x: number | null | undefined) =>
                    x == null ? "—" : `${(x * 100).toFixed(1).replace(".", ",")}%`;
                  return (
                    <div
                      className="grid items-center gap-4 border-t border-border bg-[color:var(--bg-subtle)]/40 px-5 py-2 text-xs"
                      style={{ gridTemplateColumns: "96px 1fr 78px 60px 60px 24px" }}
                    >
                      <span className="text-[10px] uppercase tracking-wider text-muted">Total</span>
                      <span />
                      <span className="text-right tabular font-semibold text-strong">
                        {fmt(sumUser)}
                      </span>
                      <span
                        className="text-right tabular text-muted"
                        title="Soma dos pesos da carteira ótima de mínima variância nos tickers selecionados (pode ser <100% em modo snapshot)"
                      >
                        {fmt(sumMv)}
                      </span>
                      <span
                        className="text-right tabular text-muted"
                        title="Soma dos pesos da carteira de máximo Sharpe nos tickers selecionados (pode ser <100% em modo snapshot)"
                      >
                        {fmt(sumMs)}
                      </span>
                      <span />
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* Summary KPIs */}
          {userPoint && frontierResult ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SummaryCard
                label="Retorno esp. (anual)"
                value={fmtPctSigned(userPoint.ret)}
                positive={userPoint.ret >= 0}
              />
              <SummaryCard
                label="Volatilidade (anual)"
                value={fmtPctSigned(userPoint.vol).replace("+", "")}
                muted
              />
              <SummaryCard
                label="Sharpe vs CDI"
                value={fmtNum2(userPoint.sharpe)}
                positive={userPoint.sharpe >= 0}
              />
              <SummaryCard
                label="Sharpe máx. (frontier)"
                value={fmtNum2(frontierResult.maxSharpe.sharpe)}
                muted
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Sector breakdown of the user's portfolio */}
      {userPoint && stats ? (
        <SectorSummaryPanel
          tickers={stats.tickers}
          weights={userPoint.weights}
          kpis={kpis}
        />
      ) : null}

      {/* Risk decomposition: per-asset RC% + top pair contributions */}
      {userPoint && stats ? (
        <RiskDecompositionPanel
          tickers={stats.tickers}
          weights={userPoint.weights}
          sigma={stats.sigma}
        />
      ) : null}

      {/* AI advisor panel */}
      {advisorReport ? <AdvisorPanel report={advisorReport} /> : null}

      {/* Walk-forward out-of-sample backtest vs 1/N (DeMiguel-Garlappi-Uppal 2009) */}
      {stats && selected.length >= 2 ? (
        <BacktestPanel
          tickers={selected}
          prices={prices}
          rf={rf}
        />
      ) : null}

      {!stats ? (
        <p className="text-sm text-muted">
          Selecione ao menos 2 tickers com histórico suficiente para calcular a fronteira.
        </p>
      ) : null}
    </div>
  );
}

function PercentInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (pct: number) => void;
}) {
  const [text, setText] = useState<string>(value.toFixed(1).replace(".", ","));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value.toFixed(1).replace(".", ","));
  }, [value, focused]);
  return (
    <div className="flex items-center justify-end gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          setFocused(true);
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d,.]/g, "").replace(",", ".");
          setText(e.target.value.replace(/[^\d,.]/g, ""));
          const n = parseFloat(raw);
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(100, n)));
        }}
        onBlur={() => {
          setFocused(false);
          setText(value.toFixed(1).replace(".", ","));
        }}
        className="w-12 rounded-md border border-border bg-[color:var(--bg-base)] px-1.5 py-0.5 text-right text-xs tabular focus:border-[color:var(--accent)] focus:outline-none"
        aria-label="Peso em porcentagem"
      />
      <span className="text-xs text-muted">%</span>
    </div>
  );
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2.5 py-1 transition ${
        active
          ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-white shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_30%,transparent)]"
          : "border-border text-muted hover:text-strong"
      }`}
    >
      {label}
      {active ? <span aria-hidden className="ml-1.5">✓</span> : null}
    </button>
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

function SectorSummaryPanel({
  tickers,
  weights,
  kpis,
}: {
  tickers: string[];
  weights: number[];
  kpis: KpiArtifact;
}) {
  const sectorByTicker = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const r of kpis.tickers) m.set(r.ticker, r.sector_b3);
    return m;
  }, [kpis]);

  const sectors = useMemo(() => {
    const agg = new Map<string, { weight: number; tickers: string[] }>();
    for (let i = 0; i < tickers.length; i++) {
      const sec = sectorByTicker.get(tickers[i]) ?? "Sem classificação";
      const w = weights[i] ?? 0;
      if (w <= 0) continue;
      const cur = agg.get(sec) ?? { weight: 0, tickers: [] };
      cur.weight += w;
      cur.tickers.push(tickers[i]);
      agg.set(sec, cur);
    }
    const total = Array.from(agg.values()).reduce((s, v) => s + v.weight, 0);
    return Array.from(agg.entries())
      .map(([sector, v]) => ({
        sector,
        weight: total > 0 ? v.weight / total : 0,
        tickers: v.tickers.sort(),
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [tickers, weights, sectorByTicker]);

  if (sectors.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <span className="eyebrow">Setores da sua carteira</span>
          <span className="ml-3 text-[10px] uppercase tracking-wider text-muted">
            {sectors.length} {sectors.length === 1 ? "setor representado" : "setores representados"}
          </span>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {sectors.map((s) => (
          <li
            key={s.sector}
            className="grid items-center gap-3 px-5 py-3"
            style={{ gridTemplateColumns: "180px 1fr 60px" }}
          >
            <span className="text-sm text-strong">{s.sector}</span>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-[color:var(--bg-subtle)]">
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--accent)]"
                style={{ width: `${Math.min(100, s.weight * 100)}%`, opacity: 0.85 }}
              />
            </div>
            <span className="text-right text-sm font-semibold tabular">
              {(s.weight * 100).toFixed(1).replace(".", ",")}%
            </span>
            <div className="col-span-3 -mt-1 ml-[180px] flex flex-wrap gap-1 pl-3">
              {s.tickers.map((t) => (
                <a
                  key={t}
                  href={withBase(`/ticker/${encodeURIComponent(t)}/`)}
                  className="mono text-[10px] rounded-md border border-border bg-[color:var(--bg-base)] px-1.5 py-0.5 text-muted hover:text-strong"
                >
                  {t.replace(/\.SA$/, "")}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div
        className="grid items-center gap-3 border-t border-border bg-[color:var(--bg-subtle)]/40 px-5 py-2 text-xs"
        style={{ gridTemplateColumns: "180px 1fr 60px" }}
      >
        <span className="text-[10px] uppercase tracking-wider text-muted">Total</span>
        <span />
        <span className="text-right font-semibold tabular text-strong">
          {(sectors.reduce((s, x) => s + x.weight, 0) * 100).toFixed(1).replace(".", ",")}%
        </span>
      </div>
    </section>
  );
}

function AdvisorPanel({ report }: { report: AdvisorReport }) {
  const verdictChip: Record<AdvisorReport["verdict"], string> = {
    forte: "bg-[color:color-mix(in_srgb,var(--gain)_22%,transparent)] text-[color:var(--gain)]",
    razoável: "bg-[color:color-mix(in_srgb,var(--accent)_22%,transparent)] text-strong",
    fraca: "bg-[color:color-mix(in_srgb,var(--loss)_22%,transparent)] text-[color:var(--loss)]",
  };

  const levelDot: Record<string, string> = {
    good: "bg-[color:var(--gain)]",
    warn: "bg-[color:var(--accent)]",
    bad: "bg-[color:var(--loss)]",
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <span className="eyebrow">Análise da carteira</span>
          <span className="ml-3 text-[10px] uppercase tracking-wider text-muted">
            análise determinística (sem LLM externo)
          </span>
        </div>
        <span className={`chip ${verdictChip[report.verdict]}`}>
          carteira {report.verdict}
        </span>
      </div>

      <div className="border-b border-border px-5 py-4">
        <p className="text-sm text-body">{report.headline}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Diag label="Sharpe atual" value={report.diagnostics.sharpeRatio.toFixed(2)} accent={report.diagnostics.sharpeRatio >= 0} />
          <Diag label="Sharpe ótimo" value={report.diagnostics.sharpeOptimal.toFixed(2)} />
          <Diag label="Gap Sharpe" value={`-${report.diagnostics.sharpeGap.toFixed(2)}`} accent={report.diagnostics.sharpeGap < 0.1} />
          <Diag
            label="Diversificação (N efetivo)"
            value={report.diagnostics.effectiveN.toFixed(1)}
            accent={report.diagnostics.effectiveN >= 4}
          />
        </div>
      </div>

      <ul className="divide-y divide-border">
        {report.recommendations.map((r, i) => (
          <li key={i} className="flex gap-3 px-5 py-3">
            <span
              aria-hidden
              className={`mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full ${levelDot[r.level]}`}
            />
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-strong">{r.title}</span>
                {r.ticker ? (
                  <a
                    href={withBase(`/ticker/${encodeURIComponent(r.ticker)}/`)}
                    className="text-[10px] uppercase tracking-wider text-muted hover:text-strong"
                  >
                    abrir {r.ticker.replace(/\.SA$/, "")} →
                  </a>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-body">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-border bg-[color:var(--bg-subtle)] px-5 py-3 text-[10px] leading-relaxed text-muted">
        <strong className="text-body">Como funciona:</strong> esta análise é{" "}
        <strong className="text-body">100% determinística</strong> e roda no seu
        navegador — não há chamadas a Groq, Llama, Gemini, OpenAI ou qualquer outro
        LLM externo. As recomendações comparam matematicamente sua alocação atual
        com a carteira de máximo Sharpe de Markowitz (computada na mesma janela
        de estimação) usando: HHI (concentração), número efetivo de ativos
        (1/Σwᵢ²), gradiente analítico do Sharpe (∂S/∂wᵢ) e a diferença ponto-a-ponto
        de pesos. Sem alucinação, totalmente reprodutível.
        <span className="block mt-1.5 italic">
          Não constitui recomendação de investimento.{" "}
          <span className={signedClass(0)} aria-hidden />
        </span>
      </div>
    </section>
  );
}

function Diag({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-base font-semibold tabular ${accent ? "kpi-positive" : "text-strong"}`}>
        {value}
      </div>
    </div>
  );
}
