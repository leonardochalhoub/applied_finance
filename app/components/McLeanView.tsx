"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  McLeanArtifact,
  McLeanCoef,
  McLeanPooled,
  McLeanStat,
} from "@/lib/data";
import { fmtNum2 } from "@/lib/format";

type SampleKey = "full" | "unconstrained" | "constrained";

const SAMPLE_LABELS: Record<SampleKey, string> = {
  full:          "Amostra completa",
  unconstrained: "Não restritas",
  constrained:   "Restritas",
};

const VAR_LABELS: Record<string, string> = {
  Cash:     "Cash (nível)",
  dCash:    "ΔCash",
  dIssue:   "ΔIssue (emissão de ações)",
  dDebt:    "ΔDebt (endividamento)",
  Cashflow: "CashFlow (op.)",
  Other:    "Other (vendas perm.)",
  Assets:   "ln(Ativo Total)",
};

const REG_VARS = ["dIssue", "dDebt", "Cashflow", "Other", "Assets"] as const;
const DESC_VARS = ["Cash", "dCash", "dIssue", "dDebt", "Cashflow", "Other", "Assets"] as const;

function fmt4(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(4).replace(".", ",");
}
function fmt2(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2).replace(".", ",");
}
function sigClass(sig: string): string {
  if (sig === "***") return "text-strong font-semibold";
  if (sig === "**")  return "text-strong";
  if (sig === "*")   return "text-body";
  return "text-muted";
}

