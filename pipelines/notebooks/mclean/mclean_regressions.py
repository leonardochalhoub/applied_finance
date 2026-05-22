"""Run McLean regressions and emit a JSON-shaped report — gold layer.

Implements three families of estimations from Chalhoub-Kirch-Terra (2015):
  · Pooled OLS with robust SE          (paper Table 3, Model 1)
  · Annual cross-section OLS year-by-year (paper Figure 1)
  · Same two splits for "constrained" / "unconstrained" subsamples,
    classified per sector-year by Kirch et al (2014) deciles.

Output (JSON, ready for the app):
  data/mclean/gold/mclean_results.json
  ├─ meta       : sample window, n_firms, n_obs, paper references
  ├─ desc       : descriptive stats per variable (full / constrained / unconstrained)
  ├─ pooled     : coefficient tables for the 3 subsamples
  ├─ annual     : per-year coefficients + t-stats + significance flags
  └─ paper_ref  : the 2015 paper's published values, for side-by-side comparison
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

REG_VARS = ['dIssue', 'dDebt', 'Cashflow', 'Other', 'Assets']
DESC_VARS = ['Cash', 'dCash', 'dIssue', 'dDebt', 'Cashflow', 'Other', 'Assets']

# Hard-coded reference numbers from the published paper for side-by-side compare.
PAPER_DESC = {
    'Cash':     {'mean': 0.090, 'std': 0.122, 'p25': 0.010, 'median': 0.0429, 'p75': 0.122, 'n': 5943},
    'dCash':    {'mean': 0.007, 'std': 0.075, 'p25': -0.013, 'median': 0.0007, 'p75': 0.025, 'n': 5936},
    'dIssue':   {'mean': 0.027, 'std': 0.106, 'p25': -0.002, 'median': 0.000, 'p75': 0.030, 'n': 5946},
    'dDebt':    {'mean': 0.038, 'std': 0.127, 'p25': -0.011, 'median': 0.011, 'p75': 0.076, 'n': 5950},
    'Cashflow': {'mean': 0.038, 'std': 0.152, 'p25': 0.004, 'median': 0.059, 'p75': 0.116, 'n': 5801},
    'Other':    {'mean': 0.003, 'std': 0.015, 'p25': 0.0,   'median': 0.0,    'p75': 0.0,   'n': 5640},
    'Assets':   {'mean': 13.854,'std': 2.162, 'p25': 12.579,'median': 14.059, 'p75': 15.278,'n': 5950},
}
PAPER_POOLED_MODEL1 = {
    'dIssue':   {'coef':  0.087,   'tstat': 6.12, 'sig': '***'},
    'dDebt':    {'coef':  0.095,   'tstat': 7.88, 'sig': '***'},
    'Cashflow': {'coef':  0.0833,  'tstat': 8.35, 'sig': '***'},
    'Other':    {'coef':  0.0414,  'tstat': 0.60, 'sig': ''},
    'Assets':   {'coef':  0.000146,'tstat': 0.22, 'sig': ''},
    'r2':       0.06, 'n': 5473,
}


def describe(df: pd.DataFrame) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for v in DESC_VARS:
        s = df[v].dropna()
        if s.empty:
            out[v] = {'mean': None, 'std': None, 'p25': None, 'median': None, 'p75': None, 'n': 0}
        else:
            out[v] = {
                'mean':   float(s.mean()),
                'std':    float(s.std()),
                'p25':    float(s.quantile(0.25)),
                'median': float(s.median()),
                'p75':    float(s.quantile(0.75)),
                'n':      int(len(s)),
            }
    return out


def _sig_flag(p: float) -> str:
    if p < 0.01: return '***'
    if p < 0.05: return '**'
    if p < 0.10: return '*'
    return ''


def pooled_ols(df: pd.DataFrame) -> dict:
    sub = df[['dCash'] + REG_VARS].dropna()
    if len(sub) < 10:
        return {'n': len(sub), 'error': 'insufficient observations'}
    y = sub['dCash']
    X = sm.add_constant(sub[REG_VARS])
    fit = sm.OLS(y, X).fit(cov_type='HC1')
    out = {
        'n':    int(fit.nobs),
        'r2':   float(fit.rsquared),
        'r2_adj': float(fit.rsquared_adj),
        'const': {
            'coef':  float(fit.params['const']),
            'tstat': float(fit.tvalues['const']),
            'p':     float(fit.pvalues['const']),
            'sig':   _sig_flag(float(fit.pvalues['const'])),
        },
    }
    for v in REG_VARS:
        out[v] = {
            'coef':  float(fit.params[v]),
            'tstat': float(fit.tvalues[v]),
            'p':     float(fit.pvalues[v]),
            'sig':   _sig_flag(float(fit.pvalues[v])),
        }
    return out


def annual_ols(df: pd.DataFrame) -> list[dict]:
    """Year-by-year cross-section regressions — paper's Figure 1 series."""
    out: list[dict] = []
    for year, sub in df.groupby('fiscal_year'):
        sub = sub[['dCash'] + REG_VARS].dropna()
        if len(sub) < 20:
            continue
        try:
            fit = sm.OLS(sub['dCash'], sm.add_constant(sub[REG_VARS])).fit(cov_type='HC1')
        except Exception as e:
            continue
        row = {'year': int(year), 'n': int(fit.nobs), 'r2': float(fit.rsquared)}
        for v in REG_VARS:
            row[v] = {
                'coef':  float(fit.params[v]),
                'tstat': float(fit.tvalues[v]),
                'sig':   _sig_flag(float(fit.pvalues[v])),
            }
        out.append(row)
    return out


