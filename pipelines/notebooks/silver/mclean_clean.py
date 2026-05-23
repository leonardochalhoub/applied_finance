# Databricks notebook source
"""Build silver.mclean_clean from silver.mclean_firm_year.

Steps (matching Chalhoub-Kirch-Terra 2015 § 3.3 + § 3.4):

  1) Compute aggregates: debt_total = debt_cp + debt_lp,
     reserva_plus_la = reserva_lucros + lucros_acumulados,
     cashflow_raw = lucro_liquido + deprec_amort.
  2) Lag (t-1) by firm to enable first-difference and AT_{t-1}-normalized
     flow variables.
  3) Construct the 6 McLean variables (Cash, ΔCash, ΔIssue, ΔDebt, CashFlow,
     Other, Assets) plus debt splits (ΔDebtCP, ΔDebtLP) and Q-friendly fields.
  4) Apply paper filters: drop financials (by SETOR_ATIV), keep only firm-years
     with AT_t > R$ 200k AND AT_{t-1} > R$ 200k AND YoY ΔAT ≤ +100%, drop nulls
     in the regression core.
  5) Winsorize 1% both tails, except CashFlow (2.5%-left / 1%-right).

Output keyed by (cd_cvm, fiscal_year). Partitioned by fiscal_year.
"""
# COMMAND ----------
import logging

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

# COMMAND ----------
from pyspark.sql import Window
from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "finance_prd")
# Cap silver to the last FULLY-FILED fiscal year. 2025 zips ship while many
# firms are still mid-filing — the partial cohort skews the winsorization
# quantiles (Cashflow flipped sign, dCash collapsed near 0 in the May 2026
# refresh after the panel was extended to 2025). The downstream gold notebooks
# already cap their regression window at this value; the filter here keeps the
# winsorization quantiles consistent with what gold actually sees.
dbutils.widgets.text("max_fiscal_year", "2024")
catalog          = dbutils.widgets.get("catalog")
MAX_FISCAL_YEAR  = int(dbutils.widgets.get("max_fiscal_year"))

FINANCIAL_SECTORS = [
    "Bancos",
    "Intermediação Financeira",
    "Arrendamento Mercantil",
    "Securitização de Recebíveis",
    "Seguradoras e Corretoras",
    "Crédito Imobiliário",
]
AT_THRESHOLD     = 200_000.0   # BRL
DAT_CAP          = 1.0         # +100% YoY asset growth cap (paper spec)
WINS_LO          = 0.01
WINS_HI          = 0.01
WINS_LO_CF       = 0.025       # CashFlow has a fatter left tail per paper

REG_CORE_VARS = ["dCash", "dIssue", "dDebt", "Cashflow", "Other", "Assets"]
WINS_VARS_STD = ["Cash", "dCash", "dIssue", "dDebt", "dDebtCP", "dDebtLP", "Other", "Dividends"]

src = (
    spark.table(f"{catalog}.silver.mclean_firm_year")
    .where(F.col("fiscal_year") <= MAX_FISCAL_YEAR)
)

# Step 1: aggregates
src = (
    src
    .withColumn("debt_total",      F.coalesce(F.col("debt_cp"), F.lit(0.0)) + F.coalesce(F.col("debt_lp"), F.lit(0.0)))
    .withColumn("reserva_plus_la", F.coalesce(F.col("reserva_lucros"), F.lit(0.0)) + F.coalesce(F.col("lucros_acumulados"), F.lit(0.0)))
    .withColumn("cashflow_raw",    F.coalesce(F.col("lucro_liquido"), F.lit(0.0)) + F.coalesce(F.col("deprec_amort"), F.lit(0.0)))
)

# Step 2: per-firm lags (t-1)
w = Window.partitionBy("cd_cvm").orderBy("fiscal_year")
for col in ["ativo_total", "cash", "debt_total", "debt_cp", "debt_lp", "patrimonio_liquido", "reserva_plus_la"]:
    src = src.withColumn(f"{col}_lag", F.lag(F.col(col)).over(w))

