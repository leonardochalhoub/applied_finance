import { ParidadeEquationCard } from "@/components/ParidadeEquationCard";
import { RiskParityView } from "@/components/RiskParityView";
import { loadCdi, loadIbov, loadPrices } from "@/lib/data";
import { withBase } from "@/lib/links";

export const dynamic = "force-static";

export const metadata = {
  title: "Paridade de Risco (ERC) — Maillard-Roncalli-Teïletche (2010) | Applied Finance",
  description:
    "Implementação do portfólio de paridade de risco (Equal Risk Contribution): cada ativo contribui igualmente para o risco total. A alternativa que joga fora μ — Maillard, Roncalli & Teïletche (2010, JPM).",
};

export default async function ParidadePage() {
  const [prices, ibov, cdi] = await Promise.all([loadPrices(), loadIbov(), loadCdi()]);
  if (!prices || !ibov) {
    return (
      <p className="text-sm text-muted">
        Série de preços ou composição do IBOV indisponíveis — aguarde o próximo
        refresh do pipeline.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <div className="eyebrow">Pesquisa aplicada · Paridade de risco</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Paridade de Risco (ERC)
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Implementação do portfólio de <strong>Equal Risk Contribution
          (ERC)</strong> de{" "}
          <a
            href="https://www.pm-research.com/content/iijpormgmt/36/4/60"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Maillard, Roncalli &amp; Teïletche (2010, JPM)
          </a>
          {" "}— &ldquo;The Properties of Equally Weighted Risk Contribution
          Portfolios&rdquo;. A ideia central: dada a fragilidade de μ̂
          documentada em{" "}
          <a href={withBase("/ingenuo/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">
            /ingenuo
          </a>{" "}
          e{" "}
          <a href={withBase("/kahneman/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">
            /kahneman
          </a>
          , por que tentar estimar retornos esperados? Use só Σ. Atribua peso
          a cada ativo de modo que cada um contribua{" "}
          <em>igualmente</em> para a variância da carteira — ninguém domina o
          risco, ninguém é desperdiçado.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-muted">
          Filosoficamente: <strong>1/N de variância</strong> em vez de 1/N de
          dólares. O All-Weather de Bridgewater (Ray Dalio, ≈ 1996) é o
          exemplo mais famoso. A versão analítica para o caso multi-asset
          (não só estoque vs bond) foi formalizada por{" "}
          <a
            href="https://www.crcpress.com/Introduction-to-Risk-Parity-and-Budgeting/Roncalli/p/book/9781482207156"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-strong"
          >
            Roncalli (2013), Introduction to Risk Parity and Budgeting
          </a>
          .
        </p>
      </header>

      <ParidadeEquationCard />

      <RiskParityView prices={prices} ibov={ibov} cdi={cdi} />
    </div>
  );
}
