# Databricks notebook source
"""CVMWIN parser for pre-2010 CVM filings (.DFM/.DFL/.ITM/.ITL/.IAN).

PoC SCAFFOLD — Layout NOT YET DECODED.

Public-info recovery (commit d3e4a528 follow-up) established two key facts:

1. Pre-2010 filings use the **Clipper database engine** — the reader
   software (`Consulta.zip` v2.4 at
   sistemas.cvm.gov.br/download/sep/pub/programas/RelatCias24/Consulta.zip)
   has `set clipper=F:200` in its DOS autoexec.bat, which is the Clipper
   memory directive. This means the `.DFM/.DFL/.ITM/.ITL` extensions are
   almost certainly **standard dBase III/IV / Clipper DBF databases** with
   a rename, NOT a proprietary binary format.

   → Phase 0 step 2 should try `dbfread` (pure Python, well-maintained,
   handles Clipper variants via `lowernames=True` + `char_decode_errors`)
   before any custom parser. Anticipated parser implementation:

       import dbfread
       for record in dbfread.DBF(file_path, lowernames=True, encoding='cp850'):
           yield CvmwinAccountLine(
               cd_conta=record['cd_conta'],   # actual field name TBD
               ds_conta=record['ds_conta'],
               vl_norm=record['vl_norm'],
               ordem_exerc=record['ordem_exerc'],
           )

   The unknowns at this stage are:
   - Actual column names in the DBF (cd_conta? CDCONTA? CD_CONT?)
   - File encoding (cp850 DOS or cp1252 Windows-ANSI for Portuguese)
   - Whether `.DFM` and `.DFL` use the same column structure (probably yes
     since they both contain DFP variants — DFM = monetary "Mil",
     DFL = "Livre"/free-form, just unit/scale difference)
   - Whether multi-file filings (BPA + BPP + DRE + DOAR in same year)
     are bundled inside one DBF or split across files

2. The pre-2010 layout is NOT publicly documented at the
   sistemas.cvm.gov.br/port/ciasabertas/Leiaute_de_Formularios_do_EmpresasNET.asp
   page (that page covers ENET 3.0 only, the current post-2010 format).
   We will decode by experiment: download one real `.DFM` file via the
   ASP-form scraper, open with `dbfread`, inspect columns, write a
   minimal smoke test, then commit a fixture for the test suite.

Until layout is decoded against a real file, `parse_*` functions raise
`LayoutNotDecodedError` so callers fail loudly instead of silently
returning empty iterators.
"""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass


class CvmwinParseError(Exception):
    """Base class for parser errors."""


class LayoutNotDecodedError(CvmwinParseError):
    """Raised when a record type's byte layout hasn't been populated yet."""


class UnsupportedVersionError(CvmwinParseError):
    """Raised when the file's CVMWIN version magic isn't recognized."""


@dataclass(frozen=True)
class CvmwinAccountLine:
    """One row from a CVMWIN statement file — matches the bronze table key.

    Stable across all statement types (BPA/BPP/DRE/DOAR/DFC/IAN). Downstream
    silver pivots on (statement, cd_conta, ordem_exerc).
    """

    cd_conta: str
    ds_conta: str
    vl_norm: float
    ordem_exerc: str  # 'ÚLTIMO' or 'PENÚLTIMO'


# File-extension → statement type. Anticipated based on CVM naming
# conventions; verify against a real Phase 0 sample.
_EXT_TO_STATEMENT = {
    ".dfm": "DFP",   # Demonstração Financeira Padronizada (monetary scale)
    ".dfl": "DFP",   # Demonstração Financeira Padronizada (livre / free unit)
    ".itm": "ITR",   # Informações Trimestrais (monetary)
    ".itl": "ITR",   # Informações Trimestrais (livre)
    ".ian": "IAN",   # Informações Anuais
}


# DBF column-name mapping per statement type. Populated in Phase 0 step 2
# after inspecting a real file with `dbfread.DBF(path).field_names`.
# Most likely shape: cd_conta / ds_conta / vl_norm / ordem_exerc names will
# be in uppercase without underscores in DBF (Clipper convention: max 10
# chars per field name, no underscores in older dialects). Common guesses:
#   - "CD_CONTA" or "CONTA" or "COD"
#   - "DS_CONTA" or "DESCRICAO" or "DESC"
#   - "VL_NORM" or "VALOR" or "VL"
#   - "ORDEM" or "ORD_EX"
_DBF_FIELD_MAP: dict[str, dict[str, str]] = {
    # Example shape once decoded:
    #   "DFP": {
    #       "cd_conta": "CD_CONTA",     # actual DBF field name
    #       "ds_conta": "DS_CONTA",
    #       "vl_norm":  "VL_CONTA",
    #       "ordem_exerc": "ORDEM_EXER",
    #   }
}


