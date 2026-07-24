"""PR-5 — concept_extractor 单测。

覆盖:
1-4. wiki_slug 各种形态
5.   blacklist 过滤
6.   alias 合并
7.   category 校验
8.   slug pattern 校验(LLM 给 "RAG_2" → 改写为 "rag-2")
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from src.concept_extractor import (
    CATEGORY_ENUM,
    CONCEPT_EXTRACT_SYSTEM_PROMPT,
    build_concept_prompt,
    extract_concepts,
    load_aliases,
    load_blacklist,
    postprocess_concepts,
)
from src.concept_slug import wiki_slug


# ---- 1-4: wiki_slug --------------------------------------------------

def test_wiki_slug_rag():
    assert wiki_slug("RAG") == "rag"


def test_wiki_slug_lora_low_rank():
    # "LoRA: Low-Rank Adaptation" → lora-low-rank-adaptation
    assert wiki_slug("LoRA: Low-Rank Adaptation") == "lora-low-rank-adaptation"


def test_wiki_slug_keeps_cjk():
    # CJK 字符应当保留(落在 \w 一-鿿 范围)
    assert wiki_slug("中文概念") == "中文概念"


def test_wiki_slug_falls_back_to_sha256_when_empty():
    # "!!!" → 全塌缩为 "-" 后 strip, 回落 sha256[:12]
    s = wiki_slug("!!!")
    assert len(s) == 12
    assert s.isalnum()


# ---- 5: blacklist 过滤 ----------------------------------------------

def test_blacklist_filter():
    # 显式注入 fake blacklist + 非空 aliases
    blacklist = {"fakerag"}
    aliases = {"realrag": "real-rag"}
    raw = [
        {"name": "FakeRAG", "slug": "fakerag", "category": "method", "novelty": 0.5, "centrality": 0.5},
        {"name": "RealRAG", "slug": "realrag", "category": "method", "novelty": 0.5, "centrality": 0.5},
    ]
    out = postprocess_concepts(raw, blacklist=blacklist, aliases=aliases)
    slugs = [c["slug"] for c in out]
    assert "fakerag" not in slugs
    # 命中 alias 折叠
    assert "real-rag" in slugs


def test_load_blacklist_reads_yaml(tmp_path, monkeypatch):
    # 写到临时文件并通过 cfg 注入路径
    p = tmp_path / "bl.yaml"
    p.write_text("foo: 1\nbar: 2\n", encoding="utf-8")
    bl = load_blacklist({"blacklist_file": str(p)})
    assert "foo" in bl
    assert "bar" in bl


def test_load_blacklist_missing_file_returns_empty():
    assert load_blacklist({"blacklist_file": "no/such/file.yaml"}) == set()


# ---- 6: alias 合并 ---------------------------------------------------

def test_alias_merge_rag_to_canonical():
    out = postprocess_concepts(
        [{"name": "RAG", "slug": "rag", "category": "method", "novelty": 0.0, "centrality": 0.9}],
        blacklist=set(),
        aliases={"rag": "retrieval-augmented-generation"},
    )
    assert len(out) == 1
    assert out[0]["slug"] == "retrieval-augmented-generation"


def test_load_aliases_reads_yaml(tmp_path):
    p = tmp_path / "aliases.yaml"
    p.write_text("a: b\nc: d\n", encoding="utf-8")
    aliases = load_aliases({"aliases_file": str(p)})
    assert aliases.get("a") == "b"
    assert aliases.get("c") == "d"


# ---- 7: category 校验 ------------------------------------------------

def test_category_out_of_enum_falls_back_to_other():
    out = postprocess_concepts(
        [{"name": "Foo", "slug": "foo", "category": "madeup-category", "novelty": 0.0, "centrality": 0.5}],
        blacklist=set(),
        aliases={},
    )
    assert out[0]["category"] == "other"


def test_category_enum_constant():
    assert CATEGORY_ENUM == {
        "method",
        "architecture",
        "methodology",
        "problem",
        "metric",
        "dataset",
        "other",
    }


# ---- 8: slug pattern / 去重 ------------------------------------------

def test_slug_pattern_normalizes_underscore_and_uppercase():
    out = postprocess_concepts(
        [{"name": "RAG_2", "slug": "RAG_2", "category": "method", "novelty": 0.1, "centrality": 0.4}],
        blacklist=set(),
        aliases={},
    )
    assert out[0]["slug"] == "rag-2"


def test_duplicate_slug_dedupes():
    raw = [
        {"name": "RAG", "slug": "rag", "category": "method", "novelty": 0.0, "centrality": 0.9},
        {"name": "RAG again", "slug": "rag", "category": "method", "novelty": 0.1, "centrality": 0.3},
    ]
    out = postprocess_concepts(raw, blacklist=set(), aliases={})
    assert len(out) == 1


def test_novelty_centrality_clamped():
    raw = [
        {"name": "X", "slug": "x", "category": "method", "novelty": 2.0, "centrality": -0.5},
    ]
    out = postprocess_concepts(raw, blacklist=set(), aliases={}, max_concepts=7)
    assert out[0]["novelty"] == 1.0
    assert out[0]["centrality"] == 0.0


# ---- 集成: extract_concepts with mock router -------------------------

class _FakeChoice(dict):
    """OpenAI-style choice — dict-key 协议(见 src/concept_extractor.py:198-202).

    旧版用 MagicMock attribute,导致 response["choices"] / choice["message"]
    / message["content"] 这种 dict-key access 抛 TypeError,被 try/except 吞掉
    返回 []。这是 Polaris §3.1 关注的"dict-key vs attribute 混用导致静默
    返回空 concepts"问题的同类(也是 MEMORY feedback_pr5_concept_extract_silent_failures
    提到的根因模式)。改为继承 dict 后,fixture 与真实 router 行为一致。
    """
    def __init__(self, content: str):
        super().__init__()
        self["message"] = {"content": content}


class _FakeResponse(dict):
    """OpenAI-style response — dict-key 协议."""

    def __init__(self, content: str):
        super().__init__()
        self["choices"] = [_FakeChoice(content)]


def test_extract_concepts_with_mock_router():
    router = MagicMock()
    router.call.return_value = _FakeResponse(
        json.dumps(
            {
                "concepts": [
                    {"name": "RAG", "slug": "rag", "category": "methodology", "novelty": 0.0, "centrality": 0.9},
                    {"name": "Diffusion", "slug": "diffusion", "category": "method", "novelty": 0.2, "centrality": 0.6},
                ]
            }
        )
    )
    out = extract_concepts("# paper", config={}, router=router)
    assert len(out) == 2
    # 命中 alias rag → retrieval-augmented-generation
    assert any(c["slug"] == "retrieval-augmented-generation" for c in out)


def test_extract_concepts_handles_router_failure():
    router = MagicMock()
    router.call.side_effect = RuntimeError("LLM down")
    out = extract_concepts("# paper", config={}, router=router)
    assert out == []


def test_build_concept_prompt_truncates_long_input():
    md = "x" * 20000
    prompt = build_concept_prompt(md)
    assert "truncated" in prompt
    # 截断到 8000 + 包装行,不会超过 9000
    assert len(prompt) < 9000


def test_concept_extract_system_prompt_contains_categories():
    for cat in ["method", "architecture", "methodology", "problem", "metric", "dataset", "other"]:
        assert cat in CONCEPT_EXTRACT_SYSTEM_PROMPT


def test_max_concepts_per_paper_limit():
    raw = [
        {"name": f"C{i}", "slug": f"c-{i}", "category": "method", "novelty": 0.0, "centrality": 0.5}
        for i in range(20)
    ]
    out = postprocess_concepts(raw, blacklist=set(), aliases={}, max_concepts=3)
    assert len(out) == 3