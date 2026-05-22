"""Build the McLean firm-year wide table from CVM DFP zips — silver layer.

Reads BPA / BPP / DRE / DFC_MI consolidated CSVs from each annual DFP zip,
extracts the line items needed for McLean (2011) variables, and produces a
firm-year wide Parquet keyed by (cd_cvm, fiscal_year).

Following the published paper "Fontes de caixa e restrições financeiras"
(Chalhoub, Kirch, Terra — RBFin 2015), this implements the variable mapping
to Brazilian IFRS (CPC) accounts post-2010.

Canonical CD_CONTA codes (non-financial firms; financials use a different
chart of accounts and are filtered out per paper spec):

  BPA  1            Ativo Total
       1.01.01      Caixa e Equivalentes de Caixa
  BPP  2.01.04      Empréstimos e Financiamentos (curto prazo)
       2.02.01      Empréstimos e Financiamentos (longo prazo)
       2.03         Patrimônio Líquido
       2.03.04      Reservas de Lucros
       2.03.05      Lucros/Prejuízos Acumulados
  DRE  3.11 / 3.09  Lucro Líquido Consolidado do Período (varies by year)
  DFC  6.02.06      Venda de Ativo Imobilizado  (→ Other)
       6.03.04      Dividendos pagos
       (D&A is inside 6.01.01 sub-items — pulled by regex on DS_CONTA)
"""
from __future__ import annotations
import argparse
import sys
import zipfile
from pathlib import Path
from typing import Iterable

import pandas as pd

# Account codes for non-financial firms (CPC IFRS chart)
CODES = {
    "ativo_total":             ("BPA", "1"),
    "cash":                    ("BPA", "1.01.01"),
    "debt_cp":                 ("BPP", "2.01.04"),
    "debt_lp":                 ("BPP", "2.02.01"),
    "patrimonio_liquido":      ("BPP", "2.03"),
    "reserva_lucros":          ("BPP", "2.03.04"),
    "lucros_acumulados":       ("BPP", "2.03.05"),
    # Income / cash flow — pulled by description fallback because codes drift.
    "venda_imobilizado":       ("DFC", "6.02.06"),
    "dividendos_pagos":        ("DFC", "6.03.04"),
}

STMT_PATTERNS = {
    "BPA": "BPA_con",
    "BPP": "BPP_con",
    "DRE": "DRE_con",
    "DFC": "DFC_MI_con",
}

NON_FINANCIAL_LABELS = {
    "BPA": {"1": "Ativo Total", "1.01": "Ativo Circulante", "1.01.01": "Caixa e Equivalentes de Caixa"},
    "BPP": {"2.03": "Patrimônio Líquido Consolidado", "2.03.04": "Reservas de Lucros", "2.03.05": "Lucros/Prejuízos Acumulados"},
}


def _read_csv_from_zip(zip_path: Path, pattern: str) -> pd.DataFrame:
    """Pull the one CSV matching `pattern` (e.g. 'BPA_con') from a CVM zip."""
    with zipfile.ZipFile(zip_path) as z:
        candidates = [n for n in z.namelist() if pattern in n]
        if not candidates:
            raise ValueError(f"No file matching {pattern!r} in {zip_path.name}")
        with z.open(candidates[0]) as f:
            return pd.read_csv(
                f,
                sep=";",
                encoding="latin-1",
                decimal=".",
                dtype={"CD_CVM": "string", "CD_CONTA": "string", "VERSAO": "string"},
                low_memory=False,
            )


def _scale_factor(escala_serie: pd.Series) -> pd.Series:
    """CVM reports values in either MIL (thousands) or UNIDADE; normalize to BRL."""
    return escala_serie.map({"MIL": 1_000.0, "UNIDADE": 1.0}).fillna(1.0)