export function McLeanView({ data }: { data: McLeanArtifact }) {
  const [sample, setSample] = useState<SampleKey>("full");

  const desc      = data.desc[sample];
  const pooled    = data.pooled[sample];
  const annual    = data.annual[sample];
  const paperDesc = data.paper_ref.desc_full;
  const paperPool = data.paper_ref.pooled_model1_full as Record<string, McLeanCoef | number>;

  // Annual chart data — 3 series (dIssue, dDebt, Cashflow) over time
  const chartData = useMemo(
    () =>
      annual.map((r) => ({
        year:     r.year,
        dIssue:   r.dIssue.coef,
        dDebt:    r.dDebt.coef,
        Cashflow: r.Cashflow.coef,
      })),
    [annual],
  );

  return (
    <div className="space-y-10">
      {/* Hero / methodology card */}
      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <div className="eyebrow">McLean (2011) — replicação</div>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <p className="text-body">
            Réplica do modelo de fontes de caixa proposto por <strong>McLean (2011)</strong> e
            aplicado às firmas brasileiras por{" "}
            <strong>Chalhoub, Kirch & Terra (2015)</strong> na{" "}
            <em>Revista Brasileira de Finanças</em>, vol. 13, nº 3.
          </p>
          <p className="text-muted">
            A equação testada é a (1) do paper original:
          </p>
          <pre className="mono whitespace-pre-wrap rounded-md bg-[color:var(--bg-subtle)] px-3 py-2 text-[11px] text-strong">
{`ΔCash_i = α + β1·ΔIssue_i + β2·ΔDebt_i + β3·CashFlow_i + β4·Other_i + β5·Assets_i + ε_i

(todas as variáveis de fluxo normalizadas por Ativo Total_{t-1})`}
          </pre>
          <p className="text-muted">
            Os dados originais usavam Economática (paga). Esta replicação usa o portal aberto da{" "}
            <strong>CVM (Dados Abertos / DFP)</strong>, disponível somente a partir de 2010 após a
            adoção das normas CPC. Janela: <strong>{data.meta.window[0]}–{data.meta.window[1]}</strong>{" "}
            (paper: {data.meta.paper_window[0]}–{data.meta.paper_window[1]}).
          </p>
        </div>

        {/* Sample summary stats */}
        <div className="grid grid-cols-2 gap-3 border-t border-border px-5 py-4 md:grid-cols-4">
          <Stat label="Firmas"            value={data.meta.n_firms.toLocaleString("pt-BR")}      sub={`paper: ${data.meta.paper_n_firms.toLocaleString("pt-BR")}`} />
          <Stat label="Firma-anos"        value={data.meta.n_obs.toLocaleString("pt-BR")}        sub={`paper: ${data.meta.paper_n_obs.toLocaleString("pt-BR")}`} />
          <Stat label="Janela"            value={`${data.meta.window[0]}–${data.meta.window[1]}`} sub={`paper: ${data.meta.paper_window[0]}–${data.meta.paper_window[1]}`} />
          <Stat label="Fonte"             value="CVM / DFP"                                       sub="Economática (paper)" />
        </div>
      </section>

      {/* Sample toggle */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="eyebrow">Sub-amostra</div>
          <div className="flex gap-1 rounded-md border border-border bg-[color:var(--bg-subtle)] p-0.5">
            {(Object.keys(SAMPLE_LABELS) as SampleKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setSample(k)}
                className={`rounded px-3 py-1 text-xs ${
                  sample === k
                    ? "bg-[color:var(--bg-elevated)] text-strong shadow-sm"
                    : "text-muted hover:text-body"
                }`}
              >
                {SAMPLE_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <p className="px-5 py-3 text-xs text-muted">
          {sample === "full" &&
            "Toda a amostra (após filtros): firmas com Ativo Total > R$ 200 mil, sem crescimento > 100% a/a, excluindo setor financeiro."}
          {sample === "unconstrained" &&
            "Firmas classificadas como não restritas: 3 decis superiores de Ativo Total dentro de cada (setor × ano), seguindo Kirch et al (2014)."}
          {sample === "constrained" &&
            "Firmas classificadas como restritas financeiramente: 3 decis inferiores de Ativo Total dentro de cada (setor × ano)."}
        </p>
      </div>

      {/* Tabela 1 — descriptive stats vs paper */}
      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <div className="eyebrow">Tabela 1 — Estatísticas descritivas</div>
          <div className="mt-1 text-xs text-muted">
            Lado a lado: replicação (2010–2024) × paper original (1995–2013, amostra completa).
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-[color:var(--bg-subtle)] text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Variável</th>
                <th className="px-3 py-2 text-right font-medium">n</th>
                <th className="px-3 py-2 text-right font-medium">Média</th>
                <th className="px-3 py-2 text-right font-medium">Desv. P.</th>
                <th className="px-3 py-2 text-right font-medium">p25</th>
                <th className="px-3 py-2 text-right font-medium">Mediana</th>
                <th className="px-3 py-2 text-right font-medium">p75</th>
                <th className="px-3 py-2 text-right font-medium text-body">Média paper</th>
                <th className="px-3 py-2 text-right font-medium text-body">Desv. paper</th>
              </tr>
            </thead>
            <tbody>
              {DESC_VARS.map((v) => {
                const s: McLeanStat = desc[v];
                const p: McLeanStat | undefined = paperDesc[v];
                return (
                  <tr key={v} className="border-b border-border/60">
                    <td className="px-3 py-2 text-strong">{VAR_LABELS[v] ?? v}</td>
                    <td className="px-3 py-2 text-right tabular text-muted">{s?.n ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular">{fmt4(s?.mean)}</td>
                    <td className="px-3 py-2 text-right tabular">{fmt4(s?.std)}</td>
                    <td className="px-3 py-2 text-right tabular">{fmt4(s?.p25)}</td>
                    <td className="px-3 py-2 text-right tabular">{fmt4(s?.median)}</td>
                    <td className="px-3 py-2 text-right tabular">{fmt4(s?.p75)}</td>
                    <td className="px-3 py-2 text-right tabular text-body">{fmt4(p?.mean)}</td>
                    <td className="px-3 py-2 text-right tabular text-body">{fmt4(p?.std)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pooled OLS coefficient table */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <div className="eyebrow">Tabela 3 (Modelo 1) — OLS Pooled</div>
            <div className="mt-1 text-xs text-muted">
              Erros padrão robustos (HC1). Significância: *** &lt; 1%, ** &lt; 5%, * &lt; 10%.
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="text-muted">n = {pooled.n.toLocaleString("pt-BR")}</div>
            <div className="text-strong">R² = {fmt4(pooled.r2)}</div>
            {sample === "full" && (
              <div className="mt-0.5 text-[10px] text-muted">paper: n=5.473 • R²=0,06</div>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-[color:var(--bg-subtle)] text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Variável</th>
                <th className="px-3 py-2 text-right font-medium">β (meu)</th>
                <th className="px-3 py-2 text-right font-medium">t-stat</th>
                <th className="px-3 py-2 text-right font-medium">sig.</th>
                {sample === "full" && (
                  <>
                    <th className="px-3 py-2 text-right font-medium text-body">β paper</th>
                    <th className="px-3 py-2 text-right font-medium text-body">t paper</th>
                    <th className="px-3 py-2 text-right font-medium text-body">sig. paper</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {REG_VARS.map((v) => {
                const c: McLeanCoef = pooled[v as keyof McLeanPooled] as McLeanCoef;
                const p = sample === "full" ? (paperPool[v] as McLeanCoef | undefined) : undefined;
                return (
                  <tr key={v} className="border-b border-border/60">
                    <td className="px-3 py-2 text-strong">{VAR_LABELS[v] ?? v}</td>
                    <td className={`px-3 py-2 text-right tabular ${sigClass(c.sig)}`}>{fmt4(c.coef)}</td>
                    <td className="px-3 py-2 text-right tabular text-muted">{fmt2(c.tstat)}</td>
                    <td className={`px-3 py-2 text-right ${sigClass(c.sig)}`}>{c.sig || "—"}</td>
                    {sample === "full" && (
                      <>
                        <td className="px-3 py-2 text-right tabular text-body">{p ? fmt4(p.coef) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular text-muted">{p ? fmt2(p.tstat) : "—"}</td>
                        <td className="px-3 py-2 text-right text-body">{p?.sig || "—"}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Annual coefficients chart — Figure 1 replication */}
      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <div className="eyebrow">Figura 1 — Taxas anuais de retenção</div>
          <div className="mt-1 text-xs text-muted">
            Coeficientes da regressão de corte transversal ano a ano, em centavos retidos por R$
            captado de cada fonte. Pontos sem significância estatística (p ≥ 10%) aparecem em cinza
            esmaecido.
          </div>
        </div>
        <div className="px-4 py-4" style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 16, right: 32, left: 16, bottom: 8 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                stroke="var(--border)"
                domain={["dataMin", "dataMax"]}
                type="number"
                tickFormatter={(v) => String(v)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                stroke="var(--border)"
                tickFormatter={(v: number) => v.toFixed(2).replace(".", ",")}
                width={48}
              />
              <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="2 3" />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border-strong)",
                        borderRadius: 8,
                        padding: "8px 10px",
                        fontSize: 11,
                      }}
                    >
                      <div className="text-strong">{label}</div>
                      {payload.map((p) => (
                        <div key={String(p.dataKey)} className="flex justify-between gap-3" style={{ color: p.color }}>
                          <span>{p.dataKey}</span>
                          <span className="tabular text-strong">{fmtNum2(p.value as number)}</span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "var(--body)" }}
                iconType="plainline"
              />
              <Line type="monotone" dataKey="dIssue"   name="ΔIssue"   stroke="var(--accent)"  strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="dDebt"    name="ΔDebt"    stroke="var(--gain)"    strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Cashflow" name="CashFlow" stroke="var(--loss)"    strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="border-t border-border px-5 py-3 text-[11px] text-muted">
          Cada ponto é a taxa de retenção daquele ano (centavos guardados como caixa por R$ 1
          captado). Coeficientes próximos entre si indicam que firmas brasileiras retêm de forma
          semelhante a partir de todas as fontes principais.
        </div>
      </section>

      {/* Constrained vs Unconstrained side-by-side */}
      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <div className="eyebrow">Quadro comparativo — restritas vs não restritas</div>
          <div className="mt-1 text-xs text-muted">
            Coeficientes do OLS pooled em cada sub-amostra. Classificação por decil de Ativo Total
            dentro de (setor × ano), seguindo Kirch et al (2014).
          </div>
        </div>
        <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
          <SubsamplePooledCard
            label="Não restritas (top 3 decis)"
            pooled={data.pooled.unconstrained}
            paperNote="Paper: todas as 3 fontes significantes"
          />
          <div className="border-t border-border md:border-l md:border-t-0">
            <SubsamplePooledCard
              label="Restritas (bottom 3 decis)"
              pooled={data.pooled.constrained}
              paperNote="Paper: ΔIssue NÃO significativo"
            />
          </div>
        </div>
      </section>

      <p className="text-[11px] text-muted">
        Fonte original: Chalhoub, L., Kirch, G., & Terra, P. R. S. (2015). Fontes de caixa e
        restrições financeiras: evidências das firmas listadas na BM&FBovespa.{" "}
        <em>Revista Brasileira de Finanças</em>, 13(3), 470–503. McLean (2011): Share issuance and
        cash savings, <em>JFE</em> 99(3).
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-base font-semibold text-strong">{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] text-muted">{sub}</div> : null}
    </div>
  );
}

function SubsamplePooledCard({
  label,
  pooled,
  paperNote,
}: {
  label: string;
  pooled: McLeanPooled;
  paperNote: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold text-strong">{label}</div>
        <div className="text-[10px] text-muted">
          n = {pooled.n.toLocaleString("pt-BR")} • R² = {fmt4(pooled.r2)}
        </div>
      </div>
      <table className="mt-3 w-full text-xs">
        <tbody>
          {REG_VARS.map((v) => {
            const c = pooled[v as keyof McLeanPooled] as McLeanCoef;
            return (
              <tr key={v} className="border-b border-border/30 last:border-0">
                <td className="py-1.5 pr-3 text-muted">{VAR_LABELS[v] ?? v}</td>
                <td className={`py-1.5 text-right tabular ${sigClass(c.sig)}`}>{fmt4(c.coef)}</td>
                <td className="py-1.5 pl-2 text-right tabular text-muted">[{fmt2(c.tstat)}]</td>
                <td className={`py-1.5 pl-2 text-right ${sigClass(c.sig)}`} style={{ width: 28 }}>
                  {c.sig || ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 text-[10px] uppercase tracking-wider text-muted">
        {paperNote}
      </div>
    </div>
  );
}
