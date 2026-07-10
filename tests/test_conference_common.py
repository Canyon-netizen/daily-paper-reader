"""Unit tests for src/conference_common.py::score_from_ranked_item."""
from __future__ import annotations

import sys
from pathlib import Path

# Make `src.*` importable without packaging.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.conference_common import score_from_ranked_item  # noqa: E402


def test_score_prefers_score_key() -> None:
    assert score_from_ranked_item({"score": 4.5, "star_rating": 3.0}) == 4.5


def test_score_falls_back_to_star_rating() -> None:
    assert score_from_ranked_item({"star_rating": 3}) == 3.0


def test_score_returns_zero_when_missing() -> None:
    assert score_from_ranked_item({}) == 0.0
    assert score_from_ranked_item({"unrelated": "value"}) == 0.0


def test_score_handles_non_numeric() -> None:
    # Non-coercible values fall through to 0.0 rather than raising.
    assert score_from_ranked_item({"score": "not-a-number"}) == 0.0
    assert score_from_ranked_item({"score": None, "star_rating": "n/a"}) == 0.0


def test_score_accepts_int() -> None:
    # LLM sometimes emits ints instead of floats.
    assert score_from_ranked_item({"score": 4}) == 4.0
    assert score_from_ranked_item({"score": 0}) == 0.0