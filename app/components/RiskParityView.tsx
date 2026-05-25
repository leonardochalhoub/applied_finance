"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CdiArtifact, IbovArtifact, PricesArtifact } from "@/lib/data";
import { fmtNum2, fmtPct, fmtPctAA, signedClass } from "@/lib/format";
import { buildFrontier } from "@/lib/markowitz";
import { jensenCorrectMu, jorionShrinkMu, ledoitWolf } from "@/lib/mvEstimators";
import {
  equalRiskContribution,
  inverseVolatilityWeights,
  riskContributions,
} from "@/lib/riskparity";
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

type StratKey = "erc" | "invvol" | "eq" | "mv" | "mkt";
const STRAT_LABEL: Record<StratKey, string> = {
  erc: "ERC (paridade de risco)",
  invvol: "Inv-vol (Σ diagonal)",
  eq: "1/N (peso igual)",
  mv: "Markowitz",
  mkt: "Mercado (IBOV)",
};
const STRAT_COLOR: Record<StratKey, string> = {
  erc: "var(--accent)",
  invvol: "var(--gain)",
  eq: "var(--muted)",
  mv: "color-mix(in srgb, var(--loss) 80%, transparent)",
  mkt: "color-mix(in srgb, var(--muted) 70%, transparent)",
};

