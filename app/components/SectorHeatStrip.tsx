import { fmtPct, signedClass } from "@/lib/format";
import type { SectorRow } from "@/lib/data";

export function SectorHeatStrip({ sectors }: { sectors: SectorRow[] }) {
  const sorted = [...sectors].sort((a, b) => b.return_ytd_mean - a.return_ytd_mean);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {sorted.map((s) => (
        <div key={s.sector_b3} className="rounded-md border border-border p-3">
          <div className="text-xs text-muted truncate" title={s.sector_b3}>
            {s.sector_b3}
          </div>
          <div className={`text-lg font-semibold tabular ${signedClass(s.return_ytd_mean)}`}>
            {fmtPct(s.return_ytd_mean)}
          </div>
          <div className="text-xs text-muted">{s.member_count} tickers</div>
        </div>
      ))}
    </div>
  );
}
