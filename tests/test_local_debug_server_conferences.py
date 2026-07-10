"""Tests for src/local_debug_server.py::build_command — F1 init-conferences workflow.

Verifies the F1 trigger (workflow_key="init-conferences") emits a bash command
that runs each per-conference init script with --year-end / --year-count, and
that the wrong inputs (empty conferences list) raise.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make `src.local_debug_server` importable.
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from src.local_debug_server import build_command  # noqa: E402


def test_init_conferences_emits_bash_with_serial_inits() -> None:
    cmd = build_command(
        "init-conferences",
        "",
        {"conferences": "ICML,NeurIPS", "year_end": 2025, "year_count": 3},
    )
    assert cmd[0] == "bash"
    assert cmd[1] == "-lc"
    script = cmd[2]
    assert "set -euo pipefail" in script
    assert "init_icml.py" in script
    assert "init_neurips.py" in script
    assert "--year-end 2025" in script
    assert "--year-count 3" in script


def test_init_conferences_default_year_end_is_current_year() -> None:
    cmd = build_command(
        "init-conferences",
        "",
        {"conferences": "AAAI", "year_count": 2},
    )
    script = cmd[2]
    assert "init_aaai.py" in script
    assert "--year-end" in script
    # year-end defaults to current year — verify the integer is the current year.
    import datetime as _dt
    assert str(_dt.datetime.now(_dt.timezone.utc).year) in script


def test_init_conferences_skip_fetch_propagates() -> None:
    cmd = build_command(
        "init-conferences",
        "",
        {"conferences": "ACL", "year_end": 2024, "year_count": 1, "skip_fetch": True},
    )
    assert "--skip-fetch" in cmd[2]


def test_init_conferences_normalizes_display_name() -> None:
    # Display names (AAAI, ACL, etc.) should be normalized to lowercase
    # init_<key>.py paths.
    cmd = build_command(
        "init-conferences",
        "",
        {"conferences": "ICLR,EMNLP", "year_end": 2024, "year_count": 1},
    )
    script = cmd[2]
    assert "init_iclr.py" in script
    assert "init_emnlp.py" in script


def test_init_conferences_unknown_conference_uses_lowercased_input() -> None:
    # If a user passes an unknown conf like "workshop" or "openreview",
    # the dispatch falls back to literal lowercase so an unknown backend
    # surfaces as a clear "file not found" error rather than silently
    # picking the wrong one.
    cmd = build_command(
        "init-conferences",
        "",
        {"conferences": "custom", "year_end": 2024, "year_count": 1},
    )
    assert "init_custom.py" in cmd[2]


def test_init_conferences_empty_string_falls_back_to_default() -> None:
    # Empty string falls back to the default ("ICML,NeurIPS") rather than
    # raising — this matches the spirit of the existing dispatch
    # (zero-config quickstart triggers a useful default).
    cmd = build_command(
        "init-conferences",
        "",
        {"conferences": "", "year_end": 2024, "year_count": 1},
    )
    assert "init_icml.py" in cmd[2]
    assert "init_neurips.py" in cmd[2]


def test_init_conferences_whitespace_only_raises() -> None:
    import pytest
    with pytest.raises(ValueError, match="init-conferences"):
        build_command(
            "init-conferences",
            "",
            {"conferences": "   ,  ,", "year_end": 2024, "year_count": 1},
        )