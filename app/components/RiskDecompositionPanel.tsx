"use client";

import { useMemo } from "react";

type Props = {
  tickers: string[];
  weights: number[];
  /** Annualized covariance matrix aligned with `tickers` (n×n). */
  sigma: number[][];
};

type AssetRow = {
  ticker: string;
  weight: number;
  sigmaI: number;
  rcShare: number;
};

type PairRow = {
  i: string;
  j: string;
  share: number;
  rho: number;
};

type Decomposition = {
  sigmaP: number;
  variance: number;
  dr: number;
  rcHHI: number;
  diagShare: number;
  assets: AssetRow[];
  pairs: PairRow[];
};

function computeDecomposition(
  tickers: string[],
  weights: number[],
  sigma: number[][],
): Decomposition | null {
  const n = tickers.length;
  if (n < 2) return null;

  const Sw = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += sigma[i][j] * weights[j];
    Sw[i] = s;
  }

  let variance = 0;
  for (let i = 0; i < n; i++) variance += weights[i] * Sw[i];
  const sigmaP = Math.sqrt(Math.max(variance, 0));
  if (!Number.isFinite(sigmaP) || sigmaP <= 0 || variance <= 0) return null;

  const vols = new Array<number>(n);
  for (let i = 0; i < n; i++) vols[i] = Math.sqrt(Math.max(sigma[i][i], 0));

  // Per-asset risk contribution (Euler decomposition: Σ RC_i = σ_p)
  const rcShare = weights.map((w, i) => (w * Sw[i]) / sigmaP / sigmaP);
  // After dividing by σ_p twice the shares sum to 1 (since Σ w_i·(Σw)_i = σ_p²).

  let drNum = 0;
  for (let i = 0; i < n; i++) drNum += weights[i] * vols[i];
  const dr = drNum / sigmaP;

  let diagShare = 0;
  for (let i = 0; i < n; i++) diagShare += weights[i] * weights[i] * sigma[i][i];
  diagShare = diagShare / variance;

  const assets: AssetRow[] = tickers
    .map((t, i) => ({
      ticker: t,
      weight: weights[i],
      sigmaI: vols[i],
      rcShare: rcShare[i],
    }))
    .filter((r) => r.weight > 1e-6)
    .sort((a, b) => b.rcShare - a.rcShare);

  const rcHHI = assets.reduce((s, r) => s + r.rcShare * r.rcShare, 0);

  const pairs: PairRow[] = [];
  for (let i = 0; i < n; i++) {
    if (weights[i] <= 0) continue;
    for (let j = i + 1; j < n; j++) {
      if (weights[j] <= 0) continue;
      const c = 2 * weights[i] * weights[j] * sigma[i][j];
      if (Math.abs(c) < 1e-12) continue;
      const share = c / variance;
      const denom = vols[i] * vols[j];
      const rho = denom > 1e-18 ? sigma[i][j] / denom : 0;
      pairs.push({
        i: tickers[i],
        j: tickers[j],
        share,
        rho: Math.max(-1, Math.min(1, rho)),
      });
    }
  }
  pairs.sort((a, b) => Math.abs(b.share) - Math.abs(a.share));

  return {
    sigmaP,
    variance,
    dr,
    rcHHI,
    diagShare,
    assets,
    pairs: pairs.slice(0, 10),
  };
}

function fmtPct1(x: number): string {
  return `${(x * 100).toFixed(1).replace(".", ",")}%`;
}

function fmtPctSigned1(x: number): string {
  const s = (x * 100).toFixed(1).replace(".", ",");
  return x >= 0 ? `+${s}%` : `${s}%`;
}

function rhoColor(rho: number): string {
  const intensity = Math.min(1, Math.abs(rho));
  if (rho >= 0) {
    return `color-mix(in srgb, var(--gain) ${Math.round(intensity * 80)}%, var(--bg-subtle))`;
  }
  return `color-mix(in srgb, var(--loss) ${Math.round(intensity * 80)}%, var(--bg-subtle))`;
}

