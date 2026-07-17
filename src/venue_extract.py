"""论文 venue extraction — Python 端纯函数。

与 `astro-src/lib/paper.ts::deriveVenue` / `scripts/backfill_paper_venue.py::extract_venue`
保持三处实现一致(source → 'ICML 2025' style label + accepted status)。

调用方:
  - src/6.generate_docs.py:准备 `paper.llm_categories` 时计算 venue 维度;
  - scripts/backfill_paper_categories.py:回填 history paper 的 venue 维度。
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

CONFERENCE_SOURCE_LABELS: dict[str, str] = {
    "aaai": "AAAI",
    "acl": "ACL",
    "emnlp": "EMNLP",
    "iclr_openreview": "ICLR",
    "icml_openreview": "ICML",
    "neurips_openreview": "NeurIPS",
}

# Uppercase tag → display label, for tagged values like "ICML-2025-Accepted".
TAG_TO_LABEL: dict[str, str] = {
    "AAAI": "AAAI",
    "ACL": "ACL",
    "EMNLP": "EMNLP",
    "ICLR": "ICLR",
    "ICML": "ICML",
    "NIPS": "NeurIPS",
    "NEURIPS": "NeurIPS",
}

ACCEPTED_STATUSES: set[str] = {"accepted", "oral", "poster", "spotlight"}


def _conf_label(s: str) -> Optional[str]:
    return CONFERENCE_SOURCE_LABELS.get(s.lower().replace("-", "_"))


def extract_venue(raw_source: Optional[str]) -> Tuple[str, bool]:
    """Pure function mirroring astro-src/lib/paper.ts::deriveVenue.

    Returns (venue, accepted). For non-conference sources or missing values,
    returns ("", False)."""
    if not raw_source:
        return "", False
    source = str(raw_source).strip()
    if not source:
        return "", False

    tagged = re.match(r"^([A-Za-z]+)-(\d{4})-(.+)$", source)
    if tagged:
        tag, year, status = tagged.group(1), tagged.group(2), tagged.group(3)
        label = TAG_TO_LABEL.get(str(tag).upper())
        if label:
            accepted = str(status).lower() in ACCEPTED_STATUSES
            return f"{label} {year}", accepted

    label = _conf_label(source)
    if label:
        return label, False

    return "", False


def venue_label_list(raw_source: Optional[str]) -> list[str]:
    """categories.venue 维度数组形式:0 或 1 个元素。"""
    v, _ = extract_venue(raw_source)
    return [v] if v else []
