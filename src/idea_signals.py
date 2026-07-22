"""PR-6 idea signals -- 4 deterministic gap analysis signals.

Aligned with Polaris _concept_holes / _trend_concepts / _limitation_excerpts /
forge.gap_analysis -- the pure-deterministic part only
(polaris/src/backend/app/agents/voyage/actions_ideas.py:269-426).

Implementation constraints:
- stdlib + pathlib + re only (no LLM, no DB, no third-party)
- All 4 signals take docs_dir (containing .md files) as input
- Mirrors TS topic-search-v2.ts in logic; cross-language parity via fixture

Runtime Chinese constants (heading keywords) are preserved as plain strings.
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

# Polaris-aligned constants (match actions_ideas.py:251-258)
HOLE_METHOD_CATEGORIES = ("method", "architecture", "methodology")
HOLE_TOP_CONCEPTS = 8
HOLE_MAX_PAIRS = 5
TREND_WINDOW_DAYS = 90
TREND_MAX = 5

# _LIMIT_KEYWORDS -- matches Polaris actions_ideas.py:339-345
# (English keywords + Chinese heading words; runtime strings, no encoding risk)
_LIMIT_KEYWORDS = (
    "limitation",
    "future work",
    "future direction",
    "局限性",  # Chinese: "limitation/limitations"
    "未来工作",  # Chinese: "future work"
    "不足",  # Chinese: "insufficient/lacking"
)
_LIMIT_EXCERPT_CHARS = 600
_LIMIT_MAX_EXCERPTS = 2


def _files(root: str):
    return [p for p in Path(root).rglob("*.md") if p.is_file()]


def _read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="ignore")


# ============================================================================
# 1. concept_holes -- aligned with Polaris _concept_holes (actions_ideas.py:287-317)
# ============================================================================

def concept_paper_map(docs_dir: str) -> dict:
    """slug -> {"category": str, "papers": set[path]}.

    Data source: wiki/concepts/<slug>.md frontmatter `category` (written by PR-5)
    + the "## 反向链接" (Reverse Links) section listing related papers.
    """
    result: dict = {}
    root = Path(docs_dir)
    if not root.exists():
        return result
    for p in root.rglob("*.md"):
        text = _read_text(p)
        # Extract frontmatter concept_id / category
        m_fm = re.search(r"^---\s*$([\s\S]*?)^---\s*$", text, re.MULTILINE)
        if not m_fm:
            continue
        slug_m = re.search(r"concept_id:\s*['\"]?([\w-]+)", m_fm.group(1))
        cat_m = re.search(r"category:\s*['\"]?(\w+)", m_fm.group(1))
        if not slug_m:
            continue
        slug = slug_m.group(1)
        category = cat_m.group(1) if cat_m else "other"
        # Extract paper links under "## 反向链接" section
        back_m = re.search(
            r"##\s*反向链接\s*$([\s\S]*?)(?=^##\s|\Z)",
            text,
            re.MULTILINE,
        )
        papers = set()
        if back_m:
            for paper_id in re.findall(r"\[\[([^\]]+)\]\]", back_m.group(1)):
                papers.add(paper_id)
        result[slug] = {"category": category, "papers": papers, "path": str(p)}
    return result


def concept_holes(
    docs_dir: str,
    top_n: int = HOLE_TOP_CONCEPTS,
    max_pairs: int = HOLE_MAX_PAIRS,
) -> list:
    """Return top-N concept pairs (method x problem) with zero co-occurrence.

    Aligned with Polaris _concept_holes:
    - Take category in {method, architecture, methodology} top-N concepts
    - Take category == "problem" top-N concepts
    - Enumerate (method, problem) pairs, skip overlapping ones
    - Sort by coverage (|papers_m| + |papers_p|) desc, take top _HOLE_MAX_PAIRS
    """
    cmap = concept_paper_map(docs_dir)
    if not cmap:
        return []

    methods = sorted(
        [(s, v) for s, v in cmap.items() if v["category"] in HOLE_METHOD_CATEGORIES],
        key=lambda kv: -len(kv[1]["papers"]),
    )[:top_n]
    problems = sorted(
        [(s, v) for s, v in cmap.items() if v["category"] == "problem"],
        key=lambda kv: -len(kv[1]["papers"]),
    )[:top_n]

    pairs = []
    for m_slug, m_data in methods:
        for p_slug, p_data in problems:
            if m_data["papers"] & p_data["papers"]:
                continue
            coverage = len(m_data["papers"]) + len(p_data["papers"])
            pairs.append((coverage, {
                "method": m_slug,
                "problem": p_slug,
                "method_papers": sorted(m_data["papers"]),
                "problem_papers": sorted(p_data["papers"]),
                "coverage": coverage,
            }))
    pairs.sort(key=lambda x: -x[0])
    return [p for _, p in pairs[:max_pairs]]


# ============================================================================
# 2. trend_concepts -- aligned with Polaris _trend_concepts (actions_ideas.py:320-335)
# ============================================================================

_DATE_RE = re.compile(r"(?:published_at|date|generated_at):\s*['\"]?(\d{4}-\d{2}-\d{2})")


def trend_concepts(
    docs_dir: str,
    window_days: int = TREND_WINDOW_DAYS,
    top_n: int = TREND_MAX,
) -> list:
    """Top-N concepts by recent (last `window_days`) paper occurrence."""
    cutoff = date.today() - timedelta(days=window_days)
    counts = Counter()

    for p in _files(docs_dir):
        text = _read_text(p)
        m = _DATE_RE.search(text)
        if not m:
            continue
        try:
            d = date.fromisoformat(m.group(1))
        except ValueError:
            continue
        if d < cutoff:
            continue
        # frontmatter.concepts is a structured slug list
        m_fm = re.search(r"^---\s*$([\s\S]*?)^---\s*$", text, re.MULTILINE)
        if not m_fm:
            continue
        m_concepts = re.search(
            r"^concepts:\s*$\s*((?:[-+]?\s+-\s+slug:\s*[\w-]+.*\n?)+)",
            m_fm.group(1),
            re.MULTILINE,
        )
        if not m_concepts:
            continue
        for slug in re.findall(r"-\s+slug:\s*([\w-]+)", m_concepts.group(1)):
            counts[slug] += 1

    sorted_pairs = sorted(counts.items(), key=lambda x: (-x[1], x[0]))[:top_n]
    return [{"concept": k, "recent_papers": v} for k, v in sorted_pairs if v >= 2]


# ============================================================================
# 3. limitation_excerpts -- aligned with Polaris _limitation_excerpts
# ============================================================================

# Chinese heading + English keywords (runtime strings, no encoding risk)
_LIMIT_HEADING_RE = re.compile(
    r"(?im)^#{1,6}\s*(?:"
    r"局限性|limitations?|future\s+work|future\s+directions?|"
    r"未来工作|不足"
    r")\s*$([\s\S]*?)(?=^#{1,6}\s|\Z)"
)
_LIMIT_INLINE_RE = re.compile(
    r"(?i)(?:limitation|future work|限局|不足)[^.。\n]{0,200}",
    re.UNICODE,
)


def limitation_excerpts(docs_dir: str) -> list:
    """Return `## Limitations` heading body content (Chinese or English).

    Aligned with Polaris: max 2 excerpts per paper, each truncated to 600 chars.
    """
    result = []
    for p in _files(docs_dir):
        text = _read_text(p)
        m = _LIMIT_HEADING_RE.search(text)
        excerpts = []
        if m:
            excerpt = m.group(1).strip()
            if len(excerpt) >= 60:
                excerpts.append(excerpt[:_LIMIT_EXCERPT_CHARS])
        else:
            # Fallback: inline keyword hit
            for hit in _LIMIT_INLINE_RE.findall(text):
                if len(hit.strip()) >= 60:
                    excerpts.append(hit.strip()[:_LIMIT_EXCERPT_CHARS])
                    if len(excerpts) >= _LIMIT_MAX_EXCERPTS:
                        break
        for ex in excerpts[:_LIMIT_MAX_EXCERPTS]:
            result.append({"paper": str(p), "excerpt": ex})
    return result


# ============================================================================
# 4. survey_gap -- Polaris LLM-driven; DPR v1 leaves it deterministic-empty
# ============================================================================

def survey_gap(arxiv_search, window_days: int = 365) -> list:
    """Via injected arxiv_search callable; None/unavailable -> [].

    Polaris uses LLM here. DPR v1 keeps this purely deterministic and uses
    the other 3 signals + concept_paper_map as research-gap hints instead.
    """
    if arxiv_search is None:
        return []
    try:
        result = arxiv_search("survey OR review", window_days=window_days)
        return result if isinstance(result, list) else []
    except Exception:
        return []


# ============================================================================
# Top-level collect_signals -- aligned with Polaris forge.collect_signals
# ============================================================================

def collect_signals(archive_dir: str, config: dict | None = None) -> dict:
    """Aggregate 4 signals -> `{signal_name: [items]}` shape.

    Optional config keys:
      - docs_dir: override archive_dir (default archive_dir)
      - hole_top_concepts / hole_max_pairs / trend_window_days / trend_max
      - arxiv_search: callable(survey_query, window_days)
    """
    cfg = config or {}
    docs_dir = cfg.get("docs_dir", archive_dir)
    return {
        "concept_holes": concept_holes(
            docs_dir,
            cfg.get("hole_top_concepts", HOLE_TOP_CONCEPTS),
            cfg.get("hole_max_pairs", HOLE_MAX_PAIRS),
        ),
        "trends": trend_concepts(
            docs_dir,
            cfg.get("trend_window_days", TREND_WINDOW_DAYS),
            cfg.get("trend_max", TREND_MAX),
        ),
        "limitations": limitation_excerpts(docs_dir),
        "survey_gap": survey_gap(cfg.get("arxiv_search"), cfg.get("survey_window_days", 365)),
    }


__all__ = [
    "HOLE_METHOD_CATEGORIES",
    "HOLE_TOP_CONCEPTS",
    "HOLE_MAX_PAIRS",
    "TREND_WINDOW_DAYS",
    "TREND_MAX",
    "concept_paper_map",
    "concept_holes",
    "trend_concepts",
    "limitation_excerpts",
    "survey_gap",
    "collect_signals",
]
