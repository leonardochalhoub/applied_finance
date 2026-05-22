"""Compute McLean (2011) variables, apply paper filters, winsorize — silver layer.

Inputs:  data/mclean/silver/firm_year_raw.parquet
Outputs: data/mclean/silver/firm_year_clean.parquet (one row per firm-year that
         survives the paper's filters, with the regression variables ready)

Variable construction follows Chalhoub, Kirch & Terra (2015, RBFin) — itself a
faithful reading of McLean (2011, JFE). Equation (1):

    ΔCash_i = α + β1·ΔIssue_i + β2·ΔDebt_i + β3·CashFlow_i + β4·Other_i
                + β5·Assets_i + ε_i

All flow variables are normalized by Total Assets_{t-1}.

Paper filters applied (in order):
  1) Drop firm-years in the financial sector (Bancos, Intermediação Financeira,
     Arrendamento Mercantil, Securitização de Recebíveis, Seguradoras,
     Crédito Imobiliário) — high leverage / regulated balance sheets.
  2) Drop firm-years with AT_t ≤ R$ 200,000 or AT_{t-1} ≤ R$ 200,000.
  3) Drop firm-years with YoY asset growth > 100%.
  4) Drop firm-years with missing core regression variables.
Winsorize 1% both tails for all variables, except CashFlow (2.5% left / 1% right).
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# Sectors excluded per paper spec (financial / regulated firms).
# Matches against `sector` column (which has the 'Emp. Adm. Part. -' prefix
# already stripped by the silver builder).
FINANCIAL_SECTORS = {
    "Bancos",
    "Intermediação Financeira",
    "Arrendamento Mercantil",
    "Securitização de Recebíveis",
    "Seguradoras e Corretoras",
    "Crédito Imobiliário",
}


def winsorize(series: pd.Series, lower_q: float, upper_q: float) -> pd.Series:
    if series.dropna().empty:
        return series
    lo = series.quantile(lower_q)
    hi = series.quantile(1 - upper_q)
    return series.clip(lo, hi)


def build(in_path: Path, out_path: Path, *, winsorize_enabled: bool = True) -> pd.DataFrame:
    df = pd.read_parquet(in_path)

    # Raw aggregates that feed McLean variables
    df['debt_total']      = df['debt_cp'].fillna(0) + df['debt_lp'].fillna(0)
    df['reserva_plus_la'] = df['reserva_lucros'].fillna(0) + df['lucros_acumulados'].fillna(0)
    df['cashflow_raw']    = df['lucro_liquido'].fillna(0) + df['deprec_amort'].fillna(0)

    # Lag (t-1) by firm — produces NaN for the first observation of each firm
    df = df.sort_values(['cd_cvm', 'fiscal_year']).reset_index(drop=True)
    grp = df.groupby('cd_cvm', sort=False)
    for col in ['ativo_total', 'cash', 'debt_total', 'patrimonio_liquido', 'reserva_plus_la']:
        df[f'{col}_lag'] = grp[col].shift(1)

    AT_lag = df['ativo_total_lag']
    df['Cash']     = df['cash'] / df['ativo_total']
    df['dCash']    = (df['cash']  - df['cash_lag'])  / AT_lag
    df['dIssue']   = ((df['patrimonio_liquido']  - df['patrimonio_liquido_lag'])
                    - (df['reserva_plus_la']    - df['reserva_plus_la_lag']))   / AT_lag
    df['dDebt']    = (df['debt_total'] - df['debt_total_lag']) / AT_lag
    df['dDebtCP']  = (df['debt_cp'].fillna(0) - grp['debt_cp'].shift(1).fillna(0)) / AT_lag
    df['dDebtLP']  = (df['debt_lp'].fillna(0) - grp['debt_lp'].shift(1).fillna(0)) / AT_lag
    df['Cashflow'] = df['cashflow_raw'] / AT_lag
    df['Other']    = df['venda_imobilizado'].fillna(0) / AT_lag
    df['Dividends']= df['dividendos_pagos'].fillna(0).abs() / AT_lag
    df['Assets']   = np.log(df['ativo_total'].where(df['ativo_total'] > 0))
    df['dAT_pct']  = (df['ativo_total'] - AT_lag) / AT_lag

    core = ['dCash', 'dIssue', 'dDebt', 'Cashflow', 'Other', 'Assets']
    raw_n = len(df)
    print(f"raw firm-year rows:                          {raw_n:,}")

    # Step 1: drop financial-sector firms (paper exclusion)
    if 'sector' in df.columns:
        is_financial = df['sector'].isin(FINANCIAL_SECTORS)
        df = df.loc[~is_financial].copy()
        print(f"after dropping financial sector firms:        {len(df):,}  "
              f"(removed {int(is_financial.sum()):,})")

    # Step 2: AT thresholds + ΔAT cap + non-null
    mask = (
        (df['ativo_total']      > 200_000)
        & (df['ativo_total_lag'] > 200_000)
        & (df['dAT_pct']        <= 1.0)
        & df[core].notna().all(axis=1)
    )
    df_f = df.loc[mask].copy()
    print(f"after AT>R$200k + ΔAT≤100% + non-null core:   {len(df_f):,}  ({len(df_f)/raw_n:.1%})")

    if winsorize_enabled:
        # Winsorize per paper spec (1% both tails; CashFlow 2.5%-left / 1%-right)
        for v in ['Cash', 'dCash', 'dIssue', 'dDebt', 'dDebtCP', 'dDebtLP', 'Other', 'Dividends']:
            df_f[v] = winsorize(df_f[v], 0.01, 0.01)
        df_f['Cashflow'] = winsorize(df_f['Cashflow'], 0.025, 0.01)
        print(f"after winsorization (1% / Cashflow 2.5-L):    {len(df_f):,}")

    print(f"firms: {df_f['cd_cvm'].nunique():,}")
    print(f"years: {int(df_f['fiscal_year'].min())}–{int(df_f['fiscal_year'].max())}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df_f.to_parquet(out_path, index=False)
    print(f"✓ wrote {out_path}")
    return df_f


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in",  dest="in_path",  type=Path, default=Path("data/mclean/silver/firm_year_raw.parquet"))
    ap.add_argument("--out", dest="out_path", type=Path, default=Path("data/mclean/silver/firm_year_clean.parquet"))
    ap.add_argument("--no-winsorize", action="store_true")
    args = ap.parse_args()
    build(args.in_path, args.out_path, winsorize_enabled=not args.no_winsorize)
    return 0


if __name__ == "__main__":
    sys.exit(main())
