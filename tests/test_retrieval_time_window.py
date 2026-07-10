"""Unit tests for src/retrieval/time_window.py.

These tests pin the exact behavior of the five helpers that PR-4 lifts from
the two retrieval scripts. They must match what `2.1.retrieval_papers_bm25.py`
and `2.2.retrieval_papers_embedding.py` previously did locally — if any of
these break, the corresponding change in either retrieval script is a
regression.
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
    DEFAULT_SHARD_DAYS,
    _format_supabase_window_for_log,
    _normalize_utc_datetime,
    multi_source_rpc_enabled,
    resolve_supabase_recall_window,
    split_supabase_time_window,
)


def test_resolve_supabase_recall_window_default_14_days() -> None:
    start, end = resolve_supabase_recall_window({})
    span = end - start
    # Allow a 2-second slack to account for test wall-clock time.
    expected = _dt.timedelta(days=14)
    assert abs(span - expected) < _dt.timedelta(seconds=2)
    assert end.tzinfo is not None


def test_resolve_supabase_recall_window_respects_config() -> None:
    config = {"supabase": {"recall_window_days": 7}}
    start, end = resolve_supabase_recall_window(config)
    span = end - start
    assert abs(span - _dt.timedelta(days=7)) < _dt.timedelta(seconds=2)


def test_resolve_supabase_recall_window_invalid_falls_back_to_14() -> None:
    config = {"supabase": {"recall_window_days": "not-a-number"}}
    start, end = resolve_supabase_recall_window(config)
    span = end - start
    assert abs(span - _dt.timedelta(days=14)) < _dt.timedelta(seconds=2)


def test_resolve_supabase_recall_window_zero_uses_default() -> None:
    # `recall_window_days: 0` falls through to the default (14) because
    # `0 or 14` evaluates to 14 in Python. This matches the historical
    # behavior in both retrieval scripts.
    config = {"supabase": {"recall_window_days": 0}}
    start, end = resolve_supabase_recall_window(config)
    span = end - start
    assert abs(span - _dt.timedelta(days=14)) < _dt.timedelta(seconds=2)


def test_split_supabase_time_window_under_limit_passthrough() -> None:
    end = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
    start = end - _dt.timedelta(days=3)
    out_start, out_end = split_supabase_time_window(
        start, end, env_var="DPR_TEST_NOT_SET", default_days=7,
    )
    assert out_start == start
    assert out_end == end


def test_split_supabase_time_window_shrinks_when_over() -> None:
    end = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
    start = end - _dt.timedelta(days=30)
    out_start, out_end = split_supabase_time_window(
        start, end, env_var="DPR_TEST_NOT_SET", default_days=7,
    )
    assert out_end == end
    assert out_start == end - _dt.timedelta(days=7)


def test_split_supabase_time_window_respects_env_var(monkeypatch) -> None:
    end = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
    start = end - _dt.timedelta(days=30)
    monkeypatch.setenv("DPR_TEST_SPLIT_DAYS", "21")
    out_start, out_end = split_supabase_time_window(
        start, end, env_var="DPR_TEST_SPLIT_DAYS", default_days=7,
    )
    assert out_start == end - _dt.timedelta(days=21)


def test_format_supabase_window_for_log() -> None:
    start = _dt.datetime(2026, 5, 1, 12, 30, tzinfo=_dt.timezone.utc)
    end = _dt.datetime(2026, 5, 2, 0, 0, tzinfo=_dt.timezone.utc)
    text = _format_supabase_window_for_log(start, end)
    assert text == "202605011230 TO 202605020000"


def test_normalize_utc_datetime_from_iso_string() -> None:
    out = _normalize_utc_datetime("2026-05-01T12:30:00Z")
    assert out is not None
    assert out.tzinfo is not None
    assert out.year == 2026
    assert out.month == 5
    assert out.day == 1


def test_normalize_utc_datetime_from_offset_string() -> None:
    out = _normalize_utc_datetime("2026-05-01T12:30:00+08:00")
    assert out is not None
    # Asia/Shanghai 12:30 → UTC 04:30
    assert out.hour == 4
    assert out.minute == 30


def test_normalize_utc_datetime_naive_assumes_utc() -> None:
    out = _normalize_utc_datetime("2026-05-01T12:30:00")
    assert out is not None
    assert out.tzinfo is not None
    assert out.hour == 12


def test_normalize_utc_datetime_passthrough_datetime() -> None:
    dt = _dt.datetime(2026, 5, 1, tzinfo=_dt.timezone.utc)
    out = _normalize_utc_datetime(dt)
    assert out is dt


def test_normalize_utc_datetime_invalid_returns_none() -> None:
    assert _normalize_utc_datetime("not a date") is None
    assert _normalize_utc_datetime("") is None
    assert _normalize_utc_datetime(None) is None


def test_multi_source_rpc_enabled_default_false() -> None:
    assert multi_source_rpc_enabled({}) is False


def test_multi_source_rpc_enabled_true_variants() -> None:
    for value in (True, "true", "1", "yes", "y", "on", "TRUE", "Yes"):
        assert multi_source_rpc_enabled({"supabase": {"multi_source_rpc_enabled": value}}) is True, value


def test_multi_source_rpc_enabled_false_variants() -> None:
    for value in (False, "false", "0", "no", "off", ""):
        assert multi_source_rpc_enabled({"supabase": {"multi_source_rpc_enabled": value}}) is False, value


def test_default_shard_days_is_seven() -> None:
    # Both retrieval scripts historically used 7 as the default shard size.
    assert DEFAULT_SHARD_DAYS == 7