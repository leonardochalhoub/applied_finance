"use client";

import { useState } from "react";

import { BlockMath } from "./Math";

const EQUATION_SPOKEN_PT = [
  "Modelo Black-Litterman, mil novecentos e noventa e dois.",
  "Primeiro: retornos implícitos pelo equilíbrio.",
  "Pi maiúsculo é igual a delta vezes sigma vezes w de mercado.",
  "É o vetor de retornos esperados que, sob média-variância em equilíbrio,",
  "faz a carteira de mercado observada ser ótima — uma reversão do CAPM.",
  "Segundo: estrutura de views.",
  "K views são representadas por uma matriz P, K por N, um vetor Q, K por um,",
  "e uma matriz de covariância de incerteza ômega, K por K, diagonal.",
  "Cada linha de P é a carteira sobre a qual a view incide.",
  "Q é o retorno esperado declarado por essa view.",
  "Ômega captura a confiança: ômega K K igual a tau vezes P K sigma P K transposto, vezes um menos c sobre c.",
  "C é a confiança na view, entre zero e um. Confiança alta encolhe ômega — a view vira lei.",
  "Terceiro: distribuição a priori de mu verdadeiro.",
  "Mu segue distribuição normal com média pi e covariância tau sigma.",
  "Tau é o escalar de calibragem da prior, tipicamente entre zero vírgula zero um e zero vírgula zero cinco.",
  "Quarto: posterior bayesiano em forma fechada.",
  "Mu B L é igual ao inverso de tau sigma inverso mais P transposto ômega inverso P,",
  "vezes tau sigma inverso pi mais P transposto ômega inverso Q.",
  "Sem views, mu B L recupera exatamente pi — a carteira de mercado.",
  "Com views, o posterior tilta proporcional à confiança.",
  "Quinto: covariância posterior usada no otimizador.",
  "Sigma B L é igual a sigma mais M, onde M é a covariância posterior do próprio mu.",
  "Esse termo inflaciona o risco efetivo e impede a concentração extrema do Markowitz puro.",
].join(" ");

export function BlackLittermanEquationCard() {
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
        <div className="eyebrow">Equações — Black-Litterman (1992)</div>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <p className="text-body">
          O ponto de partida não é a média histórica μ̂, é o{" "}
          <strong>retorno implícito pelo equilíbrio</strong>: dado o vetor
          de pesos da carteira de mercado <span className="mono">w<sub>mkt</sub></span>{" "}
          (no nosso caso, os pesos do IBOV) e a covariância{" "}
          <span className="mono">Σ</span>, qual μ tornaria essa carteira a
          tangência de Markowitz? É a <em>reversão</em> do CAPM:
        </p>

        <div className="relative rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-5 shadow-sm">
          <SpeakButton speaking={isSpeaking} onClick={speak} />
          <BlockMath
            ariaLabel="Pi maiúsculo igual a delta vezes sigma vezes w de mercado."
            tex={String.raw`\boldsymbol{\Pi} \;=\; \delta\,\Sigma\,\mathbf{w}_{\!\text{mkt}}`}
          />
        </div>

        <p className="text-body">
          O parâmetro <span className="mono">δ</span> é a{" "}
          <strong>aversão a risco do mercado representativo</strong>: 2,5 no
          textbook He-Litterman (1999), ≈ 1 quando reverte-engenheirado da
          Sharpe histórica do IBOV. As <strong>views</strong> são K previsões
          lineares com confiança calibrada por uma matriz de incerteza
          <span className="mono">Ω</span>:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="P vezes mu igual a Q mais epsilon, com epsilon distribuído normalmente, média zero, covariância ômega diagonal."
            tex={String.raw`P\,\boldsymbol{\mu} \;=\; \mathbf{Q} + \boldsymbol{\varepsilon},\qquad \boldsymbol{\varepsilon}\,\sim\,\mathcal{N}(\mathbf{0},\,\Omega)`}
          />
        </div>

        <p className="text-body">
          P é a matriz K×N das views (cada linha define a carteira sobre a
          qual a view incide), Q é o vetor de retornos esperados declarados,
          Ω é diagonal com{" "}
          <span className="mono">Ω<sub>kk</sub> = τ · P<sub>k</sub> Σ P<sub>k</sub><sup>⊤</sup> · (1−c)/c</span>,
          onde c ∈ (0, 1] é a confiança. c = 0,5 é o default He-Litterman;
          c → 1 ⇒ Ω → 0 ⇒ a view vira igualdade dura. Sob a prior
          bayesiana de Black-Litterman, μ verdadeiro tem distribuição:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="Mu distribuído normalmente com média pi e covariância tau sigma."
            tex={String.raw`\boldsymbol{\mu} \;\sim\; \mathcal{N}\!\bigl(\boldsymbol{\Pi},\, \tau\,\Sigma\bigr)`}
          />
        </div>

        <p className="text-body">
          O <strong>posterior</strong> resulta da combinação bayesiana entre
          essa prior e as views. A forma fechada — talvez a fórmula mais
          icônica da gestão quantitativa de carteiras pós-1990 — é:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="Mu B L igual ao inverso da soma de tau sigma inverso e P transposto ômega inverso P, vezes a soma de tau sigma inverso pi com P transposto ômega inverso Q."
            tex={String.raw`\boldsymbol{\mu}_{\!BL} \;=\; \Bigl[\,(\tau\Sigma)^{-1} + P^{\!\top}\Omega^{-1}P\,\Bigr]^{-1} \,\Bigl[\,(\tau\Sigma)^{-1}\boldsymbol{\Pi} + P^{\!\top}\Omega^{-1}\mathbf{Q}\,\Bigr]`}
          />
        </div>

        <p className="text-body">
          Sem views (matriz P vazia), o segundo termo do produto desaparece
          e os dois <span className="mono">(τΣ)<sup>−1</sup></span> se
          cancelam: <strong>μ<sub>BL</sub> = Π exatamente</strong>. Esse é o
          ponto teórico mais importante do modelo — sem opinião, o
          investidor recebe a recomendação &ldquo;hold the index&rdquo;.
        </p>

        <p className="text-body">
          A <strong>covariância posterior</strong> usada no otimizador final
          incorpora a incerteza adicional sobre μ:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="Sigma B L igual a sigma mais M, onde M é o inverso de tau sigma inverso mais P transposto ômega inverso P."
            tex={String.raw`\Sigma_{\!BL} \;=\; \Sigma + M, \quad\text{com}\quad M \;=\; \Bigl[\,(\tau\Sigma)^{-1} + P^{\!\top}\Omega^{-1}P\,\Bigr]^{-1}`}
          />
        </div>

        <p className="text-xs text-muted">
          <strong>Interpretação</strong>: M é a covariância posterior do
          próprio vetor μ. Sem views, M = τΣ ⇒ Σ<sub>BL</sub> = (1 + τ)Σ —
          uma inflação modesta. Com views, M é menor na direção das views
          (a Bayes &ldquo;aprendeu&rdquo;) e maior perpendicularmente. Esse
          termo é o que mata a concentração de 80% num só ticker que
          caracteriza o Markowitz puro — o otimizador é{" "}
          <em>matematicamente honesto</em> sobre não saber μ exatamente.
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