# Step 3: McLean variables
# IMPORTANT: compute dCash BEFORE Cash. Spark SQL is case-insensitive by
# default, so `withColumn("Cash", ...)` overwrites the lowercase `cash` raw
# BRL column — any subsequent `F.col("cash")` then resolves to the freshly-
# computed Cash ratio (≈0.05), not the original ~10⁹ BRL value. Computing
# dCash first locks in the raw `cash` reading; Cash then overwrites safely
# because no later expression in this block touches `cash` again. (Discovered
# May 2026 when post-refactor `dCash ≈ -Cash` everywhere — see the b25d526
# diag + the side-by-side query in diag-mclean.yml for the trail.)
AT_lag = F.col("ativo_total_lag")
src = (
    src
    .withColumn("dCash",     (F.col("cash")  - F.col("cash_lag"))  / AT_lag)
    .withColumn("Cash",      F.col("cash") / F.col("ativo_total"))
    .withColumn(
        "dIssue",
        ((F.col("patrimonio_liquido") - F.col("patrimonio_liquido_lag"))
         - (F.col("reserva_plus_la") - F.col("reserva_plus_la_lag"))) / AT_lag,
    )
    .withColumn("dDebt",     (F.col("debt_total") - F.col("debt_total_lag")) / AT_lag)
    .withColumn(
        "dDebtCP",
        (F.coalesce(F.col("debt_cp"), F.lit(0.0)) - F.coalesce(F.col("debt_cp_lag"), F.lit(0.0))) / AT_lag,
    )
    .withColumn(
        "dDebtLP",
        (F.coalesce(F.col("debt_lp"), F.lit(0.0)) - F.coalesce(F.col("debt_lp_lag"), F.lit(0.0))) / AT_lag,
    )
    .withColumn("Cashflow",  F.col("cashflow_raw") / AT_lag)
    .withColumn("Other",     F.coalesce(F.col("venda_imobilizado"), F.lit(0.0)) / AT_lag)
    .withColumn("Dividends", F.abs(F.coalesce(F.col("dividendos_pagos"), F.lit(0.0))) / AT_lag)
    .withColumn("Assets",    F.log(F.when(F.col("ativo_total") > 0, F.col("ativo_total"))))
    .withColumn("dAT_pct",   (F.col("ativo_total") - AT_lag) / AT_lag)
)

raw_n = src.count()
log.info(f"firm-year rows after variable construction: {raw_n:,}")

# Step 4: filters
src = src.where(~F.col("sector").isin(*FINANCIAL_SECTORS))
log.info(f"  after dropping financial sectors:           {src.count():,}")
src = src.where(
    (F.col("ativo_total")     > AT_THRESHOLD)
    & (F.col("ativo_total_lag") > AT_THRESHOLD)
    & (F.col("dAT_pct")       <= DAT_CAP)
)
for c in REG_CORE_VARS:
    src = src.where(F.col(c).isNotNull())
log.info(f"  after AT>{AT_THRESHOLD:,.0f}, ΔAT≤{DAT_CAP:.0%}, non-null core: {src.count():,}")

# Step 5: winsorization — compute quantiles globally (not per-year, matching
# the paper's approach of treating the panel as a pooled sample).
def _winsorize(col_name: str, lo_q: float, hi_q: float):
    """Returns a Column expression that clips col_name to [q_lo, q_hi]."""
    [q_lo, q_hi] = src.approxQuantile(col_name, [lo_q, 1.0 - hi_q], 0.001)
    log.info(f"  wins[{col_name}] → [{q_lo:.4f}, {q_hi:.4f}] @ ({lo_q}, {hi_q})")
    return F.least(F.greatest(F.col(col_name), F.lit(q_lo)), F.lit(q_hi))

for v in WINS_VARS_STD:
    src = src.withColumn(v, _winsorize(v, WINS_LO, WINS_HI))
src = src.withColumn("Cashflow", _winsorize("Cashflow", WINS_LO_CF, WINS_HI))

# Materialize
(
    src
    .write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .partitionBy("fiscal_year")
    .saveAsTable(f"{catalog}.silver.mclean_clean")
)
n = spark.table(f"{catalog}.silver.mclean_clean").count()
log.info(f"silver.mclean_clean → {n:,} rows ({n/raw_n:.1%} of raw)")
dbutils.jobs.taskValues.set(key="silver_mclean_clean_rows", value=n)
