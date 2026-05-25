import { withBase } from "@/lib/links";

export const dynamic = "force-static";

export const metadata = {
  title: "Working Paper — Cinco abordagens de seleção de carteira | Applied Finance",
  description:
    "Applied Finance Working Paper: replicação empírica de Markowitz, DeMiguel-Garlappi-Uppal, Kahneman, Black-Litterman e Paridade de Risco sobre o universo IBOV (2000-2026), com pipeline unificado de estimação Ledoit-Wolf + Jorion + macro-anchor.",
};

export default function WorkingPaperPage() {
  const PDF_HREF = withBase("/articles/wp01.pdf");
  const TEX_HREF = withBase("/articles/wp01.tex");
  const OVERLEAF_HREF =
    "https://www.overleaf.com/docs?snip_uri=" +
    encodeURIComponent(
      "https://leonardochalhoub.github.io/applied_finance/articles/wp01.tex",
    );

  return (
    <div className="space-y-10">
      <header>
        <div className="eyebrow">Applied Finance · Working Paper</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Cinco abordagens de seleção de carteira no mercado brasileiro
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Replicação empírica de Markowitz (1952),{" "}
          <a
            href="https://academic.oup.com/rfs/article-abstract/22/5/1915/1592901"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-strong"
          >
            DeMiguel-Garlappi-Uppal (2009)
          </a>
          ,{" "}
          <a
            href="https://www.nobelprize.org/prizes/economic-sciences/2002/kahneman/facts/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-strong"
          >
            Kahneman (2002 Nobel; 2011)
          </a>
          ,{" "}
          <a
            href="https://www.tandfonline.com/doi/abs/10.2469/faj.v48.n5.28"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-strong"
          >
            Black-Litterman (1992)
          </a>{" "}
          e{" "}
          <a
            href="https://www.pm-research.com/content/iijpormgmt/36/4/60"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-strong"
          >
            Maillard-Roncalli-Teïletche (2010)
          </a>{" "}
          sobre o universo IBOV em janela 2000–2026, com pipeline unificado
          de estimação Ledoit-Wolf + Jorion + macro-anchor hospedado em
          arquitetura <em>lakehouse</em> Medallion sobre Databricks Free
          Edition.
        </p>
      </header>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <span className="eyebrow">Resumo</span>
        </div>
        <div className="space-y-3 px-5 py-5 text-sm text-body">
          <p>
            A teoria moderna de carteiras oscila entre dois pólos: o ideal de
            <strong> Markowitz (1952)</strong>, que prescreve a otimização de
            média-variância como solução única do problema do investidor, e a
            crítica empírica acumulada desde Michaud (1989) e formalizada por
            DeMiguel-Garlappi-Uppal (2009), que documenta que a média amostral
            μ̂ é estatisticamente frágil demais para que o otimizador supere
            consistentemente regras ingênuas fora-da-amostra.
          </p>
          <p>
            Este <em>working paper</em> replica empiricamente cinco abordagens
            contemporâneas — Markowitz puro, ingênuo 1/N de DGU, Ilusão de
            Skill de Kahneman, Black-Litterman e Paridade de Risco (ERC) —
            sobre o universo brasileiro de ações listadas na B3, em janela
            2000-2026, com 982 tickers curados (468 efetivamente ingeridos
            via Yahoo Finance) e r<sub>f</sub> = 12,90% a.a. (CDI BCB SGS 12).
          </p>
          <p>
            <strong>Achados principais</strong>: (i) A fronteira Markowitz
            long-only sobre top-30 IBOV entrega tangência com Sharpe = 0,72;
            (ii) walk-forward 3y/1q de 8 períodos (abr/2024 a mai/2026) mostra
            Markowitz superando 1/N por +0,47 Sharpe — resultado contradizendo
            DGU mas refletindo janela favorável + shrinkage agressivo;
            (iii) Kahneman ilusão = +0,176 Sharpe (ex-ante 1,12 vs ex-post
            0,95), ambos acima do suporte aleatório; (iv) Black-Litterman
            recupera Π ∈ [5,64%, 10,49%], mais modesto que μ̂ amostral
            [12,64%, 30,90%]; (v) ERC atinge HHI<sub>risco</sub> = 0,067 ≈ 1/N
            por construção contra 0,318 do Markowitz.
          </p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <span className="eyebrow">Baixar / abrir</span>
          <p className="mt-1 text-xs text-muted">
            Quatro formatos disponíveis: PDF compilado em CI (ABNT 12pt A4),
            fonte LaTeX para reproduzir localmente, edição online no Overleaf.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 px-5 py-5 sm:grid-cols-2 md:grid-cols-3">
          <a
            href={PDF_HREF}
            target="_blank"
            rel="noreferrer"
            className="card-hover flex items-center justify-between rounded-md border border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)] px-4 py-3 text-sm font-semibold text-strong transition hover:border-strong"
          >
            <span>📖 Ler PDF</span>
            <span className="text-xs text-muted">.pdf · ABNT</span>
          </a>
          <a
            href={PDF_HREF}
            download="wp01-applied-finance.pdf"
            className="card-hover flex items-center justify-between rounded-md border border-border bg-[color:var(--bg-elevated)] px-4 py-3 text-sm font-semibold text-strong transition hover:border-strong"
          >
            <span>⤓ Baixar PDF</span>
            <span className="text-xs text-muted">arquivo</span>
          </a>
          <a
            href={TEX_HREF}
            download="wp01-applied-finance.tex"
            className="card-hover flex items-center justify-between rounded-md border border-border bg-[color:var(--bg-elevated)] px-4 py-3 text-sm font-semibold text-strong transition hover:border-strong"
          >
            <span>⤓ Baixar fonte .tex</span>
            <span className="text-xs text-muted">LaTeX</span>
          </a>
          <a
            href={OVERLEAF_HREF}
            target="_blank"
            rel="noreferrer"
            className="card-hover flex items-center justify-between rounded-md border border-border bg-[color:var(--bg-elevated)] px-4 py-3 text-sm font-semibold text-strong transition hover:border-strong"
          >
            <span>↗ Abrir no Overleaf</span>
            <span className="text-xs text-muted">editor online</span>
          </a>
        </div>
      </section>

      <section className="card px-6 py-5 text-sm text-body">
        <div className="eyebrow">Estrutura do artigo</div>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>Introdução</li>
          <li>Referencial teórico (Markowitz · Sharpe · Michaud · Jorion · Ledoit-Wolf · DGU · Kahneman · Black-Litterman · He-Litterman · Maillard et al.)</li>
          <li>Dados e materiais (lakehouse Medallion · universo de 982 tickers · IBOV)</li>
          <li>Metodologia (pipeline de estimação · walk-forward · experimento Kahneman · BL · ERC)</li>
          <li>Resultados (cinco subseções, tabelas com números reais do pipeline)</li>
          <li>Discussão (limitações · interpretação · direções futuras)</li>
          <li>Considerações finais</li>
          <li>Referências (ABNT)</li>
        </ol>
      </section>

      <section className="card px-6 py-5 text-sm text-body">
        <div className="eyebrow">Reprodutibilidade</div>
        <p className="mt-3">
          Código-fonte:{" "}
          <a
            href="https://github.com/leonardochalhoub/applied_finance"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-strong"
          >
            github.com/leonardochalhoub/applied_finance
          </a>
          {" "}(MIT). Os cinco experimentos rodam interativamente nos tabs{" "}
          <a href={withBase("/markowitz/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">/markowitz</a>,{" "}
          <a href={withBase("/ingenuo/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">/ingenuo</a>,{" "}
          <a href={withBase("/kahneman/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">/kahneman</a>,{" "}
          <a href={withBase("/black-litterman/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">/black-litterman</a>{" "}
          e{" "}
          <a href={withBase("/paridade/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">/paridade</a>.
        </p>
      </section>

      <section className="card px-6 py-5 text-xs text-muted">
        <p>
          Código sob licença MIT; texto sob CC BY 4.0. Compilação:{" "}
          <span className="font-mono">.tex</span> via{" "}
          <span className="font-mono">latexmk -pdf</span> em CI (TeX Live
          Docker image, GitHub Actions). Timestamp + SHA do commit estampados
          na capa.
        </p>
      </section>
    </div>
  );
}
