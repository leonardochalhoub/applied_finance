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
        <div className="eyebrow">Capital Allocation Line (CAL)</div>
        <p className="mt-2 text-sm text-body">
          A reta tangente à fronteira no ponto de máximo Sharpe é a{" "}
          <strong>Capital Allocation Line</strong> (Tobin 1958, Sharpe 1964):{" "}
          <span className="mono">E[r] = rf + Sharpe_t × σ</span>. Mistura entre o
          ativo livre de risco e a carteira tangência. <strong>Não chamamos de CML</strong>{" "}
          (Capital Market Line) porque a CML, em sentido estrito CAPM, conecta{" "}
          <span className="mono">rf</span> à <em>carteira de mercado</em>, não à
          carteira tangência de um subconjunto amostral.
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
          <span className="mono">σ ≈ 30%</span>, o erro-padrão da média estimada é da
          ordem de <span className="mono">σ ≈ 30%</span> — ou seja, &quot;retorno esperado de
          10% ± 30%&quot; é estatisticamente indistinguível de &quot;retorno
          esperado de 0% ± 30%&quot;.
        </p>
        <p className="mt-2 text-sm text-body">
          DeMiguel, Garlappi e Uppal (2009, &quot;Optimal Versus Naive
          Diversification&quot;) mostram empiricamente que a carteira{" "}
          <strong>1/N</strong> (peso igual) frequentemente bate Markowitz
          out-of-sample exatamente por causa desse ruído. Tratamos isso com:
        </p>
        <ul className="mt-2 space-y-1 text-sm text-body">
          <li>• Shrinkage em Σ (Ledoit-Wolf, acima).</li>
          <li>• Shrinkage em μ (Jorion 1986, James-Stein) toward grand mean.</li>
          <li>
            • Bootstrap das alocações no advisor: só recomenda{" "}
            <em>vender/comprar/reduzir</em> se{" "}
            <span className="mono">|Δw| &gt; 2·σ_bootstrap</span> — caso contrário
            usa &quot;considerar&quot;.
          </li>
          <li>
            • Backtest walk-forward contra 1/N e IBOV (na tela do construtor).
          </li>
        </ul>
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
