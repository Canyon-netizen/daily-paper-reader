"""Shared time-window helpers for the Supabase-based BM25/Embedding retrievers.

Why this exists
---------------
Before this module, `src/2.1.retrieval_papers_bm25.py` and
`src/2.2.retrieval_papers_embedding.py` each carried their own copy of five
helpers that are byte-identical apart from identifier names. The two scripts
were free to drift (and did, on small details like logging prefixes), making
it hard to know which version to consult when a Supabase windowing bug came
in.

PR-4 lifts those five functions into this module so both retrieval scripts
import from a single source of truth. Subsequent PRs can extend the
abstraction (`merge_supabase_rows`, `query_supabase_with_shards`) once the
strategy boundary is clearer.

Keep this module dependency-free (only stdlib) so the two retrieval scripts
can import it without circular references.
"""
from __future__ import annotations

import datetime as _dt
import os
from typing import Tuple


# Default shard size for the recursive Supabase time-window split. BM25 uses
# `SUPABASE_BM25_SHARD_DAYS`; embedding uses `SUPABASE_VECTOR_SHARD_DAYS`.
# They share the same default and the same split algorithm, so the default
# lives here.
DEFAULT_SHARD_DAYS = 7


def resolve_supabase_recall_window(config: dict) -> Tuple[_dt.datetime, _dt.datetime]:
    """Return (start_dt, end_dt) covering the configured Supabase recall window.

    Reads `supabase.recall_window_days` from the config; defaults to 14 days
    if missing. End is "now" (UTC). Caller is expected to pass the loaded
    config dict (`load_config()` result).
    """
    supabase = (config or {}).get("supabase") or {}
    try:
        days = int(supabase.get("recall_window_days") or 14)
    except Exception:
        days = 14
    days = max(days, 1)
    end_dt = _dt.datetime.now(_dt.timezone.utc)
    start_dt = end_dt - _dt.timedelta(days=days)
    return start_dt, end_dt


def split_supabase_time_window(
    start_dt: _dt.datetime,
    end_dt: _dt.datetime,
    *,
    env_var: str = "SUPABASE_BM25_SHARD_DAYS",
    default_days: int = DEFAULT_SHARD_DAYS,
) -> Tuple[_dt.datetime, _dt.datetime]:
    """Return (effective_start, effective_end) capped by the configured shard.

    Reads `env_var` (defaults to SUPABASE_BM25_SHARD_DAYS) and shrinks the
    window to the most-recent N days if it exceeds that. This prevents
    Supabase RPC timeouts on long windows.
    """
    try:
        max_days = int(os.getenv(env_var) or default_days)
    except Exception:
        max_days = default_days
    max_days = max(max_days, 1)
    span = end_dt - start_dt
    if span <= _dt.timedelta(days=max_days):
        return start_dt, end_dt
    return end_dt - _dt.timedelta(days=max_days), end_dt


def _format_supabase_window_for_log(start_dt: _dt.datetime, end_dt: _dt.datetime) -> str:
    """Render a (start, end) window as "YYYYMMDDHHMM TO YYYYMMDDHHMM"."""
    return (
        f"{start_dt.strftime('%Y%m%d%H%M')} TO {end_dt.strftime('%Y%m%d%H%M')}"
    )


def _normalize_utc_datetime(value: object) -> _dt.datetime | None:
    """Coerce an ISO-8601 string (or already-a-datetime) into a UTC datetime.

    Returns None on parse failure. If the input has no tzinfo, UTC is assumed.
    """
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        dt = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            dt = _dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    return dt.astimezone(_dt.timezone.utc)


def multi_source_rpc_enabled(config: dict) -> bool:
    """True iff the deployment has opted into multi-source Supabase RPCs.

    Reads `supabase.multi_source_rpc_enabled` (default: False). When True the
    retrievers prefer one UNION ALL RPC over per-source RPCs.
    """
    supabase = (config or {}).get("supabase") or {}
    value = supabase.get("multi_source_rpc_enabled")
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y", "on"}