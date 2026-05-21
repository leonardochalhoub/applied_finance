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

const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });

export function fmtBRL(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return BRL.format(v);
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return PCT.format(v);
}

export function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return NUM.format(v);
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
