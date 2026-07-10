"""Shared time-window helpers for the Supabase-based BM25/Embedding retrievers.

Why this exists
---------------
Before this module, `src/2.1.retrieval_papers_bm25.py` and
`src/2.2.retrieval_papers_embedding.py` each carried their own copy of four
helpers. The two scripts were free to drift (and did, on small details like
logging prefixes), making it hard to know which version to consult when a
Supabase windowing bug came in.

PR-4 phase 1 introduced this module with simplified versions (a generic
`config.recall_window_days` reader). Phase 2 (this version) replaces those
with the real implementations that handle `DPR_RUN_DATE` env override and
`arxiv_paper_setting.days_window` — matching the original call sites
byte-for-byte, modulo identifier renames.

Functions lifted:
  - resolve_supabase_recall_window
  - split_supabase_time_window
  - _format_supabase_window_for_log
  - _normalize_utc_datetime
  - multi_source_rpc_enabled

The first two differ between bm25 and embedding only in the default value
of the shard_days argument. Callers must pass it explicitly (no default)
to keep this module unaware of which strategy it's serving.

Keep this module dependency-free (only stdlib) so the two retrieval scripts
can import it without circular references.
"""
from __future__ import annotations

import datetime as _dt
import os
import re
from typing import Any, Dict, Optional, Tuple


# Date-token regexes for DPR_RUN_DATE override. Match both single-day
# (YYYYMMDD) and range (YYYYMMDD-YYYYMMDD) formats. Same as the original
# in 2.1.retrieval_papers_bm25.py:34-36.
_DATE_RE_DAY = re.compile(r"^(\d{8})$")
_DATE_RE_RANGE = re.compile(r"^(\d{8})-(\d{8})$")


def resolve_supabase_recall_window(
    config: Dict[str, Any],
    end_dt: Optional[_dt.datetime] = None,
) -> Tuple[_dt.datetime, _dt.datetime]:
    """Return (start_dt, end_dt) covering the configured Supabase recall window.

    Reads `arxiv_paper_setting.days_window` (default 9) and clamps to >= 1
    day. Honors the `DPR_RUN_DATE` env override (format YYYYMMDD or
    YYYYMMDD-YYYYMMDD). Caller is expected to pass the loaded config
    dict (`load_config()` result).

    Byte-equivalent to the original 2.1.retrieval_papers_bm25.py:62-92
    and 2.2.retrieval_papers_embedding.py:104-134.
    """
    paper_setting = (config or {}).get("arxiv_paper_setting") or {}
    try:
        days = int(paper_setting.get("days_window") or 9)
    except Exception:
        days = 9
    safe_days = max(days, 1)

    anchor = end_dt or _dt.datetime.now(_dt.timezone.utc)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=_dt.timezone.utc)
    anchor = anchor.astimezone(_dt.timezone.utc)
    token = str(os.getenv("DPR_RUN_DATE") or "").strip()

    range_match = _DATE_RE_RANGE.fullmatch(token)
    if range_match:
        start_text, end_text = range_match.group(1), range_match.group(2)
        try:
            start_dt = _dt.datetime.strptime(start_text, "%Y%m%d").replace(tzinfo=_dt.timezone.utc)
            end_day = _dt.datetime.strptime(end_text, "%Y%m%d").replace(tzinfo=_dt.timezone.utc)
            if end_day >= start_dt:
                return start_dt, end_day + _dt.timedelta(days=1)
        except Exception:
            pass

    day_match = _DATE_RE_DAY.fullmatch(token)
    if day_match:
        day_start = _dt.datetime.strptime(day_match.group(1), "%Y%m%d").replace(tzinfo=_dt.timezone.utc)
        if safe_days > 1:
            return anchor - _dt.timedelta(days=safe_days), anchor
        return day_start, day_start + _dt.timedelta(days=1)

    return anchor - _dt.timedelta(days=safe_days), anchor


def split_supabase_time_window(
    start_dt: Optional[_dt.datetime],
    end_dt: Optional[_dt.datetime],
    *,
    shard_days: int,
) -> list[Tuple[_dt.datetime, _dt.datetime]]:
    """Split (start_dt, end_dt) into <=shard_days chunks.

    Returns [] if either side is missing or end_dt <= start_dt. Returns
    [(start, end)] (single chunk) if the span already fits in one shard.

    Callers must pass shard_days explicitly (no default). The original
    scripts used SUPABASE_BM25_SHARD_DAYS / SUPABASE_VECTOR_SHARD_DAYS
    as defaults; this module stays strategy-agnostic.
    """
    safe_start = _normalize_utc_datetime(start_dt)
    safe_end = _normalize_utc_datetime(end_dt)
    if safe_start is None or safe_end is None or safe_end <= safe_start:
        return []

    safe_shard_days = max(int(shard_days or 1), 1)
    step = _dt.timedelta(days=safe_shard_days)
    if safe_end - safe_start <= step:
        return [(safe_start, safe_end)]

    shards: list[Tuple[_dt.datetime, _dt.datetime]] = []
    cursor = safe_start
    while cursor < safe_end:
        next_dt = min(cursor + step, safe_end)
        shards.append((cursor, next_dt))
        cursor = next_dt
    return shards


def _format_supabase_window_for_log(
    start_dt: Optional[_dt.datetime],
    end_dt: Optional[_dt.datetime],
    time_fields: Tuple[str, ...],
) -> Tuple[str, str, str]:
    """Return (published_str, updated_str, fields_csv) for log output.

    If start_dt/end_dt is None both rows become "N/A". Otherwise the
    window is rendered as "<start.iso> ~ <end.iso>"; the published row
    uses it iff "published" is in `time_fields`, the updated row iff
    "updated_at" is. The third return value is the sorted, comma-joined
    field names.
    """
    safe_fields = {str(f).strip() for f in (time_fields or ()) if str(f).strip()}
    if start_dt is None or end_dt is None:
        published = "N/A"
        updated = "N/A"
    else:
        window = f"{start_dt.isoformat()} ~ {end_dt.isoformat()}"
        published = window if "published" in safe_fields else "N/A"
        updated = window if "updated_at" in safe_fields else "N/A"
    return published, updated, ",".join(sorted(safe_fields))


def _normalize_utc_datetime(value: Optional[_dt.datetime]) -> Optional[_dt.datetime]:
    """Coerce a datetime to UTC. Returns None if input is not a datetime."""
    if not isinstance(value, _dt.datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=_dt.timezone.utc)
    return value.astimezone(_dt.timezone.utc)


def multi_source_rpc_enabled() -> bool:
    """True iff `DPR_ENABLE_MULTI_SOURCE_RPC=1/true/yes/on` is set in env."""
    return str(os.getenv("DPR_ENABLE_MULTI_SOURCE_RPC") or "").strip().lower() in ("1", "true", "yes", "on")


# Default shard sizes preserved here for documentation only — both retrieval
# scripts previously baked these in as their `shard_days=` default value.
# Now they pass explicitly so this module stays strategy-agnostic.
SUPABASE_BM25_SHARD_DAYS = 7
SUPABASE_VECTOR_SHARD_DAYS = 7