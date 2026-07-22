"""PR-5 — concept_index 单测。

覆盖:
9.  rebuild() 后 wiki/concepts/<slug>.md 包含「出处」段
10. min_appearances=2 时,出现 1 次的 concept 不建独立 md
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from src.concept_index import (
    _replace_block,
    rebuild,
    scan_papers_with_wiki_compiled,
    _parse_front_matter,
)


def _write_paper(tmp_path: Path, name: str, *, wiki_compiled: bool, concepts: list) -> Path:
    fm_lines = [
        "---",
        "title: 'Some Paper'",
        f"paper_id: 'papers/{name}'",
        "wiki_compiled: true" if wiki_compiled else "wiki_compiled: false",
    ]
    if concepts:
        fm_lines.append("concepts:")
        for c in concepts:
            fm_lines.append(f"  - slug: {c['slug']}")
            fm_lines.append(f"    display_name: \"{c.get('display_name', c['slug'])}\"")
            fm_lines.append(f"    category: {c.get('category', 'method')}")
            fm_lines.append(f"    novelty: {c.get('novelty', 0.0)}")
            fm_lines.append(f"    centrality: {c.get('centrality', 0.0)}")
    fm_lines.append("---")
    fm_lines.append("\n# paper body\n")
    p = tmp_path / f"{name}.md"
    p.write_text("\n".join(fm_lines), encoding="utf-8")
    return p


def test_scan_only_wiki_compiled_papers(tmp_path):
    _write_paper(tmp_path, "a-1", wiki_compiled=True, concepts=[{"slug": "rag"}])
    _write_paper(tmp_path, "a-2", wiki_compiled=False, concepts=[{"slug": "rag"}])
    papers = scan_papers_with_wiki_compiled(str(tmp_path))
    assert len(papers) == 1
    assert papers[0]["paper_id"] == "papers/a-1"


def test_scan_picks_up_concepts(tmp_path):
    _write_paper(
        tmp_path,
        "a-3",
        wiki_compiled=True,
        concepts=[
            {"slug": "rag", "display_name": "RAG", "category": "methodology"},
            {"slug": "lora", "display_name": "LoRA", "category": "method"},
        ],
    )
    papers = scan_papers_with_wiki_compiled(str(tmp_path))
    assert len(papers) == 1
    slugs = {c["slug"] for c in papers[0]["concepts"]}
    assert slugs == {"rag", "lora"}


def test_rebuild_creates_concept_md_with_origin_section(tmp_path):
    docs = tmp_path / "docs"
    wiki = tmp_path / "wiki"
    docs.mkdir()
    _write_paper(
        docs,
        "a-rag-1",
        wiki_compiled=True,
        concepts=[{"slug": "rag", "display_name": "RAG", "category": "methodology"}],
    )
    _write_paper(
        docs,
        "a-rag-2",
        wiki_compiled=True,
        concepts=[{"slug": "rag", "display_name": "RAG", "category": "methodology"}],
    )
    rebuild(archive_dir=str(wiki), docs_dir=str(docs), min_appearances=2)

    rag_md = wiki / "concepts" / "rag.md"
    assert rag_md.exists()
    body = rag_md.read_text(encoding="utf-8")
    assert "## 出处" in body
    assert "[[papers/a-rag-1]]" in body
    assert "[[papers/a-rag-2]]" in body
    assert "## 反向链接" in body


def test_min_appearances_skips_singleton(tmp_path):
    docs = tmp_path / "docs"
    wiki = tmp_path / "wiki"
    docs.mkdir()
    _write_paper(
        docs,
        "a-singleton",
        wiki_compiled=True,
        concepts=[{"slug": "lora", "display_name": "LoRA", "category": "method"}],
    )
    rebuild(archive_dir=str(wiki), docs_dir=str(docs), min_appearances=2)
    # 只出现 1 次 → 不建独立 md
    assert not (wiki / "concepts" / "lora.md").exists()


def test_min_appearances_one_creates_md(tmp_path):
    docs = tmp_path / "docs"
    wiki = tmp_path / "wiki"
    docs.mkdir()
    _write_paper(
        docs,
        "a-solo",
        wiki_compiled=True,
        concepts=[{"slug": "lora", "display_name": "LoRA", "category": "method"}],
    )
    rebuild(archive_dir=str(wiki), docs_dir=str(docs), min_appearances=1)
    assert (wiki / "concepts" / "lora.md").exists()


def test_rebuild_updates_existing_concept_md(tmp_path):
    docs = tmp_path / "docs"
    wiki = tmp_path / "wiki"
    wiki_concepts = wiki / "concepts"
    wiki_concepts.mkdir(parents=True)
    docs.mkdir()

    rag_path = wiki_concepts / "rag.md"
    rag_path.write_text(
        "---\nconcept_id: rag\n---\n# Existing\n\n## 出处\n\n- (stale)\n\n## 反向链接\n\n",
        encoding="utf-8",
    )
    _write_paper(
        docs,
        "a-rag-3",
        wiki_compiled=True,
        concepts=[{"slug": "rag", "display_name": "RAG", "category": "methodology"}],
    )
    _write_paper(
        docs,
        "a-rag-4",
        wiki_compiled=True,
        concepts=[{"slug": "rag", "display_name": "RAG", "category": "methodology"}],
    )
    rebuild(archive_dir=str(wiki), docs_dir=str(docs), min_appearances=2)
    body = rag_path.read_text(encoding="utf-8")
    assert "stale" not in body
    assert "[[papers/a-rag-3]]" in body
    assert "[[papers/a-rag-4]]" in body


def test_replace_block_appends_when_missing():
    text = "## 速览\n\n- x"
    new = _replace_block(text, "出处", "## 出处\n\n- foo")
    assert "## 出处" in new
    assert "## 速览" in new


def test_replace_block_replaces_existing():
    text = (
        "# top\n\n"
        "## 出处\n\n"
        "- old1\n- old2\n\n"
        "## 反向链接\n\n"
        "- old\n"
    )
    out = _replace_block(text, "出处", "## 出处\n\n- new1")
    assert "- new1" in out
    assert "old1" not in out
    assert "## 反向链接" in out


def test_parse_front_matter_returns_concepts_list():
    text = (
        "---\n"
        "title: X\n"
        "wiki_compiled: true\n"
        "concepts:\n"
        "  - slug: rag\n"
        "    display_name: RAG\n"
        "    category: methodology\n"
        "    novelty: 0.0\n"
        "    centrality: 0.9\n"
        "---\n"
        "body"
    )
    meta, body = _parse_front_matter(text)
    assert meta.get("wiki_compiled") is True
    assert isinstance(meta.get("concepts"), list)
    assert meta["concepts"][0]["slug"] == "rag"
    assert body.strip() == "body"


def test_rebuild_returns_concept_to_papers_map(tmp_path):
    docs = tmp_path / "docs"
    wiki = tmp_path / "wiki"
    docs.mkdir()
    _write_paper(
        docs,
        "p1",
        wiki_compiled=True,
        concepts=[{"slug": "rag"}, {"slug": "lora"}],
    )
    _write_paper(
        docs,
        "p2",
        wiki_compiled=True,
        concepts=[{"slug": "rag"}],
    )
    result = rebuild(archive_dir=str(wiki), docs_dir=str(docs), min_appearances=1)
    assert set(result.keys()) == {"rag", "lora"}
    assert len(result["rag"]) == 2
    assert len(result["lora"]) == 1


def test_scan_skips_paper_without_concepts(tmp_path):
    _write_paper(tmp_path, "a-empty", wiki_compiled=True, concepts=[])
    papers = scan_papers_with_wiki_compiled(str(tmp_path))
    assert papers == []