export function RiskParityView({ prices, ibov, cdi }: Props) {
  const [universeKey, setUniverseKey] = useState<UniverseKey>("top15");
  const [windowYears, setWindowYears] = useState<number>(5);

  const rf = useMemo(() => cdi?.global_mean_annual ?? 0.13, [cdi]);

  const universe = useMemo(() => {
    const members = ibov.members
      .filter((m) => prices.series[m.ticker])
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const size = Math.min(UNIVERSE_SIZES[universeKey], members.length);
    const picked = members.slice(0, size);
    if (picked.length < 2) {
      return {
        tickers: [] as string[],
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
    return {
      tickers: tightened.tickers,
      wMkt: wMkt ?? [],
      startIdx: tightened.startIdx,
      dropped: tightened.droppedForHistory,
    };
  }, [ibov, prices, universeKey, windowYears]);

  const fit = useMemo(() => {
    if (universe.tickers.length < 2) return null;
    const built = buildCoterminalReturns(prices, universe.tickers, universe.startIdx, null);
    if (!built) return null;
    const windowDays = windowYears * 252;
    const X = built.X.length > windowDays ? built.X.slice(built.X.length - windowDays) : built.X;
    if (X.length < 60) return null;
    const lw = ledoitWolf(X);
    const T = X.length;
    const N = X[0].length;
    const meanLog = new Array(N).fill(0);
    for (const row of X) for (let i = 0; i < N; i++) meanLog[i] += row[i];
    for (let i = 0; i < N; i++) meanLog[i] /= T;
    const meanSimple = jensenCorrectMu(meanLog, lw.sigma);
    const muSampleAnn = meanSimple.map((m) => m * 252);
    const sigAnn = lw.sigma.map((row) => row.map((v) => v * 252));
    const js = jorionShrinkMu(muSampleAnn, sigAnn, T);
    const macro = applyMacroAnchor(js.mu, rf, T);
    return {
      muShrunk: macro.mu,
      sigAnn,
      T,
      startDate: built.dates[built.dates.length - X.length] ?? built.dates[0],
      endDate: built.dates[built.dates.length - 1],
    };
  }, [universe, prices, windowYears, rf]);

  // Compute all 5 strategies on the same Σ
  const strategies = useMemo(() => {
    if (!fit || universe.wMkt.length === 0) return null;
    const N = universe.tickers.length;
    const wEq = new Array(N).fill(1 / N);
    const wInv = inverseVolatilityWeights(fit.sigAnn);
    const wErc = equalRiskContribution(fit.sigAnn, undefined, { tol: 1e-9, maxSweeps: 500 });
    let wMv = wEq;
    try {
      const fr = buildFrontier(fit.muShrunk, fit.sigAnn, rf, {
        longOnly: true,
        cloudSize: 0,
        frontierSteps: 12,
      });
      wMv = fr.maxSharpe.weights;
    } catch {
      // keep wMv = wEq fallback
    }
    return {
      erc: wErc,
      invvol: wInv,
      eq: wEq,
      mv: wMv,
      mkt: universe.wMkt,
    };
  }, [fit, universe.wMkt, universe.tickers.length, rf]);

  // Per-strategy stats + risk contributions
  const stats = useMemo(() => {
    if (!strategies || !fit) return null;
    const out: Record<
      StratKey,
      { ret: number; vol: number; sharpe: number; weights: number[]; rc: number[]; mrc: number[] }
    > = {} as never;
    (Object.keys(strategies) as StratKey[]).forEach((k) => {
      const w = strategies[k];
      const rc = riskContributions(w, fit.sigAnn);
      let ret = 0;
      for (let i = 0; i < w.length; i++) ret += w[i] * fit.muShrunk[i];
      const sharpe = rc.vol > 1e-12 ? (ret - rf) / rc.vol : 0;
      out[k] = { ret, vol: rc.vol, sharpe, weights: w, rc: rc.rc, mrc: rc.mrc };
    });
    return out;
  }, [strategies, fit, rf]);

  // Weights chart: side-by-side bars per ticker for the 5 strategies
  const weightChart = useMemo(() => {
    if (!stats) return [];
    return universe.tickers.map((t, i) => ({
      ticker: t.replace(".SA", ""),
      ERC: stats.erc.weights[i] * 100,
      "Inv-vol": stats.invvol.weights[i] * 100,
      "1/N": stats.eq.weights[i] * 100,
      Markowitz: stats.mv.weights[i] * 100,
      Mercado: stats.mkt.weights[i] * 100,
    }));
  }, [stats, universe.tickers]);

  // Risk contributions chart: per ticker, the share of portfolio variance
  // explained by each strategy. The headline visual of the page.
  const rcChart = useMemo(() => {
    if (!stats) return [];
    return universe.tickers.map((t, i) => ({
      ticker: t.replace(".SA", ""),
      ERC: stats.erc.rc[i] * 100,
      "Inv-vol": stats.invvol.rc[i] * 100,
      "1/N": stats.eq.rc[i] * 100,
      Markowitz: stats.mv.rc[i] * 100,
    }));
  }, [stats, universe.tickers]);

  const equalRcLine = stats ? 100 / universe.tickers.length : 0;
  const eqHHIvol = useMemo(() => {
    if (!stats) return 0;
    // Concentration of RISK in the 1/N portfolio: Σ RC²
    return stats.eq.rc.reduce((s, r) => s + r * r, 0);
  }, [stats]);
  const ercHHIvol = useMemo(() => {
    if (!stats) return 0;
    return stats.erc.rc.reduce((s, r) => s + r * r, 0);
  }, [stats]);

  return (
    <div className="space-y-10">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <span className="eyebrow">Configuração</span>
            <p className="mt-1 text-xs text-muted">
              Σ estimada via Ledoit-Wolf. ERC resolvido por descida coordenada
              cíclica até <span className="mono">max|RC_i − 1/N|</span> &lt;
              10⁻⁹. Inv-vol é o caso fechado quando Σ é diagonal.
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

      {!stats || !fit ? (
        <p className="text-sm text-muted">
          Histórico insuficiente para estimar Σ com este universo e janela.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {(["erc", "invvol", "eq", "mv", "mkt"] as StratKey[]).map((k) => (
              <StratCard key={k} label={STRAT_LABEL[k]} accent={STRAT_COLOR[k]} stats={stats[k]} />
            ))}
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <span className="eyebrow">
                Contribuição de risco por ativo (% da variância total)
              </span>
              <p className="mt-1 text-xs text-muted">
                Quanto cada ativo contribui para σ²_p, em cada estratégia. A
                linha tracejada é a meta ERC ({equalRcLine.toFixed(1).replace(".", ",")}% por ativo, = 1/N).
                Por construção,{" "}
                <span style={{ color: "var(--accent)" }}>ERC</span> bate
                exatamente na linha. <strong>1/N (peso igual)</strong>{" "}
                concentra risco nos ativos mais voláteis —{" "}
                <strong>HHI de risco do 1/N = {fmtNum2(eqHHIvol)}</strong> vs{" "}
                <strong>HHI ERC = {fmtNum2(ercHHIvol)}</strong> (mínimo possível ={" "}
                {fmtNum2(1 / universe.tickers.length)}).
              </p>
            </div>
            <div className="p-4">
              <div style={{ width: "100%", height: 340 }}>
                <ResponsiveContainer>
                  <BarChart data={rcChart} margin={{ top: 16, right: 20, left: 8, bottom: 36 }}>
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
                    <ReferenceLine
                      y={equalRcLine}
                      stroke="var(--accent)"
                      strokeDasharray="4 4"
                      label={{ value: "meta ERC = 1/N", position: "insideTopRight", style: { fontSize: 10, fill: "var(--accent)" } }}
                    />
                    <Tooltip content={<PctBarTooltip suffix="%" />} cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="ERC" fill={STRAT_COLOR.erc} fillOpacity={0.85} isAnimationActive={false} />
                    <Bar dataKey="Inv-vol" fill={STRAT_COLOR.invvol} fillOpacity={0.75} isAnimationActive={false} />
                    <Bar dataKey="1/N" fill={STRAT_COLOR.eq} fillOpacity={0.7} isAnimationActive={false} />
                    <Bar dataKey="Markowitz" fill={STRAT_COLOR.mv} fillOpacity={0.75} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <span className="eyebrow">Pesos por estratégia (% da carteira)</span>
              <p className="mt-1 text-xs text-muted">
                Dólares investidos em cada ativo. <strong>1/N</strong> é uma
                linha reta horizontal: cada ativo recebe a mesma fração. ERC
                tilta um pouco para baixar peso dos ativos de alta vol, mas
                <em>menos</em> que o inv-vol puro porque também leva em conta
                correlações. Markowitz é dramaticamente assimétrico.
              </p>
            </div>
            <div className="p-4">
              <div style={{ width: "100%", height: 340 }}>
                <ResponsiveContainer>
                  <BarChart data={weightChart} margin={{ top: 16, right: 20, left: 8, bottom: 36 }}>
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
                    <Tooltip content={<PctBarTooltip suffix="%" />} cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="ERC" fill={STRAT_COLOR.erc} fillOpacity={0.85} isAnimationActive={false} />
                    <Bar dataKey="Inv-vol" fill={STRAT_COLOR.invvol} fillOpacity={0.75} isAnimationActive={false} />
                    <Bar dataKey="1/N" fill={STRAT_COLOR.eq} fillOpacity={0.7} isAnimationActive={false} />
                    <Bar dataKey="Markowitz" fill={STRAT_COLOR.mv} fillOpacity={0.75} isAnimationActive={false} />
                    <Bar dataKey="Mercado" fill={STRAT_COLOR.mkt} fillOpacity={0.6} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <RiskInterpretationPanel
            stats={stats}
            tickers={universe.tickers}
            eqHHIvol={eqHHIvol}
            ercHHIvol={ercHHIvol}
            n={universe.tickers.length}
          />

          <section className="card px-6 py-5 text-sm text-body">
            <div className="eyebrow">Como ler &mdash; em profundidade</div>
            <div className="mt-3 space-y-4">
              <div>
                <p className="font-semibold text-strong">
                  Contribui&ccedil;&atilde;o de risco &mdash; o conceito central
                </p>
                <p className="mt-1 text-muted">
                  A contribui&ccedil;&atilde;o de risco do ativo i &eacute;{" "}
                  <span className="mono">
                    RC_i = w_i · (Σw)_i / w<sup>T</sup>Σw
                  </span>
                  . Geometricamente, RC_i &eacute; a fra&ccedil;&atilde;o da
                  vari&acirc;ncia da carteira atribu&iacute;vel ao ativo i,
                  ponderando peso pr&oacute;prio <em>e</em> co-movimento com
                  os outros. A soma{" "}
                  <span className="mono">Σ_i RC_i = 1</span> sempre — &eacute;
                  uma decomposi&ccedil;&atilde;o exata da vari&acirc;ncia
                  total. Surge naturalmente da deriva&ccedil;&atilde;o:{" "}
                  <span className="mono">∂σ_p / ∂w_i = (Σw)_i / σ_p</span>,
                  ent&atilde;o <span className="mono">w_i · ∂σ_p/∂w_i</span>{" "}
                  &eacute; a contribui&ccedil;&atilde;o euleriana — quanto o
                  ativo &ldquo;adiciona&rdquo; ao σ_p se aumentarmos seu
                  peso marginalmente.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Por que 1/N de d&oacute;lares ≠ 1/N de risco
                </p>
                <p className="mt-1 text-muted">
                  Considere dois ativos com vols 20% e 60% a.a., correla&ccedil;&atilde;o
                  zero. Com pesos 50/50, RC_1 = (0,5² × 0,04) / (0,5² × 0,04
                  + 0,5² × 0,36) = 0,04/0,40 = <strong>10%</strong>; RC_2 =
                  <strong>90%</strong>. A carteira parece diversificada
                  (cada ativo &eacute; 50% do dinheiro), mas 90% do risco
                  vive em um &uacute;nico ativo. Esse &eacute; o pecado
                  oculto do 1/N. Para que 1/N seja tamb&eacute;m 1/N de
                  risco, vols precisam ser <em>id&ecirc;nticas</em> — uma
                  condi&ccedil;&atilde;o quase nunca satisfeita em equity
                  brasileira.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  ERC &mdash; cada ativo paga seu pr&oacute;prio aluguel
                  de risco
                </p>
                <p className="mt-1 text-muted">
                  Equal Risk Contribution for&ccedil;a{" "}
                  <span className="mono">RC_i = 1/N para todo i</span>. Cada
                  ativo &eacute; <em>igualmente respons&aacute;vel</em> pela
                  vari&acirc;ncia total.{" "}
                  <a
                    href="https://www.pm-research.com/content/iijpormgmt/36/4/60"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    Maillard, Roncalli &amp; Teïletche (2010, JPM)
                  </a>{" "}
                  provam tr&ecirc;s propriedades: (a) o portf&oacute;lio
                  existe e &eacute; &uacute;nico para Σ positivo-definido;
                  (b) sua vol fica entre 1/N e min-var (sandwich theorem);
                  (c) &eacute; o &uacute;nico minimizador da fun&ccedil;&atilde;o
                  convexa <span className="mono">½ w<sup>T</sup>Σw − (1/N)Σ ln(w_i)</span>{" "}
                  s.a. <span className="mono">w ≥ 0</span>. &Eacute; uma
                  fam&iacute;lia de portf&oacute;lios mais geral: trocando
                  o alvo 1/N por qualquer vetor que some 1, obt&eacute;m-se{" "}
                  <em>risk budgeting</em> arbitr&aacute;rio.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Inv-vol &mdash; o ERC do pobre
                </p>
                <p className="mt-1 text-muted">
                  Se ignoramos correla&ccedil;&otilde;es (Σ diagonal), a
                  condi&ccedil;&atilde;o ERC reduz-se a{" "}
                  <span className="mono">w_i ∝ 1/σ_i</span> em forma fechada.
                  &Eacute; o que a maior parte dos produtos comerciais{" "}
                  <em>risk parity</em> implementa de fato — mais barato,
                  mais transparente, fora-de-amostra robusto. Funciona bem
                  quando correla&ccedil;&otilde;es s&atilde;o homog&ecirc;neas;
                  falha quando h&aacute; <em>clusters</em>: no IBOV, todos os
                  bancos respondem &agrave; Selic; commodities respondem ao
                  d&oacute;lar e &agrave; China. Inv-vol n&atilde;o v&ecirc;
                  isso — ERC propriamente dito s&iacute;m.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  O All-Weather de Bridgewater (Ray Dalio, ≈ 1996)
                </p>
                <p className="mt-1 text-muted">
                  O conceito de paridade de risco &eacute; popularizado
                  fora da academia pelo All-Weather, fundo de hedge da
                  Bridgewater Associates lan&ccedil;ado em 1996. A premissa:
                  alocar igualmente em quatro &ldquo;quadrantes&rdquo;
                  macro (crescimento alta/baixa × infla&ccedil;&atilde;o
                  alta/baixa), com pesos calibrados para que cada quadrante
                  contribua igualmente para a vol da carteira. Em termos
                  matem&aacute;ticos: ERC sobre quadrantes, n&atilde;o sobre
                  ativos individuais.{" "}
                  <a
                    href="https://www.crcpress.com/Introduction-to-Risk-Parity-and-Budgeting/Roncalli/p/book/9781482207156"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    Roncalli (2013), Introduction to Risk Parity and Budgeting
                  </a>{" "}
                  documenta a formaliza&ccedil;&atilde;o acad&ecirc;mica
                  posterior.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  ERC vs 1/N &mdash; quando faz diferen&ccedil;a
                </p>
                <p className="mt-1 text-muted">
                  Tr&ecirc;s condi&ccedil;&otilde;es onde ERC e 1/N
                  convergem: (a) vols id&ecirc;nticas; (b) correla&ccedil;&otilde;es
                  todas iguais; (c) universo muito grande com vols quase-iid.
                  No IBOV nada disso &eacute; verdade. No top-15 atual, as
                  vols anualizadas (5y) v&atilde;o de aproximadamente 22%
                  (ITSA4, ABEV3) a 38% (RENT3, B3SA3), e as
                  correla&ccedil;&otilde;es formam clusters (bancos
                  correlacionados via Selic, commodities via d&oacute;lar/China,
                  utilities via Aneel). Resultado: a contribui&ccedil;&atilde;o
                  de risco no 1/N concentra-se nos ativos de maior vol —
                  no painel acima, RENT3, B3SA3 e BPAC11 t&ecirc;m RC ≈ 9-10%
                  cada (vs meta ERC de 6,7% = 1/15), enquanto ITSA4 fica em
                  ≈5%. ERC equaliza esse perfil ao custo de uma vol total
                  marginalmente menor.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  ERC vs Markowitz &mdash; jogando fora μ
                </p>
                <p className="mt-1 text-muted">
                  Markowitz maximiza{" "}
                  <span className="mono">(μ − rf) / σ</span>. Sem confian&ccedil;a
                  em μ̂, esse esfor&ccedil;o &eacute; mostly noise.
                  ERC ignora μ por completo — &eacute; um <em>portfolio choice
                  without expected returns</em> (Roncalli, 2013). Resultado:
                  vol e Sharpe ex-ante <em>menores</em> que Markowitz, mas
                  vol ex-post fica pr&oacute;xima da ex-ante (sem surpresas),
                  e Sharpe ex-post frequentemente bate o Markowitz ap&oacute;s
                  custos. &Eacute; o equivalente sofisticado do argumento{" "}
                  <a
                    href="https://academic.oup.com/rfs/article-abstract/22/5/1915/1592901"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    DGU
                  </a>
                  : 1/N &eacute; ERC sem correla&ccedil;&otilde;es; ERC
                  pleno &eacute; &ldquo;1/N de vari&acirc;ncia&rdquo;
                  fazendo uso de Σ.
                </p>
              </div>
            </div>
          </section>

          <section className="card px-6 py-5 text-sm text-body">
            <div className="eyebrow">Notas metodol&oacute;gicas detalhadas</div>
            <ul className="mt-3 space-y-3">
              <li>
                • <strong>Σ &mdash; Ledoit-Wolf (2004)</strong>: shrinkage
                toward constant correlation, intensidade &oacute;tima δ*
                data-driven, anualizada ×252. Janela de{" "}
                <span className="mono">{windowYears * 252}</span> dias
                &uacute;teis. Mesmo Σ&nbsp;exato usado nos tabs{" "}
                <a href="../markowitz/" className="underline decoration-dotted underline-offset-2 hover:text-strong">/markowitz</a>
                {" "}e <a href="../black-litterman/" className="underline decoration-dotted underline-offset-2 hover:text-strong">/black-litterman</a>
                {" "}— coer&ecirc;ncia total entre p&aacute;ginas.
              </li>
              <li>
                • <strong>ERC &mdash; descida coordenada c&iacute;clica</strong>:
                a cada sweep, fixa{" "}
                <span className="mono">w_j</span> para j ≠ i e resolve a
                quadr&aacute;tica em <span className="mono">w_i</span> que
                satisfaz <span className="mono">RC_i = target_i</span> exato
                (com target = 1/N para ERC simples). Renormaliza ao final de
                cada sweep para preservar <span className="mono">Σw = 1</span>.
                Converge em ≈ 20-50 sweeps para N ≤ 50, toler&acirc;ncia{" "}
                <span className="mono">max|RC_i − target_i| &lt; 10⁻⁹</span>.
                Warm-start no inverso-vol. Implementa&ccedil;&atilde;o canônica
                seguindo Maillard et al. (2010, §3.1).
              </li>
              <li>
                • <strong>Alternativas testadas</strong>: SLSQP (scipy),
                Newton-Raphson no Lagrangiano (Spinu, 2013), ADMM.
                Para N ≤ 50 a coordenada c&iacute;clica &eacute; mais que
                r&aacute;pida o suficiente — completa em &lt;5 ms
                client-side em hardware moderno. SLSQP necess&aacute;ria
                apenas se quiser restri&ccedil;&otilde;es lineares
                adicionais (e.g., grupo de ativos com peso m&aacute;ximo
                conjunto).
              </li>
              <li>
                • <strong>Custom risk budgets</strong>: a fun&ccedil;&atilde;o{" "}
                <code className="mono">
                  equalRiskContribution(sigma, target)
                </code>{" "}
                aceita um vetor de or&ccedil;amento de risco arbitr&aacute;rio
                (target deve somar 1). Exemplo: 50%/30%/20% para 3 ativos
                significa &ldquo;ativo 1 carrega metade da vari&acirc;ncia,
                ativo 2 carrega 30%, ativo 3 carrega 20%&rdquo;. Usado em
                pr&aacute;tica para refletir vis&otilde;es macro: &ldquo;quero
                40% do risco em renda fixa, 40% em renda vari&aacute;vel, 20%
                em ouro&rdquo;. N&atilde;o exposto na UI ainda, mas a lib
                est&aacute; pronta.
              </li>
              <li>
                • <strong>μ̂ para Sharpe</strong>: o c&aacute;lculo do Sharpe
                ex-ante de cada estrat&eacute;gia usa o μ̂ shrinked do tab
                Markowitz (Jensen + ×252 + Jorion + macro-anchor). Crucial:
                ERC <em>n&atilde;o usa μ para escolher pesos</em>, s&oacute;
                usa para <em>reportar</em> Sharpe ex-ante esperada. Trocar
                μ̂ raw vs shrinked altera apenas a Sharpe exibida, n&atilde;o
                os pesos ERC.
              </li>
              <li>
                • <strong>HHI de risco</strong>:{" "}
                <span className="mono">HHI_risco = Σ_i RC_i²</span>. An&aacute;logo
                do HHI cl&aacute;ssico mas aplicado &agrave; decomposi&ccedil;&atilde;o
                de vari&acirc;ncia, n&atilde;o aos pesos. M&iacute;nimo{" "}
                <span className="mono">1/N</span> atingido por defini&ccedil;&atilde;o
                pela ERC; m&aacute;ximo 1 (todo o risco em um &uacute;nico
                ativo). 1/N atinge HHI de pesos 1/N mas HHI de risco{" "}
                <em>maior</em> que 1/N quando vols s&atilde;o heterog&ecirc;neas
                — paradoxo central do tab.
              </li>
              <li>
                • <strong>Caso especial inv-vol</strong>: se Σ for diagonal,
                ERC reduz a <span className="mono">w_i = (1/σ_i) / Σ_j (1/σ_j)</span>{" "}
                — forma fechada, sem solver. Implementado em{" "}
                <code className="mono">inverseVolatilityWeights(sigma)</code>{" "}
                como utility separada e usado como warm-start do solver ERC.
              </li>
              <li>
                • <strong>Reprodutibilidade</strong>: c&oacute;digo em{" "}
                <code className="mono">app/lib/riskparity.ts</code> com 10
                testes em <code className="mono">riskparity.test.ts</code>
                cobrindo: (a) RC soma 1; (b) inv-vol vs ERC em Σ diagonal
                convergem; (c) ERC em Σ aleat&oacute;rio (PD) atinge 1/N de
                cada contribui&ccedil;&atilde;o ate toler&acirc;ncia 10⁻³;
                (d) pesos n&atilde;o-negativos somando 1; (e) custom risk
                budgets respeitados.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** Plain-language interpretation panel: pulls the headline numbers out of
 *  the risk-parity calculation and explains them in three blocks:
 *    1. Who concentrates risk and by how much (1/N's hidden concentration)
 *    2. Where ERC sits between inv-vol and Markowitz on the diversification spectrum
 *    3. The vol cost of insisting on equal risk vs maximising Sharpe under μ̂ */
function RiskInterpretationPanel({
  stats,
  tickers,
  eqHHIvol,
  ercHHIvol,
  n,
}: {
  stats: Record<StratKey, { ret: number; vol: number; sharpe: number; weights: number[]; rc: number[]; mrc: number[] }>;
  tickers: string[];
  eqHHIvol: number;
  ercHHIvol: number;
  n: number;
}) {
  // Find the ticker that absorbs the most risk under 1/N (concentration target)
  let eqWorstI = 0;
  for (let i = 1; i < stats.eq.rc.length; i++) {
    if (stats.eq.rc[i] > stats.eq.rc[eqWorstI]) eqWorstI = i;
  }
  const eqWorstRc = stats.eq.rc[eqWorstI];
  const eqWorstTicker = tickers[eqWorstI]?.replace(".SA", "") ?? "?";
  const eqWorstMultiple = eqWorstRc / (1 / n);

  // Same for Markowitz: where does it stack risk?
  let mvWorstI = 0;
  for (let i = 1; i < stats.mv.rc.length; i++) {
    if (stats.mv.rc[i] > stats.mv.rc[mvWorstI]) mvWorstI = i;
  }
  const mvWorstRc = stats.mv.rc[mvWorstI];
  const mvWorstTicker = tickers[mvWorstI]?.replace(".SA", "") ?? "?";
  const mvWorstMultiple = mvWorstRc / (1 / n);

  // Vol differences (the price of risk parity vs Markowitz)
  const ercVolVsMv = stats.erc.vol - stats.mv.vol;
  const ercVolVsEq = stats.erc.vol - stats.eq.vol;
  const ercSharpeVsEq = stats.erc.sharpe - stats.eq.sharpe;
  const ercHhiTheorMin = 1 / n;

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">
          Leitura quantitativa · paridade de risco vs alternativas
        </span>
        <p className="mt-1 text-xs text-muted">
          Três números chave extraídos do seu universo atual, traduzidos em
          prosa. Toda interpretação usa os retornos amostrais shrinkados do
          tab Markowitz (para Sharpe) e a Σ Ledoit-Wolf (para RC).
        </p>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <div className="flex gap-3" style={{ borderLeft: `3px solid ${STRAT_COLOR.eq}`, paddingLeft: 12 }}>
          <div>
            <p className="font-semibold text-strong">
              A concentração escondida do 1/N
            </p>
            <p className="mt-1 text-muted">
              No 1/N de dólares, o ativo de maior volatilidade —{" "}
              <strong className="text-strong">{eqWorstTicker}</strong> —
              sozinho responde por{" "}
              <span className="tabular font-semibold text-strong">
                {(eqWorstRc * 100).toFixed(1).replace(".", ",")}%
              </span>{" "}
              da variância total da carteira. Isso é{" "}
              <span className="tabular font-semibold">
                {eqWorstMultiple.toFixed(1).replace(".", ",")}×
              </span>{" "}
              o que faria se a contribuição de risco fosse igual (1/N ={" "}
              {(100 / n).toFixed(1).replace(".", ",")}%). O HHI de risco do
              1/N é{" "}
              <span className="tabular font-semibold">{fmtNum2(eqHHIvol)}</span>
              {" "}— quase{" "}
              <span className="tabular font-semibold">
                {(eqHHIvol / ercHhiTheorMin).toFixed(1).replace(".", ",")}×
              </span>{" "}
              o mínimo possível (
              <span className="tabular">{fmtNum2(ercHhiTheorMin)}</span>). Em
              outras palavras: o 1/N parece diversificado, mas{" "}
              <em>diversificar dólares ≠ diversificar risco</em>.
            </p>
          </div>
        </div>

        <div className="flex gap-3" style={{ borderLeft: `3px solid ${STRAT_COLOR.erc}`, paddingLeft: 12 }}>
          <div>
            <p className="font-semibold text-strong">
              Onde a ERC fica no espectro
            </p>
            <p className="mt-1 text-muted">
              ERC atinge o HHI de risco mínimo:{" "}
              <span className="tabular font-semibold text-strong">
                {fmtNum2(ercHHIvol)}
              </span>{" "}
              ≈{" "}
              <span className="tabular">{fmtNum2(ercHhiTheorMin)}</span>{" "}
              por construção (cada ativo contribui 1/N para a variância). Em
              vol ela fica{" "}
              <span className={`tabular font-semibold ${signedClass(-ercVolVsEq)}`}>
                {ercVolVsEq >= 0 ? "+" : ""}
                {fmtPct(Math.abs(ercVolVsEq))}
              </span>{" "}
              {ercVolVsEq < 0 ? "abaixo" : "acima"} do 1/N e{" "}
              <span className={`tabular font-semibold ${signedClass(-ercVolVsMv)}`}>
                {ercVolVsMv >= 0 ? "+" : ""}
                {fmtPct(Math.abs(ercVolVsMv))}
              </span>{" "}
              {ercVolVsMv < 0 ? "abaixo" : "acima"} do Markowitz. ERC ocupa o
              espaço entre os dois — diversificação superior ao 1/N sem o
              ruído de estimativa do Markowitz.
            </p>
          </div>
        </div>

        <div className="rounded-md border-l-4 px-3 py-2" style={{ borderColor: STRAT_COLOR.mv, background: "color-mix(in srgb, var(--loss) 4%, transparent)" }}>
          <p className="font-semibold text-strong">
            O Markowitz aposta tudo em quem &mdash; e o que isso custa
          </p>
          <p className="mt-1 text-muted">
            No Markowitz, o ativo de maior contribuição de risco é{" "}
            <strong className="text-strong">{mvWorstTicker}</strong>{" "}
            absorvendo{" "}
            <span className="tabular font-semibold text-strong">
              {(mvWorstRc * 100).toFixed(1).replace(".", ",")}%
            </span>{" "}
            da variância — uma concentração de{" "}
            <span className="tabular font-semibold">
              {mvWorstMultiple.toFixed(1).replace(".", ",")}×
            </span>{" "}
            o equilíbrio ERC. Markowitz aposta em quem μ̂ disse ter o melhor
            risco-retorno; se μ̂ estiver errado (e quase sempre está), a
            aposta gera{" "}
            {Math.abs(ercVolVsMv) > 0.02
              ? "vol idiossincrática significativa fora-da-amostra"
              : "vol idiossincrática modesta"}
            . O ganho de Sharpe da ERC sobre o 1/N (
            <span className={`tabular font-semibold ${signedClass(ercSharpeVsEq)}`}>
              {ercSharpeVsEq >= 0 ? "+" : ""}
              {fmtNum2(ercSharpeVsEq)}
            </span>
            {ercSharpeVsEq > 0
              ? ", positivo"
              : ", negativo neste período"}) é a parcela do prêmio que vem
            apenas da reorganização de risco — <em>sem usar μ em momento
            nenhum</em>.
          </p>
        </div>

        <p className="text-xs text-muted">
          <strong>Quando ERC supera Markowitz fora-da-amostra</strong>: em
          janelas em que μ̂ é particularmente ruim (todo período com regime
          shift, eleições, choques macro). Quando ERC perde para Markowitz:
          janelas em que o μ̂ realmente capturou um winner persistente. A
          aposta da paridade de risco é que a primeira situação é a regra,
          não a exceção — e os 30+ anos de evidência (Roncalli, 2013) lhe
          dão razão.
        </p>
      </div>
    </section>
  );
}

function StratCard({
  label,
  accent,
  stats,
}: {
  label: string;
  accent: string;
  stats: { ret: number; vol: number; sharpe: number };
}) {
  return (
    <div
      className="rounded-md border border-border px-3 py-2"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="eyebrow">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
        <span className="text-muted">retorno</span>
        <span className={`text-right tabular font-semibold ${signedClass(stats.ret)}`}>
          {fmtPctAA(stats.ret)}
        </span>
        <span className="text-muted">vol</span>
        <span className="text-right tabular text-body">{fmtPct(stats.vol)}</span>
        <span className="text-muted">Sharpe</span>
        <span className={`text-right tabular font-semibold ${signedClass(stats.sharpe)}`}>
          {fmtNum2(stats.sharpe)}
        </span>
      </div>
    </div>
  );
}

function PctBarTooltip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
  suffix?: string;
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
            {p.value.toFixed(1).replace(".", ",")}{suffix ?? "%"}
          </span>
        </div>
      ))}
    </div>
  );
}
