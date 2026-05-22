import { FinOpsView } from "@/components/FinOpsView";
import { loadFinops } from "@/lib/data";

export const dynamic = "force-static";

export const metadata = {
  title: "FinOps — Custo da plataforma | Applied Finance",
  description:
    "Quanto custou rodar a plataforma Applied Finance desde o primeiro dia. Cada DBU, " +
    "cada job, cada centavo — ledger granular extraído de system.billing.* + " +
    "system.lakeflow.*, filtrado por custom_tags.team='applied-finance'.",
};

export default async function FinopsPage() {
  const data = await loadFinops();
  if (!data) {
    return (
      <div className="space-y-6">
        <header>
          <div className="eyebrow">FinOps · governança de custo</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Quanto custou rodar o Applied Finance
          </h1>
        </header>
        <p className="text-sm text-muted">
          Dados de FinOps ainda não foram gerados. Rode a sub-DAG{" "}
          <code className="rounded bg-[color:var(--bg-subtle)] px-1.5 py-0.5 text-[11px]">
            silver_finops_* → gold_finops_* → export_finops_summary
          </code>{" "}
          no Databricks para popular{" "}
          <code className="rounded bg-[color:var(--bg-subtle)] px-1.5 py-0.5 text-[11px]">
            app/public/data/finops_summary.json
          </code>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <div className="eyebrow">FinOps · governança de custo · 100% do histórico</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Quanto custou rodar o Applied Finance
        </h1>
        <p className="mt-1 text-sm text-muted">
          Cada DBU consumida e cada centavo desde o primeiro dia da plataforma — ledger
          granular extraído das system tables do Databricks (
          <code className="text-[11px]">system.billing.*</code> +{" "}
          <code className="text-[11px]">system.lakeflow.*</code>), filtrado para o
          catálogo <code className="text-[11px]">{data.catalog}</code>.
        </p>
      </header>

      <FinOpsView data={data} />
    </div>
  );
}
