import { BlockMath, InlineMath } from "@/components/Math";

export const dynamic = "force-static";

export default function MetodologiaPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <header>
        <div className="eyebrow">Metodologia</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Fórmulas, convenções e limitações
        </h1>
        <p className="mt-1 text-sm text-muted">
          Todas as fórmulas vivem em dois lugares simultaneamente: o notebook
          Python que produz a Gold e o módulo TypeScript do frontend. Esta
          página documenta as escolhas feitas e as suas consequências práticas.
        </p>
      </header>

      <section className="card px-6 py-5">
        <div className="eyebrow">Fonte de dados</div>
        <p className="mt-2 text-sm text-body">
          Preços de fechamento ajustados (splits + proventos) vêm do Yahoo
          Finance via <span className="mono">yfr_py</span>, porta Python do pacote R{" "}
          <span className="mono">msperlin/yfR</span>. A camada Bronze armazena tanto o preço
          bruto (<span className="mono">price_close</span>) quanto o ajustado
          (<span className="mono">price_adjusted</span>) para preservar auditoria sobre 26 anos
          de eventos corporativos.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Formula name="Retorno YTD" body="ln(close_ult / close_primeiro_dia_util_ano)" />
        <Formula name="Volatilidade anualizada" body="std(retornos_log_diarios) × √252" />
        <Formula name="Drawdown máximo" body="min((P − cummax(P)) / cummax(P))" />
        <Formula name="Sharpe vs CDI" body="(retorno_anualizado − CDI_anual) / vol_anualizada" />
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Convenção de retornos — log vs simples</div>
        <p className="mt-2 text-sm text-body">
          Usamos <strong>log-retornos diários</strong>{" "}
          <span className="mono">r_log = ln(P_t / P_{"{t-1}"})</span> para estimação porque
          são (i) aproximadamente Gaussianos sob hipóteses leves e (ii)
          aditivos no tempo. Markowitz, porém, é formulado em{" "}
          <strong>retornos simples</strong>{" "}
          <span className="mono">r_simp = P_t/P_{"{t-1}"} − 1</span>, que são os únicos aditivos{" "}
          <em>entre ativos</em> (retorno da carteira = soma ponderada).
        </p>
        <p className="mt-2 text-sm text-body">
          Para fechar essa lacuna aplicamos a{" "}
          <strong>correção de Jensen</strong> antes de anualizar:
        </p>
        <div className="mono mt-2 rounded-md bg-[color:var(--bg-base)] px-3 py-2 text-xs text-strong">
          μ_simples ≈ μ_log + σ²_diag / 2
        </div>
        <p className="mt-2 text-sm text-muted">
          Sem essa correção, com vol anualizada σ ≈ 30%, o viés é da ordem de{" "}
          <span className="mono">σ²/2 ≈ 4,5%</span> a.a. — magnitude maior que o equity premium
          brasileiro e maior que a intensidade de shrinkage de Σ. A correção é
          aplicada em <span className="mono">lib/mvEstimators.ts</span> dentro de{" "}
          <span className="mono">jensenCorrectMu</span>.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Markowitz analítico (Merton 1972)</div>
        <p className="mt-2 text-sm text-body">
          A fronteira eficiente é resolvida em forma fechada via Lagrangianos com
          matriz <span className="mono">A = 𝟙ᵀΣ⁻¹𝟙</span>,{" "}
          <span className="mono">B = 𝟙ᵀΣ⁻¹μ</span>,{" "}
          <span className="mono">C = μᵀΣ⁻¹μ</span>,{" "}
          <span className="mono">D = AC − B²</span>. Para retorno-alvo{" "}
          <span className="mono">r</span>:
        </p>
        <div className="mono mt-2 rounded-md bg-[color:var(--bg-base)] px-3 py-2 text-xs text-strong">
          w(r) = λ·Σ⁻¹𝟙 + γ·Σ⁻¹μ &nbsp;&nbsp; λ = (C − rB)/D &nbsp;&nbsp; γ = (rA − B)/D
        </div>
        <p className="mt-2 text-sm text-body">
          Carteira de <strong>mínima variância</strong>:{" "}
          <span className="mono">w_mv = Σ⁻¹𝟙 / A</span>. Carteira{" "}
          <strong>tangência</strong> (máximo Sharpe):{" "}
          <span className="mono">w_t = Σ⁻¹(μ − rf𝟙) / 𝟙ᵀΣ⁻¹(μ − rf𝟙)</span>.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">CAL / Linha do Mercado de Capitais (CML)</div>
        <p className="mt-2 text-sm text-body">
          A reta tangente à fronteira no ponto de máximo Sharpe é a{" "}
          <strong>Capital Allocation Line (CAL)</strong> — também chamada de{" "}
          <strong>linha do mercado de capitais (CML)</strong> na tradição de{" "}
          Tobin (1958) e Sharpe (1964):
        </p>
        <div className="mt-3 rounded-md bg-[color:var(--bg-base)] px-4 py-3">
          <BlockMath
            ariaLabel="E de r igual a rf mais Sharpe da tangência vezes sigma"
            tex={String.raw`E[r] \;=\; r_f \;+\; \mathrm{Sharpe}_{T}\cdot\sigma`}
          />
        </div>
        <p className="mt-2 text-sm text-body">
          A inclinação da reta é precisamente o índice de Sharpe da carteira de
          tangência (preço de mercado do risco). Geometricamente, a CAL/CML
          domina toda alternativa <em>buy-and-hold</em> em ativos isolados:
          qualquer ponto abaixo da reta é, por construção, mean-variance
          dominado.
        </p>
        <p className="mt-2 text-xs text-muted">
          Nota de terminologia: em ortodoxia CAPM estrita, &ldquo;CML&rdquo;
          designa especificamente a reta entre <span className="mono">rf</span>{" "}
          e a carteira <em>de mercado</em> (todos os ativos investíveis,
          pesados por capitalização). Para um subconjunto amostral como o
          nosso (subset de tickers B3), o nome técnico é CAL. Mantemos os dois
          rótulos porque, na prática brasileira, &ldquo;linha do mercado de
          capitais&rdquo; é o termo mais usado e o conceito é o mesmo: a
          fronteira ampliada por <span className="mono">rf</span>.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Shrinkage da matriz de covariância</div>
        <p className="mt-2 text-sm text-body">
          Aplicamos <strong>Ledoit-Wolf (2004)</strong> com alvo de{" "}
          <em>correlação constante</em>:
        </p>
        <div className="mono mt-2 rounded-md bg-[color:var(--bg-base)] px-3 py-2 text-xs text-strong">
          Σ̂ = δ* · F + (1 − δ*) · S
        </div>
        <p className="mt-2 text-sm text-body">
          onde <span className="mono">S</span> é a covariância amostral,{" "}
          <span className="mono">F</span> é o alvo estruturado de correlação
          constante e <span className="mono">δ*</span> é a intensidade ótima{" "}
          <em>data-driven</em> (não hardcoded). Implementação em{" "}
          <span className="mono">lib/mvEstimators.ts → ledoitWolf()</span>. A
          intensidade δ* estimada é exposta na UI.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Long-only via projeção gradiente</div>
        <p className="mt-2 text-sm text-body">
          Restrições <span className="mono">w_i ≥ 0</span> resolvidas por{" "}
          <em>projeção iterativa</em>: a partir da solução analítica
          unconstrained (Merton), zera-se o peso mais negativo, remove-se
          o ativo do problema e re-resolve no sub-espaço — repete até que
          todos os pesos remanescentes sejam não-negativos e somem 1.
          Implementação em <span className="mono">lib/markowitz.ts</span>{" "}
          (funções <span className="mono">_longOnly</span> e <span className="mono">_longOnlyForTarget</span>). Não é
          um solver QP completo: a abordagem é uma heurística greedy
          (active-set sem KKT explícito) — para o tamanho do nosso problema
          (N ≈ 40 tickers, Σ Ledoit-Wolf bem-condicionada) ela coincide com
          a solução QP exata em quase todos os casos práticos. Para Σ
          singular ou pathologicamente mal-condicionada não há garantia
          teórica de optimalidade.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Erro de estimação de μ e Σ</div>
        <p className="mt-2 text-sm text-body">
          Mean-variance é{" "}
          <strong>extremamente sensível a erro de estimação em μ</strong>{" "}
          (Merton 1980, &quot;On Estimating the Expected Return on the Market&quot;).
          Para uma janela de <em>1 ano</em> de retornos diários com vol anual{" "}
          <span className="mono">σ ≈ 30%</span>, o erro-padrão da média anualizada é:
        </p>
        <div className="mt-2 rounded-md bg-[color:var(--bg-base)] px-4 py-3">
          <BlockMath
            ariaLabel="erro-padrão da mu anualizada igual a sigma anualizada dividido por raiz de T em anos"
            tex={String.raw`\mathrm{SE}\!\left(\hat{\mu}_{\text{ann}}\right) \;=\; \frac{\sigma_{\text{ann}}}{\sqrt{T_{\text{anos}}}}`}
          />
        </div>
        <p className="mt-2 text-sm text-body">
          Ou seja, &quot;retorno esperado de 10% ± 30%&quot; é estatisticamente
          indistinguível de &quot;retorno esperado de 0% ± 30%&quot;. Pior: a
          fronteira de Markowitz é{" "}
          <strong>uma estatística de máxima ordem</strong> — concentra-se
          sempre no ativo que <em>teve mais sorte</em> na amostra, então o
          máximo de N estimativas ruidosas é viesado para cima mesmo com T
          grande. DeMiguel, Garlappi e Uppal (2009, &quot;Optimal Versus Naive
          Diversification&quot;) mostram empiricamente que a carteira{" "}
          <strong>1/N</strong> (peso igual) frequentemente bate Markowitz
          out-of-sample exatamente por isso. Combatemos com a stack descrita
          abaixo.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Stack de shrinkage em μ — Jorion + macro-prior</div>
        <p className="mt-2 text-sm text-body">
          A μ usada na visualização e nas carteiras sugeridas passa por{" "}
          <strong>duas camadas</strong> de shrinkage aplicadas em sequência.
          Sem elas, o gráfico mostra retornos esperados em torno de 50–100%
          a.a. (puro ruído amplificado pelo viés do máximo). Com elas, o
          gráfico aterrissa na faixa realista <span className="mono">[rf, rf + σ_mkt]</span>.
        </p>

        <div className="mt-3 text-[11px] uppercase tracking-wider text-muted">
          Estágio 1 · Bayes-Stein (Jorion 1986)
        </div>
        <p className="mt-1 text-sm text-body">
          Encolhe cada <span className="mono">μ̂_i</span> em direção à{" "}
          <strong>média grand</strong>{" "}
          <span className="mono">μ_g = (𝟙ᵀΣ⁻¹μ̂)/(𝟙ᵀΣ⁻¹𝟙)</span> (retorno da
          carteira de mínima variância) com intensidade{" "}
          <em>data-driven</em> <span className="mono">ψ*</span>:
        </p>
        <div className="mt-2 rounded-md bg-[color:var(--bg-base)] px-4 py-3">
          <BlockMath
            ariaLabel="mu Bayes-Stein igual a um menos psi vezes mu chapéu mais psi vezes mu grand vezes vetor um"
            tex={String.raw`\hat{\boldsymbol{\mu}}_{\text{BS}} \;=\; (1-\psi^{*})\,\hat{\boldsymbol{\mu}} \;+\; \psi^{*}\,\mu_g\,\mathbf{1}, \qquad \psi^{*} = \frac{\lambda}{1+\lambda}, \quad \lambda = \frac{N+2}{T\,(\hat{\boldsymbol{\mu}}-\mu_g\mathbf{1})^{\!\top}\Sigma^{-1}(\hat{\boldsymbol{\mu}}-\mu_g\mathbf{1})}`}
          />
        </div>
        <p className="mt-2 text-sm text-body">
          Para nosso universo (~60–80 tickers B3) e janelas de 1–5
          anos, <span className="mono">ψ̂</span> bruto satura próximo de 1
          (o numerador N+2 domina T·quad com Σ Ledoit-Wolf bem-condicionado),
          o que colapsaria todo <span className="mono">μ</span> para{" "}
          <span className="mono">μ_g</span> e tornaria max-Sharpe ≡ min-variância
          em qualquer janela. Aplicamos um teto explícito{" "}
          <span className="mono">ψ ≤ 0,50</span> em{" "}
          <span className="mono">lib/mvEstimators.ts → jorionShrinkMu()</span>{" "}
          para preservar metade do sinal cross-sectional do{" "}
          <span className="mono">μ̂</span> bruto. Quanto menor T e maior
          dispersão de <span className="mono">μ̂</span>, mais o estimador é
          encolhido. Implementação em{" "}
          <span className="mono">lib/mvEstimators.ts → jorionShrinkMu()</span>.
          O valor de <span className="mono">ψ*</span> efetivamente aplicado é
          exposto no badge da tela de Sugestões.
        </p>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          Estágio 2 · Macro-anchor (rf + ERP)
        </div>
        <p className="mt-1 text-sm text-body">
          Mesmo após Jorion, a <em>própria</em>{" "}
          <span className="mono">μ_g</span> herda o viés do máximo (se um
          setor rallyou no período, ele puxa <span className="mono">μ_g</span>{" "}
          junto). O estágio 2 encolhe{" "}
          <span className="mono">μ̂_BS</span> em direção a{" "}
          <strong>(rf + ERP)·𝟙</strong> — um <em>prior macro</em> ancorado
          no equity risk premium de longo prazo, independente do que aconteceu
          na janela:
        </p>
        <div className="mt-2 rounded-md bg-[color:var(--bg-base)] px-4 py-3">
          <BlockMath
            ariaLabel="mu final igual a um menos alfa vezes mu Bayes-Stein mais alfa vezes rf mais ERP vezes vetor um"
            tex={String.raw`\boxed{\;\boldsymbol{\mu}_{\text{final}} \;=\; (1-\alpha)\,\hat{\boldsymbol{\mu}}_{\text{BS}} \;+\; \alpha\,(r_f + \mathrm{ERP})\,\mathbf{1}\;}`}
          />
        </div>
        <p className="mt-2 text-sm text-body">
          <strong>α(T) é em forma de U</strong> — dois problemas diferentes
          tornam <span className="mono">μ̂</span> pouco confiável em extremos
          opostos de <span className="mono">T</span>:
        </p>
        <ul className="mt-1 space-y-1 text-sm text-body">
          <li>
            • <strong>Janelas curtas (T ≲ 5 a)</strong>: <em>ruído de máximo
            de N</em>. <span className="mono">SE(μ̂_anual) ∝ σ/√T</span> é
            enorme, o ativo escolhido pelo max-Sharpe é simplesmente aquele
            com mais sorte na amostra, μ̂ pode explodir para{" "}
            <span className="mono">+60–100%</span> mesmo após Jorion.
          </li>
          <li>
            • <strong>Janelas longas (T ≳ 10 a)</strong>: <em>universo
            esparso e instável</em>. O filtro de cobertura 100% reduz o
            número de tickers (de ~80 no IBOV recente para ~14 com cobertura
            de 26 anos). Esse subconjunto não é necessariamente uma amostra
            de &ldquo;vencedores&rdquo; — o Yahoo Finance preserva tickers
            que ainda negociam, vencedores E perdedores (no nosso universo
            com cobertura completa de 26 anos a média transversal de{" "}
            <span className="mono">μ̂</span> está <em>abaixo</em> do CDI).
            Mas com tão poucos pontos, μ̂ depende fortemente de qual mix
            específico sobreviveu, não da distribuição estrutural do mercado.
            O prior macro <span className="mono">rf + ERP</span> é um
            estimador independente da realização amostral, e em janelas
            longas com universo esparso é genuinamente mais informativo do
            que a média da amostra.
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-muted">
          NB: esta justificativa é deliberadamente diferente da intuição
          clássica de &ldquo;survivorship bias = só sobrevivem vencedores&rdquo;
          típica de bases tipo CRSP. Em B3 via Yahoo, o universo de cobertura
          completa contém perdedores também — o problema é a <em>esparsidade
          e instabilidade do universo</em>, não viés direcional de
          sobreviventes. A correção (puxar para o prior macro) é a mesma; o
          motivo é diferente.
        </p>
        <p className="mt-2 text-sm text-body">
          Operacionalmente, tomamos o <strong>máximo</strong> de duas pernas
          lineares (ruído + sobrevivência), com piso 0,55 e teto 0,95:
        </p>
        <div className="mt-2 rounded-md bg-[color:var(--bg-base)] px-4 py-3">
          <BlockMath
            ariaLabel="alfa de T igual a clip entre 0,55 e 0,95 do máximo entre a perna de ruído e a perna de esparsidade"
            tex={String.raw`\alpha(T_{\text{anos}}) \;=\; \mathrm{clip}\!\left[\,\max\!\big(\underbrace{0.95 - 0.04\,(T-0.5)_{+}}_{\text{ruído}},\;\; \underbrace{0.55 + 0.035\,(T-10)_{+}}_{\text{esparsidade}}\big),\;\; 0.55,\;\; 0.95\,\right]`}
          />
        </div>
        <p className="mt-2 text-sm text-body">
          Comportamento indicativo: <span className="mono">α(6m) ≈ 0,95</span>,{" "}
          <span className="mono">α(1y) ≈ 0,93</span>,{" "}
          <span className="mono">α(5y) ≈ 0,77</span>,{" "}
          <span className="mono">α(10y) ≈ 0,57</span>,{" "}
          <span className="mono">α(15y) ≈ 0,73</span>,{" "}
          <span className="mono">α(20y) ≈ 0,90</span>,{" "}
          <span className="mono">α(MAX) = 0,95</span> (teto).
        </p>
        <p className="mt-2 text-sm text-body">
          ERP fixo em <InlineMath tex={String.raw`6\%`} /> — estimativa de
          Damodaran 2026 para Brasil emergente (ver{" "}
          <a
            href="https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-strong"
          >
            Damodaran &ldquo;Country Risk Premium&rdquo;
          </a>
          ). Para a taxa CDI atual (<span className="mono">rf ≈ 12–15%</span>), o
          âncora fica em <span className="mono">18–21%</span> — o teto natural
          das expectativas de retorno realistas para uma carteira de ações
          brasileiras.
        </p>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          Estágio 3 · Teto por ativo (sanity bound estilo Black-Litterman)
        </div>
        <p className="mt-1 text-sm text-body">
          Após os dois estágios anteriores, ainda capamos cada{" "}
          <span className="mono">μ_i</span> individualmente em{" "}
          <span className="mono">rf + 3·ERP</span> — nenhum ativo isolado pode{" "}
          <em>esperar</em> mais que três equity-risk-premia de excesso. Com{" "}
          <span className="mono">rf = 13%</span> e <span className="mono">ERP = 6%</span>,
          o teto fica em <span className="mono">31%</span> — estritamente{" "}
          <em>acima</em> do CAGR de longo prazo do Ibovespa em BRL nominal e
          estritamente <em>abaixo</em> da cauda direita de janelas rolantes de
          5 anos. Impede que um único sobrevivente outlier domine a esquina
          max-Sharpe.
        </p>
        <p className="mt-2 text-[11px] text-muted">
          Calibração dos constantes <span className="mono">K=3</span>,{" "}
          <span className="mono">ERP=6%</span> e da curva α(T) é justificada
          em <strong>Calibração empírica</strong> abaixo, com as fontes que
          ancoram cada decisão.
        </p>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          Por que duas camadas?
        </div>
        <p className="mt-1 text-sm text-body">
          Jorion sozinho lida com a <em>dispersão entre ativos</em> (todos
          encolhidos toward o mesmo ponto). O macro-anchor lida com a{" "}
          <em>localização absoluta</em> desse ponto (que o Brasil dos últimos
          5–10 anos não dita o equity premium estrutural). Aplicadas juntas,
          extraem informação <em>relativa</em> entre tickers dos dados (Jorion
          preserva ranking) mas <em>ancoram o nível</em> em teoria (macro
          prior). O resultado é uma fronteira que se parece muito mais com o
          que livros-texto de CAPM emergente esperam (<span className="mono">σ ≈ 25%</span>,{" "}
          <span className="mono">E[r] ≈ rf + 5–8%</span>) e muito menos com
          uma anedota de momentum recente.
        </p>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          Outras defesas contra ruído (já em produção)
        </div>
        <ul className="mt-1 space-y-1 text-sm text-body">
          <li>
            • <strong>Σ</strong>: Ledoit-Wolf 2004 com alvo de correlação
            constante (seção acima).
          </li>
          <li>
            • <strong>Bootstrap das alocações</strong> no advisor: só recomenda{" "}
            <em>vender/comprar/reduzir</em> se{" "}
            <span className="mono">|Δw| &gt; 2·σ_bootstrap</span>; caso
            contrário usa &ldquo;considerar&rdquo;.
          </li>
          <li>
            • <strong>Backtest walk-forward</strong> contra 1/N e B3 no
            construtor — sanidade out-of-sample.
          </li>
          <li>
            • <strong>Outlier guards</strong> em retornos diários (ver seção
            abaixo) eliminam ticks corrompidos antes da estimação.
          </li>
        </ul>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Calibração empírica — benchmarks e decisões</div>
        <p className="mt-2 text-sm text-body">
          Toda a stack de shrinkage acima introduz três constantes
          (<span className="mono">α(T)</span>, <span className="mono">ERP=6%</span>,
          <span className="mono">K=3</span>). Esta seção documenta as fontes
          empíricas consultadas e a decisão de calibração derivada de cada
          uma. O objetivo: produzir um <em>intervalo defensável</em> para o
          retorno esperado de uma carteira max-Sharpe long-only de ações
          brasileiras, ancorado em dados públicos, e demonstrar que a stack
          rejeita números fora desse intervalo independentemente do tamanho da
          janela <span className="mono">T</span>.
        </p>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          1 · Retornos históricos do Ibovespa (BRL nominal)
        </div>
        <ul className="mt-1 space-y-1 text-sm text-body">
          <li>
            • <strong>50 anos (1968–2019)</strong>:{" "}
            <span className="mono">≈ 11,7%/a nominal</span> em USD;{" "}
            <span className="mono">≈ 6,9%/a real</span> em BRL após IGPDI. (
            <a
              href="https://insight.economatica.com/desempenho-do-ibovespa-50-anos-de-historia/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-strong"
            >
              Economatica — 50 anos do Ibovespa
            </a>
            )
          </li>
          <li>
            • <strong>20 anos (1999–2009)</strong>:{" "}
            <span className="mono">CAGR ≈ 10,0%/a nominal</span> e{" "}
            <span className="mono">≈ 3,6%/a real</span>.
          </li>
          <li>
            • <strong>25 anos (2000–2024)</strong>:{" "}
            <span className="mono">CAGR ≈ 8,1%/a nominal</span> vs CDI{" "}
            <span className="mono">≈ 13%/a</span> — equity premium realizado{" "}
            <em>negativo</em> no Brasil pós-Plano Real, pelo regime de juros
            altos. (
            <a
              href="https://clubedospoupadores.com/carteira-investimentos/tabela.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-strong"
            >
              Clube dos Poupadores — CDI, Bolsa e Dólar 2000–2024
            </a>
            )
          </li>
          <li>
            • <strong>5 anos rolante</strong>: melhor{" "}
            <span className="mono">≈ 40%/a</span>, pior{" "}
            <span className="mono">≈ −9%/a</span> — caudas do índice em
            janelas curtas, <em>realizadas</em>, não esperadas{" "}
            <em>ex ante</em>.
          </li>
          <li>
            • <strong>Média aritmética 1968–2019</strong>:{" "}
            <span className="mono">21,3%/a</span> com{" "}
            <span className="mono">σ ≈ 67%/a</span> — inflada pela
            hiperinflação dos anos 80–90 e por ser aritmética (não geométrica).
            Não usada como referência. (
            <a
              href="https://www.bcb.gov.br/pec/wps/ingl/wps525.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-strong"
            >
              BCB WP 525 — Long-term stock returns in Brazil
            </a>
            )
          </li>
        </ul>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          2 · Equity Risk Premium forward
        </div>
        <ul className="mt-1 space-y-1 text-sm text-body">
          <li>
            • <strong>Damodaran 2026 — ERP Brasil</strong>:{" "}
            <span className="mono">≈ 6%/a</span> acima da rf (composição:
            ERP maduro + spread de risco-país). (
            <a
              href="https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-strong"
            >
              Damodaran — Country Risk Premiums
            </a>
            ,{" "}
            <a
              href="https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6361419"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-strong"
            >
              ERP 2026 Edition
            </a>
            )
          </li>
          <li>
            • <strong>Buffett-indicator forward Brasil</strong>:{" "}
            <span className="mono">≈ 12,3%/a</span> nominal esperado
            (decomposição: crescimento PIB local 6,0% + dividend yield 4,5% +
            reversão do múltiplo 1,8%). Concordância de ordem com Damodaran
            em <span className="mono">rf ≈ 6,3% + ERP ≈ 6%</span>.
          </li>
          <li>
            • <strong>Fundos de ações brasileiros</strong>: a maioria
            sub-performa o CDI no longo prazo; somente <span className="mono">~1%</span>{" "}
            é consistente. Reforça que o forward realista de uma carteira{" "}
            <em>curada</em> de ações dificilmente excede <span className="mono">rf + ERP</span>.
            (
            <a
              href="https://neofeed.com.br/wealth-management/a-dura-vida-dos-fundos-de-acoes-so-1-tem-resultado-consistente-no-longo-prazo/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-strong"
            >
              NeoFeed — fundos de ações
            </a>
            )
          </li>
        </ul>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          3 · Banda defensável de E[r] para max-Sharpe long-only B3
        </div>
        <p className="mt-1 text-sm text-body">
          Sintetizando: para uma carteira <em>curada</em> long-only de ações
          brasileiras com shrinkage adequado, o retorno esperado deve cair em
        </p>
        <div className="mt-2 rounded-md bg-[color:var(--bg-base)] px-4 py-3">
          <BlockMath
            ariaLabel="E de r pertence a rf mais 4 por cento até rf mais 10 por cento"
            tex={String.raw`\mathrm{E}[r_{\text{port}}] \;\in\; \big[\,r_f + 4\%,\;\; r_f + 10\%\,\big] \;\approx\; \big[17\%,\;23\%\big] \;\;\text{(regime CDI atual)}`}
          />
        </div>
        <ul className="mt-2 space-y-1 text-sm text-body">
          <li>
            • <strong>≤ 17%</strong>: stack super-encolheu (provável quando T
            curto e dispersão amostral baixa).
          </li>
          <li>
            • <strong>17–23%</strong>: zona alvo — coerente com Damodaran ERP
            forward e com a banda CAPM emergente padrão.
          </li>
          <li>
            • <strong>23–27%</strong>: aceitável se o regime de juros estiver
            elevado e a carteira inclinada a low-vol.
          </li>
          <li>
            • <strong>27–31%</strong>: começa a cheirar a overfit ao período
            in-sample. <strong>≥ 31%</strong>: cortado por construção
            (Estágio 3, teto <span className="mono">K=3</span>).
          </li>
        </ul>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          4 · Decisões de calibração (e por quê)
        </div>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="py-1 pr-3">Constante</th>
                <th className="py-1 pr-3">Valor</th>
                <th className="py-1">Fonte / racional</th>
              </tr>
            </thead>
            <tbody className="text-body">
              <tr className="border-t border-border align-top">
                <td className="py-2 pr-3"><span className="mono">ERP</span></td>
                <td className="py-2 pr-3"><span className="mono">6%/a</span></td>
                <td className="py-2">Damodaran 2026 para Brasil emergente. Compatível com a
                decomposição Buffett-indicator forward. Mantido fixo (não estimado
                em-amostra) para impedir que regimes de juros recentes capturem o
                prior estrutural.</td>
              </tr>
              <tr className="border-t border-border align-top">
                <td className="py-2 pr-3"><span className="mono">α(T)</span></td>
                <td className="py-2 pr-3">U-shape, piso 0,55, teto 0,95</td>
                <td className="py-2">
                  Forma em U porque dois problemas opostos tornam μ̂ pouco confiável
                  em extremos de T: <strong>ruído de máximo</strong> (T curto, SE(μ̂)
                  ∝ σ/√T enorme) e <strong>universo esparso/instável</strong> (T longo,
                  cobertura completa filtra a maioria dos tickers — o prior macro
                  é genuinamente mais informativo que a média de uma amostra de ~14
                  sobreviventes mistos vencedores/perdedores). Curva calibrada para
                  que <em>nenhuma janela</em> entregue μ_g fora da banda{" "}
                  <span className="mono">[17%, 27%]</span> nas séries
                  Yahoo Finance 1999–presente do IBOV.
                </td>
              </tr>
              <tr className="border-t border-border align-top">
                <td className="py-2 pr-3"><span className="mono">K</span></td>
                <td className="py-2 pr-3">3</td>
                <td className="py-2">
                  Teto por ativo em <span className="mono">rf + K·ERP</span>. K=3 ⇒ 31% no
                  regime atual — estritamente <em>acima</em> do CAGR de longo prazo do
                  Ibov (11,7%) e <em>abaixo</em> da cauda direita 5y rolante (40%).
                  Inspirado em Black-Litterman: views &ldquo;razoáveis&rdquo; ficam
                  dentro de 3 desvios do prior estrutural. K=2 cortaria sinais
                  legítimos de momentum em janelas médias; K=4 deixa passar
                  artefatos de sobrevivência.
                </td>
              </tr>
              <tr className="border-t border-border align-top">
                <td className="py-2 pr-3">Filtro de tickers</td>
                <td className="py-2 pr-3">cobertura 100% na janela</td>
                <td className="py-2">
                  Decisão consciente: <strong>introduz viés de sobrevivência</strong>{" "}
                  em janelas longas. Mantido porque o alternativo (imputar preços
                  faltantes) é pior — corromperia Σ. O Estágio 2 com α(T) crescente
                  para T grande é exatamente a compensação principled.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          5 · Caso forense — como o bug se manifestava
        </div>
        <p className="mt-1 text-sm text-body">
          Antes da U-shape de α(T) e do teto K=3 (commit anterior),
          janelas longas produziam:
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="py-1 pr-3">Janela</th>
                <th className="py-1 pr-3">α antigo</th>
                <th className="py-1 pr-3">E[r] antigo</th>
                <th className="py-1 pr-3">α novo</th>
                <th className="py-1">E[r] esperado</th>
              </tr>
            </thead>
            <tbody className="text-body">
              <tr className="border-t border-border"><td className="py-1 pr-3">6M</td><td className="py-1 pr-3">0,90</td><td className="py-1 pr-3">+27,1%</td><td className="py-1 pr-3">0,95</td><td className="py-1">~25–27%</td></tr>
              <tr className="border-t border-border"><td className="py-1 pr-3">1Y</td><td className="py-1 pr-3">0,88</td><td className="py-1 pr-3">+24,1%</td><td className="py-1 pr-3">0,93</td><td className="py-1">~22–23%</td></tr>
              <tr className="border-t border-border"><td className="py-1 pr-3">5Y</td><td className="py-1 pr-3">0,71</td><td className="py-1 pr-3">+22,2%</td><td className="py-1 pr-3">0,77</td><td className="py-1">~21–22%</td></tr>
              <tr className="border-t border-border"><td className="py-1 pr-3">10Y</td><td className="py-1 pr-3">0,50</td><td className="py-1 pr-3">+26,7%</td><td className="py-1 pr-3">0,57</td><td className="py-1">~25%</td></tr>
              <tr className="border-t border-border"><td className="py-1 pr-3">15Y</td><td className="py-1 pr-3">0,30 (piso)</td><td className="py-1 pr-3">+23,3%</td><td className="py-1 pr-3">0,73</td><td className="py-1">~21%</td></tr>
              <tr className="border-t border-border"><td className="py-1 pr-3">20Y</td><td className="py-1 pr-3">0,30 (piso)</td><td className="py-1 pr-3 text-[color:var(--loss)]">+73,6% ⚠</td><td className="py-1 pr-3">0,90</td><td className="py-1">~26–28%</td></tr>
              <tr className="border-t border-border"><td className="py-1 pr-3">MAX</td><td className="py-1 pr-3">0,30 (piso)</td><td className="py-1 pr-3 text-[color:var(--loss)]">+109,6% ⚠</td><td className="py-1 pr-3">0,95 (teto)</td><td className="py-1">~25–27%</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm text-body">
          A álgebra do bug: em 20Y com α piso=0,30, o universo de
          sobreviventes entregava <span className="mono">μ_BS ≈ 97%</span>
          (Jorion não consegue ajustar porque <em>todos</em> os sobreviventes
          estão na cauda direita). Então{" "}
          <span className="mono">μ_final = 0,70·97 + 0,30·19 = 73,6%</span>{" "}
          — exatamente o número observado. O novo α(20Y) ≈ 0,90 produz{" "}
          <span className="mono">0,10·97 + 0,90·19 ≈ 27%</span>, e o teto K=3
          em 31% garante que qualquer ativo individual viesado também é
          cortado.
        </p>

        <div className="mt-4 text-[11px] uppercase tracking-wider text-muted">
          6 · O que esta calibração <em>não</em> faz
        </div>
        <ul className="mt-1 space-y-1 text-sm text-body">
          <li>
            • Não substitui dados ajustados por inflação — todas as séries
            são nominais em BRL. Para análise real, usar IGPDI ou IPCA por fora.
          </li>
          <li>
            • Não corrige o viés de sobrevivência <em>do universo</em>{" "}
            (apenas seu impacto no μ). Tickers que faliram ou foram
            descontinuados nunca entram no IBOV histórico via Yahoo Finance.
          </li>
          <li>
            • Não é uma previsão. O âncora <span className="mono">rf + ERP</span>{" "}
            é um <em>prior estrutural</em>, não um forecast — a fronteira
            sempre vai variar com a janela mesmo após shrinkage.
          </li>
        </ul>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Visualização — eixos dinâmicos</div>
        <p className="mt-2 text-sm text-body">
          Os eixos da fronteira eficiente são <strong>totalmente data-driven</strong>:
          não há piso nem teto fixo. Cada eixo é ajustado ao envelope dos
          pontos efetivamente desenhados (curva da fronteira, mín. variância,
          máx. Sharpe, marcadores de carteira, P2–P98 da nuvem, rf e poupança)
          com margem uniforme (10% no Y, 8% no X). O resultado é um canvas que
          se re-enquadra de forma estética sob qualquer janela temporal. Ativos
          individuais cujas coordenadas caem fora desse enquadramento são{" "}
          <em>visualmente omitidos</em> (não removidos do cálculo) para manter
          o foco onde a fronteira efetivamente vive.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Reprodutibilidade — PRNG seeded</div>
        <p className="mt-2 text-sm text-body">
          A nuvem Monte Carlo da fronteira e os reamostradores do bootstrap
          usam <strong>mulberry32</strong> com semente fixa{" "}
          <span className="mono">0xCAFEFEED</span> (ver{" "}
          <span className="mono">lib/prng.ts</span>). Isso garante que dois
          carregamentos da mesma página com os mesmos parâmetros produzem
          exatamente a mesma nuvem e o mesmo intervalo de confiança do
          bootstrap — um screenshot é reproduzível, e a gating do advisor em{" "}
          <span className="mono">|Δw| &gt; 2·σ_bootstrap</span> não pode mudar
          entre <em>reloads</em> sem dados novos. Para forçar reamostragem
          estocástica (testes A/B de robustez), passe{" "}
          <span className="mono">rng: mulberry32(Date.now())</span> nas funções{" "}
          <span className="mono">buildFrontier</span> e{" "}
          <span className="mono">bootstrapMaxSharpe</span>.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Bootstrap — cobertura efetiva (Beff)</div>
        <p className="mt-2 text-sm text-body">
          O bootstrap em <span className="mono">bootstrapMaxSharpe</span>{" "}
          executa B resamples e <strong>pula</strong> iterações em que a
          optimização não converge (sem substituir por 1/N, que enviesaria a
          σ_bootstrap para baixo e relaxaria a gate de significância do
          advisor). O retorno expõe <span className="mono">B = Beff</span>{" "}
          (contagem efetiva); o advisor detecta o caso degenerado{" "}
          <span className="mono">Beff = 0</span> (todos os σ exatamente zero)
          e suprime verbos fortes (vender / comprar / reduzir) com um aviso
          dedicado de &ldquo;Bootstrap sem cobertura&rdquo;. Isso impede
          recomendações fortes em ruído quando o bootstrap não consegue
          calibrar.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Fallback de pesos iguais — sinal visível</div>
        <p className="mt-2 text-sm text-body">
          Se o solver long-only greedy esgota todos os ativos sem produzir
          uma carteira não-negativa válida (caso típico: todos os μ acabam
          abaixo do rf após a stack de shrinkage em uma janela degenerada),
          <span className="mono">buildFrontier</span> retorna{" "}
          <span className="mono">isEqualWeightFallback: true</span> e a UI
          exibe um banner vermelho em cima do gráfico avisando que a
          &ldquo;máx. Sharpe&rdquo; mostrada é equal-weight, não o ponto
          analítico de tangência. Esse fallback substitui o antigo
          comportamento silencioso de retornar um vetor zero.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Janelas de covariância</div>
        <p className="mt-2 text-sm text-body">
          A Gold publica matrizes de covariância anualizadas para 1Y, 5Y, 10Y, 15Y,
          20Y e janela completa. Tickers sem cobertura total na janela são
          excluídos e listados em{" "}
          <span className="mono">valid_tickers_&lt;janela&gt;.json</span>.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Outlier guards</div>
        <p className="mt-2 text-sm text-body">
          Log-retornos diários com <span className="mono">|r| &gt; 0,5</span> (≈
          65% de variação em um dia) e log-retornos de janela com{" "}
          <span className="mono">|r| &gt; 3</span> são descartados como
          corrupção upstream (caso real: UGPA3 com close de R$ 3.302.500 em
          2007-05-07 no Yahoo).
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Limitações declaradas</div>
        <ul className="mt-2 space-y-2 text-sm text-body">
          <li>
            <span className="kpi-negative">·</span> Cobertura limitada a IBOV +
            tickers complementares B3 (~120 ativos), não cobre Small Caps.
          </li>
          <li>
            <span className="kpi-negative">·</span> Sem custos de transação, IR,
            ou turnover. Os pesos sugeridos são alocações teóricas
            single-period.
          </li>
          <li>
            <span className="kpi-negative">·</span> Sem ajuste por regimes — B3
            tem quebras estruturais (2016, 2020, 2024) que violam IID. Janelas
            mais longas atenuam mas não eliminam.
          </li>
          <li>
            <span className="kpi-negative">·</span> CDI em BRL nominal,
            consistente com retornos em BRL nominal. Para leitor que pensa em
            USD, considerar inflação BRL/USD.
          </li>
          <li>
            <span className="kpi-negative">·</span> &quot;Análise da carteira&quot;
            é determinística (sem LLM) e baseada em comparação ponto-a-ponto com
            o tangency portfolio do snapshot. Não constitui recomendação de
            investimento.
          </li>
        </ul>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Referências</div>
        <ul className="mt-2 space-y-2 text-sm text-body">
          <li>
            • Markowitz, H. (1952). &quot;Portfolio Selection&quot;.{" "}
            <em>Journal of Finance</em>, 7(1), 77–91.
          </li>
          <li>
            • Tobin, J. (1958). &quot;Liquidity Preference as Behavior Towards
            Risk&quot;. <em>Review of Economic Studies</em>.
          </li>
          <li>
            • Sharpe, W. (1964). &quot;Capital Asset Prices&quot;.{" "}
            <em>Journal of Finance</em>, 19(3), 425–442.
          </li>
          <li>
            • Merton, R. (1972). &quot;An Analytic Derivation of the Efficient
            Portfolio Frontier&quot;. <em>JFQA</em>, 7(4), 1851–1872.
          </li>
          <li>
            • Merton, R. (1980). &quot;On Estimating the Expected Return on the
            Market&quot;. <em>Journal of Financial Economics</em>, 8, 323–361.
          </li>
          <li>
            • Jorion, P. (1986). &quot;Bayes-Stein Estimation for Portfolio
            Analysis&quot;. <em>JFQA</em>, 21(3), 279–292.
          </li>
          <li>
            • Michaud, R. (1998). <em>Efficient Asset Management</em>. Boston: HBR
            Press. (Resampled efficiency.)
          </li>
          <li>
            • Ledoit, O. and Wolf, M. (2004). &quot;Honey, I Shrunk the Sample
            Covariance Matrix&quot;. <em>JPM</em>, 30(4), 110–119.
          </li>
          <li>
            • DeMiguel, V., Garlappi, L., Uppal, R. (2009). &quot;Optimal Versus
            Naive Diversification: How Inefficient Is the 1/N Portfolio
            Strategy?&quot;. <em>RFS</em>, 22(5), 1915–1953.
          </li>
        </ul>
      </section>
    </article>
  );
}

function Formula({ name, body }: { name: string; body: string }) {
  return (
    <div className="card px-5 py-4">
      <div className="eyebrow">{name}</div>
      <div className="mono mt-3 break-words text-sm text-strong">{body}</div>
    </div>
  );
}
