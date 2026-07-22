"""PR-6 idea signals — 4 路 gap analysis。

对齐 Polaris `_concept_holes` / `_trend_concepts` / `_limitation_excerpts` /
`forge.gap_analysis` 的**纯确定性**部分(pollaris/src/backend/app/agents/voyage/actions_ideas.py:269-426)。

实现约束:
- 仅依赖 stdlib + pathlib + re(无 LLM,无 DB,无第三方)
- 4 路信号输入统一是 `docs_dir`(含若干 .md 文件),无需 Polaris 的 SQL JOIN
- 与 TS `topic-search-v2.ts` 是**同构**实现(TS 用相同的概念做实时辩论);
  跨语言一致性由 tests/test_cross_lang_elo.py 用 fixture 验证
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

# Polaris 对齐常量 — 默认值与 actions_ideas.py:251-258 一致
HOLE_METHOD_CATEGORIES = ("method", "architecture", "methodology")
HOLE_TOP_CONCEPTS = 8
HOLE_MAX_PAIRS = 5
TREND_WINDOW_DAYS = 90
TREND_MAX = 5

# _LIMIT_KEYWORDS — 对齐 Polaris actions_ideas.py:339-345
_LIMIT_KEYWORDS = ("limitation", "future work", "future direction",
                   "局限性", "未来工作", "不足")
_LIMIT_EXCERPT_CHARS = 600
_LIMIT_MAX_EXCERPTS = 2


def _files(root: str):
    return [p for p in Path(root).rglob("*.md") if p.is_file()]


def _read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="ignore")


# ============================================================================
# 1. 概念共现缺口 — 对齐 Polaris _concept_holes (actions_ideas.py:287-317)
# ============================================================================

def concept_paper_map(docs_dir: str) -> dict[str, dict]:
    """slug → {"category": str, "papers": set[path]}。

    数据源: `wiki/concepts/<slug>.md` 的 frontmatter `category` 字段(PR-5 已写入)
    + 反向链接段 `## 反向链接` 列出关联论文。
    """
    result: dict[str, dict] = {}
    root = Path(docs_dir)
    if not root.exists():
        return result
    for p in root.rglob("*.md"):
        text = _read_text(p)
        # 抽 frontmatter 中的 concept_id / category
        m_fm = re.search(r"^---\s*$([\s\S]*?)^---\s*$", text, re.MULTILINE)
        if not m_fm:
            continue
        slug_m = re.search(r"concept_id:\s*['\"]?([\w-]+)", m_fm.group(1))
        cat_m = re.search(r"category:\s*['\"]?(\w+)", m_fm.group(1))
        if not slug_m:
            continue
        slug = slug_m.group(1)
        category = cat_m.group(1) if cat_m else "other"
        # 抽 ## 反向链接 段下的 [[paper_id]] 形式
        back_m = re.search(r"##\s*反向链接\s*$([\s\S]*?)(?=^##\s|\Z)", text, re.MULTILINE)
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
) -> list[dict]:
    """返回 top-N 概念对 (method × problem) 零共现的 gap。

    对齐 Polaris `_concept_holes`:
    - 取 category ∈ {method, architecture, methodology} 的 top-N concepts
    - 取 category == "problem" 的 top-N concepts
    - 枚举 (method, problem) 对,**跳过有共现论文的**
    - 按 coverage (|papers_m| + |papers_p|) 降序,返 top `_HOLE_MAX_PAIRS`
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

    pairs: list[tuple[int, dict]] = []
    for m_slug, m_data in methods:
        for p_slug, p_data in problems:
            if m_data["papers"] & p_data["papers"]:
                continue  # 共现 → 跳过
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
# 2. 趋势速度 — 对齐 Polaris _trend_concepts (actions_ideas.py:320-335)
# ============================================================================

_DATE_RE = re.compile(r"(?:published_at|date|generated_at):\s*['\"]?(\d{4}-\d{2}-\d{2})")


