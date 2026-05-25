"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CdiArtifact, IbovArtifact, PricesArtifact } from "@/lib/data";
import { fmtAxisNum, fmtNum2, fmtPctAA, signedClass } from "@/lib/format";
import { runIllusionExperiment, type IllusionResult, type NamedPortfolio } from "@/lib/illusion";
import {
  runRollingPersistenceExperiment,
  type RollingPersistenceResult,
} from "@/lib/persistence";
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

// IMPORTANT: bar color must NOT match any reference-line color, otherwise the
// line is invisible against the histogram. Use a neutral gray for bars so all
// four colored reference lines (red ex-ante, blue ex-post, green 1/N, muted
// median) pop.
// IMPORTANT: bar color must NOT match any reference-line color, otherwise the
// line is invisible against the histogram. Bars are now neutral gray so the
// four colored reference lines (red ex-ante, blue ex-post, green 1/N, muted
// median) all pop independently.
const COLOURS = {
  bar: "var(--muted)",
  exAnte: "var(--loss)",
  exPost: "var(--accent)",
  eq: "var(--gain)",
  median: "var(--muted)",
};

export function KahnemanView({ prices, ibov, cdi }: Props) {
  const [universeKey, setUniverseKey] = useState<UniverseKey>("top30");
  const [trainYears, setTrainYears] = useState<number>(2);
  const [testYears, setTestYears] = useState<number>(2);
  const [nRandom, setNRandom] = useState<number>(5000);

  const rf = useMemo(() => cdi?.global_mean_annual ?? 0.13, [cdi]);

  const tightening = useMemo(() => {
    const members = ibov?.members ?? [];
    const ranked = members
      .filter((m) => prices.series[m.ticker])
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const size = Math.min(UNIVERSE_SIZES[universeKey], ranked.length);
    const picked = ranked.slice(0, size);
    if (picked.length < 2) {
      return { kept: [] as string[], startIdx: 0, droppedForHistory: [] as string[] };
    }
    const required = (trainYears + testYears) * 252;
    const t = tightenUniverseForHistory(
      prices,
      picked.map((m) => m.ticker),
      picked.map((m) => m.weight ?? 0),
      required,
    );
    return { kept: t.tickers, startIdx: t.startIdx, droppedForHistory: t.droppedForHistory };
  }, [ibov, prices, universeKey, trainYears, testYears]);

  const built = useMemo(() => {
    if (tightening.kept.length < 2) return null;
    return buildCoterminalReturns(prices, tightening.kept, tightening.startIdx, null);
  }, [prices, tightening]);

  const result: IllusionResult | null = useMemo(() => {
    if (!built) return null;
    if (built.X.length < (trainYears + testYears) * 252) return null;
    return runIllusionExperiment({
      X: built.X,
      dates: built.dates,
      tickers: tightening.kept,
      rf,
      trainDays: trainYears * 252,
      testDays: testYears * 252,
      nRandom,
    });
  }, [built, trainYears, testYears, nRandom, rf, tightening.kept]);

  // Rolling persistence experiment — the Kahneman-correct test that asks:
  // "does Markowitz's percentile (vs concentrated random K-bets) repeat
  // across non-overlapping windows?" This is the analog of Kahneman's
  // 1984 year-pair correlation. Cheaper nRandom per window since we run
  // it once per window. Uses the same trainYears / testYears UI controls
  // but a step of (testYears * 252) so windows are non-overlapping.
  const persistenceResult: RollingPersistenceResult | null = useMemo(() => {
    if (!built) return null;
    const trainDays = trainYears * 252;
    const testDays = testYears * 252;
    if (built.X.length < trainDays + testDays + testDays) return null;
    return runRollingPersistenceExperiment({
      X: built.X,
      dates: built.dates,
      tickers: tightening.kept,
      rf,
      trainDays,
      testDays,
      stepDays: testDays, // non-overlapping windows
      nRandom: Math.min(1000, nRandom),
    });
  }, [built, trainYears, testYears, nRandom, rf, tightening.kept]);

  // Extend x-domain to fit ALL four named portfolios at their TRUE positions.
  // We tried two failed alternatives before settling here:
  //   (a) Padding only the histogram extent ⇒ Markowitz lines got clipped to
  //       the edge and stacked, hiding the gap between them — visually a lie.
  //   (b) Clamping off-axis lines to the chart edge with arrows ⇒ when BOTH
  //       Markowitz Sharpes were off-axis, both clamped to the same edge and
  //       the red ex-ante line vanished beneath the blue ex-post (red was
  //       drawn second-to-last). User couldn't see the gap at all.
  // The current approach extends the domain to include every named portfolio
  // at its real Sharpe. The visual "gap" between the histogram and the
  // Markowitz lines is itself the story: the optimist's μ̂ produces a
  // promise so extreme that no random portfolio comes close.
  const histDomain = useMemo((): [number, number] => {
    if (!result || result.histogram.length === 0) return [-1, 1];
    const lo = result.histogram[0].binStart;
    const hi = result.histogram[result.histogram.length - 1].binEnd;
    const extras = [
      result.markowitzExAnte.sharpe,
      result.markowitzExPost.sharpe,
      result.equalWeight.sharpe,
      result.medianRandom.sharpe,
    ];
    const allLo = Math.min(lo, ...extras);
    const allHi = Math.max(hi, ...extras);
    const span = Math.max(allHi - allLo, 0.1);
    return [allLo - 0.03 * span, allHi + 0.08 * span];
  }, [result]);

  return (
    <div className="space-y-10">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <span className="eyebrow">Configuração do experimento</span>
            <p className="mt-1 text-xs text-muted">
              Divide a janela coterminal em treino (otimização) e teste
              (avaliação). O histograma mostra a distribuição da Sharpe
              realizada de N carteiras long-only sorteadas uniformemente no
              simplex, no período de teste.
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
                <option value={1}>1 ano</option>
                <option value={2}>2 anos</option>
                <option value={3}>3 anos</option>
                <option value={5}>5 anos</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              teste:
              <select
                value={testYears}
                onChange={(e) => setTestYears(Number(e.target.value))}
                className="rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-xs"
              >
                <option value={1}>1 ano</option>
                <option value={2}>2 anos</option>
                <option value={3}>3 anos</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              sorteios:
              <select
                value={nRandom}
                onChange={(e) => setNRandom(Number(e.target.value))}
                className="rounded-md border border-border bg-[color:var(--bg-base)] px-2 py-1 text-xs"
              >
                <option value={1000}>1.000</option>
                <option value={2500}>2.500</option>
                <option value={5000}>5.000</option>
                <option value={10000}>10.000</option>
              </select>
            </label>
          </div>
        </div>
        <div className="px-5 py-3 text-[11px] text-muted">
          {tightening.kept.length} ativos
          {tightening.droppedForHistory.length > 0
            ? ` (auto-redução: ${tightening.droppedForHistory.length} excluído${tightening.droppedForHistory.length === 1 ? "" : "s"} por histórico curto — ${tightening.droppedForHistory.join(", ")})`
            : ""}{" "}
          · {built?.X.length ?? 0} dias úteis coterminais · rf ={" "}
          <span className="tabular">{fmtPctAA(rf)}</span>
          {result ? (
            <>
              {" "}
              · treino {result.trainStart} → {result.trainEnd} · teste{" "}
              {result.testStart} → {result.testEnd}
            </>
          ) : null}
        </div>
      </section>

      {!result ? (
        <p className="text-sm text-muted">
          Histórico insuficiente para a divisão treino/teste com esta
          combinação. {built ? `(${built.X.length} dias coterminais; precisa de ${(trainYears + testYears) * 252}).` : ""}
        </p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <SkillCard
              label="Markowitz ex-ante"
              hint="o que o otimizador PROMETEU"
              p={result.markowitzExAnte}
              accent={COLOURS.exAnte}
            />
            <SkillCard
              label="Markowitz ex-post"
              hint="o que ELE ENTREGOU"
              p={result.markowitzExPost}
              accent={COLOURS.exPost}
            />
            <SkillCard
              label="1/N (peso igual)"
              hint="benchmark ingênuo"
              p={result.equalWeight}
              accent={COLOURS.eq}
            />
            <SkillCard
              label="Mediana aleatória"
              hint={`50º percentil de ${result.nRandom.toLocaleString("pt-BR")} sorteios`}
              p={result.medianRandom}
              accent={COLOURS.median}
            />
          </section>

          <section className="card px-6 py-5 text-sm text-body">
            <div className="eyebrow">Dois experimentos, duas perguntas distintas</div>
            <ul className="mt-3 space-y-2">
              <li>
                <strong>Exp. 1 (a seguir) — viés de Kan-Smith em janela única</strong>:
                quanto a Sharpe declarada pelo otimizador (ex-ante) infla a
                Sharpe que efetivamente entrega (ex-post) numa janela específica?
                Mede a magnitude do viés in-sample, formalizado por{" "}
                <a
                  href="https://www.jstor.org/stable/25470994"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-strong"
                >
                  Kan &amp; Smith (2008)
                </a>
                . É um teste de <em>otimismo amostral</em>, não da tese de
                Kahneman propriamente dita.
              </li>
              <li>
                <strong>Exp. 2 (logo abaixo do Exp. 1) — persistência de
                Kahneman em janelas rolantes</strong>: a vantagem (ou
                desvantagem) da Markowitz numa janela prediz a vantagem na
                janela seguinte? Calcula a autocorrelação lag-1 do percentil
                da Markowitz através de várias janelas não-sobrepostas. É a
                versão portfolio do achado de{" "}
                <a
                  href="https://www.nobelprize.org/prizes/economic-sciences/2002/kahneman/facts/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-strong"
                >
                  Kahneman
                </a>{" "}
                (1984/2011): correlação ano-a-ano ≈ 0,01 entre gestores ativos.
                Se a autocorrelação aqui ficar próxima de zero, é o mesmo
                resultado empírico: skill aparente em uma janela não se
                repete na próxima.
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted">
              Os dois experimentos compartilham o mesmo universo, mesmo
              pipeline (Ledoit-Wolf + Jorion + macro-anchor), mesma fonte
              de rf. Diferem apenas no <em>arranjo</em> da janela.
            </p>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <span className="eyebrow">
                Exp. 1 · Distribuição de Sharpe realizada (Kan-Smith em janela única) · {result.nRandom.toLocaleString("pt-BR")} carteiras sorteadas
              </span>
              <p className="mt-1 text-xs text-muted">
                Cada barra é uma <em>faixa de Sharpe</em>; a altura é o número
                de carteiras aleatórias (de um total de{" "}
                {result.nRandom.toLocaleString("pt-BR")}) que entregaram um
                Sharpe naquela faixa <em>no período de teste</em>. A{" "}
                <span className="text-strong">banda sombreada</span> marca o
                suporte da distribuição aleatória — o intervalo de Sharpe que
                <em> alguma</em> carteira sorteada efetivamente atingiu. As
                quatro linhas verticais são <em>portfólios nomeados</em>{" "}
                colocados na mesma escala de Sharpe para comparação.{" "}
                <strong>Linha fora da banda sombreada significa &ldquo;Sharpe
                que nenhum sorteio alcançou&rdquo;</strong> — Markowitz fica
                em &ldquo;espaço vazio&rdquo; quando sua tangência é tão
                otimista que escapa do que a aleatoriedade consegue produzir.{" "}
                <strong className="text-strong">A ilusão</strong> é o intervalo
                horizontal entre a linha{" "}
                <span style={{ color: "var(--loss)" }}>vermelha</span> (ex-ante,
                a promessa) e a linha{" "}
                <span style={{ color: "var(--accent)" }}>azul</span> (ex-post,
                a entrega).
              </p>
            </div>
            <div className="p-4">
              <div style={{ width: "100%", height: 380 }}>
                <ResponsiveContainer>
                  <BarChart
                    data={result.histogram}
                    margin={{ top: 28, right: 60, left: 8, bottom: 28 }}
                    barCategoryGap={1}
                  >
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="binMid"
                      type="number"
                      domain={histDomain}
                      allowDataOverflow={false}
                      tick={{ fontSize: 10, fill: "var(--muted)" }}
                      stroke="var(--border)"
                      tickFormatter={(v) => fmtAxisNum(v)}
                      label={{ value: "Sharpe realizado (teste)", position: "insideBottom", offset: -16, style: { fontSize: 11, fill: "var(--muted)" } }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--muted)" }}
                      stroke="var(--border)"
                      width={48}
                      label={{ value: "carteiras", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "var(--muted)" } }}
                    />
                    <Tooltip content={<HistogramTooltip />} cursor={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)" }} />
                    {/* Subtle shaded band marking the SUPPORT of the random
                        distribution — the range of Sharpe values actually
                        achieved by the 5,000 sampled portfolios. Named lines
                        OUTSIDE this band fall in "empty space" by definition:
                        no random portfolio reached that Sharpe. The shading
                        makes this geometry visually explicit. */}
                    <ReferenceArea
                      x1={result.histogram[0].binStart}
                      x2={result.histogram[result.histogram.length - 1].binEnd}
                      fill="var(--muted)"
                      fillOpacity={0.06}
                      stroke="var(--muted)"
                      strokeOpacity={0.25}
                      strokeDasharray="3 4"
                    />
                    <Bar dataKey="count" isAnimationActive={false}>
                      {result.histogram.map((_, i) => (
                        <Cell key={i} fill={COLOURS.bar} fillOpacity={0.55} />
                      ))}
                    </Bar>
                    {/* All four named portfolios are drawn at their TRUE Sharpe
                        positions. Render order matters: the blue ex-post line
                        is declared LAST so it always draws on top of overlapping
                        lines. Labels embed the Sharpe value so the reader gets
                        the number directly off the chart without consulting
                        the KPI cards above. Right-side lines (ex-ante, ex-post)
                        use `insideTopLeft` so their labels grow LEFTWARD into
                        the chart and never get cut off by the right margin. */}
                    <ReferenceLine
                      x={result.medianRandom.sharpe}
                      stroke={COLOURS.median}
                      strokeWidth={1.5}
                      strokeDasharray="2 4"
                      label={{
                        value: `mediana ${fmtNum2(result.medianRandom.sharpe)}`,
                        position: "insideBottom",
                        offset: 6,
                        style: { fontSize: 10, fill: COLOURS.median },
                      }}
                    />
                    <ReferenceLine
                      x={result.equalWeight.sharpe}
                      stroke={COLOURS.eq}
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      label={{
                        value: `1/N ${fmtNum2(result.equalWeight.sharpe)}`,
                        position: "insideBottom",
                        offset: 22,
                        style: { fontSize: 11, fill: COLOURS.eq, fontWeight: 600 },
                      }}
                    />
                    <ReferenceLine
                      x={result.markowitzExAnte.sharpe}
                      stroke={COLOURS.exAnte}
                      strokeWidth={2.5}
                      strokeDasharray="6 4"
                      label={{
                        value: `← ex-ante (promessa) ${fmtNum2(result.markowitzExAnte.sharpe)}`,
                        position: "insideTopLeft",
                        offset: 10,
                        style: { fontSize: 11, fill: COLOURS.exAnte, fontWeight: 700 },
                      }}
                    />
                    <ReferenceLine
                      x={result.markowitzExPost.sharpe}
                      stroke={COLOURS.exPost}
                      strokeWidth={3}
                      label={{
                        value: `← ex-post (entrega) ${fmtNum2(result.markowitzExPost.sharpe)}`,
                        position: "insideTopLeft",
                        offset: 26,
                        style: { fontSize: 11, fill: COLOURS.exPost, fontWeight: 700 },
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <SharpeNumberLine result={result} />

          <ConcentratedNullPanel result={result} />

          {persistenceResult ? (
            <RollingPersistencePanel result={persistenceResult} />
          ) : null}

          <GeometricReadingPanel result={result} />

          <ObservationsPanel
            result={result}
            histDomain={histDomain}
          />

          <IllusionSummary result={result} />

          <section className="card px-6 py-5 text-sm text-body">
            <div className="eyebrow">Leitura — em profundidade</div>
            <div className="mt-3 space-y-4">
              <div>
                <p className="font-semibold text-strong">
                  O estudo original de Kahneman (1984)
                </p>
                <p className="mt-1 text-muted">
                  Em 1984, Kahneman recebeu de uma firma de wealth management
                  americana 25 anos de avalia&ccedil;&otilde;es individuais dos seus 28
                  consultores. Os b&ocirc;nus anuais eram baseados em performance
                  relativa: top-quartil ganhava grande, bottom-quartil
                  receb&iacute;a pouco — a firma operava sob a premissa de que
                  <em> alguns consultores t&ecirc;m skill</em>. Kahneman calculou
                  a correla&ccedil;&atilde;o do ranking de retorno entre TODOS os pares
                  de anos consecutivos (378 pares no total). M&eacute;dia:{" "}
                  <span className="tabular font-semibold text-strong">0,01</span>.
                  Quando apresentou o resultado, os executivos da firma fingiram
                  n&atilde;o entender — &eacute; o que Kahneman chama de{" "}
                  <em>illusion of validity</em>: a recusa cognitiva em aceitar
                  evid&ecirc;ncia que invalida a base do pr&oacute;prio neg&oacute;cio.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Por que &eacute; pol&iacute;tico chamar de &ldquo;sorte&rdquo;
                </p>
                <p className="mt-1 text-muted">
                  Em qualquer popula&ccedil;&atilde;o de gestores ativos, alguns ter&atilde;o
                  Sharpes excepcionais. Sob hip&oacute;tese nula de zero skill
                  (mercado eficiente,{" "}
                  <a
                    href="https://www.nobelprize.org/prizes/economic-sciences/2013/fama/facts/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    Fama, Nobel 2013
                  </a>
                  ), Sharpe out-of-sample seria distribu&iacute;da uniformemente
                  no percentil. Com 1.000 gestores e ru&iacute;do gaussiano, ≈ 10
                  estar&atilde;o no top-1% por puro acaso — esse subconjunto vira
                  &ldquo;famoso&rdquo;, escreve livros, comanda 2-and-20. A
                  ilus&atilde;o &eacute; <em>sobreviv&ecirc;ncia + retrospectiva</em>:
                  ningu&eacute;m lembra dos 99% que falharam.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  O mecanismo formal — Kan &amp; Smith (2008)
                </p>
                <p className="mt-1 text-muted">
                  O vi&eacute;s estat&iacute;stico do Sharpe in-sample &eacute; quantific&aacute;vel.{" "}
                  <a
                    href="https://www.jstor.org/stable/25470994"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-strong"
                  >
                    Kan &amp; Smith (2008, MgmtSci)
                  </a>{" "}
                  derivam:{" "}
                  <span className="mono">E[Sharpe_in²] − Sharpe_true² ≈ N/T</span>
                  . Para N = 30 e T = 504 (≈ 2 anos), o vi&eacute;s &eacute; ≈ 0,06
                  em Sharpe² — equivalente a 0,3 em Sharpe linear quando o
                  Sharpe verdadeiro &eacute; ≈ 0,5. <em>Toda</em> otimiza&ccedil;&atilde;o
                  in-sample &eacute; afetada; n&atilde;o &eacute; um erro de implementa&ccedil;&atilde;o,
                  &eacute; uma propriedade estat&iacute;stica do estimador.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  Distin&ccedil;&atilde;o entre Kahneman e DGU
                </p>
                <p className="mt-1 text-muted">
                  <strong>DGU (2009)</strong> &eacute; uma cr&iacute;tica matem&aacute;tica
                  da otimiza&ccedil;&atilde;o de Markowitz: o ganho te&oacute;rico
                  &eacute; menor que o erro de estima&ccedil;&atilde;o em μ̂, ent&atilde;o
                  1/N vence out-of-sample. <strong>Kahneman (2011)</strong>
                  &eacute; uma cr&iacute;tica comportamental da gest&atilde;o ativa:
                  o setor financeiro &eacute; pago para entregar persist&ecirc;ncia
                  que estatisticamente n&atilde;o existe. Os dois argumentos
                  chegam &agrave; mesma conclus&atilde;o pr&aacute;tica (1/N ou
                  &iacute;ndice supera tentar ser esperto) por caminhos
                  ortogonais: DGU &eacute; um teorema sobre otimizadores,
                  Kahneman &eacute; um teorema sobre humanos.
                </p>
              </div>

              <div>
                <p className="font-semibold text-strong">
                  As quatro linhas e seus dois espa&ccedil;os vazios
                </p>
                <p className="mt-1 text-muted">
                  <strong>Vermelha (ex-ante)</strong>: Sharpe sob μ̂_train cru
                  — promessa. <strong>Azul (ex-post)</strong>: Sharpe dos mesmos
                  pesos sob retornos realizados — entrega.{" "}
                  <strong>Verde (1/N)</strong>: Sharpe da carteira ing&ecirc;nua
                  no teste — benchmark DGU. <strong>Cinza (mediana)</strong>:
                  o &ldquo;macaco m&eacute;dio&rdquo; de Malkiel. Dois espa&ccedil;os
                  vazios importam: <em>vermelha ↔ azul</em> &eacute; a ilus&atilde;o
                  em unidades de Sharpe; <em>azul ↔ borda direita do suporte</em>{" "}
                  mede a diferen&ccedil;a entre a Markowitz e o melhor sorteio
                  Dirichlet do per&iacute;odo. <strong>N&Atilde;O confunda esse
                  segundo gap com &ldquo;skill&rdquo;</strong>: o sorteio
                  Dirichlet(1) gera carteiras <em>diversificadas</em> sobre os
                  30 ativos, enquanto Markowitz aposta em 5; a compara&ccedil;&atilde;o
                  est&aacute; estruturalmente enviesada a favor da concentra&ccedil;&atilde;o
                  que se alinhar com a tend&ecirc;ncia do per&iacute;odo. Pelo
                  argumento de Kahneman, o teste correto seria amostrar{" "}
                  <em>outras carteiras concentradas em 5 ativos</em> e ver onde
                  a Markowitz cai. Detalhe na se&ccedil;&atilde;o
                  &ldquo;Notas metodol&oacute;gicas&rdquo; abaixo.
                </p>
              </div>
            </div>
          </section>

          <section className="card px-6 py-5 text-sm text-body">
            <div className="eyebrow">Notas metodol&oacute;gicas detalhadas</div>
            <ul className="mt-3 space-y-3">
              <li>
                • <strong>Carteiras aleat&oacute;rias</strong>:{" "}
                <span className="mono">Dirichlet(α=1)</span> — uniforme sobre
                o (N−1)-simplex. Cada carteira long-only com pesos somando 1
                tem mesma densidade. &Eacute; o sorteio mais ing&ecirc;nuo
                poss&iacute;vel: nenhum vi&eacute;s para diversifica&ccedil;&atilde;o
                (α &gt; 1) ou para concentra&ccedil;&atilde;o (α &lt; 1). Implementa&ccedil;&atilde;o
                via gamma sampling com Marsaglia-Tsang.
              </li>
              <li>
                • <strong>Limita&ccedil;&atilde;o estrutural do null (Dirichlet
                vs concentra&ccedil;&atilde;o Markowitz)</strong>. Dirichlet(1)
                gera carteiras <em>diversificadas</em> em torno do peso m&eacute;dio
                1/N (≈ 3,3% para N=30); a Markowitz, por outro lado, concentra
                ≈ 92% em 5 ativos. A compara&ccedil;&atilde;o &ldquo;Sharpe
                Markowitz vs distribui&ccedil;&atilde;o Dirichlet&rdquo; mistura
                duas coisas distintas: (a) o efeito da concentra&ccedil;&atilde;o
                em si; e (b) o sinal informacional do que o otimizador
                escolheu. Quando os 5 ativos sobreponderados pela Markowitz
                continuam a tend&ecirc;ncia da janela de treino (persist&ecirc;ncia
                de regime), a Markowitz vence quase mecanicamente, sem que
                isso prove skill no sentido de Kahneman (1984). Um teste
                rigorosamente Kahneman-friendly amostraria{" "}
                <em>outras carteiras concentradas em 5 ativos</em>{" "}
                (Dirichlet(α=0,2) ou subset aleat&oacute;rio de 5 do top-30)
                e compararia a Markowitz contra esse null reformulado.
                Implementa&ccedil;&atilde;o prevista para a v2 do experimento.
              </li>
              <li>
                • <strong>Sharpe realizada (eixo X)</strong>:{" "}
                <span className="mono">
                  S = (252 · &lt;r_p&gt; − rf) / (√252 · σ(r_p))
                </span>
                , onde &lt;r_p&gt; e σ(r_p) s&atilde;o m&eacute;dia e desvio
                amostrais dos retornos di&aacute;rios da carteira NO PER&Iacute;ODO
                DE TESTE. <span className="mono">rf</span> = m&eacute;dia hist&oacute;rica
                do CDI (BCB SGS s&eacute;rie 12), tipicamente ≈ 12,8% a.a.
              </li>
              <li>
                • <strong>Markowitz ex-ante</strong>: usa μ̂_train{" "}
                <em>cru</em> (Jensen-corrigido, anualizado ×252){" "}
                <strong>sem</strong> Jorion shrinkage nem macro-anchor — isso
                &eacute; o que um usu&aacute;rio Markowitz ing&ecirc;nuo veria
                ao otimizar na fronteira de treino. Os pesos s&atilde;o
                escolhidos pelo pipeline defensivo completo do tab{" "}
                <a href="../markowitz/" className="underline decoration-dotted underline-offset-2 hover:text-strong">
                  /markowitz
                </a>{" "}
                (Ledoit-Wolf + Jorion + macro-anchor) — &eacute; a pol&iacute;tica
                que a plataforma efetivamente recomendaria. S&oacute; a Sharpe
                exibida usa μ̂ cru, para que o gap ex-ante − ex-post reflita
                o pleno otimismo do estimador amostral.
              </li>
              <li>
                • <strong>Janelas de treino e teste</strong>: divis&atilde;o
                fixa (n&atilde;o rolante). Per&iacute;odo de treino: primeiros{" "}
                <span className="mono">trainYears × 252</span> dias coterminais
                do universo. Per&iacute;odo de teste:{" "}
                <span className="mono">testYears × 252</span> dias seguintes.
                A janela de teste &eacute; estritamente posterior &agrave; de
                treino — sem look-ahead. Para uma distribui&ccedil;&atilde;o
                temporal robusta, use o tab{" "}
                <a href="../ingenuo/" className="underline decoration-dotted underline-offset-2 hover:text-strong">
                  /ingenuo
                </a>{" "}
                que repete o exerc&iacute;cio em janela rolante.
              </li>
              <li>
                • <strong>Determinismo</strong>: o RNG usa seed fixo{" "}
                <code className="mono">0xCAFEFEED</code> (PRNG mulberry32).
                Recarregar a p&aacute;gina produz o mesmo histograma exatamente
                — os 5.000 sorteios s&atilde;o reproduz&iacute;veis. Para
                amostragem fresca, troque universo, janela ou n&uacute;mero de
                sorteios; cada combina&ccedil;&atilde;o produz uma sequ&ecirc;ncia
                determin&iacute;stica diferente.
              </li>
              <li>
                • <strong>Limita&ccedil;&otilde;es</strong>: (a) &eacute; uma
                &uacute;nica divis&atilde;o treino/teste — diferentes per&iacute;odos
                produzem diferentes ilus&otilde;es; (b) μ̂ cru no ex-ante n&atilde;o
                &eacute; o que a plataforma realmente entrega ao usu&aacute;rio,
                &eacute; o que o usu&aacute;rio ing&ecirc;nuo veria; (c) o histograma
                de Dirichlet(1) &eacute; uma distribui&ccedil;&atilde;o de refer&ecirc;ncia
                te&oacute;rica — gestores reais n&atilde;o sorteiam pesos
                uniformemente, ent&atilde;o a distribui&ccedil;&atilde;o emp&iacute;rica
                de Sharpes de gestores reais &eacute; um objeto diferente.
              </li>
              <li>
                • <strong>Reprodutibilidade</strong>: c&oacute;digo da
                experi&ecirc;ncia em{" "}
                <code className="mono">app/lib/illusion.ts</code> com 9 testes
                em <code className="mono">illusion.test.ts</code> (guards de
                input, monotonicidade dos sharpes ordenados, percentil em
                [0,1], pesos 1/N exatos, determinismo seed-fixo, vi&eacute;s
                ex-ante ≥ ex-post em IID sint&eacute;tico).
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function SkillCard({
  label,
  hint,
  p,
  accent,
}: {
  label: string;
  hint: string;
  p: NamedPortfolio;
  accent: string;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="eyebrow">{label}</div>
      <div className="text-[10px] text-muted">{hint}</div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
        <span className="text-muted">Sharpe</span>
        <span className={`text-right tabular font-semibold ${signedClass(p.sharpe)}`}>
          {fmtNum2(p.sharpe)}
        </span>
        <span className="text-muted">percentil</span>
        <span className="text-right tabular text-body">
          {(p.percentile * 100).toFixed(0)}º
        </span>
      </div>
    </div>
  );
}

/** Number-line view: each of the 4 named portfolios as a marker on a single
 *  Sharpe scale. No histogram bars — the random distribution is represented
 *  only by a shaded "support band" indicating the range it occupies. This
 *  view is most useful when the named Sharpes lie far outside the random
 *  distribution (like here, where both Markowitz Sharpes are at p=100). It
 *  also adds an explicit "gap = X Sharpe" annotation between ex-ante and
 *  ex-post — the geometric size of the illusion of skill in a single number. */
function SharpeNumberLine({ result }: { result: IllusionResult }) {
  const histLo = result.histogram[0]?.binStart ?? 0;
  const histHi = result.histogram[result.histogram.length - 1]?.binEnd ?? 0;
  const all = [
    histLo,
    histHi,
    result.medianRandom.sharpe,
    result.equalWeight.sharpe,
    result.markowitzExPost.sharpe,
    result.markowitzExAnte.sharpe,
  ];
  const minS = Math.min(...all);
  const maxS = Math.max(...all);
  const span = Math.max(maxS - minS, 0.1);
  const pad = 0.06 * span;
  const lo = minS - pad;
  const hi = maxS + pad;
  const pct = (s: number) => ((s - lo) / (hi - lo)) * 100;

  // Each marker assigned a vertical lane so labels never collide horizontally.
  // Sorted by Sharpe ascending so visual reading flows left → right.
  const ordered = [
    { name: "mediana sorteio", sharpe: result.medianRandom.sharpe, color: COLOURS.median },
    { name: "1/N", sharpe: result.equalWeight.sharpe, color: COLOURS.eq },
    { name: "Markowitz ex-post (entrega)", sharpe: result.markowitzExPost.sharpe, color: COLOURS.exPost, bold: true },
    { name: "Markowitz ex-ante (promessa)", sharpe: result.markowitzExAnte.sharpe, color: COLOURS.exAnte, bold: true },
  ].sort((a, b) => a.sharpe - b.sharpe);
  // Lane assignment: alternate lanes for adjacent markers to avoid overlap.
  const laned = ordered.map((m, i) => ({ ...m, lane: i % 2 }));

  const gap = result.markowitzExAnte.sharpe - result.markowitzExPost.sharpe;
  const exAntePct = pct(result.markowitzExAnte.sharpe);
  const exPostPct = pct(result.markowitzExPost.sharpe);
  const gapLeftPct = Math.min(exAntePct, exPostPct);
  const gapWidthPct = Math.abs(exAntePct - exPostPct);
  const gapMidPct = (exAntePct + exPostPct) / 2;

  // Three axis ticks: lo, mid, hi (for orientation)
  const ticks = [lo, (lo + hi) / 2, hi];

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">Linha de Sharpe — todos os portfólios nomeados</span>
        <p className="mt-1 text-xs text-muted">
          Visão alternativa sem histograma. Cada portfólio nomeado é um ponto
          numa única escala de Sharpe. A banda sombreada marca o{" "}
          <em>suporte da distribuição aleatória</em> (o intervalo de Sharpe que
          as {result.nRandom.toLocaleString("pt-BR")} carteiras sorteadas
          efetivamente cobriram no período de teste). Marcadores fora dessa
          banda mostram Sharpes que <strong>nenhum sorteio atingiu</strong>. O
          arco horizontal conecta a promessa à entrega: seu comprimento é{" "}
          <strong>a ilusão, em unidades de Sharpe</strong>.
        </p>
      </div>
      <div className="px-8 pt-12 pb-12">
        <div className="relative h-[180px]">
          {/* Histogram-support shaded band (the range of random Sharpes) */}
          <div
            className="absolute h-3 rounded"
            style={{
              left: `${pct(histLo)}%`,
              width: `${pct(histHi) - pct(histLo)}%`,
              top: 116,
              background: "var(--muted)",
              opacity: 0.18,
              border: "1px dashed var(--muted)",
            }}
            aria-label={`Suporte da distribuição aleatória: de ${fmtNum2(histLo)} a ${fmtNum2(histHi)}`}
          />
          <div
            className="absolute text-[10px] text-muted"
            style={{
              left: `${(pct(histLo) + pct(histHi)) / 2}%`,
              top: 106,
              transform: "translateX(-50%)",
            }}
          >
            suporte aleatório
          </div>

          {/* Main horizontal axis */}
          <div
            className="absolute left-0 right-0"
            style={{ top: 121, height: 1, background: "var(--border-strong)" }}
          />

          {/* Axis ticks */}
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute"
              style={{
                left: `${pct(t)}%`,
                top: 116,
                transform: "translateX(-50%)",
                width: 1,
                height: 10,
                background: "var(--border-strong)",
              }}
            />
          ))}
          {ticks.map((t) => (
            <div
              key={`label-${t}`}
              className="absolute text-[10px] tabular text-muted"
              style={{
                left: `${pct(t)}%`,
                top: 132,
                transform: "translateX(-50%)",
              }}
            >
              {fmtNum2(t)}
            </div>
          ))}
          <div
            className="absolute text-[10px] text-muted"
            style={{ left: 0, top: 152 }}
          >
            Sharpe →
          </div>

          {/* Gap arc between ex-ante and ex-post */}
          {gapWidthPct > 0 ? (
            <>
              <div
                className="absolute"
                style={{
                  left: `${gapLeftPct}%`,
                  width: `${gapWidthPct}%`,
                  top: 18,
                  height: 16,
                  borderTop: "1.5px solid var(--strong)",
                  borderLeft: "1.5px solid var(--strong)",
                  borderRight: "1.5px solid var(--strong)",
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                }}
              />
              <div
                className="absolute"
                style={{
                  left: `${gapMidPct}%`,
                  top: 0,
                  transform: "translateX(-50%)",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--strong)",
                  whiteSpace: "nowrap",
                }}
              >
                ilusão = {fmtNum2(Math.abs(gap))} de Sharpe
              </div>
            </>
          ) : null}

          {/* Markers */}
          {laned.map((m) => {
            const isTop = m.lane === 0;
            const dotTop = 121;
            const lineTopY = isTop ? 56 : 78;
            const lineBottomY = 121;
            const labelTopY = isTop ? 38 : 86;
            return (
              <div key={m.name}>
                {/* Vertical connector from label to axis */}
                <div
                  className="absolute"
                  style={{
                    left: `${pct(m.sharpe)}%`,
                    top: lineTopY,
                    width: 1.5,
                    height: lineBottomY - lineTopY,
                    background: m.color,
                  }}
                />
                {/* Dot on axis */}
                <div
                  className="absolute rounded-full"
                  style={{
                    left: `${pct(m.sharpe)}%`,
                    top: dotTop - 5,
                    width: 11,
                    height: 11,
                    transform: "translateX(-50%)",
                    background: m.color,
                    border: "2px solid var(--bg-base)",
                  }}
                />
                {/* Label box */}
                <div
                  className="absolute whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px]"
                  style={{
                    left: `${pct(m.sharpe)}%`,
                    top: labelTopY,
                    transform: "translateX(-50%)",
                    borderColor: m.color,
                    background: "var(--bg-elevated)",
                    color: m.color,
                    fontWeight: m.bold ? 700 : 600,
                  }}
                >
                  {m.name} · <span className="tabular">{fmtNum2(m.sharpe)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Geometric reading panel: tells the reader EXACTLY what to take away from
 *  the histogram + number-line view, computed dynamically against the
 *  current run's Sharpe values. Two empty-space distances carry distinct
 *  meanings: red↔blue is the illusion of skill; blue↔band-edge is Markowitz's
 *  real skill advantage over random. */
function GeometricReadingPanel({ result }: { result: IllusionResult }) {
  const exAnte = result.markowitzExAnte.sharpe;
  const exPost = result.markowitzExPost.sharpe;
  const supportRight = result.histogram[result.histogram.length - 1]?.binEnd ?? 0;
  const supportLeft = result.histogram[0]?.binStart ?? 0;
  const illusionGap = exAnte - exPost;
  const realSkillGap = exPost - supportRight;
  const exAnteOutside = exAnte > supportRight || exAnte < supportLeft;
  const exPostOutside = exPost > supportRight || exPost < supportLeft;
  const exPostBeatRandom = exPost > supportRight;

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">
          Leitura geométrica · o que significam as duas distâncias vazias
        </span>
        <p className="mt-1 text-xs text-muted">
          O histograma e a linha de Sharpe acima mostram quatro distâncias
          interpretáveis. Esta seção decompõe cada uma com os números deste
          experimento específico.
        </p>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <div className="flex gap-3" style={{ borderLeft: `3px solid ${COLOURS.exAnte}`, paddingLeft: 12 }}>
          <div>
            <p className="font-semibold text-strong">
              Linha vermelha (ex-ante = {fmtNum2(exAnte)})
            </p>
            <p className="mt-1 text-muted">
              Sharpe que o otimizador <em>prometeu</em> com base na janela de
              treino — usando μ̂ amostral cru (sem Jorion, sem macro-anchor).
              {exAnteOutside
                ? " Está FORA da banda sombreada: nenhum portfólio sorteado alcançou esse Sharpe no teste. A promessa é inalcançável na realidade dessa janela."
                : " Está DENTRO da banda sombreada: há carteiras aleatórias que entregaram um Sharpe próximo. A promessa é, em princípio, factível por sorte pura."}
            </p>
          </div>
        </div>

        <div className="flex gap-3" style={{ borderLeft: `3px solid ${COLOURS.exPost}`, paddingLeft: 12 }}>
          <div>
            <p className="font-semibold text-strong">
              Linha azul (ex-post = {fmtNum2(exPost)})
            </p>
            <p className="mt-1 text-muted">
              Sharpe que os <em>mesmos pesos</em> entregaram quando aplicados
              aos retornos da janela de teste.
              {exPostOutside
                ? exPostBeatRandom
                  ? ` Está FORA da banda sombreada à DIREITA: a Markowitz, mesmo com os pesos da promessa otimista, superou TODAS as ${result.nRandom.toLocaleString("pt-BR")} carteiras sorteadas. Skill real existiu — só não no tamanho da promessa.`
                  : ` Está FORA da banda sombreada à ESQUERDA: a Markowitz teve performance abaixo de TODAS as carteiras sorteadas. A promessa não só falhou — a entrega foi pior que qualquer escolha aleatória.`
                : ` Está DENTRO da banda sombreada, no ${(result.markowitzExPost.percentile * 100).toFixed(0)}º percentil das aleatórias. A entrega é indistinguível, em termos de Sharpe, de um sorteio Dirichlet — Kahneman vindicado.`}
            </p>
          </div>
        </div>

        <div className="rounded-md border-l-4 px-3 py-2" style={{ borderColor: "var(--strong)", background: "color-mix(in srgb, var(--strong) 6%, transparent)" }}>
          <p className="font-semibold text-strong">
            Distância vermelha ↔ azul = {fmtNum2(Math.abs(illusionGap))} de Sharpe
          </p>
          <p className="mt-1 text-muted">
            <strong>É a ilusão de skill</strong>, medida em unidades de Sharpe.
            O otimizador <em>promete</em> a vermelha, <em>entrega</em> a azul,
            e a diferença é o que Kahneman (2011) descreve no capítulo{" "}
            &ldquo;The Illusion of Stock-Picking Skill&rdquo;: a indústria
            financeira é paga para entregar a vermelha e na média entrega
            algo próximo da mediana aleatória. Aqui o otimizador entregou
            algo melhor que a mediana, mas{" "}
            <span className="tabular font-semibold">
              {fmtNum2(Math.abs(illusionGap))}
            </span>{" "}
            unidades de Sharpe ABAIXO do que havia prometido.
          </p>
        </div>

        {exPostBeatRandom ? (
          <div className="rounded-md border-l-4 px-3 py-2" style={{ borderColor: COLOURS.exPost, background: "color-mix(in srgb, var(--accent) 4%, transparent)" }}>
            <p className="font-semibold text-strong">
              Distância azul ↔ borda direita da banda = {fmtNum2(Math.abs(realSkillGap))} de Sharpe
            </p>
            <p className="mt-1 text-muted">
              <strong>Não confunda esse gap com &ldquo;skill&rdquo; no sentido
              de Kahneman.</strong> Ele mede em quanto a entrega da Markowitz
              superou a MELHOR das {result.nRandom.toLocaleString("pt-BR")}{" "}
              carteiras sorteadas — mas as carteiras sorteadas s&atilde;o{" "}
              <em>Dirichlet(1), diversificadas sobre 30 ativos</em>, enquanto
              a Markowitz aposta em 5. A compara&ccedil;&atilde;o
              estruturalmente enviesa-se a favor de qualquer concentra&ccedil;&atilde;o
              5-bet que se alinhar com a tend&ecirc;ncia do per&iacute;odo de
              teste, e essa tend&ecirc;ncia frequentemente continua a do
              per&iacute;odo de treino (persist&ecirc;ncia de regime). Para
              testar skill real no sentido de Kahneman (1984), seria preciso
              comparar a Markowitz contra <em>outras 5.000 carteiras
              concentradas em 5 ativos</em>, sorteadas aleatoriamente do
              universo. Esse teste mais rigoroso est&aacute; previsto para
              a v2 deste experimento.
            </p>
          </div>
        ) : null}

        <p className="text-xs text-muted">
          <strong>Resumo</strong>: as duas linhas vivem em &ldquo;espaço
          vazio&rdquo; do histograma, mas cada vazio significa uma coisa
          diferente. À direita da banda = &ldquo;Sharpe que nem o melhor
          sorteio atingiu&rdquo;. Entre vermelha e azul = &ldquo;Sharpe que
          a promessa cobriu mas a entrega não&rdquo;. Os dois vazios juntos
          contam toda a história da Markowitz nesta janela.
        </p>
      </div>
    </section>
  );
}

/** Concentrated K-bet null hypothesis: the Kahneman-correct comparison.
 *  Shows a second histogram alongside the Dirichlet(1) one, where each
 *  random portfolio is concentrated in K=concentrationK randomly-chosen
 *  ativos. Markowitz's ex-post Sharpe is plotted as a reference line
 *  inside this distribution. If Markowitz lands at p≈50 under the
 *  concentrated null, the optimizer is indistinguishable from a random
 *  K-bet — i.e., its specific 5-pick carries no information beyond what
 *  a coin-flip selection of 5 tickers would deliver. That's the
 *  empirical statement closest to Kahneman's (1984) original finding. */
function ConcentratedNullPanel({ result }: { result: IllusionResult }) {
  const cn = result.concentratedNull;
  const dn = result.dirichletNull;
  const K = result.concentrationK;

  const histData = cn.histogram.map((b) => ({
    binMid: b.binMid,
    binStart: b.binStart,
    binEnd: b.binEnd,
    count: b.count,
    freq: b.freq,
  }));

  const domain = useMemo((): [number, number] => {
    if (cn.histogram.length === 0) return [-1, 1];
    const lo = cn.histogram[0].binStart;
    const hi = cn.histogram[cn.histogram.length - 1].binEnd;
    const extras = [
      result.markowitzExAnte.sharpe,
      result.markowitzExPost.sharpe,
      result.equalWeight.sharpe,
      cn.median,
    ];
    const allLo = Math.min(lo, ...extras);
    const allHi = Math.max(hi, ...extras);
    const span = Math.max(allHi - allLo, 0.1);
    return [allLo - 0.03 * span, allHi + 0.08 * span];
  }, [cn, result.markowitzExAnte.sharpe, result.markowitzExPost.sharpe, result.equalWeight.sharpe]);

  const deltaExPost =
    cn.markowitzExPostPercentile - dn.markowitzExPostPercentile;
  const sameSkillVerdict =
    Math.abs(cn.markowitzExPostPercentile - 0.5) < 0.15;

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">
          Null Kahneman-friendly: Markowitz vs sorteios CONCENTRADOS em {K} ativos
        </span>
        <p className="mt-1 text-xs text-muted">
          O histograma acima compara Markowitz contra carteiras Dirichlet(1)
          <strong> diversificadas</strong> sobre {result.tickers.length}{" "}
          ativos — uma compara&ccedil;&atilde;o estruturalmente
          enviesada porque Markowitz concentra ≈92% em apenas{" "}
          <span className="tabular font-semibold text-strong">{K}</span>{" "}
          ativos. Este painel mostra a compara&ccedil;&atilde;o
          <strong> correta segundo Kahneman</strong>: sorteamos{" "}
          {result.nRandom.toLocaleString("pt-BR")} outras carteiras
          tamb&eacute;m concentradas em {K} ativos (escolhidos
          aleatoriamente) e vemos onde a Markowitz cai nesta distribui&ccedil;&atilde;o.
        </p>
      </div>
      <div className="p-4">
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart
              data={histData}
              margin={{ top: 28, right: 60, left: 8, bottom: 28 }}
              barCategoryGap={1}
            >
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="binMid"
                type="number"
                domain={domain}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                stroke="var(--border)"
                tickFormatter={(v) => fmtAxisNum(v)}
                label={{ value: `Sharpe realizado (carteiras concentradas em ${K} ativos)`, position: "insideBottom", offset: -16, style: { fontSize: 11, fill: "var(--muted)" } }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                stroke="var(--border)"
                width={48}
                label={{ value: "carteiras", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "var(--muted)" } }}
              />
              <Tooltip content={<HistogramTooltip />} cursor={{ fill: "color-mix(in srgb, var(--loss) 8%, transparent)" }} />
              <ReferenceArea
                x1={cn.histogram[0]?.binStart ?? 0}
                x2={cn.histogram[cn.histogram.length - 1]?.binEnd ?? 0}
                fill="var(--muted)"
                fillOpacity={0.06}
                stroke="var(--muted)"
                strokeOpacity={0.25}
                strokeDasharray="3 4"
              />
              <Bar dataKey="count" isAnimationActive={false}>
                {cn.histogram.map((_, i) => (
                  <Cell key={i} fill={COLOURS.bar} fillOpacity={0.55} />
                ))}
              </Bar>
              <ReferenceLine
                x={cn.median}
                stroke={COLOURS.median}
                strokeWidth={1.5}
                strokeDasharray="2 4"
                label={{
                  value: `mediana ${fmtNum2(cn.median)}`,
                  position: "insideBottom",
                  offset: 6,
                  style: { fontSize: 10, fill: COLOURS.median },
                }}
              />
              <ReferenceLine
                x={result.markowitzExPost.sharpe}
                stroke={COLOURS.exPost}
                strokeWidth={3}
                label={{
                  value: `← Markowitz ex-post ${fmtNum2(result.markowitzExPost.sharpe)} (p=${(cn.markowitzExPostPercentile * 100).toFixed(0)}º)`,
                  position: "insideTopLeft",
                  offset: 10,
                  style: { fontSize: 11, fill: COLOURS.exPost, fontWeight: 700 },
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="space-y-3 border-t border-border px-5 py-4 text-sm">
        <div className="rounded-md border-l-4 px-3 py-2" style={{ borderColor: COLOURS.exPost, background: "color-mix(in srgb, var(--accent) 4%, transparent)" }}>
          <p className="font-semibold text-strong">
            O veredito Kahneman: Markowitz no{" "}
            <span className="tabular">
              {(cn.markowitzExPostPercentile * 100).toFixed(0)}º percentil
            </span>{" "}
            dos sorteios concentrados (vs{" "}
            <span className="tabular">
              {(dn.markowitzExPostPercentile * 100).toFixed(0)}º
            </span>{" "}
            sob Dirichlet diversificada)
          </p>
          <p className="mt-1 text-muted">
            Delta entre os dois nulls:{" "}
            <span className={`tabular font-semibold ${signedClass(-Math.abs(deltaExPost))}`}>
              {deltaExPost >= 0 ? "+" : "−"}
              {(Math.abs(deltaExPost) * 100).toFixed(1)} p.p.
            </span>
            . {sameSkillVerdict ? (
              <>
                A Markowitz vive <strong>perto da mediana</strong> entre carteiras
                concentradas em {K} ativos — <em>indistingu&iacute;vel de sorte</em>{" "}
                no sentido de Kahneman. A apar&ecirc;ncia de skill no histograma
                Dirichlet acima era artefato estrutural: qualquer concentra&ccedil;&atilde;o
                em ativos que continuaram a tend&ecirc;ncia do treino teria
                produzido o mesmo &ldquo;p=100&rdquo; vs sorteios diversificados.
              </>
            ) : cn.markowitzExPostPercentile > 0.5 ? (
              <>
                A Markowitz ficou <strong>acima da mediana</strong> mesmo entre
                carteiras concentradas — sinal de algum conte&uacute;do
                informacional na escolha do otimizador, ainda que o gap entre
                os dois nulls revele quanto da &ldquo;skill&rdquo; aparente era
                puramente estrutural.
              </>
            ) : (
              <>
                A Markowitz ficou <strong>abaixo da mediana</strong> entre
                carteiras concentradas — sinal de que, pelo menos neste per&iacute;odo,
                o μ̂ amostral apontou para os <em>piores</em> {K} ativos da
                janela de teste; o que parecia skill no histograma Dirichlet era
                pior que sorte concentrada.
              </>
            )}
          </p>
        </div>
        <p className="text-xs text-muted">
          <strong>Como esse painel deve mudar sua leitura do gr&aacute;fico
          principal:</strong> o &ldquo;p=100&rdquo; da Markowitz no histograma
          Dirichlet acima compara peras (concentradas) com ma&ccedil;&atilde;s
          (diversificadas). O p={(cn.markowitzExPostPercentile * 100).toFixed(0)}º
          desta se&ccedil;&atilde;o compara peras com peras — &eacute; o
          n&uacute;mero que devemos citar quando perguntarmos &ldquo;a Markowitz
          tem skill no sentido de Kahneman?&rdquo;.
        </p>
      </div>
    </section>
  );
}

/** Rolling-window persistence panel: the actual Kahneman test.
 *  Shows the Markowitz percentile (in the concentrated-K null) over a
 *  sequence of non-overlapping rolling windows, plus the lag-1
 *  autocorrelation and Jaccard pick-similarity. Kahneman's claim is
 *  empirically supported when autocorrelation ≈ 0 (no persistence). */
function RollingPersistencePanel({ result }: { result: RollingPersistenceResult }) {
  const chartData = result.windows.map((w) => ({
    label: w.testStart.slice(0, 7),
    percentile: w.percentileConcentrated * 100,
    percentileDir: w.percentileDirichlet * 100,
    illusion: w.sharpeExAnte - w.sharpeExPost,
    sharpe: w.sharpeExPost,
    range: `${w.testStart} → ${w.testEnd}`,
  }));

  const autocorr = result.percentileLag1Autocorr;
  const jaccard = result.jaccardAdjacentMean;
  const meanPercentile = result.percentileConcentratedMean;
  const persistenceVerdict =
    Math.abs(autocorr) < 0.20
      ? "no-persistence"
      : autocorr > 0
      ? "positive-persistence"
      : "negative-persistence";

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">
          Teste Kahneman propriamente dito · persistência em janelas rolantes ({result.windows.length} janelas não-sobrepostas)
        </span>
        <p className="mt-1 text-xs text-muted">
          O experimento {" "}
          <em>histograma + null concentrada</em> acima testa apenas{" "}
          <strong>uma única janela</strong> — não consegue detectar
          persistência de skill (a tese formal de Kahneman, 1984). Aqui
          repetimos o teste em <strong>{result.windows.length} janelas
          consecutivas não-sobrepostas</strong> (cada uma com{" "}
          <span className="mono">{result.trainDays}d treino + {result.testDays}d teste</span>
          ) e olhamos a <strong>autocorrelação lag-1</strong> do percentil
          da Markowitz. Se a autocorrelação for ≈ 0, o percentil de uma
          janela não prediz o percentil da próxima — performance pura
          oscilação, ausência de skill no sentido de Kahneman.
        </p>
      </div>

      <div className="p-4">
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 16, right: 24, left: 8, bottom: 36 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                stroke="var(--border)"
                angle={-30}
                textAnchor="end"
                height={56}
                label={{ value: "Início da janela de teste", position: "insideBottom", offset: -22, style: { fontSize: 11, fill: "var(--muted)" } }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                stroke="var(--border)"
                domain={[0, 100]}
                tickFormatter={(v) => `${v}º`}
                width={48}
                label={{ value: "Percentil concentrado", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "var(--muted)" } }}
              />
              <ReferenceLine
                y={50}
                stroke="var(--strong)"
                strokeDasharray="4 4"
                label={{ value: "50º = mediana (sorte)", position: "insideTopRight", style: { fontSize: 10, fill: "var(--strong)" } }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as {
                    label: string;
                    percentile: number;
                    percentileDir: number;
                    illusion: number;
                    sharpe: number;
                    range: string;
                  };
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
                        {p.range}
                      </div>
                      <div className="tabular text-strong">
                        ex-post Sharpe = {fmtNum2(p.sharpe)}
                      </div>
                      <div className="tabular text-body">
                        p concentrado = {p.percentile.toFixed(0)}º
                      </div>
                      <div className="tabular text-muted">
                        p Dirichlet = {p.percentileDir.toFixed(0)}º
                      </div>
                      <div className="tabular text-muted">
                        ilusão = +{fmtNum2(p.illusion)}
                      </div>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="percentile"
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "var(--accent)" }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-border px-5 py-4 md:grid-cols-3">
        <div className="rounded-md border border-border px-3 py-2">
          <div className="eyebrow">Autocorrelação lag-1 do percentil</div>
          <div className={`mt-1 text-2xl tabular font-bold ${signedClass(autocorr - 0.2)}`}>
            {autocorr >= 0 ? "+" : ""}
            {autocorr.toFixed(3)}
          </div>
          <p className="mt-1 text-[10px] text-muted">
            {persistenceVerdict === "no-persistence"
              ? "≈ 0 → percentil de t não prediz t+1 — sem skill (Kahneman vindicado)"
              : persistenceVerdict === "positive-persistence"
              ? "&gt; 0,2 → algum sinal de persistência — possível conteúdo informacional"
              : "&lt; -0,2 → percentil oscila sistematicamente — instabilidade"}
          </p>
        </div>
        <div className="rounded-md border border-border px-3 py-2">
          <div className="eyebrow">Jaccard médio dos picks</div>
          <div className="mt-1 text-2xl tabular font-bold text-strong">{fmtNum2(jaccard)}</div>
          <p className="mt-1 text-[10px] text-muted">
            {jaccard < 0.3
              ? "Picks mudam radicalmente entre janelas — MV chasing noise"
              : jaccard > 0.7
              ? "Picks muito estáveis — MV tem worldview consistente (ou regime fixo)"
              : "Picks parcialmente estáveis"}
          </p>
        </div>
        <div className="rounded-md border border-border px-3 py-2">
          <div className="eyebrow">Percentil concentrado médio</div>
          <div className={`mt-1 text-2xl tabular font-bold ${signedClass(meanPercentile - 0.5)}`}>
            {(meanPercentile * 100).toFixed(0)}º
          </div>
          <p className="mt-1 text-[10px] text-muted">
            Média sobre as {result.windows.length} janelas. Distante de 50 ⇒ MV tem viés sistemático; próximo de 50 ⇒ MV ≈ aleatório.
          </p>
        </div>
      </div>

      <div className="space-y-2 border-t border-border px-5 py-4 text-sm">
        <p className="font-semibold text-strong">Veredito Kahneman</p>
        <p className="text-muted">
          {persistenceVerdict === "no-persistence" ? (
            <>
              <strong>Persistência ≈ zero.</strong> A Markowitz não mantém
              o mesmo nível de outperformance entre janelas consecutivas; o
              percentil sobe e desce sem padrão preditivo. <em>É exatamente
              o achado de Kahneman (1984)</em>: a aparente skill numa janela
              é luck idiossincrática que não se repete na próxima.
              Markowitz é remunerado por uma habilidade que não existe além
              do regime de cada período.
            </>
          ) : persistenceVerdict === "positive-persistence" ? (
            <>
              <strong>Persistência moderada</strong> (lag-1 autocorrelação ={" "}
              {autocorr.toFixed(2)}). Janelas em que MV venceu tendem a ser
              seguidas por janelas em que MV vence de novo — sinal de
              persistência, possivelmente regime ou possivelmente skill
              estrutural (e.g., MV consistentemente identifica setores
              dominantes em mercados de momentum). Não invalida Kahneman
              num sentido literal (ele observou correlação ≈ 0,01 entre
              gestores ativos individuais — sample diferente), mas mostra
              que a aplicação mecânica do método tem persistência.
            </>
          ) : (
            <>
              <strong>Anti-persistência</strong> (lag-1 = {autocorr.toFixed(2)}).
              Janelas em que MV venceu são frequentemente seguidas por
              janelas em que MV perde — sinal de instabilidade ou regime-shift.
              MV não é remunerado por skill nem oscila aleatoriamente, mas
              <em> reverte</em>: indicação de overfitting periódico ao
              regime do treino que se inverte no teste.
            </>
          )}
        </p>
        <p className="text-xs text-muted">
          <strong>Disclaimer estatístico</strong>: com apenas{" "}
          {result.windows.length} janelas não-sobrepostas, a estimativa da
          autocorrelação tem alto erro padrão (≈ 1/√n ≈{" "}
          {(1 / Math.sqrt(result.windows.length - 1)).toFixed(2)}). Para um
          teste com poder estatístico maior, seria necessário expandir o
          histórico coterminal — o que requer um universo menor (top-10
          IBOV) ou janelas mais curtas (1y/1y).
        </p>
      </div>
    </section>
  );
}

function ObservationsPanel({
  result,
  histDomain,
}: {
  result: IllusionResult;
  histDomain: [number, number];
}) {
  const SATURATED = 0.999;
  const FLOOR = 0.001;
  const N = result.nRandom;
  const nFmt = N.toLocaleString("pt-BR");
  const [lo, hi] = histDomain;

  function locationText(sharpe: number, percentile: number): string {
    if (sharpe > hi) {
      return `acima da maior Sharpe sorteada — fora do eixo do histograma à direita`;
    }
    if (sharpe < lo) {
      return `abaixo da menor Sharpe sorteada — fora do eixo à esquerda`;
    }
    if (percentile >= SATURATED) {
      return `acima de TODAS as ${nFmt} carteiras sorteadas`;
    }
    if (percentile <= FLOOR) {
      return `abaixo de TODAS as ${nFmt} carteiras sorteadas`;
    }
    return `dentro da distribuição, no ${(percentile * 100).toFixed(0)}º percentil`;
  }

  type Row = {
    label: string;
    accent: string;
    sharpe: number;
    percentile: number;
    reading: string;
  };
  const rows: Row[] = [
    {
      label: "Markowitz ex-ante (promessa)",
      accent: COLOURS.exAnte,
      sharpe: result.markowitzExAnte.sharpe,
      percentile: result.markowitzExAnte.percentile,
      reading:
        "Sharpe da carteira-tangência sob μ̂ amostral cru (sem Jorion, sem macro-anchor). Reflete o que um usuário Markowitz ingênuo veria ao olhar a fronteira de treino — o tamanho do otimismo embutido na média histórica.",
    },
    {
      label: "Markowitz ex-post (entrega)",
      accent: COLOURS.exPost,
      sharpe: result.markowitzExPost.sharpe,
      percentile: result.markowitzExPost.percentile,
      reading:
        "Sharpe dos mesmos pesos avaliados sobre os retornos realizados na janela de teste. É o que o investidor efetivamente recebeu. A diferença entre esta linha e a ex-ante é a ilusão, em unidades de Sharpe.",
    },
    {
      label: "1/N (peso igual)",
      accent: COLOURS.eq,
      sharpe: result.equalWeight.sharpe,
      percentile: result.equalWeight.percentile,
      reading:
        "Sharpe da carteira ingênua avaliada na janela de teste. Benchmark de DeMiguel-Garlappi-Uppal (2009): se a Markowitz não bate este número, a otimização não está agregando valor além do ruído.",
    },
    {
      label: "Mediana aleatória",
      accent: COLOURS.median,
      sharpe: result.medianRandom.sharpe,
      percentile: 0.5,
      reading: `Sharpe do 2.500º portfólio em uma amostragem ordenada de ${nFmt} carteiras Dirichlet(1). É o "macaco com dardos médio" de Malkiel (1973). Sharpe ex-post abaixo deste valor é, por definição, indistinguível de sorte.`,
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">
          Observações por estratégia · onde cada linha caiu
        </span>
        <p className="mt-1 text-xs text-muted">
          As linhas verticais no gráfico não suportam hover individual (limitação
          do Recharts); esta tabela documenta cada uma. Quando a linha está
          marcada como &ldquo;fora do eixo&rdquo;, o valor real está além do
          histograma — a linha é desenhada na borda do gráfico apenas para
          referência visual.
        </p>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => {
          const offAxis = r.sharpe > hi || r.sharpe < lo;
          return (
            <div
              key={r.label}
              className="grid grid-cols-1 gap-3 px-5 py-3 text-xs md:grid-cols-[260px_1fr]"
            >
              <div className="space-y-1" style={{ borderLeft: `3px solid ${r.accent}`, paddingLeft: 12 }}>
                <div className="font-semibold text-strong">{r.label}</div>
                <div className="text-muted">
                  Sharpe ={" "}
                  <span className="tabular font-semibold text-strong">{fmtNum2(r.sharpe)}</span>
                  {offAxis ? <span className="ml-1 text-[10px] text-muted">(fora do eixo)</span> : null}
                </div>
                <div className="text-muted">
                  Posição: <span className="text-body">{locationText(r.sharpe, r.percentile)}</span>
                </div>
              </div>
              <p className="text-body">{r.reading}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function IllusionSummary({ result }: { result: IllusionResult }) {
  const gap = result.markowitzExAnte.sharpe - result.markowitzExPost.sharpe; // positive ⇒ illusion present
  const beatEQ = result.markowitzExPost.sharpe > result.equalWeight.sharpe;
  const beatMedian = result.markowitzExPost.sharpe > result.medianRandom.sharpe;
  const SATURATED = 0.999;
  const FLOOR = 0.001;
  const N = result.nRandom;
  const nFmt = N.toLocaleString("pt-BR");

  function percentileSentence(p: number, subject: string): string {
    if (p >= SATURATED) {
      return `${subject} ficou ACIMA de TODAS as ${nFmt} carteiras aleatórias avaliadas`;
    }
    if (p <= FLOOR) {
      return `${subject} ficou ABAIXO de TODAS as ${nFmt} carteiras aleatórias avaliadas`;
    }
    return `${subject} caiu no ${(p * 100).toFixed(0)}º percentil da distribuição aleatória`;
  }

  const bothSaturated =
    result.markowitzExAnte.percentile >= SATURATED &&
    result.markowitzExPost.percentile >= SATURATED;

  return (
    <section className="card px-6 py-5 text-sm text-body">
      <div className="eyebrow">A ilusão, em uma frase</div>
      <div className="mt-3 space-y-2">
        <p>
          <strong>Promessa.</strong> O otimizador prometeu uma carteira com{" "}
          Sharpe ={" "}
          <span className="tabular font-semibold text-strong">
            {fmtNum2(result.markowitzExAnte.sharpe)}
          </span>{" "}
          (calculado sob μ̂ amostral cru, sem shrinkage defensivo).{" "}
          {percentileSentence(result.markowitzExAnte.percentile, "Esse valor")}.
        </p>
        <p>
          <strong>Entrega.</strong> Aplicados os mesmos pesos no período de
          teste, a Sharpe realizada foi{" "}
          <span className="tabular font-semibold text-strong">
            {fmtNum2(result.markowitzExPost.sharpe)}
          </span>
          .{" "}
          {percentileSentence(result.markowitzExPost.percentile, "Esse valor")}.
        </p>
        <p>
          <strong>Tamanho da ilusão.</strong>{" "}
          {gap >= 0 ? (
            <>
              A entrega ficou{" "}
              <span className={`tabular font-semibold ${signedClass(-gap)}`}>
                {gap.toFixed(2).replace(".", ",")} unidades de Sharpe
              </span>{" "}
              ABAIXO da promessa
            </>
          ) : (
            <>
              A entrega ficou{" "}
              <span className={`tabular font-semibold ${signedClass(-gap)}`}>
                {Math.abs(gap).toFixed(2).replace(".", ",")} unidades de Sharpe
              </span>{" "}
              ACIMA da promessa (caso raro — a janela de teste superou
              expectativas amostrais)
            </>
          )}
          {bothSaturated ? (
            <>
              . O percentil saturou em 100º nos dois casos porque ambos os
              Sharpes excedem TODAS as carteiras sorteadas — o gap só é
              legível em unidades de Sharpe, não em percentil.
            </>
          ) : (
            <>.</>
          )}
        </p>
        <p>
          <strong>Markowitz superou os benchmarks?</strong>{" "}
          {beatEQ
            ? "Sim, no teste a Markowitz superou o 1/N. "
            : "Não — no teste o 1/N superou a Markowitz, replicando o achado de DeMiguel-Garlappi-Uppal (2009). "}
          {beatMedian
            ? "Também superou a mediana aleatória — o gestor teve, em média, mais skill que sorte neste período."
            : "Não superou a mediana aleatória — performance indistinguível de sorte (Kahneman, 2011)."}
        </p>
      </div>
    </section>
  );
}

function HistogramTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { binStart: number; binEnd: number; count: number; freq: number } }[];
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
        Sharpe entre {fmtNum2(p.binStart)} e {fmtNum2(p.binEnd)}
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>carteiras</span>
        <span className="tabular font-semibold" style={{ color: "var(--strong)" }}>
          {p.count.toLocaleString("pt-BR")} ({(p.freq * 100).toFixed(1)}%)
        </span>
      </div>
    </div>
  );
}
