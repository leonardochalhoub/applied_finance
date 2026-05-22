"use client";

import { useState } from "react";

import { BlockMath } from "./Math";

// Portuguese spoken form of the Markowitz mean-variance problem + the
// tangency-portfolio first-order condition. Kept separate from the LaTeX
// source so the screen-reader / soundbox readout flows naturally instead of
// pronouncing glyph names.
const EQUATION_SPOKEN_PT = [
  "Equação de Markowitz, mil novecentos e cinquenta e dois.",
  "Encontre o vetor de pesos w que minimiza um meio w transposto sigma w,",
  "sujeito a duas restrições:",
  "primeira, w transposto mu igual a mu estrela — o retorno alvo;",
  "segunda, w transposto vetor um igual a um — soma dos pesos é cem por cento.",
  "Sigma é a matriz de covariância dos retornos.",
  "Mu é o vetor de retornos esperados.",
  "A solução analítica, segundo Merton, mil novecentos e setenta e dois,",
  "é a carteira de tangência: sigma inverso vezes mu menos rf vetor um,",
  "dividido por vetor um transposto vezes a mesma quantidade.",
  "Essa é a carteira de máximo índice de Sharpe.",
  "No ponto ótimo, a derivada da fronteira eficiente em relação a sigma",
  "é exatamente igual ao próprio índice de Sharpe da carteira de tangência.",
].join(" ");

export function MarkowitzEquationCard() {
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

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <div className="eyebrow">Equação de Markowitz (1952)</div>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <p className="text-body">
          O problema de Markowitz é encontrar a alocação <strong>w</strong> que
          minimiza a variância da carteira para um retorno-alvo{" "}
          <span className="mono">μ*</span>, com soma dos pesos igual a um:
        </p>

        {/* Primary equation block — the optimization problem itself */}
        <div className="relative rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-5 shadow-sm">
          <button
            type="button"
            onClick={speakEquation}
            aria-label={isSpeaking ? "Parar leitura da equação" : "Ouvir a equação"}
            aria-pressed={isSpeaking}
            title={isSpeaking ? "Parar" : "Ouvir a equação"}
            className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-[color:var(--bg-subtle)] text-muted transition hover:text-strong hover:border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
          >
            {isSpeaking ? (
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
          <BlockMath
            ariaLabel="Minimização de um meio w transposto sigma w sujeito a w transposto mu igual a mu estrela e w transposto vetor um igual a um"
            tex={String.raw`\min_{\mathbf{w}\in\mathbb{R}^{n}} \;\; \tfrac{1}{2}\,\mathbf{w}^{\!\top}\Sigma\,\mathbf{w} \quad \text{s.\,a.} \quad \mathbf{w}^{\!\top}\boldsymbol{\mu} = \mu^{*}, \;\; \mathbf{w}^{\!\top}\mathbf{1} = 1`}
          />
        </div>

        <p className="text-body">
          A solução analítica fechada de <strong>Merton (1972)</strong>, quando
          existe um ativo livre de risco com taxa <span className="mono">rf</span>,
          é a <strong>carteira de tangência</strong> — exatamente o ponto de
          máximo Sharpe (estrela verde no gráfico acima):
        </p>

        {/* Secondary equation — the closed-form tangency portfolio */}
        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="w tangência igual a sigma inverso vezes mu menos rf vetor um, dividido por vetor um transposto vezes sigma inverso vezes mu menos rf vetor um"
            tex={String.raw`\mathbf{w}_{T} \;=\; \frac{\Sigma^{-1}\,(\boldsymbol{\mu} - r_f\,\mathbf{1})}{\mathbf{1}^{\!\top}\,\Sigma^{-1}\,(\boldsymbol{\mu} - r_f\,\mathbf{1})}`}
          />
        </div>

        <p className="text-muted">
          A condição de primeira ordem para o máximo Sharpe (derivando{" "}
          <span className="mono">S(σ) = (E[r] − rf)/σ</span> e igualando a zero)
          fornece a identidade que une cálculo e geometria:
        </p>

        {/* Tertiary equation — the FOC linking derivative to Sharpe */}
        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="derivada de E de r em relação a sigma, avaliada em sigma estrela, igual a E de r estrela menos rf, dividido por sigma estrela, igual ao Sharpe ótimo"
            tex={String.raw`\left.\frac{dE[r]}{d\sigma}\right|_{\sigma^{*}} \;=\; \frac{E[r^{*}]-r_f}{\sigma^{*}} \;\equiv\; \mathrm{Sharpe}^{*}`}
          />
        </div>
        <p className="text-xs text-muted">
          É essa identidade que faz a hipotenusa do triângulo verde no gráfico —
          a derivada local da fronteira — coincidir com a CAL: ambas têm
          inclinação igual ao Sharpe da carteira de tangência.
        </p>
      </div>
    </section>
  );
}
