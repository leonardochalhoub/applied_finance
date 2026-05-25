"use client";

import { useState } from "react";

import { BlockMath } from "./Math";

const EQUATION_SPOKEN_PT = [
  "Carteira ingênua um sobre N, baseada em DeMiguel, Garlappi e Uppal, dois mil e nove.",
  "Primeiro: definição da carteira um sobre N.",
  "Para um universo de N ativos, o vetor de pesos é simplesmente um sobre N para cada ativo.",
  "Soma dos pesos igual a um, peso igual a um sobre N para todos.",
  "Segundo: a carteira Markowitz walk-forward.",
  "A cada rebalanceamento t, estima-se mu chapéu e sigma chapéu na janela de treino anterior,",
  "e escolhe-se w chapéu de t como o w que maximiza a Sharpe sob esses estimadores.",
  "Esse w é mantido fixo durante a janela de teste seguinte.",
  "Terceiro: o retorno realizado da carteira.",
  "Para cada janela de teste, o retorno realizado é w chapéu transposto vezes o vetor de retornos simples do período.",
  "Quarto: turnover anualizado.",
  "Para cada rebalanceamento, soma-se o módulo da diferença de pesos, dividido por dois.",
  "Soma sobre todos os rebalanceamentos, dividido pelo número de rebalanceamentos menos um, vezes o número de rebalanceamentos por ano.",
  "A carteira um sobre N tem turnover aproximadamente zero por construção.",
  "Quinto: a concentração HHI.",
  "Soma dos pesos ao quadrado. O HHI da carteira um sobre N é exatamente um sobre N — diversificação máxima.",
].join(" ");

export function IngenuoEquationCard() {
  const [isSpeaking, setIsSpeaking] = useState(false);

  function speak() {
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

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <div className="eyebrow">Equações — Carteira ingênua (1/N) e walk-forward</div>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <p className="text-body">
          A <strong>carteira ingênua 1/N</strong> aloca o mesmo peso em
          todos os N ativos do universo. Nenhuma estimativa, nenhuma
          otimização — só uma divisão igual. É o &ldquo;macaco com dardos
          informado&rdquo;:
        </p>

        <div className="relative rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-5 shadow-sm">
          <SpeakButton speaking={isSpeaking} onClick={speak} />
          <BlockMath
            ariaLabel="w ingênua igual a um sobre N vezes vetor um, com N entradas."
            tex={String.raw`\mathbf{w}_{\text{1/N}} \;=\; \frac{1}{N}\,\mathbf{1}_{N} \;=\; \left(\tfrac{1}{N},\,\tfrac{1}{N},\,\dots,\,\tfrac{1}{N}\right)^{\!\top}`}
          />
        </div>

        <p className="text-body">
          O <strong>backtest walk-forward</strong>, espinha dorsal de
          DeMiguel-Garlappi-Uppal (2009), repete o seguinte ciclo: a cada
          rebalanceamento t, estima-se μ̂ e Σ̂ na janela de treino anterior;
          resolve-se a tangência de Markowitz <em>sob esses estimadores</em>;
          os pesos resultantes ficam congelados durante a janela de teste
          seguinte:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="w chapéu de t igual ao arg max sobre w no simplex de mu chapéu de t transposto w menos rf, dividido pela raiz de w transposto sigma chapéu de t w."
            tex={String.raw`\hat{\mathbf{w}}_{t} \;=\; \arg\max_{\mathbf{w}\,\in\,\Delta^{n-1}}\; \frac{\hat{\boldsymbol{\mu}}_{t}^{\!\top}\mathbf{w} - r_f}{\sqrt{\mathbf{w}^{\!\top}\,\hat{\Sigma}_{t}\,\mathbf{w}}}`}
          />
        </div>

        <p className="text-body">
          O <strong>retorno realizado</strong> da carteira na janela de teste
          é simplesmente o produto interno entre os pesos congelados e o
          vetor de retornos simples observado:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="r de p em t mais um igual a w chapéu de t transposto vezes r de t mais um, onde r é o vetor de retornos simples do período."
            tex={String.raw`r_{p,\,t+1} \;=\; \hat{\mathbf{w}}_{t}^{\!\top}\,\mathbf{r}_{\,t+1} \quad\text{com}\quad r_{i,\,t+1} \;=\; \exp\!\left(\textstyle\sum_{\tau\in T_{t+1}} r^{\text{log}}_{i,\tau}\right) - 1`}
          />
        </div>

        <p className="text-body">
          Duas métricas além de retorno e Sharpe captam a fragilidade do
          Markowitz: <strong>turnover</strong> e <strong>HHI</strong>.
          Turnover anualizado mede quanto da carteira é girada por ano
          (1/N gira ≈ 0 por construção; Markowitz costuma girar 1× a 3×):
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="Turnover anualizado igual a soma de t igual a dois até T da metade da soma sobre i do módulo de w i t menos w i t menos um, dividido por T menos um, vezes rebalanceamentos por ano."
            tex={String.raw`\text{Turnover}_{\text{ano}} \;=\; \frac{1}{T-1}\sum_{t=2}^{T} \frac{1}{2}\sum_{i=1}^{N}\,\bigl|\hat{w}_{i,t} - \hat{w}_{i,\,t-1}\bigr| \;\times\; \nu_{\text{ano}}`}
          />
        </div>

        <p className="text-body">
          HHI (Herfindahl-Hirschman) mede concentração: 1/N atinge o
          mínimo (= 1/N), uma única ação atinge o máximo (= 1):
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="HHI igual a soma de i de um até N de w i ao quadrado, com mínimo um sobre N para a carteira ingênua."
            tex={String.raw`\mathrm{HHI}(\mathbf{w}) \;=\; \sum_{i=1}^{N} w_{i}^{2} \quad\Longrightarrow\quad \mathrm{HHI}(\mathbf{w}_{\text{1/N}}) \;=\; \frac{1}{N}`}
          />
        </div>

        <p className="text-xs text-muted">
          A tese empírica de DGU é que o ganho teórico do Markowitz sobre o
          1/N é menor que o <em>erro de estimativa</em> em μ̂ e Σ̂. O Sharpe
          fora-da-amostra do Markowitz frequentemente fica abaixo do 1/N
          mesmo antes de descontar os custos de transação implícitos no
          turnover. Em 14 datasets clássicos, nenhuma das 14 variantes
          testadas bate o 1/N de forma robusta.
        </p>
      </div>
    </section>
  );
}

function SpeakButton({ speaking, onClick }: { speaking: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={speaking ? "Parar leitura da equação" : "Ouvir a equação"}
      aria-pressed={speaking}
      title={speaking ? "Parar" : "Ouvir a equação"}
      className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-[color:var(--bg-subtle)] text-muted transition hover:text-strong hover:border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
    >
      {speaking ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h2.5L9 3v10L5.5 10H3z" fill="currentColor" />
          <path d="M11.5 5.5a3.5 3.5 0 0 1 0 5" />
          <path d="M13.5 3.5a6 6 0 0 1 0 9" />
        </svg>
      )}
    </button>
  );
}
