import type { CorrelationPair } from "@/lib/data";
import { fmtNum2 } from "@/lib/format";

function _corrColor(rho: number): string {
  if (!Number.isFinite(rho)) return "var(--neutral-cell)";
  const intensity = Math.min(1, Math.abs(rho));
  if (rho >= 0) {
    return `color-mix(in srgb, var(--gain) ${Math.round(intensity * 80)}%, var(--bg-subtle))`;
  }
  return `color-mix(in srgb, var(--loss) ${Math.round(intensity * 80)}%, var(--bg-subtle))`;
}

/**
 * Order tickers by greedy nearest-neighbor traversal on the distance matrix
 * (d = 1 - |rho|). Produces a sequence where adjacent tickers are highly
 * correlated — the visible diagonal-band shows sector clusters.
 */
function _seriate(tickers: string[], pairMap: Map<string, number>): string[] {
  if (tickers.length <= 1) return tickers;

  function dist(a: string, b: string): number {
    if (a === b) return 0;
    const r = pairMap.get(`${a}|${b}`);
    if (r == null || !Number.isFinite(r)) return 1;
    return 1 - Math.abs(r);
  }

  const remaining = new Set(tickers);
  // Seed: pick the ticker with smallest sum-of-distances (densest hub)
  let seed = tickers[0];
  let seedScore = Infinity;
  for (const t of tickers) {
    let s = 0;
    for (const u of tickers) if (u !== t) s += dist(t, u);
    if (s < seedScore) { seedScore = s; seed = t; }
  }
  const ordered: string[] = [seed];
  remaining.delete(seed);
  let current = seed;
  while (remaining.size > 0) {
    let best: string | null = null;
    let bestD = Infinity;
    for (const candidate of remaining) {
      const d = dist(current, candidate);
      if (d < bestD) { bestD = d; best = candidate; }
    }
    if (!best) break;
    ordered.push(best);
    remaining.delete(best);
    current = best;
  }
  return ordered;
}

export function CorrelationGrid({ pairs, size = 24 }: { pairs: CorrelationPair[]; size?: number }) {
  // Extract the most-connected tickers
  const counts = new Map<string, number>();
  for (const p of pairs) {
    counts.set(p.ticker_i, (counts.get(p.ticker_i) ?? 0) + 1);
    counts.set(p.ticker_j, (counts.get(p.ticker_j) ?? 0) + 1);
  }
  const candidates = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, size)
    .map(([t]) => t);

  const pairMap = new Map<string, number>();
  for (const p of pairs) {
    pairMap.set(`${p.ticker_i}|${p.ticker_j}`, p.correlation);
    pairMap.set(`${p.ticker_j}|${p.ticker_i}`, p.correlation);
  }

  // Order by seriation so the diagonal-adjacent band shows clusters
  const tickers = _seriate(candidates, pairMap);

  function rho(a: string, b: string): number {
    if (a === b) return 1;
    return pairMap.get(`${a}|${b}`) ?? Number.NaN;
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0 text-[10px] mono">
        <thead>
          <tr>
            <th />
            {tickers.map((t) => (
              <th
                key={t}
                className="h-16 w-7 align-bottom text-muted"
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  padding: "0 2px",
                }}
              >
                {t.replace(/\.SA$/, "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickers.map((row) => (
            <tr key={row}>
              <td className="pr-2 text-right text-muted">{row.replace(/\.SA$/, "")}</td>
              {tickers.map((col) => {
                const v = rho(row, col);
                const isFinite = Number.isFinite(v);
                return (
                  <td
                    key={col}
                    title={`${row} × ${col}: ${isFinite ? fmtNum2(v) : "—"}`}
                    className="h-7 w-7 border border-[color:var(--bg-base)]"
                    style={{
                      background: _corrColor(v),
                      outline: row === col ? "1px solid var(--border-strong)" : undefined,
                      outlineOffset: row === col ? "-1px" : undefined,
                    }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center justify-between gap-4 text-[10px] text-muted">
        <span>
          Tickers ordenados por seriação greedy (vizinho mais próximo na distância 1−|ρ|).
        </span>
        <div className="flex items-center gap-2">
          <span>−1</span>
          <div
            className="h-2 w-32 rounded-full"
            style={{
              background:
                "linear-gradient(to right, var(--loss), var(--bg-subtle), var(--gain))",
            }}
          />
          <span>+1</span>
        </div>
      </div>
    </div>
  );
}
