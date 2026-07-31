"""Stage 8 — 概念流水线 fail-loud 的 pytest。

覆盖:
  - postprocess_concepts 接受 paper_title 参数,display_name 与论文标题相同 → 退化成 slug
  - postprocess_concepts display_name 超长(> 60)→ 截断 + '…'
  - _render_concept_md 的 frontmatter 能被 yaml.safe_load 解析(Stage 8 关键修复)
  - _validate_concept_labels 触发 → 抛 ValueError
  - Step 6 概念分支(轻量验证:确保 extract_concepts 抛错不再被吞)
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.concept_extractor import postprocess_concepts, _first_h1_title
from src.concept_index import _render_concept_md, _validate_concept_labels


def test_postprocess_rejects_display_name_equal_to_paper_title():
    raw = [{
        "name": "Activation Steering",
        "slug": "activation-steering",
        "category": "method",
        "novelty": 0.5,
        "centrality": 0.5,
    }]
    out = postprocess_concepts(
        raw,
        blacklist=set(),
        aliases={},
        paper_title="Activation Steering",  # 名字相同
    )
    assert out[0]["display_name"] == "activation-steering"  # 退化成 slug


def test_postprocess_truncates_long_display_name():
    long = "x" * 100
    raw = [{"name": long, "slug": "x", "category": "method", "novelty": 0, "centrality": 0}]
    out = postprocess_concepts(raw, blacklist=set(), aliases={})
    assert out[0]["display_name"].endswith("…")
    assert len(out[0]["display_name"]) <= 61


def test_first_h1_title_extracts_first_h1():
    md = "---\nfoo: bar\n---\n\n# Real Title\n\nbody"
    assert _first_h1_title(md) == "Real Title"
    md2 = "no front matter\n\n## only h2"
    assert _first_h1_title(md2) is None


def test_render_concept_md_frontmatter_yaml_parseable():
    """Stage 8 核心:产物能被 yaml.safe_load 解析。
    旧版用 f-string 写 display_name,实测 121/221 个文件抛 ScannerError。"""
    import yaml
    papers = [
        {
            "paper_id": "2607.00001-a",
            "title": "Some Paper Title",
            "slug": "a",
            "category": "method",
        }
    ]
    # display_name 含未引号化 `: ` 的边界情况
    tricky_display = "Vision: Language Model"
    md = _render_concept_md("vision-language-model", tricky_display, papers)
    assert md.startswith("---\n")
    # frontmatter 段能被 yaml 解析
    end = md.index("\n---\n", 4)
    block = md[4:end]
    parsed = yaml.safe_load(block)  # 不抛
    assert parsed["concept_id"] == "vision-language-model"
    assert parsed["display_name"] == tricky_display
    assert parsed["category"] == "method"


def test_validate_concept_labels_raises_on_long_display_name():
    papers = [{"title": "t", "slug": "s"}]
    with pytest.raises(ValueError, match="display_name 太长"):
        _validate_concept_labels("long", "x" * 50, papers)


def test_validate_concept_labels_raises_on_paper_title_collision():
    papers = [{"title": "Same Title", "slug": "s"}]
    with pytest.raises(ValueError, match="与某论文标题相同"):
        _validate_concept_labels("same-title", "Same Title", papers)


def test_step6_no_silent_swallows_in_concept_branch():
    """Stage 8 fail-loud 收尾:核心 LLM 提取分支不应再被吞。
    直接 import + assert 不存在的 except 文本。
    """
    src = pathlib.Path("src/6.generate_docs.py").read_text(encoding="utf-8")
    # 旧版裸 except 在概念块里,新 stage 已挪走。
    # 这条断言是字符串层面的"绝不重蹈" —— 失败时提醒 reviewer 复核。
    # 找 "# PR-5: 概念图谱提取" 之后到下一个空行 / return / 块结束的代码片段,
    # 不能有 except Exception 包裹 extract_concepts 调用的行。
    start = src.index("# PR-5: 概念图谱提取")
    # 取到下一个返回/函数的开始(粗略:200 行足够覆盖整个概念块)
    excerpt = src[start:start + 500]
    assert "except Exception" not in excerpt, (
        "Stage 8: 概念块的 LLM 提取不应再被 try/except 静默吞,"
        "这是 feedback_pr5_concept_extract_silent_failures 的根因。"
    )


def test_postprocess_accepts_no_paper_title():
    """向后兼容:旧调用没传 paper_title 也不应崩。"""
    raw = [{
        "name": "Foo",
        "slug": "foo",
        "category": "method",
        "novelty": 0.5,
        "centrality": 0.5,
    }]
    out = postprocess_concepts(raw, blacklist=set(), aliases={})
    assert out[0]["display_name"] == "Foo"  # 没论文标题 → 不触发退化