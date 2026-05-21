import { loadSectors } from "@/lib/data";
import { fmtPct, signedClass } from "@/lib/format";

export const dynamic = "force-static";

export default async function SectorsPage() {
  const data = await loadSectors().catch(() => null);
  if (!data) {
    return <p className="text-sm text-muted">Setores não disponíveis ainda.</p>;
  }
  const sorted = [...data.sectors].sort((a, b) => b.return_ytd_mean - a.return_ytd_mean);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Comparação setorial</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">Setor</th>
            <th className="py-2 text-right">Tickers</th>
            <th className="py-2 text-right">YTD médio</th>
            <th className="py-2 text-right">Vol. anual média</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.sector_b3} className="border-b border-border">
              <td className="py-2">{s.sector_b3}</td>
              <td className="py-2 text-right tabular">{s.member_count}</td>
              <td className={`py-2 text-right tabular font-semibold ${signedClass(s.return_ytd_mean)}`}>
                {fmtPct(s.return_ytd_mean)}
              </td>
              <td className="py-2 text-right tabular">{fmtPct(s.vol_annual_mean)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
