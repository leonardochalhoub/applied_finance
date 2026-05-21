import { fmtPctSigned, signedClass } from "@/lib/format";

type Row = {
  ticker: string;
  company_name?: string;
  sector_b3?: string;
  value: number | null;
};

export function RankedBars({
  title,
  rows,
  variant = "gain",
}: {
  title: string;
  rows: Row[];
  variant?: "gain" | "loss";
}) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value ?? 0)));
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="eyebrow">{title}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted">YTD</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const v = r.value ?? 0;
          const pct = Math.min(100, (Math.abs(v) / max) * 100);
          return (
            <li
              key={r.ticker}
              className="grid items-center gap-4 px-5 py-3"
              style={{ gridTemplateColumns: "1fr 1fr 84px" }}
            >
              <div className="min-w-0">
                <a
                  className="mono text-sm font-semibold hover:underline"
                  href={`/ticker/${encodeURIComponent(r.ticker)}/`}
                >
                  {r.ticker.replace(/\.SA$/, "")}
                </a>
                {r.company_name ? (
                  <div className="truncate text-xs text-muted">{r.company_name}</div>
                ) : null}
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-[color:var(--bg-subtle)]">
                <div
                  aria-hidden
                  className={`absolute inset-y-0 left-0 rounded-full ${
                    variant === "gain"
                      ? "bg-[color:var(--gain)]"
                      : "bg-[color:var(--loss)]"
                  }`}
                  style={{ width: `${pct}%`, opacity: 0.85 }}
                />
              </div>
              <span
                className={`text-right tabular text-sm font-semibold ${signedClass(v)}`}
              >
                {fmtPctSigned(r.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
