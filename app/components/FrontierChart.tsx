"use client";

import { useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
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
import { fmtAxisPct, fmtNum2, fmtPctSigned, signedClass } from "@/lib/format";
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

  // ── Textbook-style enhancements ────────────────────────────────────────
  // Compute data-aware axis domains using PERCENTILES (not strict min/max)
  // so the chart focuses on where the data actually lives. Extreme single-
  // asset outliers (e.g. one highly volatile ticker like UGPA3) won't drag
  // the axes out and waste 70% of the canvas on empty space.
  const cloudRets = frontierResult.cloud.map((p) => p.ret);
  const cloudVols = frontierResult.cloud.map((p) => p.vol);
  const sortedRets = [...cloudRets].sort((a, b) => a - b);
  const sortedVols = [...cloudVols].sort((a, b) => a - b);
  const pct = (arr: number[], q: number) =>
    arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * arr.length)))];

  const cloudRetHi = pct(sortedRets, 0.98);
  const cloudRetLo = pct(sortedRets, 0.02);
  const cloudVolHi = pct(sortedVols, 0.98);

  // X axis: covers cloud (98th pct) and a generous margin past max-Sharpe,
  // but does NOT chase the single-asset corner if it's much farther out.
  // Starts at 10% (volatilities below this are rarely relevant in practice).
  const xMin = 0.10;
  const xMax = Math.max(
    cloudVolHi,
    frontierResult.maxSharpe.vol * 1.6,
    frontierResult.minVariance.vol * 2.5,
  ) * 1.04;

  // Y axis: starts at 30% floor (returns below this are not the focus area),
  // with 15% headroom above the highest data point.
  const dataMaxY = Math.max(
    frontierResult.maxSharpe.ret,
    frontierResult.minVariance.ret,
    cloudRetHi,
  );
  const rangeY = Math.max(dataMaxY - Math.min(rf, cloudRetLo, frontierResult.minVariance.ret), 1e-6);
  const yMin = 0.30;
  const yMax = dataMaxY + 0.15 * rangeY;

  // Capital Allocation Line (CAL) — tangent to the frontier at max-Sharpe,
  // anchored at the risk-free rate. CAL is the correct name when the
  // tangency portfolio is the subset's optimum (not the market portfolio,
  // which would make it the CML). Clipped to whichever edge (right OR top)
  // the line hits first inside the visible axes.
  const calSlope = (frontierResult.maxSharpe.ret - rf) / Math.max(frontierResult.maxSharpe.vol, 1e-9);
  const calVolAtYMax = calSlope > 1e-9 ? (yMax - rf) / calSlope : xMax;
  const calEndVol = Math.min(xMax, Math.max(xMin, calVolAtYMax));
  const calStartRet = rf + calSlope * xMin;
  const calEndRet = rf + calSlope * calEndVol;
  const calData = [
    { vol: xMin, ret: calStartRet, weights: [], series: "Capital Allocation Line" },
    { vol: calEndVol, ret: calEndRet, weights: [], series: "Capital Allocation Line" },
  ];

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
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <span className="eyebrow">Fronteira eficiente</span>
            {caption ? (
              <span className="ml-3 text-[10px] uppercase tracking-wider text-muted">{caption}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-body">
            <LegendDot color="var(--muted)" /> nuvem aleatória
            <LegendDot color="var(--muted)" shape="dot-small" /> ativo individual
            <LegendDot color="var(--accent)" line /> fronteira
            <LegendDot color="var(--gain)" line dashed /> CAL (linha de alocação de capital)
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
                {/* Risk-free reference line (textbook annotation for rf) */}
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
                <Scatter
                  name="cal"
                  data={calData}
                  line={{ stroke: "var(--gain)", strokeWidth: 1.5, strokeDasharray: "5 4", strokeOpacity: 0.65 }}
                  lineType="joint"
                  shape={() => <g />}
                  legendType="none"
                />
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
        <span className="tabular font-semibold">{PCT2_BR.format(p.ret)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-4">
        <span style={{ color: "var(--muted)" }}>Volatilidade</span>
        <span className="tabular font-semibold">{PCT2_BR.format(p.vol)}</span>
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
              href={`/ticker/${encodeURIComponent(a.ticker)}/`}
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
  shape?: "dot" | "dot-small" | "circle-outline" | "star" | "diamond";
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
  if (shape === "dot-small") {
    return <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full opacity-80" style={{ background: color }} />;
  }
  return <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />;
}
