import { CorrelationGrid } from "@/components/CorrelationGrid";
import { CorrelationHeatmap } from "@/components/CorrelationHeatmap";
import { loadCorrelations } from "@/lib/data";

export const dynamic = "force-static";

export default async function CorrelacoesPage() {
  const data = await loadCorrelations();
  if (!data) {
    return <p className="text-sm text-muted">Correlações não disponíveis ainda.</p>;
  }
  const allPairs = [...data.top_correlated, ...data.top_anti_correlated];

  return (
    <div className="space-y-10">
      <header>
        <div className="eyebrow">Janela {data.window_label}</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Mapa de correlações
        </h1>
        <p className="mt-1 text-sm text-muted">
          Correlação dos log-retornos diários (adjusted close), janela{" "}
          {data.window_label}. Mais verde = mais correlacionados; mais vermelho =
          mais anti-correlacionados.
        </p>
      </header>

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="eyebrow">Grid (top 24 tickers por atividade)</span>
        </div>
        <CorrelationGrid pairs={allPairs} size={24} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <CorrelationHeatmap pairs={data.top_correlated.slice(0, 15)} title="Mais correlacionados" />
        <CorrelationHeatmap
          pairs={data.top_anti_correlated.slice(0, 15)}
          title="Mais anti-correlacionados"
        />
      </section>
    </div>
  );
}