export function RiskDecompositionPanel({ tickers, weights, sigma }: Props) {
  const data = useMemo(
    () => computeDecomposition(tickers, weights, sigma),
    [tickers, weights, sigma],
  );

  if (!data) return null;

  const topRc = data.assets[0];
  const effectiveNRisk = data.rcHHI > 0 ? 1 / data.rcHHI : 0;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <span className="eyebrow">Decomposição do risco</span>
          <span className="ml-3 text-[10px] uppercase tracking-wider text-muted">
            quem realmente carrega a variância da carteira
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <HeaderStat
            label="σ carteira (anual)"
            value={fmtPct1(data.sigmaP)}
          />
          <HeaderStat
            label="Razão de diversificação"
            value={data.dr.toFixed(2).replace(".", ",")}
            hint={data.dr >= 1.4 ? "boa" : data.dr >= 1.15 ? "moderada" : "baixa"}
          />
          <HeaderStat
            label="N efetivo de risco"
            value={effectiveNRisk.toFixed(1).replace(".", ",")}
            hint={`top ${topRc?.ticker.replace(/\.SA$/, "") ?? "—"} ${fmtPct1(topRc?.rcShare ?? 0)}`}
          />
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-border">
        {/* Per-asset risk contribution */}
        <div className="px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-strong">
              Contribuição por ativo
            </h3>
            <span className="text-[10px] uppercase tracking-wider text-muted">
              RCᵢ = wᵢ·(Σw)ᵢ / σ²ₚ
            </span>
          </div>
          <ul className="divide-y divide-border">
            {data.assets.map((r) => (
              <li
                key={r.ticker}
                className="grid items-center gap-3 py-2"
                style={{ gridTemplateColumns: "84px 1fr 64px" }}
              >
                <a
                  href={`/ticker/${encodeURIComponent(r.ticker)}/`}
                  className="mono text-sm hover:underline"
                >
                  {r.ticker.replace(/\.SA$/, "")}
                </a>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-[color:var(--bg-subtle)]">
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--accent)]"
                    style={{
                      width: `${Math.min(100, Math.max(0, r.rcShare * 100))}%`,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span className="text-right text-xs tabular text-strong">
                  {fmtPct1(r.rcShare)}
                </span>
                <span
                  className="col-span-3 -mt-1 ml-[84px] text-[10px] text-muted"
                  title="Peso na carteira · vol individual (anual)"
                >
                  peso {fmtPct1(r.weight)} · σ {fmtPct1(r.sigmaI)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] leading-relaxed text-muted">
            Cada ativo é responsável por uma fatia do risco total que depende
            tanto do seu peso quanto de como ele se move com o resto da
            carteira. A soma das fatias é 100%.
          </p>
        </div>

        {/* Pair variance contributions */}
        <div className="px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-strong">
              Pares que mais movem o risco
            </h3>
            <span className="text-[10px] uppercase tracking-wider text-muted">
              2·wᵢwⱼ·σᵢⱼ / σ²ₚ
            </span>
          </div>
          <ul className="divide-y divide-border">
            {data.pairs.length === 0 ? (
              <li className="py-2 text-xs text-muted">
                Sem termos de covariância relevantes (carteira muito concentrada
                em um único ativo).
              </li>
            ) : (
              data.pairs.map((p) => (
                <li
                  key={`${p.i}-${p.j}`}
                  className="grid items-center gap-3 py-2"
                  style={{ gridTemplateColumns: "1fr 64px 56px" }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <a
                      href={`/ticker/${encodeURIComponent(p.i)}/`}
                      className="mono text-sm hover:underline"
                    >
                      {p.i.replace(/\.SA$/, "")}
                    </a>
                    <span className="text-muted">×</span>
                    <a
                      href={`/ticker/${encodeURIComponent(p.j)}/`}
                      className="mono text-sm hover:underline"
                    >
                      {p.j.replace(/\.SA$/, "")}
                    </a>
                  </div>
                  <span
                    className={`text-right text-xs tabular ${
                      p.share >= 0 ? "text-strong" : "kpi-positive"
                    }`}
                    title={
                      p.share >= 0
                        ? "Soma risco à carteira"
                        : "Diversifica (reduz risco)"
                    }
                  >
                    {fmtPctSigned1(p.share)}
                  </span>
                  <span
                    className="rounded px-2 py-0.5 text-right text-[11px] font-semibold tabular text-strong"
                    style={{ background: rhoColor(p.rho) }}
                    title={`ρ = ${p.rho.toFixed(2)}`}
                  >
                    ρ {p.rho.toFixed(2).replace(".", ",")}
                  </span>
                </li>
              ))
            )}
          </ul>
          <p className="mt-3 text-[10px] leading-relaxed text-muted">
            Valores positivos somam risco (pares andam juntos); negativos
            diversificam. Termos próprios (wᵢ²·σᵢᵢ) explicam{" "}
            <strong className="text-body">{fmtPct1(data.diagShare)}</strong> da
            variância; o restante vem dos pares.
          </p>
        </div>
      </div>
    </section>
  );
}

function HeaderStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="text-sm font-semibold tabular text-strong">{value}</div>
      {hint ? <div className="text-[10px] text-muted">{hint}</div> : null}
    </div>
  );
}