def _extract_one(zip_path: Path, year: int) -> pd.DataFrame:
    """Build one firm-year wide frame from a single CVM zip (covers t and t-1)."""
    print(f"  · parsing {zip_path.name}")

    frames: dict[str, pd.DataFrame] = {}
    for stmt, pat in STMT_PATTERNS.items():
        try:
            df = _read_csv_from_zip(zip_path, pat)
        except ValueError:
            print(f"    [warn] no {stmt} file in {zip_path.name}; skipping")
            continue
        df["VL_NORM"] = pd.to_numeric(df["VL_CONTA"], errors="coerce") * _scale_factor(df["ESCALA_MOEDA"])
        frames[stmt] = df

    # For BPA/BPP we have ÚLTIMO=t-end and PENÚLTIMO=t-1-end (snapshots).
    # For DRE/DFC same labels mean the *period* statement for fiscal year ending DT_FIM_EXERC.
    rows: list[dict] = []
    by_cvm: dict[str, dict] = {}

    def _set(cdcvm: str, denom: str, sector: str | None, fy: int, var: str, val: float | None) -> None:
        key = (cdcvm, fy)
        if key not in by_cvm:
            by_cvm[key] = {
                "cd_cvm": cdcvm, "denom_cia": denom, "sector": sector, "fiscal_year": fy,
            }
        if val is None or pd.isna(val):
            return
        # Some firms restate; last write wins (CVM data is already deduped per VERSAO=last).
        by_cvm[key][var] = float(val)

    def _pull(stmt: str, code: str, var: str, *, ordem_filter: tuple[str, ...] = ("ÚLTIMO", "PENÚLTIMO")) -> None:
        if stmt not in frames:
            return
        df = frames[stmt]
        m = (df["CD_CONTA"] == code) & (df["ORDEM_EXERC"].isin(ordem_filter))
        # Filter out financial-firm variants where the code is reused with a different meaning
        # by requiring the DS_CONTA to match expected non-financial labels (when known).
        if stmt in NON_FINANCIAL_LABELS and code in NON_FINANCIAL_LABELS[stmt]:
            expected = NON_FINANCIAL_LABELS[stmt][code]
            m = m & (df["DS_CONTA"].str.strip() == expected)
        sub = df.loc[m, ["CD_CVM", "DENOM_CIA", "ORDEM_EXERC", "DT_FIM_EXERC", "VL_NORM"]]
        for _, r in sub.iterrows():
            # Fiscal year = year of DT_FIM_EXERC (already aligned with ÚLTIMO/PENÚLTIMO).
            fy = int(str(r["DT_FIM_EXERC"])[:4])
            _set(r["CD_CVM"], r["DENOM_CIA"], None, fy, var, r["VL_NORM"])

    for var, (stmt, code) in CODES.items():
        _pull(stmt, code, var)

    # Net Income: try DRE last-row of consolidated profit. Code drifts between years
    # (3.09, 3.11, sometimes 3.13). We pick the *bottom* code containing
    # "Lucro/Prejuízo Consolidado do Período" or "Lucro/Prejuízo do Período".
    if "DRE" in frames:
        dre = frames["DRE"]
        ds_lower = dre["DS_CONTA"].fillna("").str.strip().str.lower()
        # Prefer descriptions matching the bottom-line consolidated profit
        is_profit = ds_lower.isin({
            "lucro/prejuízo consolidado do período",
            "lucro/prejuízo do período",
            "resultado líquido do período",
        })
        prof = dre.loc[is_profit & dre["ORDEM_EXERC"].isin(("ÚLTIMO", "PENÚLTIMO"))]
        # For each (firm, fy) pick the row with the deepest CD_CONTA at top-level (no dot)
        # — that's the unfurled bottom-line, not a sub-attribution.
        prof = prof.assign(depth=prof["CD_CONTA"].str.count(r"\."))
        prof_top = prof.loc[prof["depth"] == prof.groupby(["CD_CVM", "DT_FIM_EXERC"])["depth"].transform("min")]
        for _, r in prof_top.iterrows():
            fy = int(str(r["DT_FIM_EXERC"])[:4])
            _set(r["CD_CVM"], r["DENOM_CIA"], None, fy, "lucro_liquido", r["VL_NORM"])

    # D&A: from DFC, scan sub-accounts under 6.01.01.* whose description contains
    # "Deprec" or "Amortiz" or "Exaust".
    if "DFC" in frames:
        dfc = frames["DFC"]
        ds_lower = dfc["DS_CONTA"].fillna("").str.lower()
        is_da = (
            dfc["CD_CONTA"].str.startswith("6.01.01")
            & (ds_lower.str.contains("deprec") | ds_lower.str.contains("amortiz") | ds_lower.str.contains("exaust"))
        )
        da = dfc.loc[is_da & dfc["ORDEM_EXERC"].isin(("ÚLTIMO", "PENÚLTIMO"))]
        # Sum sub-items (some firms split D&A and Amortization separately).
        da_grp = da.groupby(["CD_CVM", "DENOM_CIA", "DT_FIM_EXERC"])["VL_NORM"].sum().reset_index()
        for _, r in da_grp.iterrows():
            fy = int(str(r["DT_FIM_EXERC"])[:4])
            _set(r["CD_CVM"], r["DENOM_CIA"], None, fy, "deprec_amort", r["VL_NORM"])

    rows.extend(by_cvm.values())
    out = pd.DataFrame(rows)
    out["source_year_file"] = year
    return out


