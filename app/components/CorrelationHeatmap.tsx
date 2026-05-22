import type { CorrelationPair } from "@/lib/data";
import { fmtNum2 } from "@/lib/format";
import { withBase } from "@/lib/links";

function _color(rho: number): string {
  if (!Number.isFinite(rho)) return "var(--neutral-cell)";
  const intensity = Math.min(1, Math.abs(rho));
  if (rho >= 0) {
    return `color-mix(in srgb, var(--gain) ${Math.round(intensity * 80)}%, var(--bg-subtle))`;
  }
  return `color-mix(in srgb, var(--loss) ${Math.round(intensity * 80)}%, var(--bg-subtle))`;
}

export function CorrelationHeatmap({
  pairs,
  title,
}: {
  pairs: CorrelationPair[];
  title: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <span className="eyebrow">{title}</span>
      </div>
      <ul className="divide-y divide-border">
        {pairs.map((p, i) => (
          <li
            key={`${p.ticker_i}-${p.ticker_j}-${i}`}
            className="flex items-center justify-between gap-2 px-5 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <a
                className="mono text-sm hover:underline"
                href={withBase(`/ticker/${encodeURIComponent(p.ticker_i)}/`)}
              >
                {p.ticker_i.replace(/\.SA$/, "")}
              </a>
              <span className="text-muted">×</span>
              <a
                className="mono text-sm hover:underline"
                href={withBase(`/ticker/${encodeURIComponent(p.ticker_j)}/`)}
              >
                {p.ticker_j.replace(/\.SA$/, "")}
              </a>
            </div>
            <span
              className="rounded px-2 py-1 text-xs font-semibold tabular text-strong"
              style={{ background: _color(p.correlation) }}
            >
              {fmtNum2(p.correlation)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
