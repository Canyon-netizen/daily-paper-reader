"""Unit tests for src/retrieval/time_window.py.

These tests pin the exact behavior of the helpers that PR-4 phase 2 lifts
from the two retrieval scripts. They must match what
`2.1.retrieval_papers_bm25.py` and `2.2.retrieval_papers_embedding.py`
previously did locally — if any of these break, the corresponding change
in either retrieval script is a regression.
"""
from __future__ import annotations

import datetime as _dt
import os
import sys
from pathlib import Path

# Make `src.retrieval.*` importable.
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from src.retrieval.time_window import (  # noqa: E402
    SUPABASE_BM25_SHARD_DAYS,
    SUPABASE_VECTOR_SHARD_DAYS,
    _format_supabase_window_for_log,
    _normalize_utc_datetime,
    multi_source_rpc_enabled,
    resolve_supabase_recall_window,
    split_supabase_time_window,
)


# =============================================================================
# resolve_supabase_recall_window — was a 100% byte-identical copy in both
# retrieval scripts. The phase 1 version used `supabase.recall_window_days`;
# the phase 2 version (this module) uses `arxiv_paper_setting.days_window`
# (the original behavior) so we can lift the original function bodies
# without changing semantics.
# =============================================================================


def test_resolve_default_9_days() -> None:
    start, end = resolve_supabase_recall_window({})
    span = end - start
    # Allow 2-second slack.
    assert abs(span - _dt.timedelta(days=9)) < _dt.timedelta(seconds=2)
    assert end.tzinfo is not None


def test_resolve_respects_days_window() -> None:
    config = {"arxiv_paper_setting": {"days_window": 7}}
    start, end = resolve_supabase_recall_window(config)
    span = end - start
    assert abs(span - _dt.timedelta(days=7)) < _dt.timedelta(seconds=2)


def test_resolve_invalid_days_falls_back_to_9() -> None:
    config = {"arxiv_paper_setting": {"days_window": "not-a-number"}}
    start, end = resolve_supabase_recall_window(config)
    span = end - start
    assert abs(span - _dt.timedelta(days=9)) < _dt.timedelta(seconds=2)


def test_resolve_floors_at_one_day() -> None:
    # days_window=0 → 0 or 9 → 9, but max(0, 1) = 1, then 0 or 1 = 1.
    # Behavior: int(0 or 9) = 9, then safe_days = max(9, 1) = 9 → 9 days.
    # This matches the original Python `or` short-circuit semantics.
    config = {"arxiv_paper_setting": {"days_window": 0}}
    start, end = resolve_supabase_recall_window(config)
    span = end - start
    assert abs(span - _dt.timedelta(days=9)) < _dt.timedelta(seconds=2)


def test_resolve_dpr_run_date_single_day_falls_back_when_safe_days_gt_1() -> None:
    # When DPR_RUN_DATE is a single day but days_window (safe_days) is > 1,
    # the original implementation falls back to the days_window-relative
    # window anchored at "now" — the single-day token is silently ignored
    # unless the caller has set days_window=1. Pin this behavior so the
    # next refactor doesn't quietly change it.
    os.environ["DPR_RUN_DATE"] = "20260301"
    try:
        start, end = resolve_supabase_recall_window({})  # default safe_days=9
        # Falls back to the 9-day window ending "now".
        span = end - start
        assert abs(span - _dt.timedelta(days=9)) < _dt.timedelta(seconds=2)
    finally:
        del os.environ["DPR_RUN_DATE"]


def test_resolve_dpr_run_date_single_day_respected_when_safe_days_eq_1() -> None:
    # When DPR_RUN_DATE is a single day and days_window=1, the single-day
    # token IS respected (returns exactly that 24h window).
    os.environ["DPR_RUN_DATE"] = "20260301"
    try:
        start, end = resolve_supabase_recall_window({"arxiv_paper_setting": {"days_window": 1}})
        assert start == _dt.datetime(2026, 3, 1, tzinfo=_dt.timezone.utc)
        assert end == _dt.datetime(2026, 3, 2, tzinfo=_dt.timezone.utc)
    finally:
        del os.environ["DPR_RUN_DATE"]


def test_resolve_dpr_run_date_range() -> None:
    os.environ["DPR_RUN_DATE"] = "20260301-20260310"
    try:
        start, end = resolve_supabase_recall_window({})
        assert start == _dt.datetime(2026, 3, 1, tzinfo=_dt.timezone.utc)
        assert end == _dt.datetime(2026, 3, 11, tzinfo=_dt.timezone.utc)
    finally:
        del os.environ["DPR_RUN_DATE"]


def test_resolve_dpr_run_date_invalid_format_falls_back() -> None:
    # Malformed token should not raise; it should fall back to days_window.
    os.environ["DPR_RUN_DATE"] = "not-a-date"
    try:
        start, end = resolve_supabase_recall_window({})
        span = end - start
        assert abs(span - _dt.timedelta(days=9)) < _dt.timedelta(seconds=2)
    finally:
        del os.environ["DPR_RUN_DATE"]


