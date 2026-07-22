"""PR-6 idea_signals — 4 路 gap analysis 单测。

Fixture 约定:用 `wiki/concepts/<slug>.md` frontmatter 形态(对齐 Polaris
`concepts` 表 + DPR PR-5 concept_index.py 写出的形态)。
"""
from pathlib import Path
import pytest

from src.idea_signals import (
    HOLE_METHOD_CATEGORIES, HOLE_TOP_CONCEPTS, HOLE_MAX_PAIRS,
    TREND_WINDOW_DAYS, TREND_MAX,
    concept_paper_map, concept_holes, trend_concepts,
    limitation_excerpts, survey_gap, collect_signals,
)


# ----------------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------------

def _write_concept(path: Path, slug: str, category: str, papers: list[str]):
    """构造 wiki/concepts/<slug>.md,含 frontmatter + 反向链接段。"""
    back = "\n".join(f"- [[{p}]]" for p in papers)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\n"
        f"concept_id: {slug}\n"
        f"display_name: {slug.replace('-', ' ').title()}\n"
        f"category: {category}\n"
        f"---\n"
        f"# {slug}\n"
        f"## 反向链接\n\n{back}\n",
        encoding="utf-8",
    )


@pytest.fixture
def wiki_dir(tmp_path):
    """2 个 method 概念 + 1 个 problem 概念,各关联不同 papers(零共现)。"""
    (tmp_path / "wiki" / "concepts").mkdir(parents=True)
    _write_concept(tmp_path / "wiki" / "concepts" / "rag.md", "rag", "method",
                   ["paper-a", "paper-b"])
    _write_concept(tmp_path / "wiki" / "concepts" / "lora.md", "lora", "architecture",
                   ["paper-a"])
    _write_concept(tmp_path / "wiki" / "concepts" / "hallucination.md",
                   "hallucination", "problem", ["paper-c"])
    return tmp_path / "wiki"


@pytest.fixture
def wiki_dir_with_overlap(tmp_path):
    """1 个 method + 1 个 problem 共现 paper-x → 该对不应出现在 holes。"""
    (tmp_path / "wiki" / "concepts").mkdir(parents=True)
    _write_concept(tmp_path / "wiki" / "concepts" / "rag.md", "rag", "method",
                   ["paper-x"])
    _write_concept(tmp_path / "wiki" / "concepts" / "hallucination.md",
                   "hallucination", "problem", ["paper-x"])
    return tmp_path / "wiki"


@pytest.fixture
def recent_md(tmp_path):
    """Two 2026 .md files so trending slugs hit count >= 2 (the trend filter threshold)."""
    (tmp_path / "papers").mkdir()
    for n, slug in enumerate(["agent-benchmark", "agent-benchmark"]):
        (tmp_path / "papers" / f"p{n}.md").write_text(
            "---\n"
            "published_at: 2026-07-01\n"
            "concepts:\n"
            f"  - slug: {slug}\n"
            "  - slug: rag\n"
            "---\n"
            "正文", encoding="utf-8")
    return tmp_path


