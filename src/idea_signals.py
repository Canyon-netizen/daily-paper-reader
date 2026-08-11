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
        # Find frontmatter block, then extract all "slug: <name>" entries inside it
        m_fm = re.search(r"^---\s*$([\s\S]*?)^---\s*$", text, re.MULTILINE)
        if not m_fm:
            continue
        fm_block = m_fm.group(1)
        # Only count slugs that appear within a "concepts:" list section.
        # Detect by checking "concepts:" exists, then extract slug: lines until end of list.
        if not re.search(r"^concepts:\s*$", fm_block, re.MULTILINE):
            continue
        # Match "  - slug: <name>" lines (allow multiple spaces after dash)
        for slug in re.findall(r"^\s*-\s*slug:\s*([\w-]+)\s*$", fm_block, re.MULTILINE):
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
# 4. survey_gap -- Polaris LLM-driven gap analysis
# ============================================================================

import json
from datetime import datetime, timedelta

# Default window for recent papers in archive
DEFAULT_SURVEY_GAP_WINDOW_DAYS = 7
# Max papers to include in LLM prompt (token limit)
MAX_PAPERS_FOR_LLM = 30


def _load_recent_papers(archive_dir: str, window_days: int = 7) -> list[dict]:
    """Load recent papers from date-bucketed archive JSON files.

    Returns list of {"id": str, "title": str, "abstract": str}.
    """
    from pathlib import Path

    root = Path(archive_dir)
    if not root.exists():
        return []

    cutoff = datetime.now() - timedelta(days=window_days)
    papers = []

    # Walk archive/YYYYMMDD/recommend/*.json files
    for json_file in root.rglob("recommend/*.json"):
        # Extract date from directory name (e.g., archive/20260810/recommend/...)
        parent_name = json_file.parent.parent.name
        try:
            # Handle both YYYYMMDD and YYYYMMDD-YYYYMMDD formats
            date_str = parent_name.split("-")[0]
            file_date = datetime.strptime(date_str, "%Y%m%d")
        except ValueError:
            continue

        if file_date < cutoff:
            continue

        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            # Handle both "deep_dive" list and "papers" list formats
            paper_list = data.get("deep_dive", []) or data.get("papers", [])
            for p in paper_list:
                papers.append({
                    "id": p.get("id", ""),
                    "title": p.get("title", ""),
                    "abstract": p.get("abstract", ""),
                })
        except (json.JSONDecodeError, OSError):
            continue

    return papers[:MAX_PAPERS_FOR_LLM]


