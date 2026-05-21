import { HomeShell } from "@/components/HomeShell";
import { loadCdi, loadIbov, loadKpis, loadPrices, loadPricesClose, loadSectors } from "@/lib/data";

export const dynamic = "force-static";

export default async function HomePage() {
  const [kpis, sectors, ibov, prices, closes, cdi] = await Promise.all([
    loadKpis(),
    loadSectors(),
    loadIbov(),
    loadPrices(),
    loadPricesClose(),
    loadCdi(),
  ]);

  if (!kpis || !sectors || !ibov || !prices) {
    return (
      <div className="card mx-auto max-w-2xl px-6 py-10 text-center">
        <h1 className="text-xl font-semibold">Aguardando primeiro refresh</h1>
        <p className="mt-2 text-sm text-muted">
          O lakehouse ainda não publicou os artefatos. Os dados aparecem aqui
          após o primeiro deploy do pipeline diário (~22:00 BRT em dias úteis).
        </p>
      </div>
    );
  }

  return (
    <HomeShell
      kpis={kpis}
      sectors={sectors}
      ibov={ibov}
      prices={prices}
      closes={closes}
      cdi={cdi}
    />
  );
}