def classify_constraints(df: pd.DataFrame) -> pd.DataFrame:
    """Kirch et al (2014) classification:

    Within each (sector, fiscal_year) cell, sort firms ascending by AT_{t-1}.
    Bottom 3 deciles → 'constrained' (smallest firms within their sector-year).
    Top 3 deciles → 'unconstrained' (largest firms within their sector-year).

    Sector-relative ranking matters because the size distribution varies
    dramatically across sectors (e.g. Petr. & Gás dwarfs Têxtil), so a pure
    cross-sectional cut would just isolate "huge vs small industries" rather
    than firms that are constrained relative to their peers.

    Cells with fewer than 5 firms drop into 'middle' to avoid degenerate
    deciles when the sector-year is sparse.
    """
    df = df.copy()
    df['sector'] = df['sector'].fillna('Sem Setor')

    # Within (sector, year), compute the percentile rank of AT_{t-1}.
    cell_size = df.groupby(['sector', 'fiscal_year'])['cd_cvm'].transform('count')
    df['ranked_pct'] = df.groupby(['sector', 'fiscal_year'])['ativo_total_lag'].rank(pct=True)
    df['group'] = 'middle'
    df.loc[(df['ranked_pct'] <= 0.30) & (cell_size >= 5), 'group'] = 'constrained'
    df.loc[(df['ranked_pct'] >= 0.70) & (cell_size >= 5), 'group'] = 'unconstrained'
    return df


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in",  dest="in_path",  type=Path, default=Path("data/mclean/silver/firm_year_clean.parquet"))
    ap.add_argument("--out", dest="out_path", type=Path, default=Path("data/mclean/gold/mclean_results.json"))
    args = ap.parse_args()

    df = pd.read_parquet(args.in_path)
    df = classify_constraints(df)
    print(f"Loaded {len(df):,} firm-years; classifying constraints by within-year AT deciles.")
    print(f"  unconstrained: {(df['group']=='unconstrained').sum()}")
    print(f"  middle:        {(df['group']=='middle').sum()}")
    print(f"  constrained:   {(df['group']=='constrained').sum()}")

    full = df
    uncon = df[df['group'] == 'unconstrained']
    con   = df[df['group'] == 'constrained']

    result = {
        'meta': {
            'window':     [int(full['fiscal_year'].min()), int(full['fiscal_year'].max())],
            'n_firms':    int(full['cd_cvm'].nunique()),
            'n_obs':      int(len(full)),
            'paper':      'Chalhoub, Kirch & Terra (2015) — RBFin 13(3): 470–503',
            'paper_window': [1995, 2013],
            'paper_n_firms': 655,
            'paper_n_obs': 5952,
            'data_source': 'CVM Dados Abertos / DFP (Demonstrações Financeiras Padronizadas)',
        },
        'desc': {
            'full':          describe(full),
            'unconstrained': describe(uncon),
            'constrained':   describe(con),
        },
        'pooled': {
            'full':          pooled_ols(full),
            'unconstrained': pooled_ols(uncon),
            'constrained':   pooled_ols(con),
        },
        'annual': {
            'full':          annual_ols(full),
            'unconstrained': annual_ols(uncon),
            'constrained':   annual_ols(con),
        },
        'paper_ref': {
            'desc_full': PAPER_DESC,
            'pooled_model1_full': PAPER_POOLED_MODEL1,
        },
    }

    args.out_path.parent.mkdir(parents=True, exist_ok=True)
    args.out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"\n✓ wrote {args.out_path}  ({args.out_path.stat().st_size/1024:.1f} KB)")

    # Console summary: pooled OLS vs paper
    print(f"\n=== Pooled OLS — full sample ({result['meta']['window'][0]}-{result['meta']['window'][1]}) vs Paper Table 3 Model (1) (1995-2013) ===")
    fp = result['pooled']['full']
    print(f"  n={fp['n']:,}  R²={fp['r2']:.4f}  (paper n=5,473  R²=0.06)")
    print(f"  {'Variable':<10} {'my coef':>10} {'my t':>8} {'my sig':>6}  |  {'paper β':>10} {'paper t':>8}")
    for v in REG_VARS:
        m = fp[v]; p = PAPER_POOLED_MODEL1[v]
        print(f"  {v:<10} {m['coef']:>+10.5f} {m['tstat']:>+8.2f}    {m['sig']:<3}  |  {p['coef']:>+10.5f} {p['tstat']:>+8.2f}  {p['sig']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
