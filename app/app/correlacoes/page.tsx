import { CorrelationHeatmap } from "@/components/CorrelationHeatmap";
import { loadCorrelations } from "@/lib/data";

export const dynamic = "force-static";

export default async function CorrelacoesPage() {
  const data = await loadCorrelations().catch(() => null);
  if (!data) {
    return <p className="text-sm text-muted">Correlações não disponíveis ainda.</p>;
  }
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Mapa de correlações</h1>
        <p className="mt-1 text-sm text-muted">
          Janela {data.window_label} · log-retornos diários adjusted-close.
        </p>
      </header>
      <div className="grid gap-8 lg:grid-cols-2">
        <CorrelationHeatmap pairs={data.top_correlated} title="Mais correlacionados" />
        <CorrelationHeatmap pairs={data.top_anti_correlated} title="Mais anti-correlacionados" />
      </div>
    </div>
  );
}
