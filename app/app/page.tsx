import { MultiTickerChart } from "@/components/MultiTickerChart";
import { RankedBars } from "@/components/RankedBars";
import { SectorPanels } from "@/components/SectorPanels";
import { loadIbov, loadKpis, loadPrices, loadSectors } from "@/lib/data";
import { fmtDate, fmtPctSigned, signedClass } from "@/lib/format";

export const dynamic = "force-static";

export default async function HomePage() {
  const [kpis, sectors, ibov, prices] = await Promise.all([
    loadKpis(),
    loadSectors(),
    loadIbov(),
    loadPrices(),
  ]);

  if (!kpis || !sectors || !ibov) {
    return (
      <div className="card mx-auto max-w-2xl px-6 py-10 text-center">
        <h1 className="text-xl font-semibold">Aguardando primeiro refresh</h1>
        <p className="mt-2 text-sm text-muted">
          O lakehouse ainda não publicou os artefatos. Os dados aparecem aqui
          após o primeiro deploy do pipeline diário (~22:00 BRT em dias úteis).
        </p>
      </div>
    );
  }

  const validKpis = kpis.tickers.filter((t) => t.return_ytd != null);
  const sorted = [...validKpis].sort((a, b) => (b.return_ytd ?? 0) - (a.return_ytd ?? 0));
  const winners = sorted.slice(0, 8).map((t) => ({
    ticker: t.ticker,
    company_name: t.company_name,
    sector_b3: t.sector_b3,
    value: t.return_ytd,
  }));
  const losers = sorted.slice(-8).reverse().map((t) => ({
    ticker: t.ticker,
    company_name: t.company_name,
    sector_b3: t.sector_b3,
    value: t.return_ytd,
  }));

  const advancers = validKpis.filter((t) => (t.return_ytd ?? 0) > 0).length;
  const decliners = validKpis.filter((t) => (t.return_ytd ?? 0) < 0).length;
  const breadthRatio = decliners === 0 ? Infinity : advancers / decliners;

  const allTickers = prices ? Object.keys(prices.series).sort() : [];
  const candidates = ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBAS3.SA", "WEGE3.SA"];
  const initialCompare = candidates.filter((t) => allTickers.includes(t));

  // Editorial: top driver + worst drag for the IBOV YTD
  const sectorsBy = [...sectors.sectors].sort(
    (a, b) => b.return_ytd_mean - a.return_ytd_mean,
  );
  const topSector = sectorsBy[0];
  const bottomSector = sectorsBy[sectorsBy.length - 1];

  return (
    <div className="space-y-16">
      <section className="gradient-hero relative -mx-6 -mt-10 px-6 pb-10 pt-12">
        <div className="mx-auto max-w-7xl">
          <div className="eyebrow">IBOV · retorno YTD acumulado</div>
          <div className={`display-hero mt-3 ${signedClass(ibov.index_return_ytd ?? null)}`}>
            {fmtPctSigned(ibov.index_return_ytd ?? null)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="chip">snapshot {fmtDate(kpis.as_of)}</span>
            <span className="chip">{kpis.tickers.length} tickers</span>
            <span className="chip">{sectors.sectors.length} setores</span>
            <span className="chip">
              breadth {Number.isFinite(breadthRatio) ? breadthRatio.toFixed(2) : "∞"} (
              <span className="kpi-positive">{advancers}↑</span>
              <span className="mx-1 text-muted">/</span>
              <span className="kpi-negative">{decliners}↓</span>)
            </span>
            {typeof kpis.cdi_global_mean === "number" && kpis.cdi_global_mean > 0 ? (
              <span className="chip">
                CDI médio {fmtPctSigned(kpis.cdi_global_mean).replace("+", "")}
              </span>
            ) : null}
          </div>
          {topSector && bottomSector ? (
            <p className="mt-5 max-w-3xl text-sm leading-relaxed text-body">
              Puxado por{" "}
              <span className="font-semibold text-strong">{topSector.sector_b3}</span>{" "}
              <span className={signedClass(topSector.return_ytd_mean)}>
                ({fmtPctSigned(topSector.return_ytd_mean)})
              </span>
              , freado por{" "}
              <span className="font-semibold text-strong">{bottomSector.sector_b3}</span>{" "}
              <span className={signedClass(bottomSector.return_ytd_mean)}>
                ({fmtPctSigned(bottomSector.return_ytd_mean)})
              </span>
              . {advancers} de {kpis.tickers.length} tickers cobertos sobem no ano.
            </p>
          ) : null}
        </div>
      </section>

      {prices ? (
        <section>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Trajetória de preços
              </h2>
              <p className="text-xs text-muted">
                Selecione até 10 tickers · preços rebaseados a 100 no início da
                janela
              </p>
            </div>
            <a href="/comparar/" className="nav-link">ver em tela cheia →</a>
          </div>
          <MultiTickerChart
            data={prices}
            initialTickers={initialCompare}
            allTickers={allTickers}
          />
        </section>
      ) : null}

      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Setores</h2>
            <p className="text-xs text-muted">
              Retorno médio YTD por setor B3 · clique numa carta para abrir a tabela
            </p>
          </div>
          <a href="/setores/" className="nav-link">ver tabela →</a>
        </div>
        <SectorPanels sectors={sectors.sectors} prices={prices} />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">
          Líderes e retardatários
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <RankedBars title="Top 8 — maior retorno YTD" rows={winners} variant="gain" />
          <RankedBars title="Bottom 8 — menor retorno YTD" rows={losers} variant="loss" />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">
          IBOV — composição e contribuição YTD
        </h2>
        <IbovContribution members={ibov.members.slice(0, 12)} />
      </section>
    </div>
  );
}

function IbovContribution({
  members,
}: {
  members: { ticker: string; company_name?: string; weight: number; return_ytd: number | null; contribution_to_ytd: number | null }[];
}) {
  const max = Math.max(
    1e-9,
    ...members.map((m) => Math.abs(m.contribution_to_ytd ?? 0))
  );
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3 flex items-center justify-between">
        <span className="eyebrow">Top 12 por peso</span>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          contribuição p/ índice
        </span>
      </div>
      <ul className="divide-y divide-border">
        {members.map((m) => {
          const c = m.contribution_to_ytd ?? 0;
          const pct = (Math.abs(c) / max) * 100;
          const direction = c >= 0 ? "left" : "right";
          return (
            <li key={m.ticker} className="relative px-5 py-3">
              <div
                aria-hidden
                className={`absolute inset-y-0 ${
                  c >= 0
                    ? "left-1/2 bg-[color:var(--gain)]"
                    : "right-1/2 bg-[color:var(--loss)]"
                } opacity-[0.10]`}
                style={{ width: `${pct / 2}%`, [direction]: "50%" } as React.CSSProperties}
              />
              <div className="relative grid grid-cols-[120px_1fr_120px_100px] items-center gap-3">
                <a
                  className="mono text-sm font-semibold hover:underline"
                  href={`/ticker/${encodeURIComponent(m.ticker)}/`}
                >
                  {m.ticker.replace(/\.SA$/, "")}
                </a>
                <span className="truncate text-xs text-muted">{m.company_name}</span>
                <span className="text-right text-xs text-muted tabular">
                  peso {(m.weight * 100).toFixed(2)}%
                </span>
                <span className={`text-right text-sm font-semibold tabular ${signedClass(c)}`}>
                  {fmtPctSigned(c)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
