import { SectorPanels } from "@/components/SectorPanels";
import { loadPrices, loadSectors } from "@/lib/data";
import { fmtPctSigned, signedClass } from "@/lib/format";

export const dynamic = "force-static";

export default async function SectorsPage() {
  const [data, prices] = await Promise.all([loadSectors(), loadPrices()]);
  if (!data) {
    return <p className="text-sm text-muted">Setores não disponíveis ainda.</p>;
  }
  const sorted = [...data.sectors].sort((a, b) => b.return_ytd_mean - a.return_ytd_mean);
  const maxAbs = Math.max(...sorted.map((s) => Math.abs(s.return_ytd_mean)));

  return (
    <div className="space-y-10">
      <header>
        <div className="eyebrow">Comparação setorial</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Setores · retorno YTD</h1>
        <p className="mt-1 text-sm text-muted">
          Média simples do retorno log YTD dos componentes de cada setor.
        </p>
      </header>

      <section>
        <SectorPanels sectors={data.sectors} prices={prices} />
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <span className="eyebrow">Tabela detalhada</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="px-5 py-3">Setor</th>
              <th className="px-5 py-3 text-right">Tickers</th>
              <th className="px-5 py-3">YTD médio</th>
              <th className="px-5 py-3 text-right">YTD mediana</th>
              <th className="px-5 py-3 text-right">Vol. anual média</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((s) => {
              const pct = (Math.abs(s.return_ytd_mean) / maxAbs) * 100;
              const direction = s.return_ytd_mean >= 0 ? "left" : "right";
              return (
                <tr key={s.sector_b3}>
                  <td className="px-5 py-3 text-strong">{s.sector_b3}</td>
                  <td className="px-5 py-3 text-right tabular text-body">{s.member_count}</td>
                  <td className="px-5 py-3">
                    <div className="relative">
                      <div
                        aria-hidden
                        className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full opacity-60 ${
                          s.return_ytd_mean >= 0
                            ? "bg-[color:var(--gain)]"
                            : "bg-[color:var(--loss)]"
                        }`}
                        style={{
                          width: `${pct / 2}%`,
                          [direction]: "50%",
                        } as React.CSSProperties}
                      />
                      <span
                        className={`relative inline-block w-24 text-right tabular font-semibold ${signedClass(
                          s.return_ytd_mean,
                        )}`}
                      >
                        {fmtPctSigned(s.return_ytd_mean)}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right tabular text-body">
                    {fmtPctSigned(s.return_ytd_median)}
                  </td>
                  <td className="px-5 py-3 text-right tabular text-body">
                    {fmtPctSigned(s.vol_annual_mean)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
