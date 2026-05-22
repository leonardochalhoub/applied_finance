import { notFound } from "next/navigation";

import { KpiCard } from "@/components/KpiCard";
import { TickerSparkChart } from "@/components/TickerSparkChart";
import { loadIbov, loadKpis, loadPrices } from "@/lib/data";
import { fmtBRL, fmtDate, fmtNum2, fmtPctAA, fmtPctSigned, signedClass } from "@/lib/format";
import { withBase } from "@/lib/links";

export const dynamic = "force-static";

export async function generateStaticParams() {
  const kpis = await loadKpis();
  if (!kpis || kpis.tickers.length === 0) {
    return [{ ticker: "PETR4.SA" }];
  }
  return kpis.tickers.map((t) => ({ ticker: t.ticker }));
}

export default async function TickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const [kpis, prices, ibov] = await Promise.all([loadKpis(), loadPrices(), loadIbov()]);
  const row = kpis?.tickers.find((t) => t.ticker === ticker);
  if (!row || !kpis) notFound();

  const series = prices?.series[ticker] ?? null;
  const chartData =
    series && prices
      ? prices.dates
          .map((d, i) => ({ date: d, value: series[i] }))
          .filter((p): p is { date: string; value: number } => p.value != null)
      : [];

  // Sector peers (same sector_b3 in kpis)
  const peers = (kpis?.tickers ?? [])
    .filter((t) => t.sector_b3 === row.sector_b3 && t.ticker !== row.ticker)
    .sort((a, b) => (b.return_ytd ?? -Infinity) - (a.return_ytd ?? -Infinity));

  const ibovMember = ibov?.members.find((m) => m.ticker === ticker);

  // Quick window stats from the price series
  const winStats = computeWindowSummary(series, prices?.dates ?? []);

  return (
    <div className="space-y-12">
      <section>
        <a href={withBase("/")} className="text-xs text-muted hover:text-strong">
          ← voltar
        </a>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="mono text-4xl font-semibold tracking-tight">
            {row.ticker.replace(/\.SA$/, "")}
          </h1>
          <span className="text-base text-body">{row.company_name}</span>
          {row.sector_b3 ? (
            <a href={withBase(`/setores/?s=${encodeURIComponent(row.sector_b3)}`)} className="chip hover:text-strong">
              {row.sector_b3}
            </a>
          ) : null}
          {ibovMember ? (
            <span className="chip">
              IBOV · peso {(ibovMember.weight * 100).toFixed(2)}%
            </span>
          ) : null}
        </div>
        <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="eyebrow">Último fechamento</div>
            <div className="display-stat mt-2">{fmtBRL(row.last_close)}</div>
            <div className="mt-1 text-xs text-muted">{fmtDate(row.last_close_date)}</div>
          </div>
          <div>
            <div className="eyebrow">YTD</div>
            <div className={`display-stat mt-2 ${signedClass(row.return_ytd)}`}>
              {fmtPctSigned(row.return_ytd)}
            </div>
          </div>
        </div>
      </section>

      {/* Window summaries — quick context */}
      {winStats ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Retorno por janela</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <WindowChip label="1M" value={winStats.ret_1m} />
            <WindowChip label="3M" value={winStats.ret_3m} />
            <WindowChip label="6M" value={winStats.ret_6m} />
            <WindowChip label="YTD" value={winStats.ret_ytd} />
            <WindowChip label="1Y" value={winStats.ret_1y} />
            <WindowChip label="MAX" value={winStats.ret_max} />
          </div>
        </section>
      ) : null}

      {chartData.length > 5 ? (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="eyebrow">Trajetória de preços (R$ adjusted close)</span>
            <span className="text-[10px] uppercase tracking-wider text-muted">
              {chartData[0]?.date} → {chartData[chartData.length - 1]?.date}
            </span>
          </div>
          <div className="px-4 py-4">
            <TickerSparkChart
              data={chartData}
              positive={(row.return_ytd ?? 0) >= 0}
              height={360}
            />
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Retorno YTD" value={row.return_ytd} big />
        <KpiCard label="Volatilidade" value={row.vol_annual} format="pct-aa" big />
        <KpiCard label="Drawdown máx." value={row.max_drawdown} big />
        <KpiCard label="Sharpe vs CDI" value={row.sharpe_vs_cdi} format="num" big />
      </section>

      {/* Sharpe transparency */}
      {row.cdi_annual_used != null || row.n_obs != null ? (
        <section className="card px-5 py-4 text-sm text-body">
          <div className="eyebrow mb-2">Transparência do Sharpe</div>
          <ul className="space-y-1 text-xs">
            {row.cdi_annual_used != null ? (
              <li>
                Taxa livre de risco usada: <span className="tabular font-semibold">
                  {(row.cdi_annual_used * 100).toFixed(2)}% a.a.
                </span> (média CDI sobre a janela deste ticker)
              </li>
            ) : null}
            {row.n_obs != null ? (
              <li>
                Observações: <span className="tabular font-semibold">{row.n_obs}</span> dias úteis
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {/* Peers in the same sector */}
      {peers.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">
            Pares setoriais — {row.sector_b3}
          </h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-5 py-3">Ticker</th>
                  <th className="px-5 py-3">Empresa</th>
                  <th className="px-5 py-3 text-right">YTD</th>
                  <th className="px-5 py-3 text-right">Vol.</th>
                  <th className="px-5 py-3 text-right">Sharpe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {peers.slice(0, 8).map((p) => (
                  <tr key={p.ticker} className="hover:bg-[color:var(--bg-subtle)]">
                    <td className="px-5 py-2.5">
                      <a
                        href={withBase(`/ticker/${encodeURIComponent(p.ticker)}/`)}
                        className="mono text-sm font-semibold hover:underline"
                      >
                        {p.ticker.replace(/\.SA$/, "")}
                      </a>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-body">{p.company_name}</td>
                    <td className={`px-5 py-2.5 text-right tabular ${signedClass(p.return_ytd)}`}>
                      {fmtPctSigned(p.return_ytd)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular text-body">
                      {fmtPctAA(p.vol_annual).replace("+", "")}
                    </td>
                    <td className={`px-5 py-2.5 text-right tabular ${signedClass(p.sharpe_vs_cdi)}`}>
                      {fmtNum2(p.sharpe_vs_cdi)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card px-5 py-4 text-sm text-muted">
        Quer comparar este ticker com outros?{" "}
        <a href={withBase(`/comparar/?t=${encodeURIComponent(row.ticker)}`)} className="text-strong hover:underline">
          Abrir o comparador →
        </a>
      </section>
    </div>
  );
}

function WindowChip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-sm font-semibold tabular ${signedClass(value)}`}>
        {fmtPctSigned(value)}
      </div>
    </div>
  );
}

function computeWindowSummary(
  series: (number | null)[] | null,
  dates: string[],
): {
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_ytd: number | null;
  ret_1y: number | null;
  ret_max: number | null;
} | null {
  if (!series || dates.length === 0) return null;
  function logRet(startIdx: number, endIdx: number): number | null {
    const s = series![startIdx];
    const e = series![endIdx];
    if (s == null || e == null || s <= 0) return null;
    return Math.log(e / s);
  }
  const end = series.length - 1;
  const dayOffset = (n: number) => Math.max(0, end - n);
  const year = dates[end].slice(0, 4);
  const ymd = `${year}-01-01`;
  const ytdStart = Math.max(0, dates.findIndex((d) => d >= ymd));
  return {
    ret_1m: logRet(dayOffset(22), end),
    ret_3m: logRet(dayOffset(66), end),
    ret_6m: logRet(dayOffset(132), end),
    ret_ytd: ytdStart >= 0 ? logRet(ytdStart, end) : null,
    ret_1y: logRet(dayOffset(252), end),
    ret_max: logRet(0, end),
  };
}
