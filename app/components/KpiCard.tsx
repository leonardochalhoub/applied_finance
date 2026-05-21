import { fmtPct, signedClass } from "@/lib/format";

type Props = {
  label: string;
  value: number | null | undefined;
  format?: "pct" | "num";
  hint?: string;
};

export function KpiCard({ label, value, format = "pct", hint }: Props) {
  const formatted = format === "pct" ? fmtPct(value) : value == null ? "—" : value.toString();
  return (
    <div className="rounded-md border border-border bg-subtle p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular ${signedClass(value)}`}>
        {formatted}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
