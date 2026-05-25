import { IngenuoEquationCard } from "@/components/IngenuoEquationCard";
import { IngenuoView } from "@/components/IngenuoView";
import { loadCdi, loadIbov, loadPrices } from "@/lib/data";
import { withBase } from "@/lib/links";

export const dynamic = "force-static";

export const metadata = {
  title: "Ingênuo (1/N) vs Markowitz | Applied Finance",
  description:
    "Replicação do teste de DeMiguel, Garlappi & Uppal (2009): 14 datasets em que a carteira ingênua 1/N supera a otimização de Markowitz fora-da-amostra. Conexão com Kahneman (Nobel 2002) e a 'Ilusão de Skill'.",
};

export default async function IngenuoPage() {
  const [prices, ibov, cdi] = await Promise.all([loadPrices(), loadIbov(), loadCdi()]);
  if (!prices) {
    return (
      <p className="text-sm text-muted">
        Série de preços indisponível — aguarde o próximo refresh do pipeline.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <div className="eyebrow">Pesquisa aplicada · Diversificação ingênua</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          1/N supera Markowitz?
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Réplica do experimento de{" "}
          <a
            href="https://academic.oup.com/rfs/article-abstract/22/5/1915/1592901"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            DeMiguel, Garlappi &amp; Uppal (2009, RFS)
          </a>{" "}
          — &ldquo;Optimal Versus Naive Diversification: How Inefficient Is the
          1/N Portfolio Strategy?&rdquo; — em que 14 modelos de otimização
          falham em superar consistentemente a regra ingênua de peso igual
          fora-da-amostra. Aqui o mesmo teste é rodado sobre o universo
          brasileiro, com janela e conjunto de ativos configuráveis,
          comparando contra o pipeline Markowitz do tab{" "}
          <a href={withBase("/markowitz/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">
            /markowitz
          </a>{" "}
          — baseado em{" "}
          <a
            href="https://www.jstor.org/stable/2975974"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Markowitz (1952), &ldquo;Portfolio Selection&rdquo;, J. Finance
          </a>
          .
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          O enquadramento &ldquo;ilusão de skill&rdquo; é de{" "}
          <a
            href="https://us.macmillan.com/books/9780374533557/thinkingfastandslow"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Kahneman (2011), Thinking, Fast and Slow
          </a>
          {" "}—{" "}
          <a
            href="https://www.nobelprize.org/prizes/economic-sciences/2002/kahneman/facts/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Prêmio Nobel de Ciências Econômicas 2002
          </a>
          {" "}por integrar achados da psicologia à teoria econômica, em
          particular sobre julgamento e tomada de decisão sob incerteza.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-muted">
          Pais fundadores também premiados pelo Nobel:{" "}
          <a
            href="https://www.nobelprize.org/prizes/economic-sciences/1990/markowitz/facts/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Markowitz (1990)
          </a>{" "}
          ·{" "}
          <a
            href="https://www.nobelprize.org/prizes/economic-sciences/1990/sharpe/facts/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Sharpe (1990)
          </a>{" "}
          ·{" "}
          <a
            href="https://www.nobelprize.org/prizes/economic-sciences/2013/fama/facts/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Fama (2013)
          </a>{" "}
          — todos pelo trabalho pioneiro em economia financeira que sustenta
          (e desafia) a otimização de média-variância.
        </p>
      </header>

      <IngenuoEquationCard />

      <IngenuoView prices={prices} ibov={ibov} cdi={cdi} />
    </div>
  );
}
