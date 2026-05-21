export const dynamic = "force-static";

export default function MetodologiaPage() {
  return (
    <article className="prose prose-neutral max-w-none">
      <h1 className="text-2xl font-semibold">Metodologia</h1>

      <h2 className="mt-6 text-lg font-semibold">Fonte de dados</h2>
      <p className="text-sm">
        Preços de fechamento ajustados (splits + proventos) vêm do Yahoo Finance via{" "}
        <code className="font-mono">yfr_py</code>, uma porta Python do pacote R{" "}
        <code className="font-mono">msperlin/yfR</code>. A camada Bronze armazena tanto o
        preço bruto (<code>price_close</code>) quanto o ajustado (<code>price_adjusted</code>)
        para preservar auditoria sobre 26 anos de eventos corporativos.
      </p>

      <h2 className="mt-6 text-lg font-semibold">Fórmulas</h2>
      <ul className="text-sm">
        <li>
          <strong>Retorno YTD:</strong> <code>ln(close_ult / close_primeiro_dia_util_ano)</code>
        </li>
        <li>
          <strong>Volatilidade anualizada:</strong>{" "}
          <code>std(retornos_log_diarios) × √252</code>
        </li>
        <li>
          <strong>Drawdown máximo:</strong>{" "}
          <code>min((P − max_acumulado(P)) / max_acumulado(P))</code>
        </li>
        <li>
          <strong>Sharpe vs CDI:</strong>{" "}
          <code>(retorno_anualizado − CDI_anual) / vol_anualizada</code>
        </li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold">Janelas de covariância</h2>
      <p className="text-sm">
        A Gold publica três matrizes de covariância anualizadas: 1 ano (252 dias úteis), 5
        anos (1 260 dias) e janela completa. Tickers sem cobertura total na janela são
        excluídos e listados em <code>valid_tickers_&lt;janela&gt;.json</code>.
      </p>

      <h2 className="mt-6 text-lg font-semibold">Limitações conhecidas</h2>
      <ul className="text-sm">
        <li>
          A taxa CDI usada no Sharpe é uma constante de build (parametrizada via widget no
          notebook). A integração com a série BCB SGS chega na Fase 2.
        </li>
        <li>
          Para tickers com IPO posterior a 2000, a janela &quot;full&quot; reflete apenas o
          histórico disponível.
        </li>
        <li>
          Ajustes Yahoo são confiáveis para a maioria dos eventos, mas grupamentos
          (bonificações) podem ter pequenas discrepâncias vs B3 oficial.
        </li>
      </ul>
    </article>
  );
}
