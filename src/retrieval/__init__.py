"""Shared helpers for the BM25 and Embedding retrieval scripts.

Public surface intentionally small. The two retrieval scripts (`2.1.*` and
`2.2.*`) used to carry their own copy of every helper here; PR-4 phase 1
added the time-window helpers, and phase 2 will (in a follow-up commit)
swap the call sites to import from this module.
"""
from .time_window import (
    SUPABASE_BM25_SHARD_DAYS,
    SUPABASE_VECTOR_SHARD_DAYS,
    multi_source_rpc_enabled,
    resolve_supabase_recall_window,
    split_supabase_time_window,
)

__all__ = [
    "SUPABASE_BM25_SHARD_DAYS",
    "SUPABASE_VECTOR_SHARD_DAYS",
    "multi_source_rpc_enabled",
    "resolve_supabase_recall_window",
    "split_supabase_time_window",
]


# Re-exported as module-level for backward-compat (the two retrieval scripts
# previously defined these as private helpers; the leading underscore
# versions stay available for any caller's local use).
from .time_window import (  # noqa: E402, F401
    _format_supabase_window_for_log,
    _normalize_utc_datetime,
)