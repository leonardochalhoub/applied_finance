"""Interface tests for the CVMWIN parser scaffold.

These tests verify the SHAPE of the parser API: exceptions raised, dataclass
contract, function signatures. Byte-level correctness tests come in Phase 0
step 2 once the layout is decoded from the spec page and golden fixtures
captured from real CVM filings.

Run with:
    pytest pipelines/tests/test_cvmwin_parser.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# pipelines/notebooks/bronze is not a package; load the parser module by path
PARSER_PATH = Path(__file__).parent.parent / "notebooks" / "bronze"
sys.path.insert(0, str(PARSER_PATH))

import cvmwin_parser as cwp  # noqa: E402


class TestParserInterface:
    def test_account_line_is_frozen(self):
        line = cwp.CvmwinAccountLine(cd_conta="1", ds_conta="Ativo Total", vl_norm=1.0, ordem_exerc="ÚLTIMO")
        with pytest.raises(AttributeError):
            line.cd_conta = "2"  # type: ignore[misc]

    def test_account_line_fields(self):
        line = cwp.CvmwinAccountLine(cd_conta="1.01.01", ds_conta="Caixa", vl_norm=123.45, ordem_exerc="ÚLTIMO")
        assert line.cd_conta == "1.01.01"
        assert line.ds_conta == "Caixa"
        assert line.vl_norm == 123.45
        assert line.ordem_exerc == "ÚLTIMO"

    @pytest.mark.parametrize("fn", [cwp.parse_bpa, cwp.parse_bpp, cwp.parse_dre,
                                     cwp.parse_doar, cwp.parse_dfc, cwp.parse_ian])
    def test_parse_functions_exist_and_are_callable(self, fn):
        assert callable(fn)


class TestVersionDetection:
    def test_short_blob_raises(self):
        with pytest.raises(cwp.UnsupportedVersionError):
            cwp.detect_version(b"\x00\x00")

    def test_unknown_magic_raises_with_helpful_message(self):
        blob = b"\xff\xff\xff\xff" + b"\x00" * 100
        with pytest.raises(cwp.UnsupportedVersionError) as exc:
            cwp.detect_version(blob)
        assert "populate _VERSION_MAGIC" in str(exc.value)


class TestParserScaffoldRaisesUntilDecoded:
    """Until Phase 0 step 2 decodes the layout, every parse_* call should
    raise LayoutNotDecodedError. This guards against silent empty iterators
    that would mask the fact that the parser hasn't been built yet."""

    @pytest.fixture
    def fake_blob(self):
        # Use a magic that will eventually be valid, padded with zeros
        return b"\x09\x00\x00\x00" + b"\x00" * 1000

    @pytest.mark.parametrize("fn,stmt", [
        (cwp.parse_bpa, "BPA"), (cwp.parse_bpp, "BPP"), (cwp.parse_dre, "DRE"),
        (cwp.parse_doar, "DOAR"), (cwp.parse_dfc, "DFC"), (cwp.parse_ian, "IAN"),
    ])
    def test_each_parser_raises_layout_not_decoded(self, fn, stmt, fake_blob):
        with pytest.raises((cwp.LayoutNotDecodedError, cwp.UnsupportedVersionError)):
            list(fn(fake_blob))


class TestExceptionHierarchy:
    def test_layout_error_is_parse_error(self):
        assert issubclass(cwp.LayoutNotDecodedError, cwp.CvmwinParseError)

    def test_version_error_is_parse_error(self):
        assert issubclass(cwp.UnsupportedVersionError, cwp.CvmwinParseError)
