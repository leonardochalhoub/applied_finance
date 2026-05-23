# Databricks notebook source
"""Build silver.mclean_firm_year (wide firm-year table) from bronze.cvm_dfp_lines.

Pivots the long-format DFP lines into one row per (cd_cvm, fiscal_year) with
the raw accounts needed for McLean (2011) variable construction, and joins the
sector registry. This is the canonical wide table consumed by downstream
silver.mclean_clean (filters + winsorize + computed variables) and the gold
regression notebooks.

Account mapping (non-financial firms, CPC IFRS chart of accounts):
    BPA  1            → ativo_total
         1.01.01      → cash (Caixa e Equivalentes de Caixa)
    BPP  2.01.04      → debt_cp (Empréstimos e Financiamentos curto prazo)
         2.02.01      → debt_lp (Empréstimos e Financiamentos longo prazo)
         2.03         → patrimonio_liquido
         2.03.04      → reserva_lucros
         2.03.05      → lucros_acumulados
    DRE  3.11/3.09    → lucro_liquido (consolidated net income — code drifts;
                        we match by description)
    DFC  6.01.01.*    → deprec_amort (sum of D&A sub-items)
    DFC  6.02.06      → venda_imobilizado (Other in McLean)
    DFC  6.03.04      → dividendos_pagos
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# COMMAND ----------
from pyspark.sql import Window
from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "finance_prd")
catalog = dbutils.widgets.get("catalog")

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.silver")

# Canonical non-financial labels — guards against the financial-firm chart of
# accounts which reuses the same CD_CONTA codes with different meanings.
NON_FINANCIAL_LABELS = {
    ("BPA", "1"):       "Ativo Total",
    ("BPA", "1.01.01"): "Caixa e Equivalentes de Caixa",
    ("BPP", "2.03"):    "Patrimônio Líquido Consolidado",
    ("BPP", "2.03.04"): "Reservas de Lucros",
    ("BPP", "2.03.05"): "Lucros/Prejuízos Acumulados",
}

DIRECT_PULLS = [
    # (statement, cd_conta, output_column, label_filter_or_None)
    ("BPA",    "1",        "ativo_total",         "Ativo Total"),
    ("BPA",    "1.01.01",  "cash",                "Caixa e Equivalentes de Caixa"),
    ("BPP",    "2.01.04",  "debt_cp",             None),   # 'Empréstimos e Financiamentos' (CP)
    ("BPP",    "2.02.01",  "debt_lp",             None),   # 'Empréstimos e Financiamentos' (LP)
    ("BPP",    "2.03",     "patrimonio_liquido",  "Patrimônio Líquido Consolidado"),
    ("BPP",    "2.03.04",  "reserva_lucros",      "Reservas de Lucros"),
    ("BPP",    "2.03.05",  "lucros_acumulados",   "Lucros/Prejuízos Acumulados"),
    ("DFC_MI", "6.02.06",  "venda_imobilizado",   None),
    ("DFC_MI", "6.03.04",  "dividendos_pagos",    None),
]

lines = spark.table(f"{catalog}.bronze.cvm_dfp_lines")

# Authoritative-row filter — each fiscal_year value can come from two places:
#   (a) ÚLTIMO row in the matching-year zip  → source_year_file == fiscal_year
#   (b) PENÚLTIMO row in the next-year zip   → source_year_file == fiscal_year + 1
# Anything else is a restated/back-published row that may carry a different
# `vl_norm` than the firm's definitive filing; pinning to (a)/(b) prevents
# later zips from silently overwriting authoritative earlier-year values.
# Including (b) also lets us recover fy=YEAR_MIN-1 (e.g. fy=2009 from the 2010
# zip) so the lag-based dCash for fy=YEAR_MIN survives downstream — otherwise
# the earliest fiscal year is always dropped for lack of a prior observation.
authoritative = lines.where(
    ((F.col("ordem_exerc") == "ÚLTIMO")    & (F.col("source_year_file") == F.col("fiscal_year"))) |
    ((F.col("ordem_exerc") == "PENÚLTIMO") & (F.col("source_year_file") == F.col("fiscal_year") + 1))
)

# Dedupe within (cd_cvm, fiscal_year, statement, cd_conta) — prefer ÚLTIMO over
# PENÚLTIMO (firm's definitive filing wins), break ties by highest VERSAO
# (latest restatement). `last` is the deduped frame consumed below.
_pref = F.when(F.col("ordem_exerc") == "ÚLTIMO", 0).otherwise(1)
_w_dedup = Window.partitionBy("cd_cvm", "fiscal_year", "statement", "cd_conta").orderBy(
    _pref.asc(),
    F.col("versao").desc_nulls_last(),
    F.col("ingested_at").desc(),
)
last = (
    authoritative
    .withColumn("_rn", F.row_number().over(_w_dedup))
    .where(F.col("_rn") == 1)
    .drop("_rn")
)

# Build one column per (statement, cd_conta) value via filtered aggregation.
acc_exprs = [F.col("cd_cvm"), F.col("fiscal_year")]
for stmt, cd, out_col, label in DIRECT_PULLS:
    cond = (F.col("statement") == stmt) & (F.col("cd_conta") == cd)
    if label is not None:
        cond = cond & (F.trim(F.col("ds_conta")) == label)
    acc_exprs.append(F.max(F.when(cond, F.col("vl_norm"))).alias(out_col))

# Net Income — bottom-line consolidated profit. The code (3.09 vs 3.11 vs 3.13)
# drifts year-to-year so we match by description, taking the top-level code
# only (depth = 0 dots) so we don't pick a sub-attribution row.
ni_descriptions = (
    "lucro/prejuízo consolidado do período",
    "lucro/prejuízo do período",
    "resultado líquido do período",
)
ni_cond = (
    (F.col("statement") == "DRE")
    & (F.lower(F.trim(F.col("ds_conta"))).isin(*ni_descriptions))
    & (F.length(F.col("cd_conta")) - F.length(F.regexp_replace(F.col("cd_conta"), r"\.", "")) <= 1)
)
acc_exprs.append(F.max(F.when(ni_cond, F.col("vl_norm"))).alias("lucro_liquido"))

# Depreciation & Amortization — sub-items inside 6.01.01 whose description
# matches deprec/amort/exaust. We sum, not max, because firms sometimes split
# D&A across two lines.
da_cond = (
    (F.col("statement") == "DFC_MI")
    & (F.col("cd_conta").startswith("6.01.01"))
    & (
        F.lower(F.col("ds_conta")).contains("deprec")
        | F.lower(F.col("ds_conta")).contains("amortiz")
        | F.lower(F.col("ds_conta")).contains("exaust")
    )
)
acc_exprs.append(F.sum(F.when(da_cond, F.col("vl_norm"))).alias("deprec_amort"))

# Denom_cia: keep the most-recent name (sorted alphabetically inside the year).
acc_exprs.append(F.max(F.col("denom_cia")).alias("denom_cia"))

wide = last.groupBy("cd_cvm", "fiscal_year").agg(*acc_exprs[2:])

# Join sector from bronze.cvm_cad_cia
cad = spark.table(f"{catalog}.bronze.cvm_cad_cia").select("cd_cvm", "sector", "sector_raw")
wide = wide.join(cad, on="cd_cvm", how="left")

# Materialize
(
    wide
    .write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .partitionBy("fiscal_year")
    .saveAsTable(f"{catalog}.silver.mclean_firm_year")
)
n = spark.table(f"{catalog}.silver.mclean_firm_year").count()
log.info(f"silver.mclean_firm_year → {n:,} firm-year rows")
dbutils.jobs.taskValues.set(key="silver_mclean_firm_year_rows", value=n)
