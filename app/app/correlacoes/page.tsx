import { CorrelationsView } from "@/components/CorrelationsView";
import { loadCorrelations, loadKpis, loadPrices } from "@/lib/data";

export const dynamic = "force-static";

export default async function CorrelacoesPage() {
  const [precomputed, prices, kpis] = await Promise.all([
    loadCorrelations(),
    loadPrices(),
    loadKpis(),
  ]);
  if (!precomputed || !prices || !kpis) {
    return <p className="text-sm text-muted">Correlações não disponíveis ainda.</p>;
  }
  return <CorrelationsView prices={prices} kpis={kpis} precomputed={precomputed} />;
}