def _load_sector_registry(bronze_dir: Path) -> pd.DataFrame:
    """Load CVM Cadastro to get SETOR_ATIV (sector) per CD_CVM.

    The registry has multiple rows per company over time (with `SIT` reflecting
    current status); we collapse to the most-recent row per CD_CVM. The 'Emp.
    Adm. Part. - X' (holding company) sectors are normalized to the underlying
    business sector X for cleaner peer-group classification.
    """
    cad_path = bronze_dir / "cad_cia_aberta.csv"
    if not cad_path.exists():
        print(f"  [warn] no sector registry at {cad_path}; sectors will be NaN")
        return pd.DataFrame(columns=["cd_cvm", "sector", "sector_raw"])
    cad = pd.read_csv(cad_path, sep=";", encoding="latin-1", low_memory=False)
    cad["cd_cvm"] = cad["CD_CVM"].astype("Int64").astype("string").str.zfill(6)
    cad = cad.sort_values(["cd_cvm", "DT_INI_SIT"]).drop_duplicates("cd_cvm", keep="last")
    cad["sector_raw"] = cad["SETOR_ATIV"].fillna("Sem Setor")
    # Strip 'Emp. Adm. Part. - ' holding-company prefix to recover the real sector.
    cad["sector"] = cad["sector_raw"].str.replace(r"^Emp\. Adm\. Part\. - ", "", regex=True)
    return cad[["cd_cvm", "sector", "sector_raw"]]


def build(bronze_dir: Path, out_path: Path, from_year: int, to_year: int) -> None:
    print(f"Building firm-year wide table {from_year}–{to_year}")
    frames: list[pd.DataFrame] = []
    for y in range(from_year, to_year + 1):
        zip_path = bronze_dir / f"dfp_cia_aberta_{y}.zip"
        if not zip_path.exists():
            print(f"  [skip] missing {zip_path.name}")
            continue
        frames.append(_extract_one(zip_path, y))

    if not frames:
        print("  ⚠ no data extracted")
        return

    df = pd.concat(frames, ignore_index=True)

    # When the same fiscal_year appears in multiple source files
    # (e.g. fy=2012 shows up as PENÚLTIMO in 2013 zip AND as ÚLTIMO in 2012 zip),
    # prefer the ÚLTIMO row from its own year — that's the most recently restated value.
    df = df.sort_values(["cd_cvm", "fiscal_year", "source_year_file"])
    df = df.drop_duplicates(["cd_cvm", "fiscal_year"], keep="last")

    # Join sector registry
    sectors = _load_sector_registry(bronze_dir)
    if not sectors.empty:
        df["cd_cvm"] = df["cd_cvm"].astype("string").str.zfill(6)
        before = len(df)
        df = df.drop(columns=["sector"], errors="ignore").merge(sectors, on="cd_cvm", how="left")
        assert len(df) == before, "sector merge changed row count"
        matched = df["sector"].notna().sum()
        print(f"  sectors matched: {matched:,}/{len(df):,} firm-years")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    print(f"\n✓ wrote {len(df):,} firm-year rows → {out_path}")
    print(f"  firms: {df['cd_cvm'].nunique():,}")
    print(f"  years: {df['fiscal_year'].min()}–{df['fiscal_year'].max()}")
    cols_with_data = [c for c in df.columns if df[c].notna().sum() > 0]
    print(f"  variables present: {[c for c in cols_with_data if c not in ('cd_cvm','denom_cia','sector','sector_raw','fiscal_year','source_year_file')]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bronze", type=Path, default=Path("data/mclean/bronze"))
    ap.add_argument("--out", type=Path, default=Path("data/mclean/silver/firm_year_raw.parquet"))
    ap.add_argument("--from-year", type=int, default=2010)
    ap.add_argument("--to-year", type=int, default=2024)
    args = ap.parse_args()
    build(args.bronze, args.out, args.from_year, args.to_year)
    return 0


if __name__ == "__main__":
    sys.exit(main())
