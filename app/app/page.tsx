import { KpiCard } from "@/components/KpiCard";
import { SectorHeatStrip } from "@/components/SectorHeatStrip";
import { loadIbov, loadKpis, loadSectors } from "@/lib/data";
import { fmtDate, fmtPct, signedClass } from "@/lib/format";

export const dynamic = "force-static";

export default async function HomePage() {
  const [kpis, sectors, ibov] = await Promise.all([
    loadKpis().catch(() => null),
    loadSectors().catch(() => null),
    loadIbov().catch(() => null),
  ]);

  if (!kpis || !sectors || !ibov) {
    return (
      <div className="rounded-md border border-border p-6">
        <h1 className="text-xl font-semibold">Aguardando primeiro refresh</h1>
        <p className="mt-2 text-sm text-muted">
          O lakehouse ainda não publicou os artefatos. Os dados aparecem aqui após o primeiro
          deploy do pipeline diário (~22:00 BRT em dias úteis).
        </p>
      </div>
    );
  }

  const topMovers = [...kpis.tickers]
    .filter((t) => t.return_ytd != null)
    .sort((a, b) => (b.return_ytd ?? 0) - (a.return_ytd ?? 0));
  const top5 = topMovers.slice(0, 5);
  const bottom5 = topMovers.slice(-5).reverse();

  return (
    <div className="space-y-12">
      <section>
        <h1 className="text-2xl font-semibold">Visão geral do mercado brasileiro</h1>
        <p className="mt-1 text-sm text-muted">
          Snapshot em {fmtDate(kpis.as_of)} · {kpis.tickers.length} tickers · dados via{" "}
          <code className="font-mono">yfr_py</code>.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="IBOV YTD" value={ibov.index_return_ytd ?? null} />
        <KpiCard label="Tickers cobertos" value={kpis.tickers.length} format="num" />
        <KpiCard label="Setores" value={sectors.sectors.length} format="num" />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Comparação setorial — YTD</h2>
        <SectorHeatStrip sectors={sectors.sectors} />
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Top 5 — maior retorno YTD</h2>
          <ul className="divide-y divide-border rounded-md border border-border">
            {top5.map((t) => (
              <li key={t.ticker} className="flex items-center justify-between p-3">
                <div>
                  <a className="font-mono text-sm hover:underline" href={`/ticker/${encodeURIComponent(t.ticker)}/`}>
                    {t.ticker}
                  </a>
                  <span className="ml-2 text-xs text-muted">{t.company_name}</span>
                </div>
                <span className={`tabular font-semibold ${signedClass(t.return_ytd)}`}>
                  {fmtPct(t.return_ytd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">Bottom 5 — menor retorno YTD</h2>
          <ul className="divide-y divide-border rounded-md border border-border">
            {bottom5.map((t) => (
              <li key={t.ticker} className="flex items-center justify-between p-3">
                <div>
                  <a className="font-mono text-sm hover:underline" href={`/ticker/${encodeURIComponent(t.ticker)}/`}>
                    {t.ticker}
                  </a>
                  <span className="ml-2 text-xs text-muted">{t.company_name}</span>
                </div>
                <span className={`tabular font-semibold ${signedClass(t.return_ytd)}`}>
                  {fmtPct(t.return_ytd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