def detect_dbf(blob: bytes) -> bool:
    """Return True if the first byte of `blob` matches a known dBase/Clipper
    file-header signature.

    dBase III/IV/Clipper header byte values:
        0x03 = dBase III (no memo)
        0x83 = dBase III with .DBT memo
        0xF5 = Foxpro/Clipper with memo
        0xFB = dBase IV with memo

    If the byte doesn't match any of those, raise UnsupportedVersionError —
    the file is either ENET 3.0 (post-2010) or an unknown format.

    PoC TODO: verify against a real downloaded .DFM file. The byte values
    above are the documented Clipper / dBase family; should hold for any
    1990s CVM filing.
    """
    if len(blob) < 1:
        raise UnsupportedVersionError("file too short to read dBase header byte")
    header = blob[0]
    if header in (0x03, 0x83, 0xF5, 0xFB, 0x30):  # 0x30 = Visual FoxPro
        return True
    raise UnsupportedVersionError(
        f"first byte 0x{header:02x} is not a known dBase/Clipper header — "
        "file may be ENET 3.0 (post-2010) or unknown format"
    )


def _parse_records(blob: bytes, statement: str) -> Iterator[CvmwinAccountLine]:
    """Iterate CvmwinAccountLine records from a CVMWIN .DFM/.DFL/.ITM/.ITL/.IAN
    blob.

    Implementation (once layout is decoded in Phase 0 step 2):
        from io import BytesIO
        import dbfread
        detect_dbf(blob)  # raise early if not a Clipper/dBase file
        fmap = _DBF_FIELD_MAP[statement]  # raises LayoutNotDecodedError if absent
        table = dbfread.DBF(filename=None, filedata=BytesIO(blob),
                            encoding='cp850', lowernames=True)
        for record in table:
            yield CvmwinAccountLine(
                cd_conta=str(record[fmap['cd_conta']]).strip(),
                ds_conta=str(record[fmap['ds_conta']]).strip(),
                vl_norm=float(record[fmap['vl_norm']] or 0.0),
                ordem_exerc=str(record[fmap['ordem_exerc']]).strip(),
            )

    Until `_DBF_FIELD_MAP` is populated, raises LayoutNotDecodedError.
    """
    detect_dbf(blob)  # raises UnsupportedVersionError if not dBase
    if statement not in _DBF_FIELD_MAP or not _DBF_FIELD_MAP[statement]:
        raise LayoutNotDecodedError(
            f"_DBF_FIELD_MAP[{statement!r}] not yet populated — "
            "Phase 0 step 2 must inspect a real .DFM file with dbfread and "
            "record the actual DBF column names"
        )
    raise LayoutNotDecodedError(
        f"record extraction for {statement!r} pending Phase 0 implementation; "
        "see module docstring for the anticipated dbfread-based loop"
    )
    # The actual yield loop activates once the raises above are removed.
    yield  # noqa: unreachable until layout decoded


def parse_bpa(blob: bytes) -> Iterator[CvmwinAccountLine]:
    """Iterate Balanço Patrimonial Ativo account lines."""
    return _parse_records(blob, "BPA")


def parse_bpp(blob: bytes) -> Iterator[CvmwinAccountLine]:
    """Iterate Balanço Patrimonial Passivo account lines."""
    return _parse_records(blob, "BPP")


def parse_dre(blob: bytes) -> Iterator[CvmwinAccountLine]:
    """Iterate Demonstração do Resultado account lines."""
    return _parse_records(blob, "DRE")


def parse_doar(blob: bytes) -> Iterator[CvmwinAccountLine]:
    """Iterate Demonstração das Origens e Aplicações de Recursos (pre-2008)."""
    return _parse_records(blob, "DOAR")


def parse_dfc(blob: bytes) -> Iterator[CvmwinAccountLine]:
    """Iterate Demonstração do Fluxo de Caixa (2008+)."""
    return _parse_records(blob, "DFC")


def parse_ian(blob: bytes) -> Iterator[CvmwinAccountLine]:
    """Iterate Informações Anuais — sector / board / capital structure."""
    return _parse_records(blob, "IAN")


__all__ = [
    "CvmwinAccountLine",
    "CvmwinParseError",
    "LayoutNotDecodedError",
    "UnsupportedVersionError",
    "detect_dbf",
    "parse_bpa",
    "parse_bpp",
    "parse_dfc",
    "parse_doar",
    "parse_dre",
    "parse_ian",
]