def trend_concepts(
    docs_dir: str,
    window_days: int = TREND_WINDOW_DAYS,
    top_n: int = TREND_MAX,
) -> list[dict]:
    """近 `window_days` 天的文档中,概念出现频次 top-N。"""
    cutoff = date.today() - timedelta(days=window_days)
    counts: Counter[str] = Counter()

    # 索引:concept → 最近出现的 docs
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
        # frontmatter.concepts 段是结构化的 slug 列表
        m_fm = re.search(r"^---\s*$([\s\S]*?)^---\s*$", text, re.MULTILINE)
        if not m_fm:
            continue
        m_concepts = re.search(r"^concepts:\s*$\s*((?:[-+]?\s+-\s+slug:\s*[\w-]+.*\n?)+)",
                                m_fm.group(1), re.MULTILINE)
        if not m_concepts:
            continue
        for slug in re.findall(r"-\s+slug:\s*([\w-]+)", m_concepts.group(1)):
            counts[slug] += 1

    # 按 count desc, name asc, 过滤 count < 2
    sorted_pairs = sorted(counts.items(), key=lambda x: (-x[1], x[0]))[:top_n]
    return [{"concept": k, "recent_papers": v} for k, v in sorted_pairs if v >= 2]


# ============================================================================
# 3. 论文 limitations — 对齐 Polaris _limitation_excerpts (actions_ideas.py:338-350)
# ============================================================================

# 修复 mojibake(原版 `������`):Polaris 中文关键词是"局限性"——完整匹配 "局限性"/"limitations"/"future work" 等
_LIMIT_HEADING_RE = re.compile(
    r"(?im)^#{1,6}\s*(?:局限性|limitations?|future\s+work|future\s+directions?|未来工作|不足)\s*$([\s\S]*?)(?=^#{1,6}\s|\Z)"
)
_LIMIT_INLINE_RE = re.compile(
    r"(?i)(?:limitation|future work|局限|不足)[^.。\n]{0,200}",
    re.UNICODE,
)


def limitation_excerpts(docs_dir: str) -> list[dict]:
    """返回 `## 局限性` 段内容,无段则降级到正文关键词。

    对齐 Polaris:每篇最多 2 段,每段前 600 字符。
    """
    result: list[dict] = []
    for p in _files(docs_dir):
        text = _read_text(p)
        m = _LIMIT_HEADING_RE.search(text)
        excerpts: list[str] = []
        if m:
            excerpt = m.group(1).strip()
            if len(excerpt) >= 60:
                excerpts.append(excerpt[:_LIMIT_EXCERPT_CHARS])
        else:
            # 降级:inline 关键词命中
            for hit in _LIMIT_INLINE_RE.findall(text):
                if len(hit.strip()) >= 60:
                    excerpts.append(hit.strip()[:_LIMIT_EXCERPT_CHARS])
                    if len(excerpts) >= _LIMIT_MAX_EXCERPTS:
                        break
        for ex in excerpts[:_LIMIT_MAX_EXCERPTS]:
            result.append({"paper": str(p), "excerpt": ex})
    return result


# ============================================================================
# 4. 综述缺口 — Polaris forge.gap_analysis 的 LLM 部分,DPR v1 跳过
# ============================================================================

def survey_gap(arxiv_search, window_days: int = 365) -> list[dict]:
    """通过注入的 arxiv_search callable 检索;无可用 callable 返 []。

    不在 v1 范围:Polaris 是 LLM-driven;DPR 选择纯 deterministic,
    用上述 3 信号 + concept_paper_map 已够"研究空白"提示。
    """
    if arxiv_search is None:
        return []
    try:
        result = arxiv_search("survey OR review", window_days=window_days)
        return result if isinstance(result, list) else []
    except Exception:
        return []


# ============================================================================
# 顶层 collect_signals — 对齐 Polaris forge.collect_signals
# ============================================================================

def collect_signals(archive_dir: str, config: dict | None = None) -> dict[str, list]:
    """聚合 4 信号,返 `{signal_name: [items]}` 形状。

    `config` 可选键:
      - docs_dir: 替代 archive_dir(默认 archive_dir)
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
        "survey_gap": survey_gap(cfg.get("arxiv_search"),
                                 cfg.get("survey_window_days", 365)),
    }


__all__ = [
    "HOLE_METHOD_CATEGORIES", "HOLE_TOP_CONCEPTS", "HOLE_MAX_PAIRS",
    "TREND_WINDOW_DAYS", "TREND_MAX",
    "concept_paper_map", "concept_holes", "trend_concepts",
    "limitation_excerpts", "survey_gap", "collect_signals",
]
