"use client";

import { useState } from "react";

import { BlockMath } from "./Math";

// Spoken Portuguese narrative kept separate from the LaTeX source so the
// screen-reader / soundbox readout flows naturally instead of pronouncing
// glyph names like "barra" and "alfa".
const EQUATION_SPOKEN_PT = [
  "Ilusão de Skill segundo Kahneman, prêmio Nobel de dois mil e dois.",
  "Primeiro: definição do índice de Sharpe.",
  "Sharpe de uma carteira w é o retorno esperado de w menos a taxa livre de risco,",
  "dividido pela volatilidade da carteira, raiz quadrada de w transposto sigma w.",
  "Segundo: a Sharpe ex-ante, que o otimizador promete.",
  "Usando dados da janela de treino, escolhe-se o w que maximiza a Sharpe sob mu chapéu e sigma chapéu de treino.",
  "Isso é a tangência de Markowitz.",
  "Terceiro: a Sharpe ex-post, que ele entrega.",
  "Os mesmos pesos, agora avaliados nos retornos da janela de teste, fora da amostra.",
  "Quarto: a ilusão é o viés do estimador.",
  "O valor esperado da Sharpe in-sample é maior que a Sharpe verdadeira.",
  "Kan e Smith, dois mil e oito, mostram que o erro de estimativa cresce com N sobre T.",
  "Quinto: o percentil de Sharpe.",
  "Para um Sharpe observado, F de s é a probabilidade de uma carteira sorteada uniformemente no simplex render menos.",
  "Quando a Sharpe ex-post cai no percentil cinquenta, o gestor é indistinguível de sorte.",
].join(" ");

export function KahnemanEquationCard() {
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
        <div className="eyebrow">Equações — Kahneman, Ilusão de Skill</div>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <p className="text-body">
          O índice de Sharpe de uma carteira <strong>w</strong> mede retorno
          excedente por unidade de risco. Dada uma matriz de covariância{" "}
          <span className="mono">Σ</span> e um vetor de retornos esperados{" "}
          <span className="mono">μ</span>:
        </p>

        <div className="relative rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-5 shadow-sm">
          <SpeakButton speaking={isSpeaking} onClick={speak} />
          <BlockMath
            ariaLabel="Sharpe de w igual a w transposto mu menos rf, dividido por raiz de w transposto sigma w."
            tex={String.raw`S(\mathbf{w}) \;=\; \frac{\boldsymbol{\mu}^{\!\top}\mathbf{w} - r_f}{\sqrt{\mathbf{w}^{\!\top}\Sigma\,\mathbf{w}}}`}
          />
        </div>

        <p className="text-body">
          <strong>Ex-ante (in-sample, o que o otimizador promete):</strong>{" "}
          dados estimadores <span className="mono">μ̂_treino</span> e{" "}
          <span className="mono">Σ̂_treino</span>, a tangência de Markowitz é o{" "}
          <span className="mono">w*</span> que maximiza a Sharpe. Sua{" "}
          <em>Sharpe declarada</em> é o valor da função-objetivo nesse máximo:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="S de ex-ante igual a máximo sobre w no simplex de Sharpe de w avaliado em mu chapéu de treino e sigma chapéu de treino."
            tex={String.raw`S_{\text{ex-ante}} \;=\; \max_{\mathbf{w}\,\in\,\Delta^{n-1}}\; S(\mathbf{w};\, \hat{\boldsymbol{\mu}}_{\text{treino}},\, \hat{\Sigma}_{\text{treino}})`}
          />
        </div>

        <p className="text-body">
          <strong>Ex-post (out-of-sample, o que ele entrega):</strong> os{" "}
          <em>mesmos</em> pesos <span className="mono">w*</span>, agora
          avaliados sob as estatísticas <em>realizadas</em> na janela de
          teste. Nada na fórmula muda exceto os dados sob os quais
          <span className="mono">μ</span> e <span className="mono">Σ</span>{" "}
          são calculados:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="S ex-post igual a Sharpe de w estrela avaliado em mu chapéu de teste e sigma chapéu de teste."
            tex={String.raw`S_{\text{ex-post}}(\mathbf{w}^{*}) \;=\; \frac{\hat{\boldsymbol{\mu}}_{\text{teste}}^{\!\top}\,\mathbf{w}^{*} - r_f}{\sqrt{\mathbf{w}^{*\top}\,\hat{\Sigma}_{\text{teste}}\,\mathbf{w}^{*}}}`}
          />
        </div>

        <p className="text-body">
          A <strong>ilusão de skill</strong> é o gap esperado entre as duas.
          Kan &amp; Smith (2008), formalizando Jobson &amp; Korkie (1981),
          mostram que o viés cresce com a razão entre o número de ativos e
          o tamanho da amostra:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="Valor esperado de S ex-ante ao quadrado menos S verdadeiro ao quadrado é aproximadamente N sobre T, mais correção de ordem superior."
            tex={String.raw`\mathbb{E}\!\left[ S_{\text{ex-ante}}^{2} \right] - S_{\text{verdadeiro}}^{2} \;\approx\; \frac{N}{T} \;+\; O\!\left(\tfrac{N^2}{T^2}\right)`}
          />
        </div>

        <p className="text-muted">
          Para N = 30 ativos e T = 504 dias (≈ 2 anos), o viés de Sharpe ao
          quadrado é da ordem de <span className="mono">30/504 ≈ 0,06</span>.
          Quanto isso se traduz em pontos de Sharpe linear depende do
          Sharpe verdadeiro: com Sharpe_true ≈ 0,5 o gap esperado é ≈ 0,2;
          com Sharpe_true ≈ 1,0, ≈ 0,1. É a ordem de grandeza que o
          histograma desta página mostra (gap ex-ante − ex-post tipicamente
          0,1 a 0,5 em janelas curtas).
        </p>

        <p className="text-body">
          O <strong>percentil de Sharpe</strong>, finalmente, coloca esse gap
          em escala humana. Definindo a distribuição empírica das Sharpes de{" "}
          <span className="mono">M</span> carteiras{" "}
          <span className="mono">w<sup>(m)</sup></span> sorteadas uniformemente
          no simplex (Dirichlet com α = 1):
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="F de s igual a um sobre M, vezes a soma sobre m de um indicador de Sharpe da carteira m no teste menor ou igual a s."
            tex={String.raw`\hat{F}(s) \;=\; \frac{1}{M}\sum_{m=1}^{M} \mathbf{1}\!\left[\,S_{\text{ex-post}}(\mathbf{w}^{(m)}) \,\le\, s\,\right]`}
          />
        </div>
        <p className="text-xs text-muted">
          Se a Sharpe ex-post do otimizador cair em{" "}
          <span className="mono">F̂ ≈ 0,50</span>, sua performance é
          estatisticamente indistinguível do macaco com dardos de Malkiel
          (1973). O famoso resultado de Kahneman com a firma de wealth
          management — correlação 0,01 entre rankings de consultores em
          anos consecutivos — é o equivalente longitudinal desta mesma
          observação.
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
