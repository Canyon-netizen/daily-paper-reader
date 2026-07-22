"""PR-6 idea signals, implemented with injectable filesystem/search boundaries."""
from __future__ import annotations
import re
from collections import Counter
from datetime import date, timedelta
from pathlib import Path


def _files(root: str):
    return [p for p in Path(root).rglob("*.md") if p.is_file()]


def concept_holes(docs_dir: str, top_n: int = 8, max_pairs: int = 5) -> list[dict]:
    files = _files(docs_dir)
    concepts = Counter()
    docs = []
    for p in files:
        text = p.read_text(encoding="utf-8", errors="ignore")
        found = set(re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text.lower()))
        concepts.update(found)
        docs.append(found)
    top = [x for x, _ in concepts.most_common(top_n)]
    pairs = []
    for i, a in enumerate(top):
        for b in top[i + 1:]:
            if not any(a in d and b in d for d in docs):
                pairs.append({"concept_a": a, "concept_b": b, "score": 0})
                if len(pairs) >= max_pairs:
                    return pairs
    return pairs


def trend_concepts(docs_dir: str, window_days: int = 90, top_n: int = 5) -> list[dict]:
    cutoff = date.today() - timedelta(days=window_days)
    counts = Counter()
    for p in _files(docs_dir):
        text = p.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"published_at:\s*['\"]?([0-9]{4}-[0-9]{2}-[0-9]{2})", text)
        if not m:
            continue
        try:
            if date.fromisoformat(m.group(1)) < cutoff:
                continue
        except ValueError:
            continue
        counts.update(re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text.lower()))
    return [{"concept": k, "count": v} for k, v in counts.most_common(top_n)]


def limitation_excerpts(docs_dir: str) -> list[dict]:
    result = []
    for p in _files(docs_dir):
        text = p.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"(?im)^#{1,6}\s*(?:局限性|limitations?|������)\s*$([\s\S]*?)(?=^#{1,6}\s|\Z)", text)
        if m:
            result.append({"paper": str(p), "excerpt": m.group(1).strip()})
        elif "small sample" in text.lower():
            result.append({"paper": str(p), "excerpt": text.strip()})
    return result


def survey_gap(arxiv_search, window_days: int = 365) -> list[dict]:
    result = arxiv_search("survey OR review", window_days=window_days)
    return result if isinstance(result, list) else []


def collect_signals(archive_dir: str, config: dict) -> dict[str, list]:
    docs_dir = config.get("docs_dir", archive_dir)
    return {
        "concept_holes": concept_holes(docs_dir, config.get("hole_top_concepts", 8), config.get("hole_max_pairs", 5)),
        "trends": trend_concepts(docs_dir, config.get("trend_window_days", 90), config.get("trend_max", 5)),
        "limitations": limitation_excerpts(docs_dir),
        "survey_gap": survey_gap(config["arxiv_search"], config.get("survey_window_days", 365)) if config.get("arxiv_search") else [],
    }

__all__ = ["collect_signals", "concept_holes", "trend_concepts", "limitation_excerpts", "survey_gap"]
