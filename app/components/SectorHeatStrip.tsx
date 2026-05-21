import type { SectorRow } from "@/lib/data";
import { cellColor, fmtPctSigned } from "@/lib/format";

export function SectorHeatStrip({ sectors }: { sectors: SectorRow[] }) {
  const sorted = [...sectors].sort((a, b) => b.return_ytd_mean - a.return_ytd_mean);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {sorted.map((s) => (
        <div
          key={s.sector_b3}
          className="card card-hover relative overflow-hidden px-4 py-3"
        >
          <div
            aria-hidden
            className="absolute inset-0 opacity-50"
            style={{ background: cellColor(s.return_ytd_mean) }}
          />
          <div className="relative">
            <div className="truncate text-xs font-medium text-strong" title={s.sector_b3}>
              {s.sector_b3}
            </div>
            <div className="mt-2 text-xl font-semibold tabular text-strong">
              {fmtPctSigned(s.return_ytd_mean)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
              <span>{s.member_count} tickers</span>
              <span>vol {(s.vol_annual_mean * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
