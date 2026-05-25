import { BlackLittermanEquationCard } from "@/components/BlackLittermanEquationCard";
import { BlackLittermanView } from "@/components/BlackLittermanView";
import { loadCdi, loadIbov, loadPrices } from "@/lib/data";
import { withBase } from "@/lib/links";

export const dynamic = "force-static";

export const metadata = {
  title: "Black-Litterman (1992) — Markowitz Bayesiano | Applied Finance",
  description:
    "Implementação do modelo Black-Litterman: ancora μ ao equilíbrio de mercado (Π = δΣw) e mistura suas crenças (views) com confiança explícita. Resolve as patologias do Markowitz clássico apontadas por DeMiguel-Garlappi-Uppal (2009).",
};

export default async function BlackLittermanPage() {
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
        <div className="eyebrow">Pesquisa aplicada · Markowitz Bayesiano</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Black-Litterman (1992)
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Implementação do modelo de{" "}
          <a
            href="https://www.tandfonline.com/doi/abs/10.2469/faj.v48.n5.28"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-strong underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Black &amp; Litterman (1992, FAJ)
          </a>{" "}
          — &ldquo;Global Portfolio Optimization&rdquo;. Trabalho original
          desenvolvido na Goldman Sachs Fixed Income Research. A ideia é
          conserta o Markowitz clássico fazendo duas coisas: (1) usar como
          prior <em>não</em> a média amostral μ̂, mas a vetor de retornos{" "}
          <em>implícitos pelo equilíbrio de mercado</em>{" "}
          <span className="mono">Π = δΣw_mkt</span> (o μ que tornaria a
          carteira de mercado ótima na média-variância); (2) misturar essa
          prior com as <em>views</em> do gestor — opiniões bayesianas com
          grau de confiança explícito.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-muted">
          Resolve diretamente os problemas levantados em{" "}
          <a href={withBase("/ingenuo/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">
            /ingenuo
          </a>{" "}
          (DGU 2009 — μ̂ amostral é instável) e em{" "}
          <a href={withBase("/kahneman/")} className="underline decoration-dotted underline-offset-2 hover:text-strong">
            /kahneman
          </a>{" "}
          (Kahneman — μ̂ amostral confunde sorte com skill). Sem views ⇒ μ_BL
          = Π, a tangência é a própria carteira de mercado — &ldquo;quando você
          não tem opinião, fique com o índice&rdquo;. Com views ⇒ o
          posterior tilta suavemente proporcional à confiança declarada.
        </p>
      </header>

      <BlackLittermanEquationCard />

      <BlackLittermanView prices={prices} ibov={ibov} cdi={cdi} />
    </div>
  );
}
