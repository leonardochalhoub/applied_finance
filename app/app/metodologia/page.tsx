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
          aplicada em <span className="mono">lib/markowitz.ts</span> dentro de{" "}
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
          nosso (~38 tickers B3), o nome técnico é CAL. Mantemos os dois
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
          <span className="mono">lib/markowitz.ts → ledoitWolf()</span>. A
          intensidade δ* estimada é exposta na UI.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Long-only via QP convexo</div>
        <p className="mt-2 text-sm text-body">
          Restrições <span className="mono">w_i ≥ 0</span> resolvidas via solver QP{" "}
          puro-JS (active-set com KKT explícito). Substituiu uma heurística greedy
          anterior que podia parar em soluções subótimas para Σ mal-condicionada.
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
          Para <span className="mono">N ≈ 38</span> tickers e janelas de 1–5
          anos, <span className="mono">ψ*</span> tipicamente cai em{" "}
          <span className="mono">[0.3, 0.8]</span> — quanto menor T e maior
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
          <strong>α é adaptativo em T</strong>: janelas curtas (alto erro de
          estimação) recebem ancoragem mais forte, janelas longas confiam
          mais nos dados. Rampa linear ancorada em{" "}
          <span className="mono">(0,5 ano → α = 0,90)</span> e{" "}
          <span className="mono">(10 anos → α = 0,50)</span>, com piso{" "}
          <span className="mono">0,30</span> e teto <span className="mono">0,95</span>:
        </p>
        <div className="mt-2 rounded-md bg-[color:var(--bg-base)] px-4 py-3">
          <BlockMath
            ariaLabel="alfa de T igual a clip entre 0,30 e 0,95 de 0,90 menos 0,042 vezes T anos menos 0,5"
            tex={String.raw`\alpha(T_{\text{anos}}) \;=\; \mathrm{clip}\!\left[\,0.90 - 0.042\,(T_{\text{anos}} - 0.5),\;\; 0.30,\;\; 0.95\,\right]`}
          />
        </div>
        <p className="mt-2 text-sm text-body">
          Comportamento indicativo: <span className="mono">α(6m) ≈ 0,90</span>,{" "}
          <span className="mono">α(1y) ≈ 0,88</span>,{" "}
          <span className="mono">α(3y) ≈ 0,80</span>,{" "}
          <span className="mono">α(5y) ≈ 0,71</span>,{" "}
          <span className="mono">α(10y) ≈ 0,50</span>. ERP fixo em{" "}
          <InlineMath tex={String.raw`6\%`} /> — estimativa de Damodaran para
          Brasil emergente (ver{" "}
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
        <div className="eyebrow">Visualização — teto do eixo Y</div>
        <p className="mt-2 text-sm text-body">
          O eixo de retorno esperado da fronteira é fixado em{" "}
          <strong>0% até 35% a.a.</strong> Após a stack de shrinkage acima, o
          máximo Sharpe realista para o universo B3 fica em{" "}
          <span className="mono">rf + σ_mkt ≈ 18–25%</span>; qualquer ponto
          tocando o teto de 35% já está na cauda direita e merece suspeita.
          Ativos individuais com retorno esperado acima desse teto são{" "}
          <em>visualmente descartados</em> (não removidos do cálculo) para
          que o canvas se dedique à região onde a fronteira efetivamente vive.
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
