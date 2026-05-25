"use client";

import { useState } from "react";

import { BlockMath } from "./Math";

const EQUATION_SPOKEN_PT = [
  "Paridade de risco, segundo Maillard, Roncalli e Teïletche, dois mil e dez.",
  "Primeiro: contribuição de risco do ativo i.",
  "R C de i é igual a w i vezes sigma w i, dividido por w transposto sigma w.",
  "É a fração da variância total da carteira atribuível ao ativo i, somando um.",
  "Segundo: a condição E R C.",
  "Paridade de risco exige R C de i igual a um sobre N para todo i.",
  "Cada ativo paga seu próprio aluguel de risco.",
  "Terceiro: formulação convexa de Maillard, Roncalli e Teïletche.",
  "A solução E R C existe e é única como minimizador da função: meio w transposto sigma w menos um sobre N vezes a soma de logaritmo natural de w i,",
  "sujeito a w maior ou igual a zero. O gradiente é sigma w menos um sobre N vezes vetor de um sobre w i.",
  "Quarto: caso fechado da paridade ingênua, sigma diagonal.",
  "Se ignorarmos correlações, w i é proporcional a um sobre sigma i — a paridade de volatilidade.",
  "É o que a maioria dos produtos comerciais de risk parity implementa na prática.",
  "Quinto: a covariância de risco H H I.",
  "Soma dos R C ao quadrado mede concentração de risco.",
  "A carteira um sobre N tem H H I de risco maior que um sobre N quando vols são heterogêneas;",
  "a E R C atinge o mínimo possível por construção.",
].join(" ");

export function ParidadeEquationCard() {
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
        <div className="eyebrow">Equações — Paridade de Risco (ERC)</div>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <p className="text-body">
          A variância de uma carteira é{" "}
          <span className="mono">σ²_p = w<sup>⊤</sup>Σw</span>. A{" "}
          <strong>contribuição de risco</strong> do ativo i é a parcela
          dessa variância que pode ser atribuída a ele — o produto entre seu
          peso e seu &ldquo;risco marginal&rdquo; <span className="mono">(Σw)_i</span>:
        </p>

        <div className="relative rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-5 shadow-sm">
          <SpeakButton speaking={isSpeaking} onClick={speak} />
          <BlockMath
            ariaLabel="R C de i igual a w i vezes sigma w i, dividido por w transposto sigma w. Soma dos R C igual a um."
            tex={String.raw`\mathrm{RC}_{i}(\mathbf{w}) \;=\; \frac{w_{i}\,(\Sigma\,\mathbf{w})_{i}}{\mathbf{w}^{\!\top}\Sigma\,\mathbf{w}}, \qquad \sum_{i=1}^{N} \mathrm{RC}_{i} \;=\; 1`}
          />
        </div>

        <p className="text-body">
          A <strong>condição ERC (Equal Risk Contribution)</strong> exige que
          cada ativo contribua igualmente: cada ativo &ldquo;paga o mesmo
          aluguel de risco&rdquo;:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="R C de i igual a um sobre N para todo i de um até N."
            tex={String.raw`\mathrm{RC}_{i}(\mathbf{w}^{\!*}) \;=\; \frac{1}{N} \quad \forall\, i \in \{1,\,\dots,\,N\}`}
          />
        </div>

        <p className="text-body">
          Maillard, Roncalli &amp; Teïletche (2010) provam que esse vetor de
          pesos existe, é único, e é o minimizador de um problema convexo
          com solução em fórmula iterativa rápida — sem otimizador
          quadrático geral, sem busca por raízes:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="Minimização de meio w transposto sigma w menos um sobre N vezes a soma de logaritmo natural de w i, sujeito a w maior ou igual a zero."
            tex={String.raw`\min_{\mathbf{w}\,\ge\,\mathbf{0}}\;\; \tfrac{1}{2}\,\mathbf{w}^{\!\top}\Sigma\,\mathbf{w} \;-\; \frac{1}{N}\sum_{i=1}^{N}\,\ln\!\bigl(w_{i}\bigr)`}
          />
        </div>

        <p className="text-body">
          O termo <span className="mono">−ln(w_i)</span> é uma{" "}
          <em>barreira logarítmica</em>: força <span className="mono">w_i &gt; 0</span>{" "}
          (não pode ir a zero, pois ln(0) = −∞) e empurra a solução para o
          interior do simplex. O gradiente é{" "}
          <span className="mono">Σw − (1/N)·(1/w_i)</span>, que se anula
          exatamente quando <span className="mono">w_i (Σw)_i = constante</span>{" "}
          — a condição ERC.
        </p>

        <p className="text-body">
          Caso especial: quando <strong>Σ é diagonal</strong> (zero
          correlação entre os ativos), há uma fórmula fechada que dispensa o
          solver. É a chamada <em>paridade de volatilidade</em> ou
          &ldquo;ERC do pobre&rdquo;:
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="w i é proporcional a um sobre sigma i, onde sigma i é a raiz quadrada da i-ésima diagonal de sigma."
            tex={String.raw`w_{i}^{\!\text{inv-vol}} \;\propto\; \frac{1}{\sigma_{i}}, \qquad \sigma_{i} \;=\; \sqrt{\Sigma_{ii}}`}
          />
        </div>

        <p className="text-body">
          É essa fórmula que a maioria dos produtos &ldquo;risk parity&rdquo;
          comerciais implementa de fato — barata, transparente, mas{" "}
          <em>cega</em> a clusters de correlação (bancos brasileiros todos
          correlacionados com Selic, commodities todas correlacionadas com
          dólar). A ERC propriamente dita captura essas correlações.
        </p>

        <p className="text-body">
          A <strong>concentração de risco</strong>, finalmente, mede-se
          como HHI das contribuições de risco (não dos pesos):
        </p>

        <div className="rounded-lg border border-border bg-[color:var(--bg-elevated)] px-6 py-4">
          <BlockMath
            ariaLabel="H H I de risco igual a soma de i de R C i ao quadrado, com mínimo um sobre N atingido pela carteira E R C."
            tex={String.raw`\mathrm{HHI}_{\text{risco}}(\mathbf{w}) \;=\; \sum_{i=1}^{N} \mathrm{RC}_{i}^{\,2} \;\;\ge\;\; \frac{1}{N} \;=\; \mathrm{HHI}_{\text{risco}}(\mathbf{w}^{\!*}_{\text{ERC}})`}
          />
        </div>

        <p className="text-xs text-muted">
          <strong>Por que isso importa para o 1/N</strong>: no 1/N de
          dólares, ativos voláteis dominam a variância. Considere dois
          ativos com vols anualizadas de 24% e 38% (ordens de grandeza
          observadas no top-15 do IBOV, e.g. ITSA4 vs RENT3) e
          correlação zero. Com pesos 50/50, a contribuição de risco do
          ativo mais volátil é <span className="mono">(0,5²·0,38²) / (0,5²·0,24² + 0,5²·0,38²) ≈ 0,71</span>
          {" "}— ou seja, 71% do risco no ativo de maior vol mesmo
          investindo metade do dinheiro em cada. ERC corrige isso
          reduzindo o peso dos ativos de alta vol até que cada um
          contribua exatamente 1/N para a variância total.
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
