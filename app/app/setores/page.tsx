import { SectorsView } from "@/components/SectorsView";
import { loadKpis, loadPrices, loadSectors } from "@/lib/data";

export const dynamic = "force-static";

export default async function SectorsPage() {
  const [sectors, prices, kpis] = await Promise.all([
    loadSectors(),
    loadPrices(),
    loadKpis(),
  ]);
  if (!sectors || !prices || !kpis) {
    return <p className="text-sm text-muted">Setores não disponíveis ainda.</p>;
  }

  return (
    <div className="space-y-10">
      <header>
        <div className="eyebrow">Comparação setorial</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Setores</h1>
        <p className="mt-1 text-sm text-muted">
          Média simples do retorno log dos componentes de cada setor, com janelas configuráveis.
        </p>
      </header>

      <SectorsView kpis={kpis} sectorsSnapshot={sectors} prices={prices} />
    </div>
  );
}
