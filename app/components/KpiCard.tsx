import { fmtPctAA, fmtPctSigned, fmtNum2, signedClass } from "@/lib/format";

type Props = {
  label: string;
  value: number | null | undefined;
  /** "pct" → no time-unit suffix (use for YTD, drawdowns).
   *  "pct-aa" → appends " a.a." (use for annualized rates).
   *  "num" → plain number with 2 decimals (use for Sharpe). */
  format?: "pct" | "pct-aa" | "num";
  hint?: string;
  big?: boolean;
};

export function KpiCard({ label, value, format = "pct", hint, big = false }: Props) {
  const formatted =
    value == null || !Number.isFinite(value as number)
      ? "—"
      : format === "pct"
      ? fmtPctSigned(value)
      : format === "pct-aa"
      ? fmtPctAA(value)
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
