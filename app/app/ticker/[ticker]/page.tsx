import { notFound } from "next/navigation";

import { KpiCard } from "@/components/KpiCard";
import { loadKpis } from "@/lib/data";
import { fmtDate, fmtPct } from "@/lib/format";

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
  const kpis = await loadKpis().catch(() => null);
  const row = kpis?.tickers.find((t) => t.ticker === ticker);
  if (!row || !kpis) notFound();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-mono text-2xl font-semibold">{row.ticker}</h1>
        <p className="mt-1 text-sm text-muted">
          {row.company_name} · {row.sector_b3 ?? "—"} · snapshot {fmtDate(kpis.as_of)}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Retorno YTD" value={row.return_ytd} />
        <KpiCard label="Volatilidade anual" value={row.vol_annual} />
        <KpiCard label="Drawdown máx." value={row.max_drawdown} />
        <KpiCard label="Sharpe vs CDI" value={row.sharpe_vs_cdi} format="num" />
      </section>

      <section className="rounded-md border border-border p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
          Último fechamento
        </h2>
        <div className="text-lg tabular">
          R$ {row.last_close?.toFixed(2) ?? "—"} ({fmtDate(row.last_close_date)})
        </div>
      </section>

      <section className="text-sm text-muted">
        Série histórica e gráfico de candles serão renderizados a partir do Parquet
        <code className="mx-1 font-mono">returns_wide.parquet</code> em uma próxima entrega.
        A versão atual usa apenas os KPIs precomputados.
      </section>
    </div>
  );
}
