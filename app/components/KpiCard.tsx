import { fmtPctSigned, fmtNum2, signedClass } from "@/lib/format";

type Props = {
  label: string;
  value: number | null | undefined;
  format?: "pct" | "num";
  hint?: string;
  big?: boolean;
};

export function KpiCard({ label, value, format = "pct", hint, big = false }: Props) {
  const formatted =
    value == null || !Number.isFinite(value as number)
      ? "—"
      : format === "pct"
      ? fmtPctSigned(value)
      : fmtNum2(value);
  return (
    <div className="card card-hover px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className={`mt-2 ${big ? "display-stat" : "text-2xl"} ${signedClass(value)}`}>
        {formatted}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
