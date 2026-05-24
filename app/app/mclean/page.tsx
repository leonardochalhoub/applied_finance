import { McLeanView } from "@/components/McLeanView";
import { loadMcLean } from "@/lib/data";

export const dynamic = "force-static";

export const metadata = {
  title: "McLean (2011) — Replicação | Applied Finance",
  description:
    "Replicação do modelo de Chalhoub, Kirch & Terra (2015, RBFin) sobre as fontes de caixa retido das firmas listadas na BM&FBovespa, usando dados abertos da CVM (2010–2025).",
};

export default async function McLeanPage() {
  const data = await loadMcLean();
  if (!data) {
    return (
      <p className="text-sm text-muted">
        Resultados da replicação McLean não disponíveis. Rode o pipeline em{" "}
        <code>pipelines/notebooks/mclean/</code> para gerar{" "}
        <code>app/public/data/mclean_results.json</code>.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <div className="eyebrow">Pesquisa aplicada</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Modelo de McLean
        </h1>
        <p className="mt-1 text-sm text-muted">
          Réplica do paper publicado na RBFin (2015) sobre as fontes do caixa retido pelas firmas
          listadas na BM&FBovespa, estendida para o período pós-2013 com dados abertos da CVM.
        </p>
      </header>

      <McLeanView data={data} />
    </div>
  );
}
