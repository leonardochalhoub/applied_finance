"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { blackLitterman, type View } from "@/lib/blacklitterman";
import type { CdiArtifact, IbovArtifact, PricesArtifact } from "@/lib/data";
import { fmtAxisPct, fmtNum2, fmtPct, fmtPctAA, signedClass } from "@/lib/format";
import { buildFrontier } from "@/lib/markowitz";
import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "@/lib/mvEstimators";
import { applyMacroAnchor } from "@/lib/shrinkage";
import { buildCoterminalReturns, tightenUniverseForHistory } from "@/lib/universe";

type Props = {
  prices: PricesArtifact;
  ibov: IbovArtifact;
  cdi: CdiArtifact | null;
};

type UniverseKey = "top10" | "top15" | "top20" | "top30";

const UNIVERSE_LABELS: Record<UniverseKey, string> = {
  top10: "IBOV — 10 maiores",
  top15: "IBOV — 15 maiores",
  top20: "IBOV — 20 maiores",
  top30: "IBOV — 30 maiores",
};

const UNIVERSE_SIZES: Record<UniverseKey, number> = {
  top10: 10,
  top15: 15,
  top20: 20,
  top30: 30,
};

type ViewDraft = {
  id: string;
  tickerIdx: number;
  expectedReturn: number; // user-entered as percent, e.g. 18 means 18%
  confidence: number; // 0-1
};

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function BlackLittermanView({ prices, ibov, cdi }: Props) {
  const [universeKey, setUniverseKey] = useState<UniverseKey>("top15");
  const [windowYears, setWindowYears] = useState<number>(5);
  const [delta, setDelta] = useState<number>(2.5);
  const [tau, setTau] = useState<number>(0.05);
  const [viewDrafts, setViewDrafts] = useState<ViewDraft[]>([]);

  const rf = useMemo(() => cdi?.global_mean_annual ?? 0.13, [cdi]);

  // Universe: top-N IBOV constituents, tightened to coterminal window for Σ̂ estimation.
  const universe = useMemo(() => {
    const members = ibov.members
      .filter((m) => prices.series[m.ticker])
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const size = Math.min(UNIVERSE_SIZES[universeKey], members.length);
    const picked = members.slice(0, size);
    if (picked.length < 2) {
      return {
        tickers: [] as string[],
        labels: [] as string[],
        wMkt: [] as number[],
        startIdx: 0,
        dropped: [] as string[],
      };
    }
    const required = windowYears * 252;
    const tightened = tightenUniverseForHistory(
      prices,
      picked.map((m) => m.ticker),
      picked.map((m) => m.weight ?? 0),
      required,
    );
    const wSum = tightened.weights.reduce((a, b) => a + b, 0);
    const wMkt = wSum > 0 ? tightened.weights.map((w) => w / wSum) : null;
    // Restore the company labels for the kept tickers
    const labelByTicker = new Map(picked.map((m) => [m.ticker, m.company_name ?? m.ticker]));
    return {
      tickers: tightened.tickers,
      labels: tightened.tickers.map((t) => labelByTicker.get(t) ?? t),
      wMkt: wMkt ?? [],
      startIdx: tightened.startIdx,
      dropped: tightened.droppedForHistory,
    };
  }, [ibov, prices, universeKey, windowYears]);

  // Daily log returns matrix sliced to the chosen window.
  const fit = useMemo(() => {
    if (universe.tickers.length < 2) return null;
    const built = buildCoterminalReturns(prices, universe.tickers, universe.startIdx, null);
    if (!built) return null;
    const windowDays = windowYears * 252;
    const Xfull = built.X;
    const X = Xfull.length > windowDays ? Xfull.slice(Xfull.length - windowDays) : Xfull;
    if (X.length < 60) return null;
    const lw = ledoitWolf(X);
    const T = X.length;
    const Nlocal = X[0].length;
    const meanLog = new Array(Nlocal).fill(0);
    for (const row of X) for (let i = 0; i < Nlocal; i++) meanLog[i] += row[i];
    for (let i = 0; i < Nlocal; i++) meanLog[i] /= T;
    const meanSimple = jensenCorrectMu(meanLog, lw.sigma);
    const muSampleAnn = meanSimple.map((m) => m * 252);
    const sigAnn = lw.sigma.map((row) => row.map((v) => v * 252));
    const js = jorionShrinkMu(muSampleAnn, sigAnn, T);
    const macro = applyMacroAnchor(js.mu, rf, T);
    return {
      X,
      T,
      muSampleAnn, // raw post-Jensen/×252 (no shrinkage) — the "naive" Markowitz μ̂
      muShrunk: macro.mu, // production μ̂ used in /portfolio
      sigAnn,
      startDate: built.dates[built.dates.length - X.length] ?? built.dates[0],
      endDate: built.dates[built.dates.length - 1],
    };
  }, [universe, prices, windowYears, rf]);

  // Convert UI drafts to BL View objects (filter out garbage entries).
  const views: View[] = useMemo(() => {
    const out: View[] = [];
    for (const d of viewDrafts) {
      if (d.tickerIdx < 0 || d.tickerIdx >= universe.tickers.length) continue;
      if (!Number.isFinite(d.expectedReturn)) continue;
      out.push({
        tickerIndices: [d.tickerIdx],
        coeffs: [1],
        expectedReturn: d.expectedReturn / 100,
        confidence: Math.min(Math.max(d.confidence, 0.05), 0.95),
        label: universe.tickers[d.tickerIdx],
      });
    }
    return out;
  }, [viewDrafts, universe.tickers]);

  // Run Black-Litterman whenever inputs change.
  const bl = useMemo(() => {
    if (!fit || universe.wMkt.length === 0) return null;
    try {
      return blackLitterman({
        sigma: fit.sigAnn,
        wMkt: universe.wMkt,
        delta,
        tau,
        views,
      });
    } catch {
      return null;
    }
  }, [fit, universe.wMkt, delta, tau, views]);

  // Frontiers for the 3-way comparison: market portfolio (just w_mkt), classical
  // Markowitz under shrunken μ̂, and BL posterior.
  const frontiers = useMemo(() => {
    if (!fit || !bl) return null;
    try {
      const fMV = buildFrontier(fit.muShrunk, fit.sigAnn, rf, {
        longOnly: true,
        cloudSize: 0,
        frontierSteps: 12,
      });
      const fBL = buildFrontier(bl.muBL, bl.sigmaBL, rf, {
        longOnly: true,
        cloudSize: 0,
        frontierSteps: 12,
      });
      return { mv: fMV.maxSharpe, bl: fBL.maxSharpe };
    } catch {
      return null;
    }
  }, [fit, bl, rf]);

  // Bars data for "Π vs μ̂_shrunk vs μ_BL"
  const muChartData = useMemo(() => {
    if (!bl || !fit) return [];
    return universe.tickers.map((t, i) => ({
      ticker: t.replace(".SA", ""),
      Equilíbrio: bl.pi[i] * 100,
      Amostral: fit.muShrunk[i] * 100,
      Posterior: bl.muBL[i] * 100,
    }));
  }, [bl, fit, universe.tickers]);

  const weightsChartData = useMemo(() => {
    if (!frontiers) return [];
    return universe.tickers.map((t, i) => ({
      ticker: t.replace(".SA", ""),
      Mercado: universe.wMkt[i] * 100,
      Markowitz: frontiers.mv.weights[i] * 100,
      BL: frontiers.bl.weights[i] * 100,
    }));
  }, [frontiers, universe.tickers, universe.wMkt]);

  const addView = () => {
    setViewDrafts((d) => [
      ...d,
      { id: uid(), tickerIdx: 0, expectedReturn: 20, confidence: 0.5 },
    ]);
  };
  const removeView = (id: string) => setViewDrafts((d) => d.filter((v) => v.id !== id));
  const patchView = (id: string, patch: Partial<ViewDraft>) =>
    setViewDrafts((d) => d.map((v) => (v.id === id ? { ...v, ...patch } : v)));

  return (
    <div className="space-y-10">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <span className="eyebrow">Configuração do modelo</span>
            <p className="mt-1 text-xs text-muted">
              Σ̂ estimado por Ledoit-Wolf na janela; μ_amostral usa o pipeline
              do tab Markowitz (Jensen + Jorion + macro-anchor). w_mkt = pesos
              IBOV restritos ao universo (renormalizados).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-body">
            <label className="flex items-center gap-1">
              universo:
              <select
                value={universeKey}
                onChange={(e) => setUniverseKey(e.target.value as UniverseKey)}
                className="rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-xs"
              >
                {(Object.keys(UNIVERSE_LABELS) as UniverseKey[]).map((k) => (
                  <option key={k} value={k}>
                    {UNIVERSE_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              janela:
              <select
                value={windowYears}
                onChange={(e) => setWindowYears(Number(e.target.value))}
                className="rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-xs"
              >
                <option value={3}>3 anos</option>
                <option value={5}>5 anos</option>
                <option value={10}>10 anos</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              δ (aversão):
              <input
                type="number"
                step={0.1}
                min={0.5}
                max={10}
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value))}
                className="w-16 rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-xs tabular"
              />
            </label>
            <label className="flex items-center gap-1">
              τ (prior):
              <input
                type="number"
                step={0.01}
                min={0.001}
                max={1}
                value={tau}
                onChange={(e) => setTau(Number(e.target.value))}
                className="w-16 rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-xs tabular"
              />
            </label>
          </div>
        </div>
        <div className="px-5 py-3 text-[11px] text-muted">
          {universe.tickers.length} ativos
          {universe.dropped.length > 0
            ? ` (auto-redução: ${universe.dropped.length} excluído${universe.dropped.length === 1 ? "" : "s"} por histórico curto — ${universe.dropped.join(", ")})`
            : ""}
          {fit ? <> · janela {fit.startDate} → {fit.endDate} · T = {fit.T}d</> : null}
          {" "}· rf = <span className="tabular">{fmtPctAA(rf)}</span>
        </div>
      </section>

      {!bl || !fit ? (
        <p className="text-sm text-muted">
          Aguardando estimativa de Σ̂ — janela ou universo insuficientes.
        </p>
      ) : (
        <>
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
              <div>
                <span className="eyebrow">Views (opiniões bayesianas)</span>
                <p className="mt-1 text-xs text-muted">
                  Adicione views absolutas sobre tickers individuais.
                  &ldquo;Espero que {universe.tickers[0]?.replace(".SA", "") ?? "X"} renda
                  18% a.a. com confiança 70%&rdquo;. Sem views ⇒ μ_BL = Π
                  (carteira de mercado é a ótima).
                </p>
              </div>
              <button
                type="button"
                onClick={addView}
                className="rounded-md border border-border bg-[color:var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-strong hover:bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)]"
              >
                + adicionar view
              </button>
            </div>
            {viewDrafts.length === 0 ? (
              <div className="px-5 py-4 text-xs text-muted">
                Nenhuma view. O posterior é igual ao prior (μ_BL = Π).
              </div>
            ) : (
              <div className="divide-y divide-border">
                {viewDrafts.map((v) => {
                  const tickerLabel = universe.tickers[v.tickerIdx]?.replace(".SA", "") ?? "?";
                  const priorPct = bl.pi[v.tickerIdx] * 100;
                  const postPct = bl.muBL[v.tickerIdx] * 100;
                  return (
                    <div key={v.id} className="grid grid-cols-1 gap-3 px-5 py-3 text-xs md:grid-cols-[1fr_1fr_1fr_120px_60px] md:items-center">
                      <label className="flex items-center gap-2">
                        <span className="text-muted">ativo</span>
                        <select
                          value={v.tickerIdx}
                          onChange={(e) => patchView(v.id, { tickerIdx: Number(e.target.value) })}
                          className="flex-1 rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-xs"
                        >
                          {universe.tickers.map((t, i) => (
                            <option key={t} value={i}>
                              {t.replace(".SA", "")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="text-muted">E[r] a.a.</span>
                        <input
                          type="number"
                          step={0.5}
                          value={v.expectedReturn}
                          onChange={(e) => patchView(v.id, { expectedReturn: Number(e.target.value) })}
                          className="w-20 rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-right tabular"
                        />
                        <span className="text-muted">%</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="text-muted">confiança</span>
                        <input
                          type="range"
                          min={5}
                          max={95}
                          step={5}
                          value={Math.round(v.confidence * 100)}
                          onChange={(e) => patchView(v.id, { confidence: Number(e.target.value) / 100 })}
                          className="flex-1"
                        />
                        <span className="w-9 text-right tabular text-strong">
                          {Math.round(v.confidence * 100)}%
                        </span>
                      </label>
                      <div className="text-[10px] text-muted">
                        prior {tickerLabel}: <span className="tabular text-body">{priorPct.toFixed(1).replace(".", ",")}%</span>
                        {" "}→ posterior:{" "}
                        <span className={`tabular font-semibold ${signedClass(postPct - priorPct)}`}>
                          {postPct.toFixed(1).replace(".", ",")}%
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeView(v.id)}
                        className="rounded-md border border-border px-2 py-1 text-[10px] text-muted hover:border-[color:var(--loss)] hover:text-[color:var(--loss)]"
                      >
                        remover
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <InterpretationPanel
            tickers={universe.tickers}
            wMkt={universe.wMkt}
            pi={bl.pi}
            muSample={fit.muShrunk}
            muBL={bl.muBL}
            delta={delta}
            tau={tau}
            views={views}
          />

          <section className="card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <span className="eyebrow">Retornos esperados (a.a.)</span>
              <p className="mt-1 text-xs text-muted">
                <span style={{ color: "var(--muted)" }}>Equilíbrio (Π)</span>{" "}
                = δ Σ w_mkt — o μ implícito pelo IBOV ser a carteira ótima.{" "}
                <span style={{ color: "var(--gain)" }}>Amostral</span> = média
                amostral histórica com shrinkage (igual ao tab Markowitz).{" "}
                <span style={{ color: "var(--accent)" }}>Posterior (μ_BL)</span>{" "}
                = Bayes(Π, views). Sem views ⇒ Posterior = Equilíbrio.
              </p>
            </div>
            <div className="p-4">
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={muChartData} margin={{ top: 16, right: 20, left: 8, bottom: 36 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="ticker"
                      tick={{ fontSize: 10, fill: "var(--muted)" }}
                      stroke="var(--border)"
                      angle={-45}
                      textAnchor="end"
                      height={56}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--muted)" }}
                      stroke="var(--border)"
                      tickFormatter={(v) => fmtAxisPct(v / 100)}
                      width={56}
                    />
                    <Tooltip content={<PctBarTooltip />} cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Equilíbrio" fill="var(--muted)" fillOpacity={0.7} isAnimationActive={false} />
                    <Bar dataKey="Amostral" fill="var(--gain)" fillOpacity={0.7} isAnimationActive={false} />
                    <Bar dataKey="Posterior" fill="var(--accent)" fillOpacity={0.85} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {bl.viewDiagnostics.length > 0 ? (
            <section className="card overflow-hidden">
              <div className="border-b border-border px-5 py-3">
                <span className="eyebrow">Diagnóstico das views</span>
                <p className="mt-1 text-xs text-muted">
                  Para cada view: o retorno que a prior atribui ao ativo
                  (P·Π), o que a view declara (Q), e quanto a posterior se
                  moveu em direção à view (P·μ_BL). Resíduo grande + Ω_kk
                  pequeno ⇒ a view foi acolhida com força.
                </p>
              </div>
              <div className="px-5 py-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted">
                      <th className="py-2">view</th>
                      <th className="py-2 text-right">P·Π (prior)</th>
                      <th className="py-2 text-right">Q (view)</th>
                      <th className="py-2 text-right">resíduo</th>
                      <th className="py-2 text-right">P·μ_BL (post.)</th>
                      <th className="py-2 text-right">Ω_kk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bl.viewDiagnostics.map((d, i) => {
                      const v = views[i];
                      return (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="py-2 text-strong">{d.label.replace(".SA", "")}</td>
                          <td className="py-2 text-right tabular text-body">{fmtPctAA(d.priorReturn)}</td>
                          <td className="py-2 text-right tabular text-strong">{fmtPctAA(v.expectedReturn)}</td>
                          <td className={`py-2 text-right tabular font-semibold ${signedClass(d.residual)}`}>
                            {fmtPctAA(d.residual)}
                          </td>
                          <td className="py-2 text-right tabular text-body">{fmtPctAA(d.posteriorReturn)}</td>
                          <td className="py-2 text-right tabular text-muted">{d.omegaK.toExponential(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {frontiers ? (
            <section className="card overflow-hidden">
              <div className="border-b border-border px-5 py-3">
                <span className="eyebrow">Carteiras tangência (max-Sharpe long-only)</span>
                <p className="mt-1 text-xs text-muted">
                  <span style={{ color: "var(--muted)" }}>Mercado</span> = pesos
                  IBOV (referência).{" "}
                  <span style={{ color: "var(--gain)" }}>Markowitz</span> =
                  tangência sob μ̂ amostral encolhido + Σ̂ Ledoit-Wolf —
                  igual ao tab Markowitz.{" "}
                  <span style={{ color: "var(--accent)" }}>BL</span> =
                  tangência sob μ_BL + Σ_BL = Σ + M. Sem views, BL ≈ Mercado;
                  com views, BL desvia do Mercado <em>na direção</em> da view.
                </p>
              </div>
              <div className="p-4">
                <div style={{ width: "100%", height: 320 }}>
                  <ResponsiveContainer>
                    <BarChart data={weightsChartData} margin={{ top: 16, right: 20, left: 8, bottom: 36 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="ticker"
                        tick={{ fontSize: 10, fill: "var(--muted)" }}
                        stroke="var(--border)"
                        angle={-45}
                        textAnchor="end"
                        height={56}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "var(--muted)" }}
                        stroke="var(--border)"
                        tickFormatter={(v) => `${v}%`}
                        width={48}
                      />
                      <Tooltip content={<WeightBarTooltip />} cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Mercado" fill="var(--muted)" fillOpacity={0.7} isAnimationActive={false}>
                        {weightsChartData.map((_, i) => (
                          <Cell key={i} fill="var(--muted)" />
                        ))}
                      </Bar>
                      <Bar dataKey="Markowitz" fill="var(--gain)" fillOpacity={0.7} isAnimationActive={false} />
                      <Bar dataKey="BL" fill="var(--accent)" fillOpacity={0.85} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 border-t border-border px-5 py-4 md:grid-cols-3">
                <WeightSummary
                  label="Mercado (IBOV)"
                  ret={frontierStats(universe.wMkt, fit.muSampleAnn, fit.sigAnn, rf).ret}
                  vol={frontierStats(universe.wMkt, fit.muSampleAnn, fit.sigAnn, rf).vol}
                  sharpe={frontierStats(universe.wMkt, fit.muSampleAnn, fit.sigAnn, rf).sharpe}
                />
                <WeightSummary
                  label="Markowitz"
                  ret={frontiers.mv.ret}
                  vol={frontiers.mv.vol}
                  sharpe={frontiers.mv.sharpe}
                  highlight
                />
                <WeightSummary
                  label="Black-Litterman"
                  ret={frontiers.bl.ret}
                  vol={frontiers.bl.vol}
                  sharpe={frontiers.bl.sharpe}
                  highlight
                />
              </div>
            </section>
          ) : null}

          {frontiers ? (
            <WeightShiftPanel
              tickers={universe.tickers}
              wMkt={universe.wMkt}
              wMv={frontiers.mv.weights}
              wBl={frontiers.bl.weights}
              viewsCount={views.length}
              tau={tau}
            />
          ) : null}

          <section className="card px-6 py-5 text-sm text-body">
            <div className="eyebrow">Como ler — em profundidade</div>
            <div className="mt-3 space-y-4">
              <div>
                <p className="font-semibold text-strong">
                  Por que Π existe? &mdash; reversão do problema de otimização
                </p>
                <p className="mt-1 text-muted">
                  Markowitz resolve <code className="mono">w*(μ, Σ, δ)</code>. Black-Litterman
                  inverte: dado um <em>w</em> observado (o IBOV) e Σ, qual é o
                  μ que faria <em>w</em> ser a solução ótima de média-variância?
                  Resposta: <span className="mono">Π = δ Σ w</span>. Se você
                  acredita que o IBOV de hoje reflete o consenso agregado de
                  todos os investidores otimizando MV (CAPM em equilíbrio), então
                  Π é a melhor estimativa <em>livre de amostra</em> dos retornos
                  esperados — não tem nenhuma média histórica nele.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Comparando Π com μ̂ amostral &mdash; onde estão os erros
                </p>
                <p className="mt-1 text-muted">
                  Onde o gráfico de barras mostra <strong>Amostral &gt; Equilíbrio</strong>,
                  esse ticker teve sorte na janela escolhida — μ̂ pegou o pico
                  do ciclo. Markowitz vai sobreponderá-lo (porque μ̂ está
                  artificialmente alto), e a Sharpe ex-post vai desabar.
                  Onde <strong>Equilíbrio &gt; Amostral</strong>, o ticker
                  apanhou na janela — Markowitz vai subponderá-lo (ou zerá-lo),
                  e o ativo pode performar bem no futuro reverter à média.
                  Π neutraliza ambos os erros.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  O papel de τ &mdash; quanta atenção dar às views
                </p>
                <p className="mt-1 text-muted">
                  τ é a variância da prior em unidades de Σ. <strong>τ pequeno
                  (0,01-0,05)</strong>: a prior é &ldquo;quase certa&rdquo; — você
                  precisa de muita confiança e/ou views com retorno bem
                  diferente de Π·P para mover μ_BL. <strong>τ grande</strong>:
                  a prior é frouxa — a primeira view já domina o posterior.
                  O canônico Black-Litterman (1992) usa <span className="mono">τ ≈ 0.05</span>;
                  Idzorek (2005) e He-Litterman (1999) também ficam nessa
                  faixa. <strong>τ → ∞</strong> faz BL colapsar para Markowitz
                  puro com μ = média ponderada das views por confiança (sem
                  ancoragem ao equilíbrio).
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  O papel de δ &mdash; aversão a risco
                </p>
                <p className="mt-1 text-muted">
                  δ controla a magnitude de Π. <strong>δ = 2,5</strong> é o
                  default textbook. Pode ser reverte-engenheirado da Sharpe
                  histórica do índice: <span className="mono">δ ≈ (E[r_mkt] − rf) / σ²_mkt</span>.
                  Para o IBOV, com prêmio de risco ≈ 6% a.a. e σ_mkt ≈ 25% a.a.,
                  isso dá δ ≈ 0,06 / 0,0625 ≈ 0,96. Use 2,5 para reproduzir os
                  papers; use ≈1 para refletir a realidade brasileira.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Σ_BL = Σ + M &mdash; o anti-otimismo
                </p>
                <p className="mt-1 text-muted">
                  Mesmo a Σ&nbsp;estimada é uma estimativa — μ é ainda mais incerto.
                  Black-Litterman incorpora essa incerteza inflando a covariância
                  usada no otimizador final: <span className="mono">Σ_BL = Σ + M</span>
                  onde M é a covariância <em>do próprio μ</em>. Sem views,
                  M = τΣ ⇒ Σ_BL = (1+τ)Σ. Com views, M é menor (a Bayes
                  &ldquo;aprendeu&rdquo; algo), e o otimizador é menos
                  conservador na direção dessas views. É o que mata a
                  concentração 80%-em-um-ticker do Markowitz puro.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Sem views &mdash; BL recupera o &ldquo;hold the market&rdquo;
                </p>
                <p className="mt-1 text-muted">
                  Quando a lista de views está vazia, μ_BL = Π exatamente. E
                  como Π é construído justamente para fazer w_mkt ser ótimo,
                  a tangência max-Sharpe sob μ_BL é aproximadamente w_mkt
                  (com pequenas diferenças devido a Σ_BL = (1+τ)Σ).
                  Isso é o ponto. <strong>BL sem views é a versão matemática
                  do conselho &ldquo;se você não tem opinião, fique com o
                  índice&rdquo;</strong> — Malkiel (1973), Bogle (1976), Fama
                  (Nobel 2013).
                </p>
              </div>
            </div>
          </section>

          <section className="card px-6 py-5 text-sm text-body">
            <div className="eyebrow">Notas metodológicas detalhadas</div>
            <ul className="mt-3 space-y-3">
              <li>
                • <strong>Σ &mdash; Ledoit-Wolf (2004)</strong>: covariância
                shrinked toward constant correlation, estimada nos últimos{" "}
                <span className="mono">{windowYears * 252}</span> dias úteis.
                Mesmo Σ usado em <a href="../markowitz/" className="underline decoration-dotted underline-offset-2 hover:text-strong">/markowitz</a>{" "}
                — coerência total entre tabs.
              </li>
              <li>
                • <strong>w_mkt &mdash; pesos IBOV</strong> dos constituintes
                que sobraram após a auto-redução por histórico curto,
                renormalizados para somar 1. Não é exatamente a carteira de
                mercado &ldquo;true&rdquo; (mercado completo inclui privadas,
                renda fixa, imobiliário, ouro), mas é o melhor proxy disponível
                para o universo brasileiro de ações.
              </li>
              <li>
                • <strong>Π &mdash; reversão CAPM</strong>:{" "}
                <span className="mono">Π = δ Σ w_mkt</span>. Sob o CAPM de
                Sharpe (1964, Nobel 1990), a tangência é a carteira de mercado
                — invertendo essa equação, Π é o μ que faz isso ser verdade.
                Não tem média histórica aqui — Π depende apenas de δ, Σ e
                w_mkt.
              </li>
              <li>
                • <strong>Ω &mdash; calibragem de incerteza das views</strong>:
                Ω é diagonal com{" "}
                <span className="mono">Ω_kk = τ · P_k Σ P_kᵀ · (1−c)/c</span>{" "}
                onde c ∈ (0,1] é a confiança da view. c = 0,5 é o canônico He-Litterman (1999) — Ω_kk =
                τ P_k Σ P_kᵀ. c → 1 ⇒ Ω → 0 ⇒ a view é tratada como
                igualdade dura. c → 0 ⇒ Ω → ∞ ⇒ a view é completamente
                ignorada. O método de{" "}
                <a
                  href="https://corporate.morningstar.com/ib/documents/MethodologyDocuments/IBBAssociates/BlackLitterman.pdf"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-strong"
                >
                  Idzorek (2005)
                </a>{" "}
                permite calibrar c a partir de uma confiança percentual
                explícita — equivalente conceitual ao que fazemos aqui.
              </li>
              <li>
                • <strong>μ_BL &mdash; forma fechada</strong>:{" "}
                <span className="mono">μ_BL = [(τΣ)⁻¹ + Pᵀ Ω⁻¹ P]⁻¹ · [(τΣ)⁻¹ Π + Pᵀ Ω⁻¹ Q]</span>.
                Não há iteração nem simulação — todo o cálculo é uma única
                inversão de matriz K×K (K = número de views) e uma N×N. O
                custo cresce com K (não com N de forma significativa).
              </li>
              <li>
                • <strong>Σ_BL</strong> = Σ + M, onde M = [(τΣ)⁻¹ + Pᵀ Ω⁻¹ P]⁻¹.
                Sem views, M = τΣ. Com views, M é menor na direção das views
                (a Bayes aprendeu) e maior nas direções perpendiculares.
              </li>
              <li>
                • <strong>μ̂ amostral</strong> exibido para comparação é o μ
                pós-pipeline do tab Markowitz: Jensen + ×252 + Jorion shrink
                + macro-anchor. Sem o macro-anchor, o gap entre μ̂ e Π seria
                ainda mais dramático (μ̂ raw alcança 60-100% a.a. para alguns
                tickers com janelas curtas).
              </li>
              <li>
                • <strong>Views absolutas vs relativas</strong>: esta página
                expõe apenas views absolutas (&ldquo;ativo X renderá Y%&rdquo;).
                A biblioteca <code className="mono">lib/blacklitterman.ts</code>{" "}
                suporta também views relativas (&ldquo;A supera B por Z%&rdquo;) —
                basta passar <code className="mono">{`coeffs: [+1, -1]`}</code>{" "}
                no objeto View. Adicionar UI para views relativas é uma
                extensão natural se houver interesse.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function InterpretationPanel({
  tickers,
  wMkt,
  pi,
  muSample,
  muBL,
  delta,
  tau,
  views,
}: {
  tickers: string[];
  wMkt: number[];
  pi: number[];
  muSample: number[];
  muBL: number[];
  delta: number;
  tau: number;
  views: View[];
}) {
  // Top-5 by IBOV weight for the deep-dive table
  const rows = useMemo(() => {
    const idx = tickers.map((_, i) => i).sort((a, b) => wMkt[b] - wMkt[a]).slice(0, 5);
    return idx.map((i) => ({
      ticker: tickers[i].replace(".SA", ""),
      wMkt: wMkt[i],
      pi: pi[i],
      muSample: muSample[i],
      muBL: muBL[i],
      gapAmostralPrior: muSample[i] - pi[i],
      gapPosteriorPrior: muBL[i] - pi[i],
    }));
  }, [tickers, wMkt, pi, muSample, muBL]);

  const maxOptimistic = useMemo(() => {
    let bestI = -1;
    let bestGap = -Infinity;
    for (let i = 0; i < tickers.length; i++) {
      const gap = muSample[i] - pi[i];
      if (gap > bestGap) {
        bestGap = gap;
        bestI = i;
      }
    }
    return bestI >= 0 ? { ticker: tickers[bestI].replace(".SA", ""), gap: bestGap } : null;
  }, [tickers, muSample, pi]);

  const maxPessimistic = useMemo(() => {
    let bestI = -1;
    let bestGap = Infinity;
    for (let i = 0; i < tickers.length; i++) {
      const gap = muSample[i] - pi[i];
      if (gap < bestGap) {
        bestGap = gap;
        bestI = i;
      }
    }
    return bestI >= 0 ? { ticker: tickers[bestI].replace(".SA", ""), gap: bestGap } : null;
  }, [tickers, muSample, pi]);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">O que estes números significam</span>
        <p className="mt-1 text-xs text-muted">
          Os 5 ativos com maior peso no IBOV (após auto-redução), decompostos
          em três retornos esperados anuais e duas leituras de gap. δ ={" "}
          <span className="mono">{delta.toFixed(2).replace(".", ",")}</span> · τ ={" "}
          <span className="mono">{tau.toFixed(3).replace(".", ",")}</span> ·{" "}
          {views.length === 0 ? "sem views ⇒ μ_BL = Π" : `${views.length} view${views.length === 1 ? "" : "s"}`}
        </p>
      </div>
      <div className="overflow-x-auto px-5 py-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="py-2">ticker</th>
              <th className="py-2 text-right">peso IBOV</th>
              <th className="py-2 text-right">Π equilíbrio</th>
              <th className="py-2 text-right">μ̂ amostral</th>
              <th className="py-2 text-right">μ_BL posterior</th>
              <th className="py-2 text-right">μ̂ − Π</th>
              <th className="py-2 text-right">μ_BL − Π</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker} className="border-b border-border last:border-0">
                <td className="py-2 font-semibold text-strong">{r.ticker}</td>
                <td className="py-2 text-right tabular text-body">{(r.wMkt * 100).toFixed(1).replace(".", ",")}%</td>
                <td className="py-2 text-right tabular text-body">{fmtPctAA(r.pi)}</td>
                <td className="py-2 text-right tabular text-body">{fmtPctAA(r.muSample)}</td>
                <td className="py-2 text-right tabular font-semibold text-strong">{fmtPctAA(r.muBL)}</td>
                <td className={`py-2 text-right tabular ${signedClass(r.gapAmostralPrior)}`}>
                  {fmtPctAA(r.gapAmostralPrior)}
                </td>
                <td className={`py-2 text-right tabular ${signedClass(r.gapPosteriorPrior)}`}>
                  {fmtPctAA(r.gapPosteriorPrior)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border bg-[color:color-mix(in_srgb,var(--accent)_5%,transparent)] px-5 py-4 text-xs text-body">
        <p>
          <strong>Como interpretar</strong>:{" "}
          <em>Π equilíbrio</em> é o retorno que o mercado{" "}
          <em>está precificando</em> para cada ticker, dado seu peso no IBOV e
          sua covariância — não tem nenhuma média histórica. <em>μ̂ amostral</em>{" "}
          é o retorno médio observado na janela, após o pipeline de shrinkage
          do tab Markowitz. <em>μ_BL posterior</em> é a média ponderada
          bayesiana das duas — ancorada em Π, ajustada pelas suas views.
        </p>
        <p className="mt-2">
          <strong>μ̂ − Π &gt; 0</strong>: a janela &ldquo;favoreceu&rdquo; esse
          ticker. Markowitz puro vai super-alocar; BL vai resistir.{" "}
          <strong>μ̂ − Π &lt; 0</strong>: a janela &ldquo;castigou&rdquo; esse
          ticker. Markowitz vai zerar; BL vai manter próximo do peso de mercado.
        </p>
        {maxOptimistic && maxPessimistic ? (
          <p className="mt-2">
            <strong>No seu universo agora</strong>: o ativo mais
            &ldquo;sortudo&rdquo; é{" "}
            <strong className="text-strong">{maxOptimistic.ticker}</strong>{" "}
            (μ̂ excede Π por{" "}
            <span className={`tabular font-semibold ${signedClass(maxOptimistic.gap)}`}>
              {fmtPctAA(maxOptimistic.gap)}
            </span>
            ) — é onde o Markowitz vai concentrar peso de forma frágil. O mais
            &ldquo;azarado&rdquo; é{" "}
            <strong className="text-strong">{maxPessimistic.ticker}</strong>{" "}
            (μ̂ menor que Π por{" "}
            <span className={`tabular font-semibold ${signedClass(maxPessimistic.gap)}`}>
              {fmtPctAA(maxPessimistic.gap)}
            </span>
            ) — onde Markowitz vai subponderar mas o mercado precifica
            retorno positivo.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Side-by-side weight comparison panel: shows for each ticker how
 *  Markowitz puro and BL each diverged from the market weight. Two
 *  separately-computed L1 deviations:
 *    - ||w_MV − w_mkt||₁: how aggressively Markowitz diverges from the index
 *    - ||w_BL − w_mkt||₁: how aggressively BL diverges from the index
 *  When views = 0, the second should be small (BL ≈ market); the first is
 *  the "noise tax" of pure μ̂ optimization. Per-ticker diffs are sorted
 *  by absolute MV deviation so the most extreme bets land at the top. */
function WeightShiftPanel({
  tickers,
  wMkt,
  wMv,
  wBl,
  viewsCount,
  tau,
}: {
  tickers: string[];
  wMkt: number[];
  wMv: number[];
  wBl: number[];
  viewsCount: number;
  tau: number;
}) {
  const rows = tickers.map((t, i) => ({
    ticker: t.replace(".SA", ""),
    mkt: wMkt[i],
    mv: wMv[i],
    bl: wBl[i],
    mvDelta: wMv[i] - wMkt[i],
    blDelta: wBl[i] - wMkt[i],
  }));
  // Sort by absolute Markowitz deviation, biggest bets first
  rows.sort((a, b) => Math.abs(b.mvDelta) - Math.abs(a.mvDelta));
  const top = rows.slice(0, 8);
  const l1Mv = rows.reduce((s, r) => s + Math.abs(r.mvDelta), 0);
  const l1Bl = rows.reduce((s, r) => s + Math.abs(r.blDelta), 0);
  const ratio = l1Bl > 1e-9 ? l1Mv / l1Bl : Infinity;
  // Number of tickers Markowitz zero-weights
  const mvZeros = rows.filter((r) => r.mv < 0.005).length;
  const blZeros = rows.filter((r) => r.bl < 0.005).length;

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">
          Como os pesos se deslocam vs IBOV · Markowitz vs BL
        </span>
        <p className="mt-1 text-xs text-muted">
          Para cada ativo, quanto cada otimizador se desviou do peso de
          mercado. Markowitz tende a apostas extremas em poucos ativos (μ̂
          chasing); BL, com τ ={" "}
          <span className="mono">{tau.toFixed(3).replace(".", ",")}</span> e{" "}
          {viewsCount === 0 ? "nenhuma view" : `${viewsCount} view${viewsCount === 1 ? "" : "s"}`}
          , se ancora muito mais próximo do IBOV.
        </p>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <div className="rounded-md border-l-4 px-3 py-2" style={{ borderColor: "var(--strong)", background: "color-mix(in srgb, var(--strong) 5%, transparent)" }}>
          <p className="font-semibold text-strong">
            Distância total ao IBOV (norma L1 ÷ 2)
          </p>
          <p className="mt-1 text-muted">
            Markowitz:{" "}
            <span className="tabular font-semibold text-strong">
              {(l1Mv * 50).toFixed(1).replace(".", ",")}%
            </span>{" "}
            da carteira difere do IBOV.{" "}
            Black-Litterman:{" "}
            <span className="tabular font-semibold text-strong">
              {(l1Bl * 50).toFixed(1).replace(".", ",")}%
            </span>
            . Razão MV/BL ={" "}
            <span className="tabular font-semibold">
              {Number.isFinite(ratio) ? ratio.toFixed(1).replace(".", ",") : "∞"}×
            </span>
            . Markowitz zera{" "}
            <span className="tabular font-semibold">{mvZeros}</span> de{" "}
            {rows.length} ativos (peso &lt; 0,5%); BL zera apenas{" "}
            <span className="tabular font-semibold">{blZeros}</span>.{" "}
            {viewsCount === 0
              ? "Sem views, BL recupera essencialmente a carteira de mercado — é o ponto teórico mais importante do modelo."
              : `Com ${viewsCount} view${viewsCount === 1 ? "" : "s"}, BL tilta na direção das views mas mantém a maior parte dos pesos próxima do IBOV.`}
          </p>
        </div>

        <div>
          <p className="font-semibold text-strong">
            As 8 maiores apostas do Markowitz (vs IBOV)
          </p>
          <p className="mt-1 text-xs text-muted">
            Ordenado por |w_MV − w_mkt| decrescente. Quando MV-Δ é positivo,
            Markowitz <em>sobreponderou</em> o ativo (acreditou no μ̂ alto);
            quando negativo, <em>subponderou</em> ou zerou. BL-Δ na mesma
            linha mostra o quanto BL concorda — quase sempre uma fração de MV-Δ.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="py-2">ticker</th>
                  <th className="py-2 text-right">peso IBOV</th>
                  <th className="py-2 text-right">peso MV</th>
                  <th className="py-2 text-right">peso BL</th>
                  <th className="py-2 text-right">MV − IBOV</th>
                  <th className="py-2 text-right">BL − IBOV</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.ticker} className="border-b border-border last:border-0">
                    <td className="py-2 font-semibold text-strong">{r.ticker}</td>
                    <td className="py-2 text-right tabular text-muted">{(r.mkt * 100).toFixed(1).replace(".", ",")}%</td>
                    <td className="py-2 text-right tabular text-body">{(r.mv * 100).toFixed(1).replace(".", ",")}%</td>
                    <td className="py-2 text-right tabular text-body">{(r.bl * 100).toFixed(1).replace(".", ",")}%</td>
                    <td className={`py-2 text-right tabular font-semibold ${signedClass(r.mvDelta)}`}>
                      {r.mvDelta >= 0 ? "+" : ""}
                      {(r.mvDelta * 100).toFixed(1).replace(".", ",")}pp
                    </td>
                    <td className={`py-2 text-right tabular ${signedClass(r.blDelta)}`}>
                      {r.blDelta >= 0 ? "+" : ""}
                      {(r.blDelta * 100).toFixed(1).replace(".", ",")}pp
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-muted">
          <strong>Como interpretar uma linha</strong>: se MV-Δ = +15pp e BL-Δ
          = +2pp para um ticker, Markowitz aposta 15 pontos percentuais a
          mais que o IBOV nesse ativo (acreditando que μ̂ está certo); BL
          adiciona apenas 2pp (a maior parte do sinal foi absorvido pela
          prior bayesiana via Π). A razão MV/BL ≈{" "}
          {Number.isFinite(ratio) ? ratio.toFixed(0).replace(".", ",") : "∞"}{" "}
          é uma medida de quanto BL <em>protege</em> contra erro de
          estimativa em μ.
        </p>
      </div>
    </section>
  );
}

function frontierStats(
  w: number[],
  muAnn: number[],
  sigAnn: number[][],
  rf: number,
): { ret: number; vol: number; sharpe: number } {
  let ret = 0;
  for (let i = 0; i < w.length; i++) ret += w[i] * muAnn[i];
  let variance = 0;
  for (let i = 0; i < w.length; i++) {
    let row = 0;
    for (let j = 0; j < w.length; j++) row += sigAnn[i][j] * w[j];
    variance += w[i] * row;
  }
  variance = Math.max(variance, 0);
  const vol = Math.sqrt(variance);
  const sharpe = vol > 1e-12 ? (ret - rf) / vol : 0;
  return { ret, vol, sharpe };
}

function WeightSummary({
  label,
  ret,
  vol,
  sharpe,
  highlight,
}: {
  label: string;
  ret: number;
  vol: number;
  sharpe: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        highlight
          ? "border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"
          : "border-border"
      }`}
    >
      <div className="eyebrow">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
        <span className="text-muted">retorno</span>
        <span className={`text-right tabular font-semibold ${signedClass(ret)}`}>
          {fmtPctAA(ret)}
        </span>
        <span className="text-muted">vol</span>
        <span className="text-right tabular text-body">{fmtPct(vol)}</span>
        <span className="text-muted">Sharpe</span>
        <span className={`text-right tabular font-semibold ${signedClass(sharpe)}`}>
          {fmtNum2(sharpe)}
        </span>
      </div>
    </div>
  );
}

function PctBarTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 11,
      }}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }}>{p.dataKey}</span>
          <span className="tabular font-semibold" style={{ color: "var(--strong)" }}>
            {p.value >= 0 ? "+" : ""}
            {p.value.toFixed(1).replace(".", ",")}% a.a.
          </span>
        </div>
      ))}
    </div>
  );
}

function WeightBarTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 11,
      }}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }}>{p.dataKey}</span>
          <span className="tabular font-semibold" style={{ color: "var(--strong)" }}>
            {p.value.toFixed(1).replace(".", ",")}%
          </span>
        </div>
      ))}
    </div>
  );
}
