"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  FinopsArtifact,
  FinopsJobRow,
  FinopsOutcomeRow,
  FinopsProductRow,
  FinopsRunRow,
} from "@/lib/data";
import { fmtBRL, fmtInt, fmtNum2 } from "@/lib/format";

// ── Formatters ──────────────────────────────────────────────────────────────
const USD = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const USD_COMPACT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
function fmtUSD(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v > 0 && v < 0.01) return "< US$ 0,01";
  return USD.format(v);
}
function fmtUSDCompact(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  return USD_COMPACT.format(v);
}
function fmtDec1(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(1).replace(".", ",");
}

const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];
function fmtDayShort(iso: string): string {
  if (!iso) return "";
  const parts = iso.split("-").map(Number);
  const m = parts[1];
  const d = parts[2];
  return `${String(d).padStart(2, "0")}/${MONTHS_PT[m - 1]}`;
}
function fmtDayFull(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${MONTHS_PT[m - 1]}/${y}`;
}
function truncate(s: string | null | undefined, n = 60): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ── Color helpers (resolve CSS vars to keep recharts simple) ────────────────
// Recharts can't compute color-mix on strings, so resolve once per render.
function useThemeColors(): {
  accent: string;
  gain: string;
  loss: string;
  amber: string;
  teal: string;
  pink: string;
  slate: string;
} {
  const [colors, setColors] = useState({
    accent: "#2563eb",
    gain:   "#16a34a",
    loss:   "#dc2626",
    amber:  "#d97706",
    teal:   "#0d9488",
    pink:   "#db2777",
    slate:  "#64748b",
  });
  useEffect(() => {
    function refresh() {
      const root = getComputedStyle(document.documentElement);
      const isDark = document.documentElement.classList.contains("dark");
      setColors({
        accent: root.getPropertyValue("--accent").trim() || (isDark ? "#60a5fa" : "#2563eb"),
        gain:   root.getPropertyValue("--gain").trim()   || (isDark ? "#34d399" : "#16a34a"),
        loss:   root.getPropertyValue("--loss").trim()   || (isDark ? "#f87171" : "#dc2626"),
        amber:  isDark ? "#fbbf24" : "#d97706",
        teal:   isDark ? "#2dd4bf" : "#0d9488",
        pink:   isDark ? "#f472b6" : "#db2777",
        slate:  isDark ? "#94a3b8" : "#64748b",
      });
    }
    refresh();
    const obs = new MutationObserver(refresh);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

function outcomeColor(state: string, c: ReturnType<typeof useThemeColors>): string {
  switch (state) {
    case "SUCCEEDED": return c.gain;
    case "ERROR":     return c.loss;
    case "CANCELLED": return c.amber;
    default:          return c.slate;
  }
}
function productColor(product: string, c: ReturnType<typeof useThemeColors>): string {
  const map: Record<string, string> = {
    JOBS:                     c.accent,
    SQL:                      c.gain,
    INTERACTIVE:              c.teal,
    DLT:                      c.pink,
    NETWORKING:               c.amber,
    DEFAULT_STORAGE:          c.slate,
    PREDICTIVE_OPTIMIZATION:  c.pink,
  };
  return map[product] ?? c.slate;
}

const PRODUCT_LABEL: Record<string, string> = {
  JOBS: "Jobs",
  SQL: "SQL warehouses",
  INTERACTIVE: "Clusters interativos",
  DLT: "DLT pipelines",
  NETWORKING: "Networking serverless",
  DEFAULT_STORAGE: "Storage gerenciado",
  PREDICTIVE_OPTIMIZATION: "Optimization auto.",
};
const OUTCOME_LABEL: Record<string, string> = {
  SUCCEEDED: "Bem-sucedidas",
  ERROR:     "Falharam",
  CANCELLED: "Canceladas",
  UNKNOWN:   "Sem outcome",
};

// ── BCB USD→BRL FX (cached in module scope, refetched on mount) ─────────────
const BCB_SGS_USD = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/1?formato=json";
const FX_FALLBACK = { rate: 5.85, date: null as string | null, source: "fallback" as const };
type Fx = { rate: number; date: string | null; source: "bcb" | "fallback" };

function useUsdBrlRate(): Fx | null {
  const [fx, setFx] = useState<Fx | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(BCB_SGS_USD, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows: Array<{ data: string; valor: string }>) => {
        if (cancelled) return;
        const last = rows?.[rows.length - 1];
        const rate = last ? Number(String(last.valor).replace(",", ".")) : NaN;
        if (Number.isFinite(rate) && rate > 0) {
          setFx({ rate, date: last.data, source: "bcb" });
        } else {
          setFx(FX_FALLBACK);
        }
      })
      .catch(() => { if (!cancelled) setFx(FX_FALLBACK); });
    return () => { cancelled = true; };
  }, []);
  return fx;
}

function fmtBcbDate(brDate: string | null | undefined): string | null {
  if (!brDate) return null;
  const [d, m, y] = brDate.split("/").map(Number);
  if (!d || !m || !y) return brDate;
  return `${String(d).padStart(2, "0")}/${MONTHS_PT[m - 1]}/${y}`;
}

// ── Main view ───────────────────────────────────────────────────────────────
export function FinOpsView({ data }: { data: FinopsArtifact }) {
  const c = useThemeColors();
  const fx = useUsdBrlRate();
  const k = data.kpis;

  return (
    <div className="space-y-10">
      {/* Hero / methodology */}
      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <div className="eyebrow">FinOps · governança de custo · 100% do histórico</div>
        </div>
        <div className="space-y-4 px-5 py-4 text-sm">
          <p className="text-body">
            Cada DBU consumida e cada centavo desde o primeiro dia da plataforma —{" "}
            <strong>{fmtDayFull(data.window.first_day)}</strong> a{" "}
            <strong>{fmtDayFull(data.window.last_day)}</strong> ({fmtInt(data.window.n_days)}{" "}
            dias). Bronze:{" "}
            <code className="rounded bg-[color:var(--bg-subtle)] px-1.5 py-0.5 text-[11px]">
              system.billing.usage
            </code>{" "}
            +{" "}
            <code className="rounded bg-[color:var(--bg-subtle)] px-1.5 py-0.5 text-[11px]">
              system.lakeflow.job_run_timeline
            </code>{" "}
            (managed pelo Databricks). Filtro:{" "}
            <code className="rounded bg-[color:var(--bg-subtle)] px-1.5 py-0.5 text-[11px]">
              custom_tags.team = &apos;{data.team_tag}&apos;
            </code>
            . Custo USD = Σ DBU × <code className="text-[11px]">list_price</code> (versionado no tempo).
          </p>

          {/* Currency banner */}
          <div className="flex flex-col gap-2 rounded-md border border-border bg-[color:var(--bg-subtle)] px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-xs text-body">
              <span className="chip">USD</span>
              <span className="text-muted">→</span>
              <span className="chip">BRL</span>
              <span>
                Faturado em <strong>dólar estadunidense</strong>; conversão usa BCB SGS série 1 (PTAX compra).
              </span>
            </div>
            <div className="text-right text-xs">
              {fx ? (
                <>
                  <div className="font-semibold text-strong">
                    US$ 1 = R$ {fx.rate.toFixed(4).replace(".", ",")}
                  </div>
                  <div className="text-[10px] text-muted">
                    {fx.source === "bcb" && fx.date
                      ? `Cotação de ${fmtBcbDate(fx.date)}`
                      : "Cotação de referência (offline)"}
                  </div>
                </>
              ) : (
                <span className="text-muted">Carregando câmbio…</span>
              )}
            </div>
          </div>
        </div>

        {/* Headline KPIs */}
        <div className="grid grid-cols-1 gap-3 border-t border-border px-5 py-4 md:grid-cols-2">
          <HeroCard
            label="Custo total · lifetime"
            unit="USD"
            value={fmtUSD(k.total_cost_usd_lifetime)}
            brl={fx ? fmtBRL(k.total_cost_usd_lifetime * fx.rate) : null}
            sub={
              `${fmtInt(data.window.n_days)} dias contínuos · ` +
              `${fmtNum2(k.total_dbus_lifetime)} DBUs consumidas · ` +
              `${fmtInt(k.n_runs_lifetime)} job runs registradas`
            }
          />
          <HeroCard
            tone="warn"
            label="Spend desperdiçado · ERROR + CANCELLED"
            unit="%"
            value={`${fmtDec1(k.wasted_pct_lifetime)}%`}
            brl={fx ? fmtBRL(k.wasted_cost_usd_lifetime * fx.rate) : null}
            sub={
              `${fmtUSD(k.wasted_cost_usd_lifetime)} em runs que não entregaram resultado. ` +
              `DBUs consumidas até o crash ou cancelamento.`
            }
          />
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 border-t border-border px-5 py-4 md:grid-cols-4">
          <Stat
            label="Últimos 30 dias"
            value={fmtUSD(k.total_cost_usd_30d)}
            sub={`Últimos 7 dias: ${fmtUSD(k.total_cost_usd_7d)}`}
          />
          <Stat
            label="Custo médio por run"
            value={fmtUSD(k.avg_cost_per_run_usd)}
            sub={`p95: ${fmtUSD(k.p95_cost_per_run_usd)}`}
          />
          <Stat
            label="Chargeable"
            value={`${fmtDec1(k.chargeable_share_pct)}%`}
            sub="Código que rodou (jobs, SQL, DLT)"
          />
          <Stat
            label="Overhead de plataforma"
            value={`${fmtDec1(k.overhead_share_pct)}%`}
            sub="Networking + storage + auto-optim."
          />
        </div>
      </section>

      {/* Editorial callout */}
      <section className="card overflow-hidden">
        <div className="grid grid-cols-[4px_1fr] gap-4 px-5 py-4">
          <div className="rounded-full" style={{ background: c.accent }} />
          <div className="space-y-2 text-sm">
            <div className="eyebrow">Por que FinOps importa</div>
            <p className="text-body">
              Plataformas serverless cobram por uso, não por hora reservada. Cada query,
              cada falha, cada cluster esquecido aceso vira USD na fatura. Aqui,{" "}
              <strong>{fmtDec1(k.wasted_pct_lifetime)}% do custo de jobs</strong> foi
              queimado em runs que falharam ou foram canceladas — DBUs consumidas até o
              crash, sem entregar resultado. Esse é o tipo de custo que o ciclo FinOps
              clássico — <em>visibility → allocation → optimization</em> — ataca primeiro.
            </p>
            {k.most_expensive_run && (
              <p className="text-body">
                Run mais cara do histórico:{" "}
                <strong>{fmtUSD(k.most_expensive_run.cost_usd)}</strong> em{" "}
                <strong>{fmtDec1(k.most_expensive_run.billed_minutes)} min</strong> —{" "}
                <span
                  className="font-semibold"
                  style={{ color: outcomeColor(k.most_expensive_run.result_state, c) }}
                >
                  {OUTCOME_LABEL[k.most_expensive_run.result_state] ??
                    k.most_expensive_run.result_state}
                </span>{" "}
                em {fmtDayFull(k.most_expensive_run.day)} ·{" "}
                <code className="text-[11px] text-muted">
                  {truncate(k.most_expensive_run.job_name, 80)}
                </code>
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Cumulative spend */}
      <Panel
        label="Custo acumulado desde o primeiro dia"
        sub={`USD acumulado dia-a-dia · janela completa de ${fmtInt(data.window.n_days)} dias`}
      >
        <CumulativeSpendChart daily={data.daily} accent={c.accent} />
      </Panel>

      {/* Daily area */}
      <Panel
        label="Spend diário ao longo do tempo"
        sub="USD/dia · chargeable (código do usuário) vs overhead (plataforma)"
      >
        <DailySpendArea daily={data.daily} c={c} />
      </Panel>

      {/* Storage */}
      {data.storage && data.storage.total_usd_lifetime > 0 && (
        <Panel
          label="Storage acumulado · custo por dia/mês/ano"
          sub="DEFAULT_STORAGE cobra continuamente — custo cresce mesmo sem rodar nada"
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Total gasto em storage"
              value={fmtUSD(data.storage.total_usd_lifetime)}
              sub={`${fmtDec1(data.storage.share_of_total_pct)}% do custo total · ${fmtInt(data.storage.days_with_storage)} dias com cobrança`}
            />
            <Stat
              label="Custo por dia (atual)"
              value={fmtUSD(data.storage.per_day_current)}
              sub={`Média lifetime: ${fmtUSD(data.storage.per_day_avg_lifetime)}/dia`}
            />
            <Stat
              label="Run rate mensal"
              value={fmtUSD(data.storage.per_month_run_rate)}
              sub="Projeção: 30 dias × custo atual"
            />
            <Stat
              label="Run rate anual"
              value={fmtUSD(data.storage.per_year_run_rate)}
              sub="Projeção: 365 dias × custo atual"
            />
          </div>
        </Panel>
      )}

      {/* Storage attribution by bytes */}
      {data.attribution && data.attribution.workspace_bytes > 0 && (
        <Panel
          label="Atribuição do storage · rateio por bytes"
          sub={
            `DEFAULT_STORAGE é cobrado no workspace (compartilhado), sem tags de job. ` +
            `Atribuímos ao ${data.catalog} a fração ` +
            `${fmtDec1(data.attribution.storage_share_pct)}% — proporcional ao tamanho ` +
            `físico do catálogo (tabelas Delta + Volumes).`
          }
        >
          <AttributionTable attribution={data.attribution} />
        </Panel>
      )}

      {/* Two-col: by product + by outcome */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          label="Pra onde o dinheiro foi"
          sub={`${data.by_product.length} produtos · chargeable ${fmtDec1(k.chargeable_share_pct)}% · overhead ${fmtDec1(k.overhead_share_pct)}%`}
        >
          <ProductDonut byProduct={data.by_product} c={c} />
          <ProductLegend byProduct={data.by_product} c={c} />
        </Panel>

        <Panel
          label="Quanto custou cada desfecho"
          sub="Falhar custa quase o mesmo que ter sucesso — DBUs queimam até o crash"
        >
          <OutcomeBars byOutcome={data.by_outcome} c={c} />
          <OutcomeLegend byOutcome={data.by_outcome} c={c} />
        </Panel>
      </div>

      {/* Top jobs */}
      <Panel
        label="Jobs mais caros"
        sub={`Top ${data.by_job.length} por custo lifetime — agrupa runs do mesmo job (dev/prod) com split de outcome`}
      >
        <TopJobsTable byJob={data.by_job} c={c} />
      </Panel>

      {/* Top runs */}
      <Panel
        label={`As ${data.top_runs.length} execuções individuais mais caras`}
        sub="Útil pra investigar spikes, clusters mal-dimensionados, ou jobs que ficaram presos"
      >
        <TopRunsTable topRuns={data.top_runs} c={c} />
      </Panel>

      <footer className="text-[11px] text-muted">
        Gerado em {data.generated_at_utc} · catalog{" "}
        <code className="text-[11px]">{data.catalog}</code> · pipeline{" "}
        <code className="text-[11px]">mercado_br daily refresh → export_finops_summary</code>
      </footer>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────
function HeroCard({
  label,
  unit,
  value,
  brl,
  sub,
  tone = "primary",
}: {
  label: string;
  unit: string;
  value: string;
  brl: string | null;
  sub: string;
  tone?: "primary" | "warn";
}) {
  return (
    <div
      className="rounded-md border px-4 py-4"
      style={{
        borderColor: "var(--border)",
        background:
          tone === "warn"
            ? "color-mix(in srgb, var(--loss) 6%, var(--bg-elevated))"
            : "color-mix(in srgb, var(--accent) 6%, var(--bg-elevated))",
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">{label}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted">{unit}</div>
      </div>
      <div className="mt-2 display-stat text-strong">{value}</div>
      {brl ? (
        <div className="mt-1 text-xs text-body">
          ≈ <strong>{brl}</strong>
        </div>
      ) : null}
      <div className="mt-2 text-xs text-muted">{sub}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-base font-semibold tabular text-strong">{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] text-muted">{sub}</div> : null}
    </div>
  );
}

function Panel({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <div className="eyebrow">{label}</div>
        {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

// ── Charts ──────────────────────────────────────────────────────────────────
function tooltipStyle() {
  return {
    contentStyle: {
      background: "var(--bg-elevated)",
      border: "1px solid var(--border-strong)",
      borderRadius: 8,
      fontSize: 11,
      color: "var(--strong)",
    },
    labelStyle: { color: "var(--muted)", fontWeight: 600 },
    itemStyle: { color: "var(--strong)" },
  };
}

function CumulativeSpendChart({
  daily,
  accent,
}: {
  daily: FinopsArtifact["daily"];
  accent: string;
}) {
  const series = useMemo(() => {
    const idx = daily.findIndex((d) => (d.cost_total_cumulative ?? 0) > 0.001);
    return idx >= 0 ? daily.slice(idx) : daily;
  }, [daily]);
  const ts = tooltipStyle();

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <AreaChart data={series} margin={{ top: 16, right: 16, bottom: 8, left: 4 }}>
          <defs>
            <linearGradient id="finops-cum" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={accent} stopOpacity={0.45} />
              <stop offset="95%" stopColor={accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="usage_date"
            tickFormatter={fmtDayShort}
            stroke="var(--border)"
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={36}
          />
          <YAxis
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={fmtUSDCompact}
          />
          <Tooltip
            labelFormatter={(v) => fmtDayFull(String(v))}
            formatter={(value: unknown) => [fmtUSD(Number(value)), "Acumulado"]}
            {...ts}
          />
          <Area
            type="monotone"
            dataKey="cost_total_cumulative"
            stroke={accent}
            strokeWidth={2.5}
            fill="url(#finops-cum)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DailySpendArea({
  daily,
  c,
}: {
  daily: FinopsArtifact["daily"];
  c: ReturnType<typeof useThemeColors>;
}) {
  const trimmed = useMemo(() => {
    const idx = daily.findIndex((d) => (d.cost_total ?? 0) > 0.001);
    return idx >= 0 ? daily.slice(idx) : daily;
  }, [daily]);
  const ts = tooltipStyle();

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <AreaChart data={trimmed} margin={{ top: 12, right: 16, bottom: 8, left: 4 }}>
          <defs>
            <linearGradient id="finops-charge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={c.accent} stopOpacity={0.7} />
              <stop offset="95%" stopColor={c.accent} stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="finops-overhead" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={c.amber} stopOpacity={0.65} />
              <stop offset="95%" stopColor={c.amber} stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="usage_date"
            tickFormatter={fmtDayShort}
            stroke="var(--border)"
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={36}
          />
          <YAxis
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={fmtUSDCompact}
          />
          <Tooltip
            labelFormatter={(v) => fmtDayFull(String(v))}
            formatter={(value: unknown, name: unknown) => {
              const labels: Record<string, string> = {
                cost_chargeable_total: "Chargeable",
                cost_overhead_total:   "Overhead",
              };
              return [fmtUSD(Number(value)), labels[String(name)] ?? String(name)];
            }}
            {...ts}
          />
          <Legend
            verticalAlign="top"
            height={28}
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: "var(--body)" }}
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                cost_chargeable_total: "Chargeable",
                cost_overhead_total:   "Overhead",
              };
              return <span style={{ color: "var(--body)" }}>{labels[value] ?? value}</span>;
            }}
          />
          <Area
            type="monotone"
            dataKey="cost_chargeable_total"
            stackId="1"
            stroke={c.accent}
            strokeWidth={1.5}
            fill="url(#finops-charge)"
          />
          <Area
            type="monotone"
            dataKey="cost_overhead_total"
            stackId="1"
            stroke={c.amber}
            strokeWidth={1.5}
            fill="url(#finops-overhead)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProductDonut({
  byProduct,
  c,
}: {
  byProduct: FinopsProductRow[];
  c: ReturnType<typeof useThemeColors>;
}) {
  const data = byProduct.map((r) => ({
    name: PRODUCT_LABEL[r.product] ?? r.product,
    value: r.cost_usd,
    raw: r,
  }));
  const ts = tooltipStyle();

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.name} fill={productColor(d.raw.product, c)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: unknown, name: unknown, ctx: unknown) => {
              const payload = (ctx as { payload?: { raw: FinopsProductRow } })?.payload;
              const share = payload?.raw.share_pct ?? 0;
              return [`${fmtUSD(Number(value))} (${fmtDec1(share)}%)`, String(name)];
            }}
            {...ts}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProductLegend({
  byProduct,
  c,
}: {
  byProduct: FinopsProductRow[];
  c: ReturnType<typeof useThemeColors>;
}) {
  return (
    <ul className="mt-3 space-y-1.5">
      {byProduct.map((r) => (
        <li
          key={r.product}
          className="flex items-center justify-between gap-3 text-xs"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm"
              style={{ background: productColor(r.product, c) }}
            />
            <span className="truncate text-body">{PRODUCT_LABEL[r.product] ?? r.product}</span>
            {r.workload_class === "overhead" ? (
              <span className="chip text-[9px]">overhead</span>
            ) : null}
          </span>
          <span className="flex-shrink-0 tabular text-strong">
            {fmtUSD(r.cost_usd)}{" "}
            <span className="text-[10px] text-muted">{fmtDec1(r.share_pct)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function OutcomeBars({
  byOutcome,
  c,
}: {
  byOutcome: FinopsOutcomeRow[];
  c: ReturnType<typeof useThemeColors>;
}) {
  const data = byOutcome.map((r) => ({
    state: OUTCOME_LABEL[r.result_state] ?? r.result_state,
    raw_state: r.result_state,
    cost: r.cost_usd,
    n: r.n_runs,
    avg: r.avg_per_run,
    minutes: r.avg_minutes,
    share: r.share_pct,
  }));
  const ts = tooltipStyle();

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 4 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="state"
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickLine={false}
          />
          <YAxis
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={fmtUSDCompact}
          />
          <Tooltip
            formatter={(value: unknown, name: unknown, ctx: unknown) => {
              if (name === "cost") {
                const payload = (ctx as { payload?: typeof data[number] })?.payload;
                if (!payload) return [fmtUSD(Number(value)), "Custo"];
                return [
                  `${fmtUSD(Number(value))} · ${fmtInt(payload.n)} runs · ${fmtUSD(payload.avg)} médio · ${fmtDec1(payload.minutes)} min`,
                  "Custo",
                ];
              }
              return [String(value), String(name)];
            }}
            {...ts}
          />
          <Bar dataKey="cost" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.state} fill={outcomeColor(d.raw_state, c)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function OutcomeLegend({
  byOutcome,
  c,
}: {
  byOutcome: FinopsOutcomeRow[];
  c: ReturnType<typeof useThemeColors>;
}) {
  return (
    <ul className="mt-3 space-y-1.5">
      {byOutcome.map((r) => (
        <li
          key={r.result_state}
          className="flex items-center justify-between gap-3 text-xs"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm"
              style={{ background: outcomeColor(r.result_state, c) }}
            />
            <span className="truncate text-body">
              {OUTCOME_LABEL[r.result_state] ?? r.result_state}
            </span>
            <span className="chip text-[9px]">{fmtInt(r.n_runs)} runs</span>
          </span>
          <span className="flex-shrink-0 tabular text-strong">
            {fmtUSD(r.cost_usd)}{" "}
            <span className="text-[10px] text-muted">{fmtDec1(r.share_pct)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function TopJobsTable({
  byJob,
  c,
}: {
  byJob: FinopsJobRow[];
  c: ReturnType<typeof useThemeColors>;
}) {
  if (!byJob.length) {
    return <p className="text-xs text-muted">Sem runs registradas ainda.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-border bg-[color:var(--bg-subtle)] text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Job</th>
            <th className="px-3 py-2 text-right font-medium">Runs</th>
            <th className="px-3 py-2 text-right font-medium">OK · ERR · CAN</th>
            <th className="px-3 py-2 text-right font-medium">Custo total</th>
            <th className="px-3 py-2 text-right font-medium">Médio</th>
            <th className="px-3 py-2 text-right font-medium">Desperdiçado</th>
            <th className="px-3 py-2 text-right font-medium">Min/run</th>
          </tr>
        </thead>
        <tbody>
          {byJob.map((j) => {
            const wastedRatio = j.cost_usd > 0 ? j.wasted_cost / j.cost_usd : 0;
            return (
              <tr key={j.job_name} className="border-b border-border/60">
                <td className="px-3 py-2 text-strong" title={j.job_name}>
                  {truncate(j.job_name, 60)}
                </td>
                <td className="px-3 py-2 text-right tabular">{fmtInt(j.n_runs)}</td>
                <td className="px-3 py-2 text-right tabular">
                  <span style={{ color: c.gain }}>{j.succeeded}</span>
                  {" · "}
                  <span style={{ color: c.loss }}>{j.failed}</span>
                  {" · "}
                  <span style={{ color: c.amber }}>{j.cancelled}</span>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular text-strong">
                  {fmtUSD(j.cost_usd)}
                </td>
                <td className="px-3 py-2 text-right tabular">{fmtUSD(j.avg_per_run)}</td>
                <td
                  className="px-3 py-2 text-right tabular"
                  style={{ color: wastedRatio > 0.3 ? c.loss : undefined }}
                >
                  {fmtUSD(j.wasted_cost)}
                  {wastedRatio > 0.05 ? (
                    <span className="ml-1 text-[10px] text-muted">
                      ({fmtDec1(wastedRatio * 100)}%)
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular text-muted">
                  {fmtDec1(j.avg_minutes)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtBytes(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

function AttributionTable({
  attribution,
}: {
  attribution: FinopsArtifact["attribution"];
}) {
  if (!attribution) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat
          label="Tamanho do catálogo alvo"
          value={fmtBytes(attribution.target_bytes)}
          sub={attribution.target_catalog}
        />
        <Stat
          label="Total do workspace"
          value={fmtBytes(attribution.workspace_bytes)}
          sub={`${attribution.catalogs.length} catálogos · soma de tabelas + Volumes`}
        />
        <Stat
          label="Razão de atribuição"
          value={`${fmtDec1(attribution.storage_share_pct)}%`}
          sub="Aplicada a DEFAULT_STORAGE / NETWORKING"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-[color:var(--bg-subtle)] text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Catálogo</th>
              <th className="px-3 py-2 text-right font-medium">Tabelas Delta</th>
              <th className="px-3 py-2 text-right font-medium">Volumes</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {attribution.catalogs.map((c) => (
              <tr
                key={c.catalog}
                className="border-b border-border/60"
                style={c.is_target ? { background: "color-mix(in srgb, var(--accent) 6%, transparent)" } : undefined}
              >
                <td className="px-3 py-2 text-strong">
                  <code className="text-[11px]">{c.catalog}</code>
                  {c.is_target ? (
                    <span className="chip ml-2 text-[9px]">alvo</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular">{fmtBytes(c.tables_bytes)}</td>
                <td className="px-3 py-2 text-right tabular">{fmtBytes(c.volumes_bytes)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular text-strong">
                  {fmtBytes(c.total_bytes)}
                </td>
                <td className="px-3 py-2 text-right tabular">{fmtDec1(c.share_pct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted">
        Snapshot: {attribution.snapshot_at}. O rateio assume que a fração do storage
        cresce proporcional aos bytes físicos — aproximação razoável porque
        DEFAULT_STORAGE é cobrado por GB-mês independente do catálogo.
      </p>
    </div>
  );
}

function TopRunsTable({
  topRuns,
  c,
}: {
  topRuns: FinopsRunRow[];
  c: ReturnType<typeof useThemeColors>;
}) {
  if (!topRuns.length) {
    return <p className="text-xs text-muted">Sem runs registradas ainda.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-border bg-[color:var(--bg-subtle)] text-muted">
          <tr>
            <th className="px-3 py-2 text-right font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">Dia</th>
            <th className="px-3 py-2 text-left font-medium">Job</th>
            <th className="px-3 py-2 text-right font-medium">Outcome</th>
            <th className="px-3 py-2 text-right font-medium">Min</th>
            <th className="px-3 py-2 text-right font-medium">DBUs</th>
            <th className="px-3 py-2 text-right font-medium">Custo</th>
          </tr>
        </thead>
        <tbody>
          {topRuns.map((r, i) => (
            <tr
              key={r.run_id ?? `${r.job_id}-${i}`}
              className="border-b border-border/60"
              style={r.is_wasted ? { background: "var(--loss-bg)" } : undefined}
            >
              <td className="px-3 py-2 text-right tabular text-muted">{i + 1}</td>
              <td className="px-3 py-2 tabular">{r.day ? fmtDayShort(r.day) : "—"}</td>
              <td className="px-3 py-2 text-strong" title={r.job_name}>
                {truncate(r.job_name, 50)}
              </td>
              <td
                className="px-3 py-2 text-right font-semibold"
                style={{ color: outcomeColor(r.result_state, c) }}
              >
                {OUTCOME_LABEL[r.result_state] ?? r.result_state}
              </td>
              <td className="px-3 py-2 text-right tabular">{fmtDec1(r.billed_minutes)}</td>
              <td className="px-3 py-2 text-right tabular">{fmtNum2(r.dbus)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular text-strong">
                {fmtUSD(r.cost_usd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
