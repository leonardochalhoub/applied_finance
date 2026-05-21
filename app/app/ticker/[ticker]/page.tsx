import { notFound } from "next/navigation";

import { KpiCard } from "@/components/KpiCard";
import { TickerSparkChart } from "@/components/TickerSparkChart";
import { loadKpis, loadPrices } from "@/lib/data";
import { fmtBRL, fmtDate, fmtPctSigned, signedClass } from "@/lib/format";

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
  const [kpis, prices] = await Promise.all([loadKpis(), loadPrices()]);
  const row = kpis?.tickers.find((t) => t.ticker === ticker);
  if (!row || !kpis) notFound();

  const series = prices?.series[ticker] ?? null;
  const chartData =
    series && prices
      ? prices.dates
          .map((d, i) => ({ date: d, value: series[i] }))
          .filter((p): p is { date: string; value: number } => p.value != null)
      : [];

  return (
    <div className="space-y-12">
      <section>
        <a href="/" className="text-xs text-muted hover:text-strong">
          ← voltar
        </a>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="mono text-4xl font-semibold tracking-tight">
            {row.ticker.replace(/\.SA$/, "")}
          </h1>
          <span className="text-base text-body">{row.company_name}</span>
          {row.sector_b3 ? <span className="chip">{row.sector_b3}</span> : null}
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

      {chartData.length > 5 ? (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="eyebrow">Trajetória de preços</span>
            <span className="text-[10px] uppercase tracking-wider text-muted">
              rebaseado a 100 em {chartData[0]?.date}
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
        <KpiCard label="Volatilidade anual" value={row.vol_annual} big />
        <KpiCard label="Drawdown máx." value={row.max_drawdown} big />
        <KpiCard label="Sharpe vs CDI" value={row.sharpe_vs_cdi} format="num" big />
      </section>

      <section className="card px-5 py-4 text-sm text-muted">
        Quer comparar este ticker com outros?{" "}
        <a href="/comparar/" className="text-strong hover:underline">
          Abrir o comparador →
        </a>
      </section>
    </div>
  );
}
