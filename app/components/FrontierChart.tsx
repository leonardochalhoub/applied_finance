"use client";

import { useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Customized,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { downloadSvgChart } from "@/lib/chartDownload";
import { withBase } from "@/lib/links";
import { fmtAxisPct, fmtNum2, fmtPctAA, fmtPctSigned, signedClass } from "@/lib/format";
import { buildFrontier, type FrontierResult } from "@/lib/markowitz";

const PCT2_BR = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type ClickedPoint = {
  kind: "frontier" | "cloud" | "mv" | "ms" | "user" | "compare";
  vol: number;
  ret: number;
  sharpe?: number;
  weights: number[];
};

type UserPoint = {
  vol: number;
  ret: number;
  sharpe: number;
  weights: number[];
};

type Props = {
  mu: number[];
  sigma: number[][];
  rf: number;
  tickers: string[];
  longOnly: boolean;
  /** Optional callback when the user clicks "load this portfolio" — receives
   *  a {ticker: weight} record (only non-zero). */
  onLoad?: (weights: Record<string, number>) => void;
  /** Optional caption shown next to the eyebrow. */
  caption?: string;
  /** Optional user portfolio to render as a special "Sua carteira" marker. */
  userPoint?: UserPoint | null;
  /** Optional comparison portfolio (e.g. imported real portfolio). */
  comparePoint?: (UserPoint & { label?: string }) | null;
};

export function FrontierChart({ mu, sigma, rf, tickers, longOnly, onLoad, caption, userPoint, comparePoint }: Props) {
  const [clicked, setClicked] = useState<ClickedPoint | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  const frontierResult: FrontierResult | null = useMemo(() => {
    if (tickers.length < 2) return null;
    try {
      return buildFrontier(mu, sigma, rf, {
        longOnly,
        frontierSteps: 80,
        cloudSize: 2500,
      });
    } catch (e) {
      console.warn("frontier build failed", e);
      return null;
    }
  }, [mu, sigma, rf, tickers, longOnly]);

  if (!frontierResult) {
    return (
      <div className="card px-6 py-8 text-sm text-muted">
        Não foi possível resolver a fronteira eficiente para os parâmetros atuais.
      </div>
    );
  }

  const frontierData = frontierResult.frontier.map((p) => ({
    vol: p.vol,
    ret: p.ret,
    weights: p.weights,
    series: "Fronteira",
  }));
  const cloudData = frontierResult.cloud.map((p) => ({
    vol: p.vol,
    ret: p.ret,
    sharpe: p.sharpe,
    weights: p.weights,
    series: "Nuvem aleatória",
  }));
  const mvPoint = [{
    vol: frontierResult.minVariance.vol,
    ret: frontierResult.minVariance.ret,
    sharpe: frontierResult.minVariance.sharpe,
    weights: frontierResult.minVariance.weights,
    series: "Mínima variância",
  }];
  const msPoint = [{
    vol: frontierResult.maxSharpe.vol,
    ret: frontierResult.maxSharpe.ret,
    sharpe: frontierResult.maxSharpe.sharpe,
    weights: frontierResult.maxSharpe.weights,
    series: "Máximo Sharpe",
  }];

  // ── Data-driven axis domains ──────────────────────────────────────────
  // Both axes adapt to the actual data extent with a uniform margin —
  // no fixed floors or ceilings. The chart re-frames itself across time
  // windows so the data always fills the canvas. Cloud uses the 2nd/98th
  // percentile (not strict min/max) so a handful of outlier draws can't
  // drag the axes out and waste canvas on empty space.
  const cloudRets = frontierResult.cloud.map((p) => p.ret);
  const cloudVols = frontierResult.cloud.map((p) => p.vol);
  const sortedRets = [...cloudRets].sort((a, b) => a - b);
  const sortedVols = [...cloudVols].sort((a, b) => a - b);
  const pct = (arr: number[], q: number) =>
    arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * arr.length)))];

  const cloudRetHi = pct(sortedRets, 0.98);
  const cloudRetLo = pct(sortedRets, 0.02);
  const cloudVolHi = pct(sortedVols, 0.98);
  const cloudVolLo = pct(sortedVols, 0.02);

  // Poupança — aproximação dinâmica: 70% do CDI (acompanha rf em vez de
  // travar no piso legal de 6,17% a.a.). Mantém a mensagem visual: mesma
  // vol nominal ≈ 0 que rf, mas retorno menor — dominada em média-variância.
  const poupancaRate = 0.7 * rf;

  // Y-axis members — the cloud + frontier + portfolio markers ONLY. We
  // deliberately exclude rf and poupança from the bounds: they sit well
  // below typical max-Sharpe returns (rf ≈ 13%, poupança ≈ 9% vs port
  // returns ≈ 20–25%), and including them stretches the axis downward
  // and squashes the cloud into the top third of the canvas. Their
  // numeric values are surfaced as text in the header so the user knows
  // them without paying the visual cost. Reference lines are still drawn,
  // but only when they happen to fall inside the data-driven range.
  const yValues: number[] = [
    frontierResult.minVariance.ret,
    frontierResult.maxSharpe.ret,
    ...frontierResult.frontier.map((p) => p.ret),
    cloudRetLo,
    cloudRetHi,
  ];
  if (userPoint && Number.isFinite(userPoint.ret)) yValues.push(userPoint.ret);
  if (comparePoint && Number.isFinite(comparePoint.ret)) yValues.push(comparePoint.ret);

  const dataMinY = Math.min(...yValues);
  const dataMaxY = Math.max(...yValues);
  const rangeY = Math.max(dataMaxY - dataMinY, 0.01);
  const yMin = dataMinY - 0.10 * rangeY;
  const yMax = dataMaxY + 0.10 * rangeY;
  const rfInRange = rf >= yMin && rf <= yMax;
  const poupancaInRange = poupancaRate >= yMin && poupancaRate <= yMax;

  // X-axis members.
  const xValues: number[] = [
    frontierResult.minVariance.vol,
    frontierResult.maxSharpe.vol,
    ...frontierResult.frontier.map((p) => p.vol),
    cloudVolLo,
    cloudVolHi,
  ];
  if (userPoint && Number.isFinite(userPoint.vol)) xValues.push(userPoint.vol);
  if (comparePoint && Number.isFinite(comparePoint.vol)) xValues.push(comparePoint.vol);

  const dataMinX = Math.min(...xValues);
  const dataMaxX = Math.max(...xValues);
  const rangeX = Math.max(dataMaxX - dataMinX, 0.01);
  const xMin = Math.max(0, dataMinX - 0.08 * rangeX);
  const xMax = dataMaxX + 0.08 * rangeX;

  // Capital Allocation Line (CAL) — tangent to the frontier at max-Sharpe,
  // anchored at the risk-free rate. CAL is the correct name when the
  // tangency portfolio is the subset's optimum (not the market portfolio,
  // which would make it the CML). Clipped to whichever edge (right OR top)
  // the line hits first inside the visible axes.
  const calSlope = (frontierResult.maxSharpe.ret - rf) / Math.max(frontierResult.maxSharpe.vol, 1e-9);
  // Suppress the CAL entirely if the tangency portfolio's Sharpe is
  // effectively zero or negative (can happen when heavy shrinkage flattens
  // the frontier toward rf). Drawing it would overlap the rf reference
  // line and read as a horizontal line at rf, which is misleading.
  const showCal = calSlope > 1e-6;
  const calVolAtYMax = showCal ? (yMax - rf) / calSlope : xMax;
  const calEndVol = Math.min(xMax, Math.max(xMin, calVolAtYMax));
  const calStartRet = rf + calSlope * xMin;
  const calEndRet = rf + calSlope * calEndVol;
  const calData = showCal
    ? [
        { vol: xMin, ret: calStartRet, weights: [], series: "Capital Allocation Line" },
        { vol: calEndVol, ret: calEndRet, weights: [], series: "Capital Allocation Line" },
      ]
    : [];

  // Derivative triangles — geometric "rise over run" construction of ∂E[r]/∂σ
  // at two frontier points. By the first-order condition for max-Sharpe,
  //
  //     dE[r]/dσ |_{σ*}  =  (E[r*] − r_f) / σ*   (= Sharpe ratio at σ*)
  //
  // so the triangle anchored at the tangency portfolio has hypotenuse parallel
  // to the CAL. A second triangle past max-Sharpe shows the slope dropping
  // below the Sharpe ratio — the geometric reason walking right of the
  // tangency portfolio is suboptimal.
  type DerivAnchor = { vol: number; ret: number; slope: number };
  const derivTriangles: { msTri: DerivAnchor | null; tailTri: DerivAnchor | null } = (() => {
    const pts = frontierResult.frontier;
    if (pts.length < 5) return { msTri: null, tailTri: null };
    // Max-Sharpe anchor: use the analytical tangency portfolio directly,
    // with slope = Sharpe ratio. This is exact by the first-order condition
    //     dE[r]/dσ |_{σ*} = (E[r*] − r_f)/σ* ≡ Sharpe*
    // so the value displayed under the triangle matches the Sharpe shown on
    // the clicked-portfolio card to the last decimal — no FD approximation.
    const msTri: DerivAnchor = {
      vol: frontierResult.maxSharpe.vol,
      ret: frontierResult.maxSharpe.ret,
      slope: frontierResult.maxSharpe.sharpe,
    };
    // Tail anchor: a frontier point past max-Sharpe. No closed-form slope
    // here (without rebuilding the Merton constants), so we use a centred
    // finite difference on adjacent frontier points — accuracy is fine for
    // the qualitative "slope < Sharpe" story.
    let msIdx = 0;
    let bestDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.vol - frontierResult.maxSharpe.vol);
      if (d < bestDist) { bestDist = d; msIdx = i; }
    });
    const tailIdx = Math.max(1, Math.min(pts.length - 2, Math.floor(msIdx + 0.55 * (pts.length - 1 - msIdx))));
    let tailTri: DerivAnchor | null = null;
    if (tailIdx > msIdx + 2 && tailIdx >= 1 && tailIdx <= pts.length - 2) {
      const lo = pts[tailIdx - 1];
      const hi = pts[tailIdx + 1];
      tailTri = {
        vol: pts[tailIdx].vol,
        ret: pts[tailIdx].ret,
        slope: (hi.ret - lo.ret) / Math.max(hi.vol - lo.vol, 1e-9),
      };
    }
    return { msTri, tailTri };
  })();

  // Individual asset markers — only include those that fit inside the visible
  // axes. Off-chart corners (e.g. ultra-volatile single tickers) are dropped
  // to keep the chart focused on the dense data region.
  const assetData = tickers
    .map((t, i) => ({
      vol: Math.sqrt(Math.max(sigma[i][i], 0)),
      ret: mu[i],
      weights: tickers.map((_, k) => (k === i ? 1 : 0)),
      series: t.replace(/\.SA$/, ""),
      sharpe: 0,
    }))
    .filter((d) => d.vol <= xMax && d.ret >= yMin && d.ret <= yMax);

  function onClickPoint(kind: ClickedPoint["kind"]) {
    return (d: { payload?: { vol: number; ret: number; sharpe?: number; weights: number[] } }) => {
      if (!d?.payload) return;
      setClicked({
        kind,
        vol: d.payload.vol,
        ret: d.payload.ret,
        sharpe: d.payload.sharpe,
        weights: d.payload.weights,
      });
    };
  }

  function handleLoad() {
    if (!clicked || !onLoad) return;
    const out: Record<string, number> = {};
    tickers.forEach((t, i) => {
      const w = clicked.weights[i] ?? 0;
      if (w > 0.0005) out[t] = w;
    });
    const sum = Object.values(out).reduce((a, b) => a + b, 0);
    if (sum > 0) Object.keys(out).forEach((k) => (out[k] = out[k] / sum));
    onLoad(out);
    setClicked(null);
  }

  return (
    <div className="space-y-4">
      {frontierResult.isEqualWeightFallback ? (
        <div
          className="rounded-md border border-[color:var(--loss)]/40 bg-[color:var(--loss)]/8 px-4 py-3 text-xs text-strong"
          role="alert"
        >
          <strong className="block uppercase tracking-wider text-[10px] text-[color:var(--loss)]">
            Aviso: fallback de pesos iguais (1/N)
          </strong>
          O solver long-only não conseguiu produzir uma carteira não-negativa
          válida com esses parâmetros (caso comum: todos os μ abaixo do rf após
          shrinkage). A &ldquo;máx. Sharpe&rdquo; e a &ldquo;mín. variância&rdquo;
          exibidas são <em>equal-weight</em>, não os pontos analíticos. Considere
          ajustar a janela, o universo, ou desabilitar o long-only.
        </div>
      ) : null}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <span className="eyebrow">Fronteira eficiente</span>
            {caption ? (
              <span className="ml-3 text-[10px] uppercase tracking-wider text-muted">{caption}</span>
            ) : null}
            <span
              className="ml-2 text-[10px] uppercase tracking-wider text-muted"
              title="rf = CDI médio sobre a janela · poupança ≈ 70% do CDI (Lei 12.703/2012)"
            >
              · rf (CDI) = {(rf * 100).toFixed(2).replace(".", ",")}% a.a.
              {" · "}
              poupança ≈ {(poupancaRate * 100).toFixed(2).replace(".", ",")}% a.a.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-body">
            <LegendDot color="var(--muted)" /> nuvem aleatória
            <LegendDot color="var(--muted)" shape="dot-small" /> ativo individual
            <LegendDot color="var(--accent)" line /> fronteira
            <LegendDot color="var(--gain)" line dashed /> CAL (linha de alocação de capital)
            <LegendDot color="var(--muted)" line dashed /> poupança
            <LegendDot color="var(--gain)" shape="triangle" /> derivada ∂E[r]/∂σ
            <LegendDot color="var(--strong)" shape="circle-outline" /> mín. variância
            <LegendDot color="var(--gain)" shape="star" /> máx. Sharpe
            {userPoint ? (
              <>
                <LegendDot color="var(--accent)" shape="diamond" /> sua carteira
              </>
            ) : null}
            {comparePoint ? (
              <>
                <LegendDot color="var(--loss)" shape="diamond" /> {comparePoint.label ?? "comparação"}
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void downloadSvgChart(
                  chartRef.current,
                  `fronteira-eficiente-${new Date().toISOString().slice(0, 10)}.png`,
                  "png",
                ).catch((e) => console.warn("download failed", e));
              }}
              className="ml-auto rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted hover:text-strong"
              title="Baixar PNG da fronteira eficiente"
            >
              ↓ baixar
            </button>
          </div>
        </div>
        <div className="p-4">
          <div ref={chartRef} style={{ width: "100%", height: 440 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 16, right: 32, left: 16, bottom: 44 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="vol"
                  name="vol"
                  domain={[xMin, xMax]}
                  allowDataOverflow
                  label={{
                    value: "Volatilidade anualizada  σ",
                    position: "insideBottom",
                    offset: -14,
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
                  domain={[yMin, yMax]}
                  allowDataOverflow
                  label={{
                    value: "Retorno esperado  E[r]",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--muted)",
                    fontSize: 11,
                    offset: 0,
                  }}
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  stroke="var(--border)"
                  tickFormatter={fmtAxisPct}
                  width={70}
                />
                <ZAxis range={[12, 12]} />
                <Tooltip cursor={false} content={<FrontierTooltip />} />
                {/* Risk-free reference line — only if rf falls inside the
                    visible Y range; otherwise skipped to save vertical space. */}
                {rfInRange ? (
                  <ReferenceLine
                    y={rf}
                    stroke="var(--gain)"
                    strokeDasharray="2 3"
                    strokeOpacity={0.5}
                    label={{
                      value: `rf (CDI) = ${(rf * 100).toFixed(2).replace(".", ",")}%`,
                      position: "insideTopLeft",
                      fill: "var(--gain)",
                      fontSize: 10,
                      fillOpacity: 0.8,
                    }}
                  />
                ) : null}
                {/* Poupança — renda fixa do varejo, dominada pelo CDI */}
                {poupancaInRange ? (
                  <ReferenceLine
                    y={poupancaRate}
                    stroke="var(--muted)"
                    strokeDasharray="2 4"
                    strokeOpacity={0.55}
                    label={{
                      value: `poupança ≈ ${(poupancaRate * 100).toFixed(2).replace(".", ",")}%`,
                      position: "insideBottomLeft",
                      fill: "var(--muted)",
                      fontSize: 9.5,
                      fillOpacity: 0.85,
                    }}
                  />
                ) : null}
                {/* Individual asset corner points — textbook "feasible set boundary" */}
                <Scatter
                  name="assets"
                  data={assetData}
                  onClick={(d: { payload?: { vol: number; ret: number; weights: number[] } }) => {
                    if (!d?.payload) return;
                    setClicked({
                      kind: "frontier",
                      vol: d.payload.vol,
                      ret: d.payload.ret,
                      weights: d.payload.weights,
                    });
                  }}
                  shape={(props: { cx?: number; cy?: number; payload?: { series?: string } }) => {
                    const cx = props.cx ?? 0;
                    const cy = props.cy ?? 0;
                    return (
                      <g style={{ cursor: "pointer" }}>
                        <circle cx={cx} cy={cy} r={3.5} fill="var(--muted)" fillOpacity={0.85} />
                        <text
                          x={cx + 6}
                          y={cy + 3.5}
                          fontSize={9}
                          fill="var(--muted)"
                          opacity={0.75}
                        >
                          {props.payload?.series}
                        </text>
                      </g>
                    );
                  }}
                />
                {/* Capital Allocation Line: tangent at max-Sharpe, anchored at (0, rf) */}
                {showCal ? (
                  <Scatter
                    name="cal"
                    data={calData}
                    line={{ stroke: "var(--gain)", strokeWidth: 1.5, strokeDasharray: "5 4", strokeOpacity: 0.65 }}
                    lineType="joint"
                    shape={() => <g />}
                    legendType="none"
                  />
                ) : null}
                <Scatter
                  name="cloud"
                  data={cloudData}
                  fill="var(--muted)"
                  fillOpacity={0.25}
                  shape="circle"
                  onClick={onClickPoint("cloud")}
                  style={{ cursor: "pointer" }}
                />
                <Scatter
                  name="frontier"
                  data={frontierData}
                  line={{ stroke: "var(--accent)", strokeWidth: 2 }}
                  lineType="joint"
                  fill="var(--accent)"
                  fillOpacity={0}
                  onClick={onClickPoint("frontier")}
                  shape={(props: { cx?: number; cy?: number }) => (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={4}
                      fill="var(--accent)"
                      fillOpacity={0.001}
                      style={{ cursor: "pointer" }}
                    />
                  )}
                />
                {/* Derivative triangles — geometric "rise over run" for
                    ∂E[r]/∂σ at the tangency portfolio (hypotenuse ∥ CAL,
                    slope = Sharpe ratio) and past it (slope < Sharpe). Drawn
                    via <Customized> using the chart's own scales so the
                    triangle stays correct under axis-domain changes. */}
                <Customized
                  component={(props: { xAxisMap?: Record<string, { scale?: (v: number) => number }>; yAxisMap?: Record<string, { scale?: (v: number) => number }> }) => {
                    const xScale = props.xAxisMap?.[0]?.scale ?? Object.values(props.xAxisMap ?? {})[0]?.scale;
                    const yScale = props.yAxisMap?.[0]?.scale ?? Object.values(props.yAxisMap ?? {})[0]?.scale;
                    if (typeof xScale !== "function" || typeof yScale !== "function") return null;

                    const renderTriangle = (
                      anchor: DerivAnchor,
                      color: string,
                      annotation: string,
                      key: string,
                    ) => {
                      // Adapt triangle width so the vertical extent stays
                      // inside ~14% of the y-range even when the slope is
                      // steep (near min-var).
                      const baseW = (xMax - xMin) * 0.07;
                      const maxDE = (yMax - yMin) * 0.14;
                      const w = anchor.slope > 1e-6 ? Math.min(baseW, maxDE / anchor.slope) : baseW;
                      const dE = anchor.slope * w;
                      // Anchor sits at the TOP-RIGHT vertex (C); triangle
                      // extends down-left so the hypotenuse arrives at the
                      // frontier point — geometrically the "tangent touching
                      // the curve" picture.
                      const Cx = xScale(anchor.vol);
                      const Cy = yScale(anchor.ret);
                      const Bx = xScale(anchor.vol - w);
                      const By = yScale(anchor.ret);
                      const Ax = xScale(anchor.vol - w);
                      const Ay = yScale(anchor.ret - dE);
                      const slopeFmt = anchor.slope.toFixed(2).replace(".", ",");
                      return (
                        <g key={key} pointerEvents="none">
                          <path
                            d={`M ${Ax} ${Ay} L ${Bx} ${By} L ${Cx} ${Cy} Z`}
                            fill={color}
                            fillOpacity={0.07}
                          />
                          {/* Top leg (Δσ) */}
                          <line x1={Bx} y1={By} x2={Cx} y2={Cy} stroke={color} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.7} />
                          {/* Left leg (ΔE[r]) */}
                          <line x1={Ax} y1={Ay} x2={Bx} y2={By} stroke={color} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.7} />
                          {/* Hypotenuse (tangent line) */}
                          <line x1={Ax} y1={Ay} x2={Cx} y2={Cy} stroke={color} strokeWidth={1.75} strokeOpacity={0.9} />
                          {/* Δσ label, above the top leg */}
                          <text x={(Bx + Cx) / 2} y={By - 5} fontSize={9} fill="var(--muted)" textAnchor="middle">Δσ</text>
                          {/* ΔE[r] label, left of the left leg */}
                          <text x={Bx - 5} y={(Ay + By) / 2 + 3} fontSize={9} fill="var(--muted)" textAnchor="end">ΔE[r]</text>
                          {/* Slope value (the actual derivative) — placed at A so it sits below the triangle */}
                          <text x={Ax} y={Ay + 14} fontSize={10.5} fontWeight={600} fill={color} textAnchor="start">
                            ∂E[r]/∂σ = {slopeFmt}
                          </text>
                          <text x={Ax} y={Ay + 26} fontSize={9} fill="var(--muted)" textAnchor="start">
                            {annotation}
                          </text>
                        </g>
                      );
                    };

                    return (
                      <g>
                        {derivTriangles.msTri
                          ? renderTriangle(derivTriangles.msTri, "var(--gain)", "= Sharpe (tangência)", "tri-ms")
                          : null}
                        {derivTriangles.tailTri
                          ? renderTriangle(derivTriangles.tailTri, "var(--strong)", "< Sharpe (subótimo)", "tri-tail")
                          : null}
                      </g>
                    );
                  }}
                />
                <Scatter
                  name="min variance"
                  data={mvPoint}
                  onClick={onClickPoint("mv")}
                  shape={(props: { cx?: number; cy?: number }) => (
                    <g style={{ cursor: "pointer" }}>
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={14}
                        fill="var(--strong)"
                        fillOpacity={0.08}
                      />
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={9}
                        fill="var(--bg-elevated)"
                        stroke="var(--strong)"
                        strokeWidth={2.5}
                      />
                    </g>
                  )}
                />
                <Scatter
                  name="max Sharpe"
                  data={msPoint}
                  onClick={onClickPoint("ms")}
                  shape={(props: { cx?: number; cy?: number }) => {
                    const cx = props.cx ?? 0;
                    const cy = props.cy ?? 0;
                    // 5-pointed star, points-up, ro=12, ri=6
                    const pts: string[] = [];
                    for (let i = 0; i < 10; i++) {
                      const r = i % 2 === 0 ? 12 : 6;
                      const a = (Math.PI / 5) * i - Math.PI / 2;
                      pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
                    }
                    const d = "M " + pts.join(" L ") + " Z";
                    return (
                      <g style={{ cursor: "pointer" }}>
                        <circle cx={cx} cy={cy} r={16} fill="var(--gain)" fillOpacity={0.15} />
                        <path d={d} fill="var(--gain)" stroke="var(--bg-base)" strokeWidth={1.5} />
                      </g>
                    );
                  }}
                />
                {userPoint ? (
                  <Scatter
                    name="user"
                    data={[{ ...userPoint, series: "Sua carteira" }]}
                    onClick={onClickPoint("user")}
                    shape={(props: { cx?: number; cy?: number }) => {
                      const cx = props.cx ?? 0;
                      const cy = props.cy ?? 0;
                      const s = 10;
                      const d = `M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`;
                      return (
                        <g style={{ cursor: "pointer" }}>
                          <circle cx={cx} cy={cy} r={16} fill="var(--accent)" fillOpacity={0.18} />
                          <path d={d} fill="var(--accent)" stroke="var(--bg-base)" strokeWidth={1.5} />
                        </g>
                      );
                    }}
                  />
                ) : null}
                {comparePoint ? (
                  <Scatter
                    name="compare"
                    data={[{ ...comparePoint, series: comparePoint.label ?? "Comparação" }]}
                    onClick={onClickPoint("compare")}
                    shape={(props: { cx?: number; cy?: number }) => {
                      const cx = props.cx ?? 0;
                      const cy = props.cy ?? 0;
                      const s = 10;
                      const d = `M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`;
                      return (
                        <g style={{ cursor: "pointer" }}>
                          <circle cx={cx} cy={cy} r={16} fill="var(--loss)" fillOpacity={0.18} />
                          <path d={d} fill="var(--loss)" stroke="var(--bg-base)" strokeWidth={1.5} />
                        </g>
                      );
                    }}
                  />
                ) : null}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-center text-[10px] text-muted">
            Clique em qualquer ponto para ver a composição da carteira.
          </p>
        </div>
      </div>

      {clicked ? (
        <ClickedPortfolioCard
          point={clicked}
          tickers={tickers}
          onClose={() => setClicked(null)}
          onLoad={onLoad ? handleLoad : undefined}
          rf={rf}
        />
      ) : null}
    </div>
  );
}