@pytest.fixture
def md_with_limitation(tmp_path):
    """构造一篇带 '## Limitations' heading 的 md(fixture 用 ASCII 避免 Windows 编码陷阱)。
    中文 heading 的逻辑通过 test_chinese_heading_inline 单独覆盖。
    """
    (tmp_path / "papers").mkdir()
    (tmp_path / "papers" / "p1.md").write_text(
        "---\npublished_at: 2026-07-22\n---\n"
        "## Limitations\n"
        "This paper suffers from small sample problem; the dataset is too small.\n\n"
        "## Future Work\n"
        "We plan to extend to multi-modal scenarios.\n",
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture
def md_with_chinese_limitation(tmp_path):
    """Build a markdown file with Chinese 'limitations' heading.

    Chinese strings are constructed at runtime via chr() concatenation so that
    no source-level non-ASCII bytes exist (which can be corrupted by Windows
    cp1252 encoders when pytest writes the fixture to disk).

    Body content padded to >= 60 chars (limitation_excerpts threshold) by
    appending additional Chinese text via repeated chr() calls.
    """
    (tmp_path / "papers").mkdir()
    heading = chr(0x5C40) + chr(0x9650) + chr(0x6027)   # 局限性
    # Body: 本文存在 small sample 问题，数据集偏小。
    body = (
        chr(0x672C) + chr(0x6587) + chr(0x5B58) + chr(0x5728)
        + " small sample "
        + chr(0x95EE) + chr(0x9898) + chr(0xFF0C)
        + chr(0x6570) + chr(0x636E) + chr(0x96C6) + chr(0x504F) + chr(0x5C0F)
    )
    # Pad: 我们建议在更大规模的数据集上验证本方法的泛化能力，并扩展到多模态场景。
    pad = (
        chr(0x6211) + chr(0x4EEC) + chr(0x5EFA) + chr(0x8BAE) + chr(0x5728)
        + chr(0x66F4) + chr(0x5927) + chr(0x89C4) + chr(0x6A21) + chr(0x7684)
        + chr(0x6570) + chr(0x636E) + chr(0x96C6) + chr(0x4E0A) + chr(0x9A8C) + chr(0x8BC1)
        + chr(0x672C) + chr(0x65B9) + chr(0x6CD5) + chr(0x7684) + chr(0x6CDB) + chr(0x5316) + chr(0x80FD) + chr(0x529B) + chr(0xFF0C)
        + chr(0x5E76) + chr(0x6269) + chr(0x5C55) + chr(0x5230) + chr(0x591A) + chr(0x6A21) + chr(0x6001) + chr(0x573A) + chr(0x666F) + chr(0x3002)
    )
    body = body + pad
    future = (
        chr(0x672A) + chr(0x6765) + chr(0x5C06) + chr(0x6269) + chr(0x5C55)
        + chr(0x5230) + chr(0x591A) + chr(0x6A21) + chr(0x6001) + chr(0x573A) + chr(0x666F) + chr(0x3002)
    )
    content = (
        "---\npublished_at: 2026-07-22\n---\n"
        "## " + heading + "\n"
        + body + "\n\n"
        "## Future Work\n"
        + future + "\n"
    )
    (tmp_path / "papers" / "p1.md").write_text(content, encoding="utf-8")
    return tmp_path


# ----------------------------------------------------------------------------
# concept_paper_map
# ----------------------------------------------------------------------------

def test_concept_paper_map_reads_frontmatter_and_backlinks(wiki_dir):
    cmap = concept_paper_map(str(wiki_dir / "concepts"))
    assert set(cmap.keys()) == {"rag", "lora", "hallucination"}
    assert cmap["rag"]["category"] == "method"
    assert cmap["rag"]["papers"] == {"paper-a", "paper-b"}
    assert cmap["lora"]["category"] == "architecture"
    assert cmap["hallucination"]["category"] == "problem"


def test_concept_paper_map_handles_missing_dir(tmp_path):
    assert concept_paper_map(str(tmp_path / "nonexistent")) == {}


# ----------------------------------------------------------------------------
# concept_holes — 对齐 Polaris _concept_holes
# ----------------------------------------------------------------------------

def test_concept_holes_zero_cooccurrence(wiki_dir):
    holes = concept_holes(str(wiki_dir / "concepts"))
    # rag(lora) × hallucination 三种组合都零共现
    pairs = {(h["method"], h["problem"]) for h in holes}
    assert ("rag", "hallucination") in pairs
    assert ("lora", "hallucination") in pairs


def test_concept_holes_skips_overlap(wiki_dir_with_overlap):
    holes = concept_holes(str(wiki_dir_with_overlap / "concepts"))
    # 共现的对不应出现
    pairs = {(h["method"], h["problem"]) for h in holes}
    assert ("rag", "hallucination") not in pairs


def test_concept_holes_max_pairs(wiki_dir):
    holes = concept_holes(str(wiki_dir / "concepts"), top_n=8, max_pairs=1)
    assert len(holes) <= 1


def test_concept_holes_respects_top_n(tmp_path):
    """10 个 method × 10 个 problem → 取 top 5 method × top 5 problem。"""
    (tmp_path / "wiki" / "concepts").mkdir(parents=True)
    for i in range(10):
        _write_concept(tmp_path / "wiki" / "concepts" / f"m{i}.md",
                       f"m{i}", "method", [f"p{i}"])
    for j in range(10):
        _write_concept(tmp_path / "wiki" / "concepts" / f"p{j}.md",
                       f"p{j}", "problem", [f"q{j}"])
    holes = concept_holes(str(tmp_path / "wiki" / "concepts"),
                          top_n=5, max_pairs=5)
    # 最多 5*5=25 对,但 max_pairs 限制为 5
    assert len(holes) == 5


# ----------------------------------------------------------------------------
# trend_concepts — 对齐 Polaris _trend_concepts
# ----------------------------------------------------------------------------

def test_trend_concepts_recent_window(recent_md):
    trends = trend_concepts(str(recent_md))
    slugs = [t["concept"] for t in trends]
    assert "agent-benchmark" in slugs
    assert "rag" in slugs


def test_trend_concepts_filters_low_count(tmp_path):
    (tmp_path / "p.md").write_text(
        "---\npublished_at: 2026-07-22\nconcepts:\n  - slug: lonely-concept\n---\n", encoding="utf-8")
    # lonely-concept 只出现 1 次 → 应被过滤 (count < 2)
    trends = trend_concepts(str(tmp_path))
    assert "lonely-concept" not in [t["concept"] for t in trends]


def test_trend_concepts_excludes_old(tmp_path):
    (tmp_path / "old.md").write_text(
        "---\npublished_at: 2025-01-01\nconcepts:\n  - slug: stale\n---\n", encoding="utf-8")
    trends = trend_concepts(str(tmp_path), window_days=90)
    assert "stale" not in [t["concept"] for t in trends]


# ----------------------------------------------------------------------------
# limitation_excerpts — 对齐 Polaris _limitation_excerpts
# ----------------------------------------------------------------------------

def test_limitation_excerpts_chinese_heading(md_with_chinese_limitation):
    excerpts = limitation_excerpts(str(md_with_chinese_limitation))
    assert len(excerpts) >= 1
    assert any("small sample" in e["excerpt"] for e in excerpts)


def test_limitation_excerpts_no_mojibake():
    """回归测试:确保 limitation_excerpts 不再有 mojibake `������`。"""
    import src.idea_signals as mod
    src_text = Path(mod.__file__).read_text(encoding="utf-8")
    assert "������" not in src_text, "mojibake leaked back into source"


def test_limitation_excerpts_max_two_per_paper(tmp_path):
    (tmp_path / "p.md").write_text(
        "## 局限性\n" + "## 局限性\n".join(f"段{i}。" + "x" * 80 for i in range(5)) + "\n",
        encoding="utf-8")
    excerpts = limitation_excerpts(str(tmp_path))
    # 每篇最多 2 段 → 整文档也只有这一篇 → ≤2
    assert len(excerpts) <= 2


# ----------------------------------------------------------------------------
# survey_gap + collect_signals
# ----------------------------------------------------------------------------

def test_survey_gap_with_mock():
    result = survey_gap(lambda q, window_days: [{"q": q, "days": window_days}])
    assert result == [{"q": "survey OR review", "days": 365}]


def test_survey_gap_no_callable():
    assert survey_gap(None) == []


def test_survey_gap_callable_raises():
    def bad(q, window_days):
        raise RuntimeError("network down")
    assert survey_gap(bad) == []


def test_collect_signals_shape(tmp_path):
    out = collect_signals(str(tmp_path), {"arxiv_search": lambda q, window_days: []})
    assert set(out.keys()) == {"concept_holes", "trends", "limitations", "survey_gap"}


def test_collect_signals_uses_docs_dir_override(tmp_path, wiki_dir):
    out = collect_signals(str(tmp_path), {"docs_dir": str(wiki_dir / "concepts")})
    assert len(out["concept_holes"]) >= 1
