export const dynamic = "force-static";

export default function MetodologiaPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <header>
        <div className="eyebrow">Metodologia</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Como os KPIs são calculados</h1>
        <p className="mt-1 text-sm text-muted">
          Todas as fórmulas vivem em dois lugares simultaneamente: o notebook
          Python que produz a Gold e o módulo TypeScript do frontend.
        </p>
      </header>

      <section className="card px-6 py-5">
        <div className="eyebrow">Fonte de dados</div>
        <p className="mt-2 text-sm text-body">
          Preços de fechamento ajustados (splits + proventos) vêm do Yahoo
          Finance via <span className="mono">yfr_py</span>, porta Python do pacote R{" "}
          <span className="mono">msperlin/yfR</span>. A camada Bronze armazena tanto o preço bruto
          (<span className="mono">price_close</span>) quanto o ajustado
          (<span className="mono">price_adjusted</span>) para preservar auditoria sobre 26 anos de
          eventos corporativos.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Formula
          name="Retorno YTD"
          body="ln(close_ult / close_primeiro_dia_util_ano)"
        />
        <Formula
          name="Volatilidade anualizada"
          body="std(retornos_log_diarios) × √252"
        />
        <Formula
          name="Drawdown máximo"
          body="min((P − cummax(P)) / cummax(P))"
        />
        <Formula
          name="Sharpe vs CDI"
          body="(retorno_anualizado − CDI_anual) / vol_anualizada"
        />
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Janelas de covariância</div>
        <p className="mt-2 text-sm text-body">
          A Gold publica três matrizes de covariância anualizadas: 1 ano (252
          dias úteis), 5 anos (1 260 dias) e janela completa. Tickers sem
          cobertura total na janela são excluídos e listados em{" "}
          <span className="mono">valid_tickers_&lt;janela&gt;.json</span>.
        </p>
      </section>

      <section className="card px-6 py-5">
        <div className="eyebrow">Limitações conhecidas</div>
        <ul className="mt-2 space-y-2 text-sm text-body">
          <li>
            <span className="kpi-negative">·</span> A taxa CDI usada no Sharpe é
            constante de build (parametrizada via widget no notebook). Integração
            com a série BCB SGS chega na Fase 2.
          </li>
          <li>
            <span className="kpi-negative">·</span> Para tickers com IPO posterior
            a 2000, a janela &quot;full&quot; reflete apenas o histórico
            disponível.
          </li>
          <li>
            <span className="kpi-negative">·</span> Ajustes Yahoo são confiáveis
            para a maioria dos eventos, mas grupamentos (bonificações) podem ter
            pequenas discrepâncias vs B3 oficial.
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