function FrontierTooltip({ active, payload }: { active?: boolean; payload?: { payload?: { vol?: number; ret?: number; sharpe?: number; series?: string } }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p || typeof p.vol !== "number" || typeof p.ret !== "number") return null;
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 12,
        color: "var(--strong)",
        minWidth: 140,
        boxShadow: "0 6px 24px -8px rgba(0,0,0,0.5)",
      }}
    >
      {p.series ? (
        <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          {p.series}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <span style={{ color: "var(--muted)" }}>Retorno</span>
        <span className="tabular font-semibold">{PCT2_BR.format(p.ret)} a.a.</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-4">
        <span style={{ color: "var(--muted)" }}>Volatilidade</span>
        <span className="tabular font-semibold">{PCT2_BR.format(p.vol)} a.a.</span>
      </div>
      {typeof p.sharpe === "number" ? (
        <div className="mt-0.5 flex items-center justify-between gap-4">
          <span style={{ color: "var(--muted)" }}>Sharpe</span>
          <span className="tabular font-semibold">{fmtNum2(p.sharpe)}</span>
        </div>
      ) : null}
    </div>
  );
}

function ClickedPortfolioCard({
  point,
  tickers,
  onClose,
  onLoad,
  rf,
}: {
  point: ClickedPoint;
  tickers: string[];
  onClose: () => void;
  onLoad?: () => void;
  rf: number;
}) {
  const KIND_LABEL: Record<string, string> = {
    frontier: "Ponto da fronteira",
    cloud: "Carteira aleatória",
    mv: "Mínima variância",
    ms: "Máximo Sharpe (tangência)",
    user: "Sua carteira",
    compare: "Carteira comparação",
  };
  const allocations = tickers
    .map((t, i) => ({ ticker: t, weight: point.weights[i] ?? 0 }))
    .filter((a) => Math.abs(a.weight) > 0.001)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const sharpe = point.sharpe ?? (point.vol > 0 ? (point.ret - rf) / point.vol : 0);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <div className="eyebrow">Carteira selecionada</div>
          <div className="mt-1 text-sm text-strong">{KIND_LABEL[point.kind] ?? "Carteira"}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {onLoad ? (
            <button
              type="button"
              onClick={onLoad}
              className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 font-semibold text-white"
            >
              Carregar no construtor
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-muted hover:text-strong"
          >
            Fechar
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Retorno esp.</div>
          <div className={`mt-1 text-sm font-semibold tabular ${signedClass(point.ret)}`}>
            {fmtPctAA(point.ret)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Vol. anual</div>
          <div className="mt-1 text-sm font-semibold tabular">
            {fmtPctAA(point.vol).replace("+", "")}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Sharpe</div>
          <div className={`mt-1 text-sm font-semibold tabular ${signedClass(sharpe)}`}>
            {fmtNum2(sharpe)}
          </div>
        </div>
      </div>
      <ul className="max-h-[360px] divide-y divide-border overflow-auto">
        {allocations.map((a) => (
          <li
            key={a.ticker}
            className="grid items-center gap-3 px-5 py-2.5"
            style={{ gridTemplateColumns: "80px 1fr 80px" }}
          >
            <a
              href={withBase(`/ticker/${encodeURIComponent(a.ticker)}/`)}
              className="mono text-sm font-semibold hover:underline"
            >
              {a.ticker.replace(/\.SA$/, "")}
            </a>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-[color:var(--bg-subtle)]">
              <div
                aria-hidden
                className={`absolute inset-y-0 left-0 rounded-full ${
                  a.weight >= 0 ? "bg-[color:var(--accent)]" : "bg-[color:var(--loss)]"
                }`}
                style={{ width: `${Math.min(100, Math.abs(a.weight) * 100)}%`, opacity: 0.75 }}
              />
            </div>
            <span className={`text-right text-xs tabular ${signedClass(a.weight)}`}>
              {(a.weight * 100).toFixed(1).replace(".", ",")}%
            </span>
          </li>
        ))}
        {allocations.length === 0 ? (
          <li className="px-5 py-4 text-xs text-muted">Pesos negligíveis em todos os ativos.</li>
        ) : null}
      </ul>
      {allocations.length > 0 ? (
        <div
          className="grid items-center gap-3 border-t border-border bg-[color:var(--bg-subtle)]/40 px-5 py-2 text-xs"
          style={{ gridTemplateColumns: "80px 1fr 80px" }}
        >
          <span className="text-[10px] uppercase tracking-wider text-muted">Total</span>
          <span />
          <span className="text-right font-semibold tabular text-strong">
            {(point.weights.reduce((s, w) => s + (w ?? 0), 0) * 100)
              .toFixed(1)
              .replace(".", ",")}
            %
          </span>
        </div>
      ) : null}
    </div>
  );
}

function LegendDot({
  color,
  line,
  dashed,
  shape = "dot",
}: {
  color: string;
  line?: boolean;
  dashed?: boolean;
  shape?: "dot" | "dot-small" | "circle-outline" | "star" | "diamond" | "triangle";
}) {
  if (line) {
    if (dashed) {
      return (
        <span aria-hidden className="inline-flex items-center gap-1">
          <svg width="20" height="4" aria-hidden style={{ display: "inline-block" }}>
            <line x1="0" y1="2" x2="20" y2="2" stroke={color} strokeWidth="2" strokeDasharray="4 3" />
          </svg>
        </span>
      );
    }
    return (
      <span aria-hidden className="inline-flex items-center gap-1">
        <span className="inline-block h-[2px] w-4 rounded-full" style={{ background: color }} />
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
    return <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: color }} />;
  }
  if (shape === "triangle") {
    return (
      <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden style={{ display: "inline-block" }}>
        <path d="M0 9 L12 9 L12 0 Z" fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.25} />
      </svg>
    );
  }
  if (shape === "dot-small") {
    return <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full opacity-80" style={{ background: color }} />;
  }
  return <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />;
}
