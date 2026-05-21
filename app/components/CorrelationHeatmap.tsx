import type { CorrelationPair } from "@/lib/data";
import { fmtNum } from "@/lib/format";

function _color(rho: number): string {
  if (rho >= 0.7) return "#16A34A";
  if (rho >= 0.4) return "#65A30D";
  if (rho >= 0.1) return "#D4D4D4";
  if (rho >= -0.1) return "#E5E5E5";
  if (rho >= -0.4) return "#F59E0B";
  return "#DC2626";
}

export function CorrelationHeatmap({
  pairs,
  title,
}: {
  pairs: CorrelationPair[];
  title: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {pairs.map((p, i) => (
          <li key={`${p.ticker_i}-${p.ticker_j}-${i}`} className="flex items-center justify-between gap-2 p-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono text-sm">{p.ticker_i}</span>
              <span className="text-muted">×</span>
              <span className="font-mono text-sm">{p.ticker_j}</span>
            </div>
            <span
              className="rounded px-2 py-1 text-xs font-semibold tabular text-white"
              style={{ backgroundColor: _color(p.correlation) }}
            >
              {fmtNum(p.correlation)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
