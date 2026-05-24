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

import { BlockMath, InlineMath } from "./Math";

// GitHub Pages serves the site under /applied_finance/ in production but at /
// in dev. NEXT_PUBLIC_* is inlined at build time; missing → "" (works locally).
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type SampleKey = "full" | "unconstrained" | "constrained";
type WindowKey = "full" | "original";

const SAMPLE_LABELS: Record<SampleKey, string> = {
  full:          "Amostra completa",
  unconstrained: "Não restritas",
  constrained:   "Restritas",
};

const WINDOW_LABELS: Record<WindowKey, { short: string; long: string; tooltip: string }> = {
  full: {
    short:   "Máxima",
    long:    "2010–2025",
    tooltip: "Resultados na janela máxima disponível na CVM (16 anos).",
  },
  original: {
    short:   "Original",
    long:    "2010–2013",
    tooltip: "Janela equivalente ao paper original (2010–2013, sobreposição com a amostra 1995–2013).",
  },
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

// Portuguese spoken form of paper equation (1). Kept separate from the LaTeX
// so the screen-reader/audio version reads naturally instead of glyph names.
const EQUATION_SPOKEN_PT = [
  "Delta Caixa, índice i t,",
  "igual a alfa,",
  "mais beta um vezes Delta Emissão de Ações, índice i t,",
  "mais beta dois vezes Delta Dívida, índice i t,",
  "mais beta três vezes Fluxo de Caixa, índice i t,",
  "mais beta quatro vezes Outros, índice i t,",
  "mais beta cinco vezes Ativos, índice i t,",
  "mais épsilon, índice i t.",
  "Variáveis de fluxo normalizadas por Ativo Total, índice i, t menos um.",
].join(" ");

export function McLeanView({ data }: { data: McLeanArtifact }) {
  const [windowKey, setWindowKey] = useState<WindowKey>("full");
  const [sample, setSample]       = useState<SampleKey>("full");
  const [isSpeaking, setIsSpeaking] = useState(false);

  function speakEquation() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    if (isSpeaking) {
      synth.cancel();
      setIsSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(EQUATION_SPOKEN_PT);
    u.lang = "pt-BR";
    u.rate = 0.95;
    u.onend = () => setIsSpeaking(false);
    u.onerror = () => setIsSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setIsSpeaking(true);
  }

  const win       = data.windows[windowKey];
  const desc      = win.desc[sample];
  const pooled    = win.pooled[sample];
  const annual    = win.annual[sample];
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
        <div className="space-y-4 px-5 py-4 text-sm">
          <p className="text-body">
            Réplica do modelo de fontes de caixa proposto por{" "}
            <a
              href="https://www.sciencedirect.com/science/article/abs/pii/S0304405X10002424"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-strong"
            >
              <strong>McLean (2011)</strong>
            </a>{" "}
            e aplicado às firmas brasileiras por{" "}
            <a
              href="https://periodicos.fgv.br/rbfin/article/view/57475"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-strong"
            >
              <strong>Chalhoub, Kirch & Terra (2015)</strong>
            </a>{" "}
            na <em>Revista Brasileira de Finanças</em>, vol. 13, nº 3.
          </p>
          <div className="flex items-start gap-5 rounded-md border border-border bg-[color:var(--bg-subtle)] px-4 py-4">
            <div className="flex flex-shrink-0 items-center gap-3">
              <a
                href="https://www.ufrgs.br/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="UFRGS"
              >
                <img
                  src={`${BASE}/logos/ufrgs.png`}
                  alt="Universidade Federal do Rio Grande do Sul"
                  className="h-16 w-auto"
                />
              </a>
              <a
                href="https://www.ufrgs.br/escoladeadministracao/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Escola de Administração UFRGS"
              >
                <img
                  src={`${BASE}/logos/ea-ufrgs.png`}
                  alt="Escola de Administração — UFRGS"
                  className="h-16 w-auto dark:hidden"
                />
                <img
                  src={`${BASE}/logos/ea-ufrgs-dark.png`}
                  alt="Escola de Administração — UFRGS"
                  className="hidden h-16 w-auto dark:block"
                />
              </a>
            </div>
            <div className="text-xs leading-relaxed text-body">
              O artigo brasileiro foi derivado da{" "}
              <strong>dissertação de mestrado</strong> defendida no{" "}
              <strong>Programa de Pós-Graduação em Administração (PPGA)</strong>{" "}
              da{" "}
              <a
                href="https://www.ufrgs.br/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-dotted underline-offset-2 hover:text-strong"
              >
                Universidade Federal do Rio Grande do Sul (UFRGS)
              </a>
              ,{" "}
              <a
                href="https://www.ufrgs.br/escoladeadministracao/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-dotted underline-offset-2 hover:text-strong"
              >
                Escola de Administração
              </a>{" "}
              — orientação <strong>Prof. Dr. Guilherme Kirch</strong>.
            </div>
          </div>
          <div>
            <p className="text-muted">A equação testada é a (1) do paper original:</p>
            <div className="relative mt-3 rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-5 shadow-sm">
              <button
                type="button"
                onClick={speakEquation}
                aria-label={isSpeaking ? "Parar leitura da equação" : "Ouvir a equação"}
                aria-pressed={isSpeaking}
                title={isSpeaking ? "Parar" : "Ouvir a equação"}
                className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-[color:var(--bg-subtle)] text-muted transition hover:text-strong hover:border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
              >
                {isSpeaking ? (
                  // stop icon
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                    <rect x="2" y="2" width="8" height="8" rx="1" />
                  </svg>
                ) : (
                  // speaker icon
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h2.5L9 3v10L5.5 10H3z" fill="currentColor" />
                    <path d="M11.5 5.5a3.5 3.5 0 0 1 0 5" />
                    <path d="M13.5 3.5a6 6 0 0 1 0 9" />
                  </svg>
                )}
              </button>
              <BlockMath
                ariaLabel="Delta Cash igual a alpha mais beta um Delta Issue mais beta dois Delta Debt mais beta três Cash Flow mais beta quatro Other mais beta cinco Assets mais epsilon"
                tex={String.raw`\Delta\mathrm{Cash}_{i,t} \;=\; \alpha \;+\; \beta_{1}\,\Delta\mathrm{Issue}_{i,t} \;+\; \beta_{2}\,\Delta\mathrm{Debt}_{i,t} \;+\; \beta_{3}\,\mathrm{CashFlow}_{i,t} \;+\; \beta_{4}\,\mathrm{Other}_{i,t} \;+\; \beta_{5}\,\mathrm{Assets}_{i,t} \;+\; \varepsilon_{i,t}`}
              />
              <p className="mt-3 border-t border-border pt-3 text-center text-[11px] text-muted">
                Variáveis de fluxo normalizadas por{" "}
                <InlineMath tex={String.raw`\text{Ativo Total}_{i,\,t-1}`} />.
              </p>
            </div>
          </div>
          <p className="text-muted">
            Os dados originais usavam Economática (paga). Esta replicação usa o portal aberto da{" "}
            <strong>CVM (Dados Abertos / DFP)</strong>, disponível somente a partir de 2010 após a
            adoção das normas CPC.
          </p>
        </div>

        {/* Window toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <div>
            <div className="eyebrow">Janela</div>
            <div className="mt-0.5 text-[10px] text-muted">{WINDOW_LABELS[windowKey].tooltip}</div>
          </div>
          <div className="flex gap-1 rounded-md border border-border bg-[color:var(--bg-subtle)] p-0.5">
            {(Object.keys(WINDOW_LABELS) as WindowKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setWindowKey(k)}
                className={`rounded px-3 py-1 text-xs ${
                  windowKey === k
                    ? "bg-[color:var(--bg-elevated)] text-strong shadow-sm"
                    : "text-muted hover:text-body"
                }`}
                title={WINDOW_LABELS[k].tooltip}
              >
                {WINDOW_LABELS[k].short}{" "}
                <span className="ml-1 text-[10px] text-muted">{WINDOW_LABELS[k].long}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sample summary stats */}
        <div className="grid grid-cols-2 gap-3 border-t border-border px-5 py-4 md:grid-cols-4">
          <Stat label="Firmas"      value={win.n_firms.toLocaleString("pt-BR")} sub={`paper: ${data.meta.paper_n_firms.toLocaleString("pt-BR")}`} />
          <Stat label="Firma-anos"  value={win.n_obs.toLocaleString("pt-BR")}   sub={`paper: ${data.meta.paper_n_obs.toLocaleString("pt-BR")}`} />
          <Stat label="Janela"      value={`${win.window[0]}–${win.window[1]}`} sub={`paper: ${data.meta.paper_window[0]}–${data.meta.paper_window[1]}`} />
          <Stat label="Fonte"       value="CVM / DFP"                            sub="Economática (paper)" />
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
            Lado a lado: replicação (2010–2025) × paper original (1995–2013, amostra completa).
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

        {/* Plain-Portuguese reading of the coefficients */}
        <div className="border-t border-border bg-[color:var(--bg-subtle)] px-5 py-4 text-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-strong">
            Como ler os coeficientes
          </div>
          <p className="mt-2 text-body">
            Como todas as variáveis de fluxo estão normalizadas por{" "}
            <InlineMath tex={String.raw`\text{Ativo Total}_{i,\,t-1}`} />, cada β é{" "}
            <strong>adimensional</strong> e pode ser lido como{" "}
            <em>centavos de caixa retidos por R$ 1,00 captado naquela fonte</em>. Exemplo: β
            <sub>ΔIssue</sub> = {fmt4(pooled.dIssue.coef)} significa que, em média, para cada
            R$ 1,00 que a firma capta via emissão líquida de ações no ano <em>t</em>,
            aproximadamente <strong>R$ {(pooled.dIssue.coef).toFixed(2).replace(".", ",")}</strong>{" "}
            (≈ {(pooled.dIssue.coef * 100).toFixed(1).replace(".", ",")} centavos) acabam parados
            no caixa ao final do mesmo ano — mantendo ΔDebt, CashFlow, Other e tamanho da firma
            constantes.
          </p>
          <ul className="mt-3 space-y-1.5 text-body">
            <li>
              <strong>ΔIssue {fmt4(pooled.dIssue.coef)}{pooled.dIssue.sig && ` ${pooled.dIssue.sig}`}</strong>{" "}
              — de cada R$ 1,00 captado via emissão líquida de ações, cerca de{" "}
              <strong>{(pooled.dIssue.coef * 100).toFixed(1).replace(".", ",")} centavos</strong>{" "}
              ficam retidos como caixa.
            </li>
            <li>
              <strong>ΔDebt {fmt4(pooled.dDebt.coef)}{pooled.dDebt.sig && ` ${pooled.dDebt.sig}`}</strong>{" "}
              — de cada R$ 1,00 de dívida nova líquida (CP + LP), cerca de{" "}
              <strong>{(pooled.dDebt.coef * 100).toFixed(1).replace(".", ",")} centavos</strong>{" "}
              ficam retidos como caixa.
            </li>
            <li>
              <strong>CashFlow {fmt4(pooled.Cashflow.coef)}{pooled.Cashflow.sig && ` ${pooled.Cashflow.sig}`}</strong>{" "}
              — de cada R$ 1,00 de fluxo de caixa operacional (lucro líquido + D&A), cerca de{" "}
              <strong>{(pooled.Cashflow.coef * 100).toFixed(1).replace(".", ",")} centavos</strong>{" "}
              ficam retidos como caixa.
            </li>
            <li>
              <strong>Other {fmt4(pooled.Other.coef)}{pooled.Other.sig && ` ${pooled.Other.sig}`}</strong>{" "}
              — de cada R$ 1,00 recebido pela venda de ativo permanente, cerca de{" "}
              <strong>{(pooled.Other.coef * 100).toFixed(1).replace(".", ",")} centavos</strong>{" "}
              ficam retidos. Estimativa ruidosa: 75% das firmas-ano têm Other = 0.
            </li>
            <li>
              <strong>ln(AT) {fmt4(pooled.Assets.coef)}{pooled.Assets.sig && ` ${pooled.Assets.sig}`}</strong>{" "}
              — tamanho da firma (em log) não tem efeito incremental sobre o caixa retido
              uma vez controladas as quatro fontes acima.
            </li>
          </ul>
          <p className="mt-3 text-[11px] text-muted">
            Em outras palavras: o mecanismo central de McLean (2011) é que firmas{" "}
            <strong>não gastam imediatamente</strong> todo R$ captado — uma fração
            estatisticamente significativa de cada fonte permanece como caixa,
            consistente com motivos precaucionários (oportunidades de investimento futuras,
            choques de liquidez).
          </p>
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
            pooled={win.pooled.unconstrained}
            paperNote="Paper: todas as 3 fontes significantes"
          />
          <div className="border-t border-border md:border-l md:border-t-0">
            <SubsamplePooledCard
              label="Restritas (bottom 3 decis)"
              pooled={win.pooled.constrained}
              paperNote="Paper: ΔIssue NÃO significativo"
            />
          </div>
        </div>
      </section>

      {/* Interpretive notes — what the replication does and does not say */}
      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <div className="eyebrow">Leitura dos resultados</div>
          <div className="mt-1 text-xs text-muted">
            O que esta replicação permite afirmar — e o que ainda não permite — confrontada com o
            artigo original de 2015.
          </div>
        </div>

        <div className="space-y-5 px-5 py-4 text-sm">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-strong">
              O que se sustenta
            </div>
            <p className="mt-2 text-body">
              No OLS pooled (Modelo 1 da eq. 1), <strong>todos os três coeficientes de retenção
              são positivos e significativos a 1%</strong> — ΔIssue, ΔDebt e CashFlow — e Assets
              continua não-significativo. É a mesma história qualitativa da Tabela 3 do artigo. O
              mecanismo de cash savings de McLean (2011) <strong>sobrevive em dados abertos da
              CVM</strong>, mesmo trocando Economática por DFP. Estatísticas descritivas
              (Cash≈0,08, ΔCash≈0,006, ΔIssue≈0,026, ΔDebt≈0,041) também ficam dentro da
              distribuição reportada em 2015, reforçando que o painel pós-2010 é reconhecidamente
              o mesmo universo de firmas listadas.
            </p>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-strong">
              Onde o resultado diverge — e por quê
            </div>
            <ul className="mt-2 space-y-2 text-body">
              <li>
                <strong>As janelas mal se sobrepõem.</strong> Paper cobre 1995–2013; réplica cobre
                2010–2025. Apenas quatro anos em comum. A janela moderna inclui ciclos da Selic
                pós-2015, hoarding de liquidez na COVID e retração do BNDES — regime macro
                materialmente diferente. Coeficientes maiores em ΔIssue/ΔDebt na réplica são
                consistentes com isso, mas <em>não permitem atribuir o delta à metodologia</em> sem
                fixar a janela.
              </li>
              <li>
                <strong>A assimetria precaucionária inverte.</strong> No paper, firmas restritas
                poupam <em>mais</em> dos recursos externos — núcleo do argumento de 2015. Na
                réplica, os coeficientes do grupo <em>não restrito</em> superam os do restrito em
                todas as três fontes (ΔIssue 0,112 vs. 0,080; ΔDebt 0,136 vs. 0,088; CashFlow
                0,090 vs. 0,063). Dois drivers prováveis: (a) acumulação de caixa por grandes
                firmas pós-COVID infla o lado não-restrito; (b) o proxy por decil de Ativo Total
                dentro de setor-ano classifica de forma distinta em uma B3 moderna mais concentrada.
                Esse achado <em>é, em si, um resultado</em> — não uma falha do código.
              </li>
              <li>
                <strong>Other (0,112***) é frágil.</strong> 75% das firmas-ano são zero (p25 =
                mediana = p75 = 0); a significância depende de uma cauda curta de eventos de venda
                de ativo permanente. Tratar como ruído, não como achado.
              </li>
              <li>
                <strong>Assets em escala diferente.</strong> Média de ln(AT) na réplica fica em
                ~21,6 contra ~13,9 no paper, gap de ano-base/unidade da deflação. Coeficiente
                permanece ~0 nos dois, então não muda inferência — mas precisa ser harmonizado
                antes de qualquer tabela publicada lado-a-lado.
              </li>
              <li>
                <strong>R² praticamente dobra (0,06 → 0,11).</strong> Mais plausível atribuir à
                homogeneidade do painel pós-IFRS (CPC 26/2010 padronizou a DFP) do que a ganho
                metodológico. Não vender como mérito.
              </li>
            </ul>
          </div>

          <div className="rounded-md border border-border bg-[color:var(--bg-subtle)] px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-strong">
              Narrativa defensável
            </div>
            <p className="mt-2 text-body">
              O mecanismo de cash savings documentado em 2015 segue operando em 2010–2025:
              firmas brasileiras continuam retendo parcela significativa de cada real captado via
              emissão, dívida ou caixa operacional. No entanto, a{" "}
              <strong>assimetria precaucionária entre restritas e não-restritas não se replica
              out-of-sample</strong>. Qualquer afirmação mais forte exige (a) reaver Economática
              para refazer a janela 1995–2013, ou (b) isolar o subsample 2010–2013 para
              separar efeito de fonte de dados de efeito de janela.
            </p>
          </div>
        </div>
      </section>

      <div className="space-y-1 text-[11px] text-muted">
        <p>
          ⊳{" "}
          <a
            href="https://periodicos.fgv.br/rbfin/article/view/57475"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-body"
          >
            Chalhoub, L., Kirch, G., & Terra, P. R. S. (2015). Fontes de caixa e restrições
            financeiras: evidências das firmas listadas na BM&FBovespa.{" "}
            <em>Revista Brasileira de Finanças</em>, 13(3), 470–503.
          </a>
        </p>
        <p>
          ⊳{" "}
          <a
            href="https://www.sciencedirect.com/science/article/abs/pii/S0304405X10002424"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-body"
          >
            McLean, R. D. (2011). Share issuance and cash savings.{" "}
            <em>Journal of Financial Economics</em>, 99, 693–715.
          </a>
        </p>
      </div>
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

