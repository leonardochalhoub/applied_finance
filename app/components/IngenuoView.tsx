"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { walkForwardBacktest, type BacktestSummary } from "@/lib/backtest";
import type { CdiArtifact, IbovArtifact, PricesArtifact } from "@/lib/data";
import {
  fmtAxisPct,
  fmtNum2,
  fmtPct,
  fmtPctAA,
  fmtPctSigned,
  signedClass,
} from "@/lib/format";
import { buildCoterminalReturns, tightenUniverseForHistory } from "@/lib/universe";

type Props = {
  prices: PricesArtifact;
  ibov: IbovArtifact | null;
  cdi: CdiArtifact | null;
};

type UniverseKey = "top15" | "top30" | "top50" | "all";

const UNIVERSE_LABELS: Record<UniverseKey, string> = {
  top15: "IBOV — 15 maiores",
  top30: "IBOV — 30 maiores",
  top50: "IBOV — 50 maiores",
  all: "IBOV completo",
};

const UNIVERSE_SIZES: Record<UniverseKey, number> = {
  top15: 15,
  top30: 30,
  top50: 50,
  all: 100,
};


export function IngenuoView({ prices, ibov, cdi }: Props) {
  const [universeKey, setUniverseKey] = useState<UniverseKey>("top30");
  const [trainYears, setTrainYears] = useState<number>(3);
  const [testQuarters, setTestQuarters] = useState<number>(1);

  const rf = useMemo(() => {
    if (!cdi?.global_mean_annual) return 0.13;
    return cdi.global_mean_annual;
  }, [cdi]);

  // Select IBOV constituents sorted by weight that ALSO exist in the prices
  // artifact. Truncated to the chosen universe size, then auto-tightened to
  // a subset with enough coterminal history for the chosen train+test budget.
  const tightening = useMemo(() => {
    const members = ibov?.members ?? [];
    const ranked = members
      .filter((m) => prices.series[m.ticker])
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const size = Math.min(UNIVERSE_SIZES[universeKey], ranked.length);
    const picked = ranked.slice(0, size);
    if (picked.length < 2) {
      return {
        requested: picked.map((m) => m.ticker),
        kept: [] as string[],
        keptWeights: null as number[] | null,
        startIdx: 0,
        availableDays: 0,
        droppedForHistory: [] as string[],
      };
    }
    const rawWeights = picked.map((m) => m.weight ?? 0);
    const required = trainYears * 252 + testQuarters * 63;
    const t = tightenUniverseForHistory(
      prices,
      picked.map((m) => m.ticker),
      rawWeights,
      required,
    );
    const sum = t.weights.reduce((a, b) => a + b, 0);
    const keptWeights = sum > 0 ? t.weights.map((w) => w / sum) : null;
    return {
      requested: picked.map((m) => m.ticker),
      kept: t.tickers,
      keptWeights,
      startIdx: t.startIdx,
      availableDays: t.availableDays,
      droppedForHistory: t.droppedForHistory,
    };
  }, [ibov, prices, universeKey, trainYears, testQuarters]);

  const universeTickers = tightening.kept;
  const benchmarkWeights = tightening.keptWeights;

  const built = useMemo(() => {
    if (universeTickers.length < 2) return null;
    return buildCoterminalReturns(prices, universeTickers, tightening.startIdx, benchmarkWeights);
  }, [prices, universeTickers, benchmarkWeights, tightening.startIdx]);

  const result = useMemo(() => {
    if (!built) return null;
    if (built.X.length < 252) return null;
    return walkForwardBacktest({
      X: built.X,
      dates: built.dates,
      benchmark: built.benchmark,
      trainDays: trainYears * 252,
      testDays: testQuarters * 63,
      rf,
      tickers: universeTickers,
    });
  }, [built, trainYears, testQuarters, rf, universeTickers]);

  // Series for the wealth-curve chart (cumulative returns, %)
  const wealthData = useMemo(() => {
    if (!result) return [];
    return result.series.map((p) => ({
      date: p.date,
      Markowitz: p.markowitz * 100,
      "1/N": p.equalWeight * 100,
      "B3 (cesta IBOV)": p.benchmark != null ? p.benchmark * 100 : null,
    }));
  }, [result]);

  // Difference series: cumulative (MV − 1/N) in percentage points. THE plot
  // of the DGU paper — when above zero, the optimizer is winning.
  const diffData = useMemo(() => {
    if (!result) return [];
    return result.series.map((p) => ({
      date: p.date,
      diff: (p.markowitz - p.equalWeight) * 100,
    }));
  }, [result]);

  // Per-period scatter: 1/N return (x) vs MV return (y). 45° line ⇒ they tied.
  // Points above the line ⇒ MV won that period; below ⇒ 1/N won.
  const scatterData = useMemo(() => {
    if (!result) return [];
    return result.series.map((p) => ({
      x: p.equalWeightPeriodReturn * 100,
      y: p.markowitzPeriodReturn * 100,
      win: p.markowitzPeriodReturn > p.equalWeightPeriodReturn ? 1 : 0,
      date: p.date,
    }));
  }, [result]);

  const scatterDomain = useMemo(() => {
    if (scatterData.length === 0) return [-10, 10] as [number, number];
    const all = scatterData.flatMap((p) => [p.x, p.y]);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const m = Math.max(Math.abs(lo), Math.abs(hi), 1);
    return [-m * 1.05, m * 1.05] as [number, number];
  }, [scatterData]);

  const mvWinPct = useMemo(() => {
    if (scatterData.length === 0) return 0;
    return scatterData.filter((p) => p.win === 1).length / scatterData.length;
  }, [scatterData]);

  const totalPeriods = result?.periods ?? 0;
  const hasResult = result != null && result.series.length > 0;

  return (
    <div className="space-y-10">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <span className="eyebrow">Configuração do experimento</span>
            <p className="mt-1 text-xs text-muted">
              Janela rolante: treina μ̂ e Σ̂ no histórico anterior, fixa pesos,
              segura por uma janela de teste, rola adiante. Mesma pipeline de
              shrinkage do tab Markowitz (Ledoit-Wolf · Jorion · macro-anchor).
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
        <div className="px-5 py-3 text-[11px] text-muted">
          {universeTickers.length} ativos
          {tightening.droppedForHistory.length > 0
            ? ` (auto-redução: ${tightening.droppedForHistory.length} excluído${tightening.droppedForHistory.length === 1 ? "" : "s"} por histórico curto — ${tightening.droppedForHistory.join(", ")})`
            : ""}
          · {built?.X.length ?? 0} dias úteis coterminais · {totalPeriods}{" "}
          rebalanceamentos · rf ={" "}
          <span className="tabular">{fmtPctAA(rf)}</span>
        </div>
      </section>

      {!hasResult ? (
        <p className="text-sm text-muted">
          Histórico insuficiente para o backtest com esta combinação.{" "}
          {built ? `(${built.X.length} dias coterminais; precisa de ${trainYears * 252 + testQuarters * 63}).` : ""}
        </p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SummaryCard label="Markowitz (max-Sharpe)" data={result!.markowitz} highlight />
            <SummaryCard label="1/N (peso igual)" data={result!.equalWeight} />
            {result!.benchmark ? (
              <SummaryCard label="B3 (cesta IBOV)" data={result!.benchmark} />
            ) : (
              <div className="card px-4 py-3 text-xs text-muted">
                Cesta IBOV não disponível.
              </div>
            )}
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
              <div>
                <span className="eyebrow">Retorno acumulado</span>
                <p className="mt-1 text-xs text-muted">
                  Capital de R$ 1 rebalanceado a cada{" "}
                  {testQuarters === 4 ? "1 ano" : `${testQuarters} trim.`} sob cada estratégia.
                </p>
              </div>
            </div>
            <div className="p-4">
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={wealthData} margin={{ top: 12, right: 20, left: 8, bottom: 28 }}>
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
                    <Tooltip content={<PctTooltip />} cursor={{ stroke: "var(--border-strong)", strokeDasharray: "2 3" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="Markowitz" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="1/N" stroke="var(--gain)" strokeWidth={1.75} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                    {result!.benchmark ? (
                      <Line type="monotone" dataKey="B3 (cesta IBOV)" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} connectNulls />
                    ) : null}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <span className="eyebrow">Markowitz − 1/N (acumulado)</span>
              <p className="mt-1 text-xs text-muted">
                Diferença de riqueza acumulada. Acima de zero ⇒ Markowitz na
                frente; abaixo ⇒ 1/N ingênuo na frente. É o gráfico-chave de
                DeMiguel-Garlappi-Uppal: em quase todos os universos a curva
                fica sob zero a maior parte do tempo.
              </p>
            </div>
            <div className="p-4">
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={diffData} margin={{ top: 12, right: 20, left: 8, bottom: 28 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} stroke="var(--border)" minTickGap={32} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} stroke="var(--border)" tickFormatter={(v) => fmtAxisPct(v / 100)} width={56} />
                    <ReferenceLine y={0} stroke="var(--border-strong)" />
                    <Tooltip content={<DiffTooltip />} cursor={{ stroke: "var(--border-strong)", strokeDasharray: "2 3" }} />
                    <Line type="monotone" dataKey="diff" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <span className="eyebrow">
                Retornos por rebalanceamento · Markowitz vs 1/N
              </span>
              <p className="mt-1 text-xs text-muted">
                Cada ponto = um período de teste. Eixo X: retorno do 1/N
                naquele trimestre. Eixo Y: retorno do Markowitz. Pontos{" "}
                <span className="font-semibold" style={{ color: "var(--gain)" }}>acima</span>{" "}
                da diagonal ⇒ Markowitz venceu no período. Frequência de
                vitórias do Markowitz:{" "}
                <span className={`tabular font-semibold ${signedClass(mvWinPct - 0.5)}`}>
                  {(mvWinPct * 100).toFixed(0)}%
                </span>{" "}
                ({totalPeriods} períodos).
              </p>
            </div>
            <div className="p-4">
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 12, right: 20, left: 8, bottom: 28 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={scatterDomain}
                      tick={{ fontSize: 10, fill: "var(--muted)" }}
                      stroke="var(--border)"
                      tickFormatter={(v) => fmtAxisPct(v / 100)}
                      name="1/N"
                      label={{ value: "Retorno 1/N (período)", position: "insideBottom", offset: -16, style: { fontSize: 11, fill: "var(--muted)" } }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={scatterDomain}
                      tick={{ fontSize: 10, fill: "var(--muted)" }}
                      stroke="var(--border)"
                      tickFormatter={(v) => fmtAxisPct(v / 100)}
                      name="Markowitz"
                      width={56}
                      label={{ value: "Markowitz", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "var(--muted)" } }}
                    />
                    <ZAxis range={[40, 40]} />
                    <ReferenceLine
                      segment={[
                        { x: scatterDomain[0], y: scatterDomain[0] },
                        { x: scatterDomain[1], y: scatterDomain[1] },
                      ]}
                      stroke="var(--border-strong)"
                      strokeDasharray="3 3"
                    />
                    <Tooltip content={<ScatterTooltip />} cursor={{ stroke: "var(--border-strong)", strokeDasharray: "2 3" }} />
                    <Scatter data={scatterData} isAnimationActive={false}>
                      {scatterData.map((p, i) => (
                        <Cell
                          key={i}
                          fill={p.win === 1 ? "var(--gain)" : "var(--loss)"}
                          fillOpacity={0.65}
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <MetricCard
              eyebrow="Turnover anual (one-way)"
              note={
                "Quanto da carteira é girada por ano. 1/N gira ≈ 0% (só rebalanceia para voltar a 1/N). Markowitz costuma girar muito porque μ̂ é instável — a maior parte do giro é ruído de estimativa, e os custos de transação corroem o pequeno ganho teórico."
              }
              rows={[
                { label: "Markowitz", value: result!.markowitz.turnoverAnn, fmt: "x" },
                { label: "1/N", value: result!.equalWeight.turnoverAnn, fmt: "x" },
              ]}
            />
            <MetricCard
              eyebrow="Concentração média (HHI)"
              note={
                "HHI = Σ wᵢ². 1/N tem HHI = 1/N — diversificação máxima. Markowitz long-only tende a empilhar peso em poucos vencedores in-sample, o que sobe HHI e a vol idiossincrática."
              }
              rows={[
                { label: "Markowitz", value: result!.markowitz.meanHHI, fmt: "num" },
                { label: "1/N", value: result!.equalWeight.meanHHI, fmt: "num" },
              ]}
            />
          </section>

          <DgvInterpretationPanel
            result={result!}
            mvWinPct={mvWinPct}
            totalPeriods={totalPeriods}
          />

          <section className="card px-6 py-5 text-sm text-body">
            <div className="eyebrow">Leitura — em profundidade</div>
            <div className="mt-3 space-y-4">
              <div>
                <p className="font-semibold text-strong">
                  O mecanismo: por que μ̂ amostral &eacute; t&atilde;o ruim
                </p>
                <p className="mt-1 text-muted">
                  O erro padr&atilde;o da m&eacute;dia amostral &eacute;{" "}
                  <span className="mono">σ̂ / √T</span>. Para uma a&ccedil;&atilde;o
                  brasileira t&iacute;pica com vol anualizada de 30% e janela de 5
                  anos (T = 1.260 dias), isso d&aacute; ±13 pontos percentuais de
                  desvio padr&atilde;o em μ̂ a.a. — uma incerteza maior que o
                  pr&ecirc;mio de risco hist&oacute;rico inteiro do mercado.{" "}
                  <a
                    href="https://www.tandfonline.com/doi/abs/10.2469/faj.v47.n2.46"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    Best &amp; Grauer (1991, FAJ)
                  </a>{" "}
                  mostraram que mudan&ccedil;as de 25 pontos b&aacute;sicos em μ̂
                  podem inverter completamente a carteira ótima. O Markowitz puro
                  &eacute; um amplificador de ruído por design — a otimiza&ccedil;&atilde;o
                  escolhe sempre o ativo com μ̂ <em>mais inflado por sorte</em>.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  O argumento matem&aacute;tico — DGU (2009)
                </p>
                <p className="mt-1 text-muted">
                  {" "}
                  <a
                    href="https://academic.oup.com/rfs/article-abstract/22/5/1915/1592901"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    DeMiguel-Garlappi-Uppal
                  </a>{" "}
                  pegaram 14 datasets cl&aacute;ssicos (S&amp;P sectors, MSCI countries,
                  Fama-French) e rodaram 14 modelos de otimiza&ccedil;&atilde;o (sample
                  MV, min-var, Bayes-Stein, Black-Litterman, kernel-shrinkage)
                  contra o ingênuo 1/N. <strong>Nenhum venceu de forma robusta
                  ap&oacute;s custos</strong>. A interpreta&ccedil;&atilde;o formal:
                  para um universo de N ativos, o tamanho de amostra T necess&aacute;rio
                  para que a otimiza&ccedil;&atilde;o supere 1/N out-of-sample &eacute;{" "}
                  <span className="mono">T &gt; 3.000 anos para N = 25 ativos</span>{" "}
                  (sob suas premissas). &Eacute; um c&aacute;lculo pr&aacute;tico:
                  μ̂ &eacute; estatisticamente fr&aacute;gil demais para
                  exper&ecirc;ncia humana de uma vida.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  O argumento comportamental — Kahneman (1984/2011)
                </p>
                <p className="mt-1 text-muted">
                  {" "}
                  <a
                    href="https://www.nobelprize.org/prizes/economic-sciences/2002/kahneman/facts/"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    Kahneman
                  </a>{" "}
                  recebeu, em 1984, dados de uma firma de wealth management
                  com 25 anos de avalia&ccedil;&otilde;es de 28 consultores. Calculou
                  a correla&ccedil;&atilde;o ano-a-ano dos rankings de retorno:
                  <strong> m&eacute;dia 0,01 sobre 378 pares</strong>. Em{" "}
                  <a
                    href="https://us.macmillan.com/books/9780374533557/thinkingfastandslow"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    Thinking, Fast and Slow (2011)
                  </a>{" "}
                  batizou o resultado de <em>The Illusion of Skill</em>: o setor
                  financeiro &eacute; pago para entregar persist&ecirc;ncia que
                  estatisticamente n&atilde;o existe. Detalhe na p&aacute;gina{" "}
                  <a href="../kahneman/" className="underline decoration-dotted underline-offset-2 hover:text-strong">
                    /kahneman
                  </a>
                  .
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Por que 1/N &eacute; t&atilde;o competitivo
                </p>
                <p className="mt-1 text-muted">
                  Tr&ecirc;s motivos compostos: (1) 1/N tem turnover ≈ 0 — n&atilde;o
                  paga corretagem nem spread; (2) HHI = 1/N mantém o risco
                  idiossincr&aacute;tico baixo; (3) μ̂ n&atilde;o entra na decis&atilde;o,
                  ent&atilde;o erro de estimativa em μ &eacute; zero. O custo: 1/N
                  ignora informa&ccedil;&atilde;o relevante (correla&ccedil;&otilde;es,
                  vols distintas). Mas como essa informa&ccedil;&atilde;o &eacute;
                  imperfeita, o ganho te&oacute;rico do Markowitz &eacute; menor que
                  a perda pr&aacute;tica do erro de estimativa.{" "}
                  <a
                    href="https://www.jstor.org/stable/4479185"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    Michaud (1989, FAJ)
                  </a>{" "}
                  chamou isso de <em>error maximization</em>: o otimizador
                  amplifica os erros porque os pesos &oacute;timos s&atilde;o n&atilde;o-lineares
                  em μ̂.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Quando Markowitz vence 1/N
                </p>
                <p className="mt-1 text-muted">
                  Tr&ecirc;s regimes onde a otimiza&ccedil;&atilde;o adiciona valor:
                  (a) universos muito grandes (N &gt; 100) com pares fortemente
                  correlacionados — 1/N concentra risco em fatores latentes; (b)
                  janelas longas e est&aacute;veis (10+ anos sem regime shift) em
                  que μ̂ &eacute; menos ruidoso; (c) quando o investidor tem{" "}
                  <em>views</em> reais sobre alguns ativos —{" "}
                  <a
                    href="https://www.tandfonline.com/doi/abs/10.2469/faj.v48.n5.28"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    Black-Litterman (1992)
                  </a>{" "}
                  &eacute; o framework canônico para incorpor&aacute;-las sem voltar
                  ao Markowitz puro (ver tab{" "}
                  <a href="../black-litterman/" className="underline decoration-dotted underline-offset-2 hover:text-strong">
                    /black-litterman
                  </a>
                  ).
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Alternativas ao trade-off cl&aacute;ssico
                </p>
                <p className="mt-1 text-muted">
                  Duas ramifica&ccedil;&otilde;es modernas: (i){" "}
                  <strong>Paridade de risco</strong> — Maillard, Roncalli &amp;
                  Teïletche (2010), o &ldquo;1/N de vari&acirc;ncia&rdquo;: pesos
                  tais que cada ativo contribua igualmente para σ²_p, sem usar μ̂.
                  Ver tab{" "}
                  <a href="../paridade/" className="underline decoration-dotted underline-offset-2 hover:text-strong">
                    /paridade
                  </a>
                  . (ii) <strong>EMH passiva</strong> — Bogle (1976), Malkiel
                  (1973),{" "}
                  <a
                    href="https://www.nobelprize.org/prizes/economic-sciences/2013/fama/facts/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    Fama (Nobel 2013)
                  </a>
                  : se mercados s&atilde;o eficientes, qualquer otimiza&ccedil;&atilde;o
                  ativa &eacute; ru&iacute;do, e a carteira de mercado domina.
                  &Eacute; o limite te&oacute;rico do argumento DGU.
                </p>
              </div>
            </div>
          </section>

          <section className="card px-6 py-5 text-sm text-body">
            <div className="eyebrow">Notas metodol&oacute;gicas detalhadas</div>
            <ul className="mt-3 space-y-3">
              <li>
                • <strong>Universo padr&atilde;o</strong>:{" "}
                {universeTickers.length} maiores constituintes do IBOV (por peso
                de mercado) com hist&oacute;rico coterminal completo. A fun&ccedil;&atilde;o{" "}
                <code className="mono">tightenUniverseForHistory</code> auto-derruba
                tickers com hist&oacute;rico curto (IPOs recentes, fus&otilde;es) at&eacute;
                que a janela coterminal cubra <span className="mono">trainDays + testDays</span>{" "}
                — mostrado em texto acima dos controles.
              </li>
              <li>
                • <strong>Pipeline Markowitz</strong> (id&ecirc;ntico ao tab{" "}
                <a href="../markowitz/" className="underline decoration-dotted underline-offset-2 hover:text-strong">
                  /markowitz
                </a>
                ): (1) Σ&nbsp;Ledoit-Wolf (2004) com alvo de correla&ccedil;&atilde;o
                constante e intensidade &oacute;tima δ* data-driven; (2) μ̂_log
                anualizada com Jensen correction; (3) Jorion (1986) shrinkage
                toward grand mean; (4) macro-anchor toward{" "}
                <span className="mono">rf + ERP</span> com α data-driven (≈ 0,42
                em 5y); (5) teto por ativo em{" "}
                <span className="mono">rf + 3·ERP ≈ 31%</span>. Long-only via
                active-set greedy. Sem isso a fronteira mostraria μ̂ de 60-100%
                a.a.
              </li>
              <li>
                • <strong>Sem look-ahead</strong>: o estimador de μ̂/Σ̂ usa
                <em> estritamente</em> o hist&oacute;rico anterior ao in&iacute;cio do
                per&iacute;odo de teste; nenhum dado do futuro contamina a decis&atilde;o.
                Cada rebalanceamento &eacute; uma <em>walk-forward</em> independente.
                A carteira &eacute; mantida fixa durante a janela de teste — sem
                rebalanceamento intra-per&iacute;odo, sem look-back-bias.
              </li>
              <li>
                • <strong>Retornos compostos</strong>: para cada per&iacute;odo de
                teste, calcula-se o retorno cumulativo (log) de cada ticker,
                converte-se para simples (
                <span className="mono">e^cumLog − 1</span>), pondera-se pelos
                pesos da carteira, e converte-se de volta para log. Isso d&aacute;
                o retorno simples real da carteira, n&atilde;o uma aproxima&ccedil;&atilde;o
                via retorno log das m&eacute;dias.
              </li>
              <li>
                • <strong>Benchmark B3 (cesta IBOV)</strong>: aproxima&ccedil;&atilde;o
                com pesos fixos no <em>&uacute;ltimo</em> snapshot do &iacute;ndice. N&atilde;o
                captura: (a) rebalanceamentos trimestrais do IBOV; (b) IPOs/deslistagens
                durante a janela; (c) corre&ccedil;&otilde;es de Free-Float Adjustment.
                &Eacute; uma refer&ecirc;ncia de mercado, n&atilde;o uma replica&ccedil;&atilde;o
                fiel do índice. Para uma replica&ccedil;&atilde;o estrita, use ETF
                BOVA11 como proxy direto.
              </li>
              <li>
                • <strong>Turnover anualizado one-way</strong>:{" "}
                <span className="mono">
                  T<sub>ano</sub> = (1/(T−1)) Σ_t (½ Σ_i |w<sub>i,t</sub> − w<sub>i,t−1</sub>|) × ν<sub>ano</sub>
                </span>
                . O fator ½ &eacute; a conven&ccedil;&atilde;o &ldquo;one-way&rdquo;
                (uma rota&ccedil;&atilde;o 50%→50% conta como 50% de turnover, n&atilde;o
                100%). ν<sub>ano</sub> = 252 / testDays &eacute; a frequ&ecirc;ncia
                anualizada de rebalanceamento.
              </li>
              <li>
                • <strong>HHI m&eacute;dio</strong>:{" "}
                <span className="mono">HHI = Σ_i w_i²</span>, m&eacute;dia sobre
                rebalanceamentos. M&iacute;nimo te&oacute;rico = 1/N (atingido por
                1/N por defini&ccedil;&atilde;o); m&aacute;ximo = 1 (carteira em
                um &uacute;nico ativo). HHI 0,2 ≈ &ldquo;diversificada em 5 ativos
                equivalentes&rdquo;; HHI 0,5 ≈ &ldquo;concentrada em 2 ativos&rdquo;.
              </li>
              <li>
                • <strong>Custos de transa&ccedil;&atilde;o estimados</strong>:
                0,20% por turnover one-way no painel de leitura. Decomposi&ccedil;&atilde;o:
                ≈ 0,03% corretagem + 0,03% emolumentos + 0,05% IRRF curto + 0,05%
                spread t&iacute;pico + 0,04% slippage em ativos menos l&iacute;quidos.
                Investidores institucionais conseguem ≈ 0,05%; HFTs operam
                quase zero. Reduza para 0,10% se quiser modelar uma corretora
                moderna sem custos fixos.
              </li>
              <li>
                • <strong>Reprodutibilidade</strong>: todo o c&oacute;digo do
                backtest est&aacute; em{" "}
                <code className="mono">app/lib/backtest.ts</code> e{" "}
                <code className="mono">app/lib/universe.ts</code>, com testes
                em <code className="mono">backtest.test.ts</code> (13 cen&aacute;rios,
                de garantia de turnover-zero do 1/N at&eacute; consist&ecirc;ncia
                cumulativo-vs-per&iacute;odo). Seed determin&iacute;stica para
                amostragens; mesmas estat&iacute;sticas em todo reload.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** DGU "verdict" panel: pulls the headline numbers out of the walk-forward
 *  result and renders them in plain prose so the reader doesn't have to
 *  combine cards mentally. Two qualitative readings:
 *    1. Sharpe gap MV − 1/N (annualised) — the DGU headline metric.
 *    2. Turnover & HHI ratio — the price of chasing μ̂. */
function DgvInterpretationPanel({
  result,
  mvWinPct,
  totalPeriods,
}: {
  result: import("@/lib/backtest").BacktestResult;
  mvWinPct: number;
  totalPeriods: number;
}) {
  const sharpeDelta = result.markowitz.sharpe - result.equalWeight.sharpe;
  const retDelta = result.markowitz.retAnn - result.equalWeight.retAnn;
  const volDelta = result.markowitz.volAnn - result.equalWeight.volAnn;
  const ddDelta = result.markowitz.maxDD - result.equalWeight.maxDD; // both negative
  const turnoverRatio =
    result.equalWeight.turnoverAnn > 1e-6
      ? result.markowitz.turnoverAnn / result.equalWeight.turnoverAnn
      : result.markowitz.turnoverAnn / 0.01; // sentinel — 1/N turnover ≈ 0
  const hhiRatio = result.markowitz.meanHHI / result.equalWeight.meanHHI;
  const mvBeatEQ = result.markowitz.sharpe > result.equalWeight.sharpe;
  const mvWonMajority = mvWinPct > 0.5;
  // Rough transaction-cost penalty estimate at 0.20% per one-way turnover
  // (typical Brazilian retail brokerage all-in cost). Annualised drag.
  const TRANSACTION_COST = 0.002;
  const mvTcDrag = result.markowitz.turnoverAnn * TRANSACTION_COST;
  const eqTcDrag = result.equalWeight.turnoverAnn * TRANSACTION_COST;
  const sharpeDeltaAfterTC =
    (result.markowitz.retAnn - mvTcDrag - 0.1277) / result.markowitz.volAnn -
    (result.equalWeight.retAnn - eqTcDrag - 0.1277) / result.equalWeight.volAnn;

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">
          Veredito DGU · o que este backtest específico diz
        </span>
        <p className="mt-1 text-xs text-muted">
          Cinco números extraídos da janela rolante deste experimento
          (treino {result.trainDays}d / teste {result.testDays}d ×{" "}
          {totalPeriods} rebalanceamentos) com leitura em prosa.
          DeMiguel-Garlappi-Uppal (2009) é vindicado quando o 1/N entrega
          Sharpe maior que Markowitz após custos.
        </p>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <div className="flex gap-3" style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 12 }}>
          <div>
            <p className="font-semibold text-strong">
              Frequência de vitórias por período
            </p>
            <p className="mt-1 text-muted">
              Markowitz superou o 1/N em{" "}
              <span className={`tabular font-semibold ${signedClass(mvWinPct - 0.5)}`}>
                {(mvWinPct * 100).toFixed(0)}%
              </span>{" "}
              dos {totalPeriods} períodos de teste.{" "}
              {mvWonMajority
                ? "Vence a maioria, mas isso por si só não basta — basta uma derrota grande para anular várias vitórias pequenas (assimetria de payoff)."
                : "Perde a maioria. DGU formalizado: a otimização sob μ̂ ruidoso não compensa em frequência."}
            </p>
          </div>
        </div>

        <div className="flex gap-3" style={{ borderLeft: `3px solid ${mvBeatEQ ? "var(--gain)" : "var(--loss)"}`, paddingLeft: 12 }}>
          <div>
            <p className="font-semibold text-strong">
              Sharpe anualizado — Markowitz vs 1/N
            </p>
            <p className="mt-1 text-muted">
              Markowitz:{" "}
              <span className="tabular font-semibold">{fmtNum2(result.markowitz.sharpe)}</span>
              {" "}· 1/N:{" "}
              <span className="tabular font-semibold">{fmtNum2(result.equalWeight.sharpe)}</span>
              . Diferença ={" "}
              <span className={`tabular font-semibold ${signedClass(sharpeDelta)}`}>
                {sharpeDelta >= 0 ? "+" : ""}
                {fmtNum2(sharpeDelta)}
              </span>{" "}
              ({mvBeatEQ ? "Markowitz à frente" : "1/N à frente"}). Em retorno:{" "}
              <span className={`tabular font-semibold ${signedClass(retDelta)}`}>
                {fmtPctAA(retDelta)}
              </span>
              ; em vol:{" "}
              <span className="tabular">
                {volDelta >= 0 ? "+" : ""}
                {fmtPct(Math.abs(volDelta))}
              </span>
              ; em max DD:{" "}
              <span className={`tabular ${signedClass(-ddDelta)}`}>
                {ddDelta >= 0 ? "+" : ""}
                {fmtPctSigned(ddDelta)}
              </span>
              .
            </p>
          </div>
        </div>

        <div className="rounded-md border-l-4 px-3 py-2" style={{ borderColor: "var(--strong)", background: "color-mix(in srgb, var(--strong) 5%, transparent)" }}>
          <p className="font-semibold text-strong">
            O preço de chasing μ̂: turnover e HHI
          </p>
          <p className="mt-1 text-muted">
            Markowitz gira{" "}
            <span className="tabular font-semibold">
              {fmtNum2(result.markowitz.turnoverAnn)}× a.a.
            </span>
            , enquanto 1/N gira{" "}
            <span className="tabular">
              {fmtNum2(result.equalWeight.turnoverAnn)}× a.a.
            </span>{" "}
            — Markowitz tem{" "}
            <span className="tabular font-semibold text-strong">
              {turnoverRatio.toFixed(0)}×
            </span>{" "}
            mais turnover. HHI médio da Markowitz é{" "}
            <span className="tabular font-semibold text-strong">
              {hhiRatio.toFixed(1)}×
            </span>{" "}
            o do 1/N, ou seja, concentra peso em{" "}
            {hhiRatio > 2.5
              ? "menos da metade dos ativos"
              : hhiRatio > 1.5
                ? "uma fração menor do universo"
                : "quase todo o universo"}{" "}
            — empilhando posições no que μ̂ exagera. <em>É exatamente o
            mecanismo de &ldquo;error maximization&rdquo; de Michaud (1989)</em>.
          </p>
        </div>

        <div className="rounded-md border-l-4 px-3 py-2" style={{ borderColor: "var(--loss)", background: "color-mix(in srgb, var(--loss) 4%, transparent)" }}>
          <p className="font-semibold text-strong">
            Sharpe após custos de transação estimados
          </p>
          <p className="mt-1 text-muted">
            A 0,20% de custo por turnover one-way (estimativa conservadora
            para corretagem brasileira retail all-in), Markowitz perde ≈{" "}
            <span className="tabular font-semibold">{fmtPctAA(mvTcDrag).replace("+", "")}</span>{" "}
            de retorno; 1/N perde ≈{" "}
            <span className="tabular">{fmtPctAA(eqTcDrag).replace("+", "")}</span>
            . Sharpe ajustado (delta MV − 1/N):{" "}
            <span className={`tabular font-semibold ${signedClass(sharpeDeltaAfterTC)}`}>
              {sharpeDeltaAfterTC >= 0 ? "+" : ""}
              {fmtNum2(sharpeDeltaAfterTC)}
            </span>{" "}
            (vs{" "}
            <span className={`tabular ${signedClass(sharpeDelta)}`}>
              {sharpeDelta >= 0 ? "+" : ""}
              {fmtNum2(sharpeDelta)}
            </span>{" "}
            sem custos).{" "}
            {sharpeDeltaAfterTC < 0 && sharpeDelta > 0
              ? "Markowitz vence sem custos mas perde quando o turnover é cobrado — o ganho teórico não sobrevive ao atrito real. Este é o achado clássico de DGU."
              : sharpeDeltaAfterTC < 0
                ? "1/N permanece à frente mesmo descontados custos."
                : "Markowitz mantém a vantagem mesmo após custos de transação — caso raro em DGU."}
          </p>
        </div>

        <p className="text-xs text-muted">
          <strong>O custo de 0,20% por turnover</strong> é uma estimativa
          aproximada (corretagem zero + impostos + spread + custódia +
          slippage de execução em ativos menos líquidos da B3). Reduções
          recentes em corretagem retail trouxeram esse número para próximo
          de 0,10%; gestores institucionais conseguem ≈ 0,05%; HFTs operam
          com custos efetivamente nulos. O ponto qualitativo — o ganho
          teórico do Markowitz é da mesma ordem do custo de implementação —
          se mantém em qualquer cenário razoável.
        </p>
      </div>
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
        highlight
          ? "border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"
          : "border-border"
      }`}
    >
      <div className="eyebrow">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
        <span className="text-muted">retorno</span>
        <span className={`text-right tabular font-semibold ${signedClass(data.retAnn)}`}>
          {fmtPctAA(data.retAnn)}
        </span>
        <span className="text-muted">vol</span>
        <span className="text-right tabular text-body">
          {fmtPctAA(data.volAnn).replace("+", "")}
        </span>
        <span className="text-muted">Sharpe</span>
        <span className={`text-right tabular font-semibold ${signedClass(data.sharpe)}`}>
          {fmtNum2(data.sharpe)}
        </span>
        <span className="text-muted">max DD</span>
        <span className="text-right tabular text-[color:var(--loss)]">
          {fmtPctSigned(data.maxDD)}
        </span>
        <span className="text-muted">turnover</span>
        <span className="text-right tabular text-body">
          {fmtNum2(data.turnoverAnn)}× a.a.
        </span>
        <span className="text-muted">HHI</span>
        <span className="text-right tabular text-body">{fmtNum2(data.meanHHI)}</span>
      </div>
    </div>
  );
}

function MetricCard({
  eyebrow,
  note,
  rows,
}: {
  eyebrow: string;
  note: string;
  rows: { label: string; value: number; fmt: "x" | "num" }[];
}) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">{eyebrow}</span>
        <p className="mt-1 text-xs text-muted">{note}</p>
      </div>
      <div className="px-5 py-4">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border last:border-0">
                <td className="py-2 text-body">{r.label}</td>
                <td className="py-2 text-right tabular font-semibold text-strong">
                  {r.fmt === "x" ? `${fmtNum2(r.value)}× a.a.` : fmtNum2(r.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PctTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number | null; color: string }[];
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
            {p.value != null
              ? `${p.value >= 0 ? "+" : ""}${p.value.toFixed(1).replace(".", ",")}%`
              : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiffTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = payload[0].value;
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
      <div className="flex items-center justify-between gap-4">
        <span>Markowitz − 1/N</span>
        <span
          className="tabular font-semibold"
          style={{ color: v >= 0 ? "var(--gain)" : "var(--loss)" }}
        >
          {`${v >= 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%`}
        </span>
      </div>
    </div>
  );
}

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { x: number; y: number; date: string; win: number } }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
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
        {p.date}
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>1/N</span>
        <span className="tabular">{`${p.x >= 0 ? "+" : ""}${p.x.toFixed(1).replace(".", ",")}%`}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>Markowitz</span>
        <span className="tabular">{`${p.y >= 0 ? "+" : ""}${p.y.toFixed(1).replace(".", ",")}%`}</span>
      </div>
      <div
        className="mt-1 text-[10px]"
        style={{ color: p.win === 1 ? "var(--gain)" : "var(--loss)" }}
      >
        {p.win === 1 ? "Markowitz venceu" : "1/N venceu"}
      </div>
    </div>
  );
}