# =============================================================================
# split_supabase_time_window
# =============================================================================


def test_split_returns_empty_for_missing_inputs() -> None:
    assert split_supabase_time_window(None, None, shard_days=7) == []
    assert split_supabase_time_window(
        _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc), None, shard_days=7
    ) == []


def test_split_returns_empty_when_end_before_start() -> None:
    start = _dt.datetime(2026, 5, 2, tzinfo=_dt.timezone.utc)
    end = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
    assert split_supabase_time_window(start, end, shard_days=7) == []


def test_split_single_shard_when_under_limit() -> None:
    start = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
    end = start + _dt.timedelta(days=3)
    assert split_supabase_time_window(start, end, shard_days=7) == [(start, end)]


def test_split_chunks_to_multiple_shards() -> None:
    start = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
    end = start + _dt.timedelta(days=30)
    chunks = split_supabase_time_window(start, end, shard_days=7)
    # 30 days / 7-day shards → [0..7, 7..14, 14..21, 21..28, 28..30]
    assert len(chunks) == 5
    assert chunks[0][0] == start
    assert chunks[-1][1] == end
    # Each chunk except the last should be exactly 7 days.
    for s, e in chunks[:-1]:
        assert e - s == _dt.timedelta(days=7)


def test_split_floors_shard_days_at_one() -> None:
    start = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
    end = start + _dt.timedelta(days=3)
    # shard_days=0 must not loop forever; it becomes 1.
    chunks = split_supabase_time_window(start, end, shard_days=0)
    assert len(chunks) == 3


# =============================================================================
# _format_supabase_window_for_log
# =============================================================================


def test_format_returns_na_when_dts_none() -> None:
    out = _format_supabase_window_for_log(None, None, ("published",))
    assert out == ("N/A", "N/A", "published")


def test_format_renders_window_for_known_fields() -> None:
    start = _dt.datetime(2026, 5, 1, 12, 0, tzinfo=_dt.timezone.utc)
    end = _dt.datetime(2026, 5, 2, 0, 0, tzinfo=_dt.timezone.utc)
    pub, upd, fields = _format_supabase_window_for_log(
        start, end, ("published", "updated_at"),
    )
    assert pub == "2026-05-01T12:00:00+00:00 ~ 2026-05-02T00:00:00+00:00"
    assert upd == pub
    assert fields == "published,updated_at"


def test_format_omits_window_for_unknown_field() -> None:
    start = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
    end = _dt.datetime(2026, 5, 2, tzinfo=_dt.timezone.utc)
    pub, upd, _ = _format_supabase_window_for_log(start, end, ("other",))
    assert pub == "N/A"
    assert upd == "N/A"


def test_format_strips_empty_field_names() -> None:
    out = _format_supabase_window_for_log(None, None, ("", "  ", "published"))
    assert out[2] == "published"


# =============================================================================
# _normalize_utc_datetime
# =============================================================================


def test_normalize_passes_through_naive_to_utc() -> None:
    dt = _dt.datetime(2026, 5, 1, 12, 0)
    out = _normalize_utc_datetime(dt)
    assert out is not None
    assert out.tzinfo is _dt.timezone.utc


def test_normalize_converts_offset_to_utc() -> None:
    dt = _dt.datetime(2026, 5, 1, 12, 0, tzinfo=_dt.timezone(_dt.timedelta(hours=8)))
    out = _normalize_utc_datetime(dt)
    assert out is not None
    assert out.utcoffset() == _dt.timedelta(0)
    assert out.hour == 4  # 12 - 8


def test_normalize_returns_none_for_non_datetime() -> None:
    assert _normalize_utc_datetime("2026-05-01") is None
    assert _normalize_utc_datetime(123) is None
    assert _normalize_utc_datetime(None) is None


# =============================================================================
# multi_source_rpc_enabled
# =============================================================================


def test_multi_source_rpc_enabled_default_false(monkeypatch) -> None:
    monkeypatch.delenv("DPR_ENABLE_MULTI_SOURCE_RPC", raising=False)
    assert multi_source_rpc_enabled() is False


def test_multi_source_rpc_enabled_true_variants(monkeypatch) -> None:
    for value in ("1", "true", "yes", "on", "TRUE", "Yes", "ON"):
        monkeypatch.setenv("DPR_ENABLE_MULTI_SOURCE_RPC", value)
        assert multi_source_rpc_enabled() is True, value


def test_multi_source_rpc_enabled_false_variants(monkeypatch) -> None:
    for value in ("0", "false", "no", "off", ""):
        monkeypatch.setenv("DPR_ENABLE_MULTI_SOURCE_RPC", value)
        assert multi_source_rpc_enabled() is False, value


# =============================================================================
# Default shard sizes
# =============================================================================


def test_shard_defaults_are_seven() -> None:
    # Both retrieval scripts historically used 7 as the default shard size.
    assert SUPABASE_BM25_SHARD_DAYS == 7
    assert SUPABASE_VECTOR_SHARD_DAYS == 7