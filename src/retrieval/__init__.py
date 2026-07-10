"""Shared helpers for the BM25 and Embedding retrieval scripts.

Public surface intentionally small. The two retrieval scripts (`2.1.*` and
`2.2.*`) used to carry their own copy of every helper here; PR-4 lifts the
time-windowing helpers into `retrieval.time_window` so both call from a
single source of truth. The two scripts themselves still own their
strategy-specific code (BM25Index, EmbeddingCoarseFilter, query payload
construction, save side effects).
"""
from .time_window import (
    DEFAULT_SHARD_DAYS,
    multi_source_rpc_enabled,
    resolve_supabase_recall_window,
    split_supabase_time_window,
)

__all__ = [
    "DEFAULT_SHARD_DAYS",
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