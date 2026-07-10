"""Shared helpers for the conference paper retrieval pipeline.

Why this exists
---------------
Before this module, `src/conference_pipeline.py::_score_from_item` and
`src/conference_sidebar.py::score_from_ranked_item` were byte-identical 8-line
duplicates. Either file could change and the other would silently drift.

Keep this module dependency-free (only stdlib + typing) so both pipeline and
sidebar can import it without circular references.
"""
from __future__ import annotations

from typing import Any, Dict


def score_from_ranked_item(item: Dict[str, Any]) -> float:
    """Extract a numeric score from a ranked paper item.

    Tries `score` first, then `star_rating` (legacy LLM output), falling back
    to 0.0 when neither key is present or coercible. This is the canonical
    implementation; both `conference_pipeline.prune_llm_result` and
    `conference_sidebar.build_sidebar_payload` must use it instead of
    duplicating the loop.
    """
    for key in ("score", "star_rating"):
        try:
            return float(item.get(key))
        except Exception:
            continue
    return 0.0