const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

const PCT = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PCT_SIGNED = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

const NUM2 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const INT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const NUMTICK = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const PCT_TICK = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const fmtAxisNum = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? NUMTICK.format(v) : String(v);

export const fmtAxisBRL = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? `R$ ${NUMTICK.format(v)}` : String(v);

export const fmtAxisPct = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? PCT_TICK.format(v) : String(v);

export const fmtInt = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "—" : INT.format(v);

const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });

export function fmtBRL(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return BRL.format(v);
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return PCT.format(v);
}

export function fmtPctSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return PCT_SIGNED.format(v);
}

/** Annualized return / vol / rate. Convention used everywhere in this app:
 *  μ is multiplied by ×252 and σ by ×√252 before display, so any percentage
 *  produced from those is per-year. Suffix "a.a." (ao ano) makes it explicit. */
export function fmtPctAA(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${PCT_SIGNED.format(v)} a.a.`;
}

/** Monthly rate — "a.m." (ao mês). Not currently used in any panel but
 *  exported for symmetry so any future monthly metric carries the right
 *  unit. */
export function fmtPctAM(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${PCT_SIGNED.format(v)} a.m.`;
}

/** Daily rate — "a.d." (ao dia). Same rationale as fmtPctAM. */
export function fmtPctAD(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${PCT_SIGNED.format(v)} a.d.`;
}

export function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return NUM.format(v);
}

export function fmtNum2(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return NUM2.format(v);
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return DATE.format(d);
}

export function signedClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-muted";
  return v >= 0 ? "kpi-positive" : "kpi-negative";
}

export function returnIntensity(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  // Saturate at ±15% (a strong YTD move on the B3). Square-root the magnitude
  // so even small returns are visible.
  const ratio = Math.min(1, Math.abs(v) / 0.15);
  return Math.sqrt(ratio);
}

export function cellColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "var(--neutral-cell)";
  const intensity = returnIntensity(v);
  const pct = Math.round(intensity * 100);
  if (v >= 0) {
    return `color-mix(in srgb, var(--gain) ${pct}%, var(--bg-subtle))`;
  }
  return `color-mix(in srgb, var(--loss) ${pct}%, var(--bg-subtle))`;
}
