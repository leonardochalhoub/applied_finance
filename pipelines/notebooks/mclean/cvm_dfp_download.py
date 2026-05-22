"""Download annual CVM DFP zips (consolidated statements) — bronze layer.

McLean replication source data: Comissão de Valores Mobiliários "Dados Abertos"
publishes one annual zip per year (2010+) containing standardized BPA/BPP/DRE/DFC.

Output: pipelines/data/mclean/bronze/dfp_cia_aberta_YYYY.zip
"""
from __future__ import annotations
import argparse
import sys
import urllib.request
from pathlib import Path

DFP_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS"


def download_year(year: int, out_dir: Path, force: bool = False) -> Path:
    url = f"{DFP_BASE}/dfp_cia_aberta_{year}.zip"
    out_path = out_dir / f"dfp_cia_aberta_{year}.zip"
    if out_path.exists() and not force:
        size_mb = out_path.stat().st_size / 1e6
        print(f"  [skip] {year} already present ({size_mb:.1f} MB)")
        return out_path
    print(f"  [get ] {year} ← {url}")
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".zip.tmp")
    with urllib.request.urlopen(url, timeout=120) as resp, open(tmp, "wb") as f:
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            f.write(chunk)
    tmp.rename(out_path)
    size_mb = out_path.stat().st_size / 1e6
    print(f"        ✓ {size_mb:.1f} MB")
    return out_path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-year", type=int, default=2010)
    ap.add_argument("--to-year", type=int, default=2024)
    ap.add_argument("--out", type=Path, default=Path("data/mclean/bronze"))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    print(f"Downloading CVM DFP {args.from_year}–{args.to_year} → {args.out}")
    for y in range(args.from_year, args.to_year + 1):
        download_year(y, args.out, force=args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