def survey_gap(
    *,
    archive_dir=".",
    docs_dir=".",
    config=None,
    arxiv_search=None,
    llm_call=None,
    max_gaps: int = 5,
) -> list[dict]:
    """Plan §3.2: LLM-driven survey gap detection from corpus.

    Strategy:
      1. If `arxiv_search` callable provided, use it to find recent survey-style papers
         and their stated open problems (Polaris GAP_SYSTEM_PROMPT pattern).
      2. Else, extract a sample of recent paper abstracts/titles from `archive_dir`
         (date-bucketed) and ask LLM to identify recurring under-covered sub-topics.
      3. Fall back to "not_checked" with empty list if LLM unavailable or fails.

    Args:
        llm_call: optional override (callable → dict). If None, uses
                  `get_llm_router().call("topic.survey_gap", ...)`.
        max_gaps: cap on number of gaps to return (save tokens).

    Returns:
        list of {"title": str, "description": str, "source": "arxiv"|"corpus"}
        Empty list if no inputs or LLM unavailable — caller treats empty as
        "no gap found" (NOT failure).
    """
    # Gather papers from available sources
    papers: list[dict] = []
    arxiv_raw_results = None  # Store for backward compat fallback

    # Priority 1: arxiv_search (backward compat, Polaris pattern)
    if arxiv_search is not None:
        try:
            arxiv_result = arxiv_search("survey OR review", window_days=365)
            if isinstance(arxiv_result, list):
                papers.extend(arxiv_result)
                arxiv_raw_results = arxiv_result  # Save for fallback
        except Exception:
            pass

    # Priority 2: archive_dir date-bucketed JSONs
    if not papers:
        papers = _load_recent_papers(archive_dir, window_days=DEFAULT_SURVEY_GAP_WINDOW_DAYS)

    if not papers:
        return []

    # Build papers summary for LLM
    papers_summary = "\n".join(
        f"- {p.get('title', 'Untitled')[:200]}\n  {p.get('abstract', '')[:300]}"
        for p in papers[:MAX_PAPERS_FOR_LLM]
    )

    # Determine LLM callable
    llm = llm_call
    llm_available = True
    if llm is None:
        try:
            from src.llm_router import get_llm_router

            router = get_llm_router()

            def _default_call(stage: str, messages: list[dict]) -> dict:
                return router.call(stage, messages)

            llm = _default_call
        except Exception:
            # No LLM available
            llm_available = False

    # If no LLM available, fall back to returning arxiv_search results (backward compat)
    if not llm_available:
        if arxiv_raw_results is not None:
            return arxiv_raw_results
        return []

    # Build LLM prompt and call
    prompt = (
        f"你是综述缺口分析员。从以下近期论文列表中,识别 {max_gaps} 个被现有综述覆盖不足的子方向。\n\n"
        f"论文列表:\n{papers_summary}\n\n"
        '每个缺口请输出 JSON:\n{"title": "<子方向标题>", "description": "<一句话说明覆盖不足的具体方面>"}\n\n'
        "只输出 JSON 数组,无前缀说明。"
    )

    # LLM fallback: if LLM call fails, return arxiv results (backward compat) or empty
    fallback_result = arxiv_raw_results if arxiv_raw_results is not None else []

    try:
        response = llm("topic.survey_gap", [{"role": "user", "content": prompt}])
        # Extract content from response (support both dict and string)
        if isinstance(response, dict):
            content = response.get("content", "")
            if not content and "choices" in response:
                content = response["choices"][0].get("message", {}).get("content", "")
        else:
            content = str(response)

        # Parse JSON array from content
        # Handle cases where response includes markdown code blocks
        import re

        json_match = re.search(r"\[[\s\S]*\]", content)
        if json_match:
            gaps = json.loads(json_match.group())
            if isinstance(gaps, list):
                # Validate and normalize structure
                result = []
                for g in gaps:
                    if isinstance(g, dict) and "title" in g and "description" in g:
                        result.append({
                            "title": g["title"],
                            "description": g["description"],
                            "source": "corpus",
                        })
                return result[:max_gaps]
        return fallback_result

    except Exception:
        # LLM call failed — return backward compat result (arxiv or empty)
        return fallback_result


# ============================================================================
# Top-level collect_signals -- aligned with Polaris forge.collect_signals
# ============================================================================

def collect_signals(
    archive_dir: str,
    config: dict | None = None,
    llm_call=None,
) -> dict:
    """Aggregate 4 signals -> `{signal_name: [items]}` shape.

    Optional config keys:
      - docs_dir: override archive_dir (default archive_dir)
      - hole_top_concepts / hole_max_pairs / trend_window_days / trend_max
      - arxiv_search: callable(survey_query, window_days)
      - survey_window_days: window for survey_gap archive lookup
      - max_gaps: max gaps to request from LLM

    Args:
        llm_call: optional LLM callable for survey_gap signal.
                  If None, survey_gap will try to use get_llm_router().
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
        "survey_gap": survey_gap(
            archive_dir=archive_dir,
            docs_dir=docs_dir,
            config=cfg,
            arxiv_search=cfg.get("arxiv_search"),
            llm_call=llm_call,
            max_gaps=cfg.get("max_gaps", 5),
        ),
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
