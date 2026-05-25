# Databricks notebook source
"""CVMWIN binary parser for pre-2010 CVM filings (.DFM/.DFL/.ITM/.ITL/.IAN).

PoC SCAFFOLD — Layout NOT YET DECODED.

The published layout spec lives at
    https://sistemas.cvm.gov.br/port/ciasabertas/Leiaute_de_Formularios_do_EmpresasNET.asp
and the DESIGN doc (Decision 4) cited speculative byte offsets that were
NOT retrieved from the spec page. Phase 0 PoC step 2 is: fetch the spec,
decode the layout, populate `_RECORD_LAYOUTS` below, and verify against
the 2010-2013 Dados Abertos overlap.

Until that work is done, `parse_*` functions raise `LayoutNotDecodedError`
so callers fail loudly instead of silently returning empty iterators.
"""
from __future__ import annotations

import struct
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


_VERSION_MAGIC = {
    # Layout per spec page — TBD. Placeholder until Phase 0 decode complete.
    # Populating this dict is part of A-002 validation.
}


_RECORD_LAYOUTS: dict[str, dict] = {
    # Keyed by (statement_type, version). Each value is a dict describing
    # field offsets and widths for record-row parsing. Populated by Phase 0.
    #
    # Example shape once decoded:
    #   ("BPA", 9): {
    #       "header_size": <int>,
    #       "record_size": <int>,
    #       "fields": {
    #           "record_type":  (offset, width, encoding),
    #           "cd_conta":     (offset, width, "cp1252"),
    #           "ds_conta":     (offset, width, "cp1252"),
    #           "vl_norm":      (offset, 8, "double_le"),
    #           "ordem_exerc":  (offset, 2, "ascii_enum"),
    #       },
    #   }
}


def detect_version(blob: bytes) -> int:
    """Inspect the first bytes of a CVMWIN file and return its format version.

    Raises:
        UnsupportedVersionError: if the header magic doesn't match a known
            version.

    PoC TODO: confirm magic-byte location and values from the spec page.
    Tentative values from web research only — verify against a sample file
    fetched during Phase 0.
    """
    if len(blob) < 4:
        raise UnsupportedVersionError("file too short to read version magic")
    magic = struct.unpack("<I", blob[:4])[0]
    if magic in _VERSION_MAGIC:
        return _VERSION_MAGIC[magic]
    raise UnsupportedVersionError(
        f"unknown CVMWIN magic 0x{magic:08x} — populate _VERSION_MAGIC after spec decode"
    )


def _parse_records(blob: bytes, statement: str) -> Iterator[CvmwinAccountLine]:
    version = detect_version(blob)
    key = (statement, version)
    if key not in _RECORD_LAYOUTS:
        raise LayoutNotDecodedError(
            f"layout for {statement!r} v{version} not yet decoded — "
            "Phase 0 PoC step 2 must populate _RECORD_LAYOUTS first"
        )
    layout = _RECORD_LAYOUTS[key]
    record_size = layout["record_size"]
    offset = layout["header_size"]
    while offset + record_size <= len(blob):
        # Field-extraction stub — implementation lives behind the layout dict
        # to keep this loop format-agnostic once layouts are populated.
        raise LayoutNotDecodedError(
            f"record extraction for {statement!r} v{version} not yet implemented"
        )
        offset += record_size


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
    "detect_version",
    "parse_bpa",
    "parse_bpp",
    "parse_dfc",
    "parse_doar",
    "parse_dre",
    "parse_ian",
]
