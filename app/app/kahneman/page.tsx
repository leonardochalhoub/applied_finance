import { KahnemanEquationCard } from "@/components/KahnemanEquationCard";
import { KahnemanView } from "@/components/KahnemanView";
import { loadCdi, loadIbov, loadPrices } from "@/lib/data";
import { withBase } from "@/lib/links";

export const dynamic = "force-static";

export const metadata = {
  title: "Kahneman — Ilusão de Skill e distribuição de Sharpe aleatório | Applied Finance",
  description:
    "Réplica empírica do argumento 'Illusion of Skill' de Daniel Kahneman (Nobel de Ciências Econômicas 2002, Thinking Fast and Slow 2011): histograma de Sharpe realizada em milhares de carteiras long-only sorteadas, contra a Sharpe que Markowitz prometeu ex-ante e a que entregou ex-post.",
};

export default async function KahnemanPage() {
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
        <div className="eyebrow">Pesquisa aplicada · Kahneman, ilusão de skill</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Kahneman — a Sharpe é sorte?
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Em 1984{" "}
          <a
            href="https://www.nobelprize.org/prizes/economic-sciences/2002/kahneman/facts/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Daniel Kahneman (Prêmio Nobel 2002)
          </a>{" "}
          recebeu de uma firma de wealth management 25 anos de avaliações
          individuais dos seus 28 consultores. Esperando ver{" "}
          <em>persistência de talento</em>, calculou a correlação entre o
          ranking de retorno de cada consultor em pares de anos consecutivos.
          O número médio de 28×27/2 = 378 pares: <strong>0,01</strong>. Em{" "}
          <a
            href="https://us.macmillan.com/books/9780374533557/thinkingfastandslow"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Thinking, Fast and Slow (2011)
          </a>{" "}
          ele batizou o fato de <em>The Illusion of Skill</em>: a indústria
          financeira recompensa um talento que não existe. Performance
          ano-a-ano é indistinguível de sorte.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Este tab traduz essa tese numa imagem. Sorteamos milhares de
          carteiras <em>long-only</em> uniformemente no simplex (o
          &ldquo;macaco atirando dardos&rdquo; de{" "}
          <a
            href="https://wwnorton.com/books/9780393358384"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Malkiel (1973)
          </a>
          ), avaliamos cada uma na <em>janela de teste</em> (out-of-sample), e
          desenhamos o histograma. Sobre esse histograma marcamos quatro
          carteiras nomeadas — a Sharpe que o otimizador Markowitz{" "}
          <em>prometeu</em> com base na janela de treino (ex-ante), a Sharpe
          que <em>entregou</em> ao usar os mesmos pesos no teste (ex-post),
          o 1/N (peso igual) e a mediana dos sorteios. Se a barra ex-ante
          mora no percentil 80 e a ex-post no percentil 50, a diferença é
          uma medida quantitativa da <em>ilusão</em>: o gestor parecia ter
          skill quando só teve sorte na amostra.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-muted">
          Complementa o tab{" "}
          <a href={withBase("/ingenuo/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">
            /ingenuo (1/N vs Markowitz)
          </a>{" "}
          — DeMiguel-Garlappi-Uppal mostra o problema <em>matemático</em>
          {" "}(erro de estimativa em μ̂ e Σ̂); aqui Kahneman documenta o
          problema <em>comportamental</em> (o gestor é remunerado como se
          tivesse skill, mas sua Sharpe ex-post vive na cauda da distribuição
          aleatória).
        </p>
      </header>

      <KahnemanEquationCard />

      <KahnemanView prices={prices} ibov={ibov} cdi={cdi} />
    </div>
  );
}
