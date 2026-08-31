"""Per-paper method debate feature tests."""

import json
import os
import pytest
from unittest.mock import MagicMock, patch

# Import the module under test
from src.method_debate import (
    generate_method_debate,
    load_paper_text,
    STAGE_NAME,
)


# Test fixtures
SAMPLE_TITLE = "Teaching LLMs to Self-Evolve: Cultivating Core Meta-Skills with Reinforcement Learning"
SAMPLE_ABSTRACT = """
Test-time scaling through iterative self-evolution with environment feedback, as demonstrated by AlphaEvolve,
shows remarkable performance gains. We hypothesize that the success of such evolution frameworks hinges on
meta-skills, such as self-reflection with environment feedback, that enable effective multi-round refinement.
To bridge this gap, we present META EVOLVE, a framework designed to develop these meta-skills via a
data synthesis pipeline, evolution-aware reinforcement learning (RL), and inference-time evolutionary search.
"""

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "method_debate_sample.txt")


# ----------------------------------------------------------------------------
# Schema validation tests
# ----------------------------------------------------------------------------

def test_schema_valid():
    """Test that the function returns correct schema structure when mocked."""
    mock_response = {
        "choices": [{
            "message": {
                "content": json.dumps({
                    "method_pros_cons": {
                        "META EVOLVE框架": {
                            "pros": ["显式培养自演化元技能", "可迁移到开放任务"],
                            "cons": ["依赖代码执行奖励信号", "训练数据合成复杂"]
                        }
                    },
                    "method_comparison": "本文仅提出META EVOLVE一个方法，未进行多方法对比"
                }, ensure_ascii=False)
            }
        }],
        "model": "deepseek/deepseek-chat"
    }

    with patch("src.method_debate.get_llm_router") as mock_router:
        mock_router_instance = MagicMock()
        mock_router_instance.call.return_value = mock_response
        mock_router.return_value = mock_router_instance

        result = generate_method_debate(SAMPLE_TITLE, SAMPLE_ABSTRACT, None)

        assert result is not None
        assert "method_pros_cons" in result
        assert "method_comparison" in result
        assert "method_debate_model" in result
        assert "method_debate_generated_at" in result
        assert result["method_debate_model"] == "deepseek/deepseek-chat"


# ----------------------------------------------------------------------------
# Single method tests (no cross-method comparison)
# ----------------------------------------------------------------------------

def test_single_method_no_comparison_across():
    """Test single method returns default comparison message."""
    mock_response = {
        "choices": [{
            "message": {
                "content": json.dumps({
                    "method_pros_cons": {
                        "演化轨迹数据合成": {
                            "pros": ["构建训练数据", "可扩展性强"],
                            "cons": ["需要大量代码数据", "多样性过滤复杂"]
                        }
                    },
                    "method_comparison": "本文未提出多个独立方法进行对比"
                }, ensure_ascii=False)
            }
        }],
        "model": "deepseek/deepseek-chat"
    }

    with patch("src.method_debate.get_llm_router") as mock_router:
        mock_router_instance = MagicMock()
        mock_router_instance.call.return_value = mock_response
        mock_router.return_value = mock_router_instance

        result = generate_method_debate(SAMPLE_TITLE, SAMPLE_ABSTRACT, None)

        assert result is not None
        assert len(result["method_pros_cons"]) == 1
        assert result["method_comparison"] == "本文未提出多个独立方法进行对比"


# ----------------------------------------------------------------------------
# Multi-method tests (full schema)
# ----------------------------------------------------------------------------

def test_multi_method_full_schema():
    """Test multi-method returns full schema with comparison."""
    mock_response = {
        "choices": [{
            "message": {
                "content": json.dumps({
                    "method_pros_cons": {
                        "演化轨迹数据合成": {
                            "pros": ["构建训练数据", "可扩展性强"],
                            "cons": ["需要大量代码数据", "多样性过滤复杂"]
                        },
                        "演化感知强化学习": {
                            "pros": ["可验证奖励", "无需人工标注"],
                            "cons": ["依赖执行环境", "训练不稳定"]
                        },
                        "推理时演化搜索": {
                            "pros": ["迭代优化", "发现新解"],
                            "cons": ["计算开销大", "搜索空间大"]
                        }
                    },
                    "method_comparison": "演化轨迹数据合成为训练提供数据基础，演化感知RL从中学习元技能，推理时搜索则在部署阶段实现自我演化"
                }, ensure_ascii=False)
            }
        }],
        "model": "deepseek/deepseek-chat"
    }

    with patch("src.method_debate.get_llm_router") as mock_router:
        mock_router_instance = MagicMock()
        mock_router_instance.call.return_value = mock_response
        mock_router.return_value = mock_router_instance

        result = generate_method_debate(SAMPLE_TITLE, SAMPLE_ABSTRACT, None)

        assert result is not None
        assert len(result["method_pros_cons"]) == 3
        assert "演化轨迹数据合成" in result["method_pros_cons"]
        assert "演化感知强化学习" in result["method_pros_cons"]
        assert "推理时演化搜索" in result["method_pros_cons"]
        assert "演化轨迹数据合成为训练提供数据基础" in result["method_comparison"]


# ----------------------------------------------------------------------------
# Missing paper text (falls back to abstract)
# ----------------------------------------------------------------------------

def test_missing_paper_text_falls_back_to_abstract():
    """Test function works when paper_text is None (uses abstract only)."""
    mock_response = {
        "choices": [{
            "message": {
                "content": json.dumps({
                    "method_pros_cons": {
                        "META EVOLVE": {
                            "pros": ["培养元技能", "可迁移"],
                            "cons": ["依赖代码数据"]
                        }
                    },
                    "method_comparison": "本文未提出多个独立方法进行对比"
                }, ensure_ascii=False)
            }
        }],
        "model": "deepseek/deepseek-chat"
    }

    with patch("src.method_debate.get_llm_router") as mock_router:
        mock_router_instance = MagicMock()
        mock_router_instance.call.return_value = mock_response
        mock_router.return_value = mock_router_instance

        # paper_text is None - should still work
        result = generate_method_debate(SAMPLE_TITLE, SAMPLE_ABSTRACT, None)

        assert result is not None
        # Verify the call was made
        mock_router_instance.call.assert_called_once()


# ----------------------------------------------------------------------------
# LLM failure handling
# ----------------------------------------------------------------------------

def test_llm_failure_returns_none():
    """Test LLM failure returns None gracefully."""
    with patch("src.method_debate.get_llm_router") as mock_router:
        mock_router_instance = MagicMock()
        mock_router_instance.call.side_effect = Exception("API Error")
        mock_router.return_value = mock_router_instance

        result = generate_method_debate(SAMPLE_TITLE, SAMPLE_ABSTRACT, None)

        assert result is None


def test_llm_empty_response_returns_none():
    """Test empty LLM response returns None."""
    mock_response = {
        "choices": [{
            "message": {
                "content": ""
            }
        }]
    }

    with patch("src.method_debate.get_llm_router") as mock_router:
        mock_router_instance = MagicMock()
        mock_router_instance.call.return_value = mock_response
        mock_router.return_value = mock_router_instance

        result = generate_method_debate(SAMPLE_TITLE, SAMPLE_ABSTRACT, None)

        assert result is None


def test_llm_invalid_json_returns_none():
    """Test invalid JSON in response returns None."""
    mock_response = {
        "choices": [{
            "message": {
                "content": "This is not valid JSON"
            }
        }]
    }

    with patch("src.method_debate.get_llm_router") as mock_router:
        mock_router_instance = MagicMock()
        mock_router_instance.call.return_value = mock_response
        mock_router.return_value = mock_router_instance

        result = generate_method_debate(SAMPLE_TITLE, SAMPLE_ABSTRACT, None)

        assert result is None


# ----------------------------------------------------------------------------
# Backfill skip tests
# ----------------------------------------------------------------------------

def test_missing_title_returns_none():
    """Test missing title returns None."""
    result = generate_method_debate("", SAMPLE_ABSTRACT, None)
    assert result is None


def test_router_failure_returns_none():
    """Test router initialization failure returns None."""
    with patch("src.method_debate.get_llm_router") as mock_router:
        mock_router.side_effect = Exception("Router init failed")

        result = generate_method_debate(SAMPLE_TITLE, SAMPLE_ABSTRACT, None)

        assert result is None


# ----------------------------------------------------------------------------
# Prompt body has required keys
# ----------------------------------------------------------------------------

def test_prompt_body_has_required_keys():
    """Test that the prompt body contains required JSON keys."""
    # Read the prompt body file
    prompt_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "config",
        "prompts",
        "method-debate",
        "2026-08-31",
        "body.md"
    )

    if os.path.exists(prompt_path):
        with open(prompt_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Check for required keys in prompt
        assert "method_pros_cons" in content
        assert "method_comparison" in content
        assert "pros" in content
        assert "cons" in content


# ----------------------------------------------------------------------------
# Fixture loading
# ----------------------------------------------------------------------------

def test_load_fixture():
    """Test that the fixture file exists and is readable."""
    assert os.path.exists(FIXTURE_PATH)

    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    assert len(content) > 0
    assert "Teaching LLMs to Self-Evolve" in content


# ----------------------------------------------------------------------------
# Constants
# ----------------------------------------------------------------------------

def test_stage_name_correct():
    """Test that STAGE_NAME is correct."""
    assert STAGE_NAME == "paper.method_debate"


# ----------------------------------------------------------------------------
# Backfill dry-run behavior (regression test for generate-before-check bug)
# ----------------------------------------------------------------------------

def test_backfill_dry_run_skips_llm_call(tmp_path, monkeypatch):
    """process_paper(dry_run=True) must NOT invoke generate_method_debate.

    Regression: previously the LLM call happened before the dry_run check,
    so --dry-run still triggered HTTP 401 when DEEPSEEK_API_KEY was unset.
    """
    from src.maintain import backfill_method_debate

    # Stub generate_method_debate — must never be called.
    called = {"n": 0}

    def fake_generate(*args, **kwargs):
        called["n"] += 1
        return None

    monkeypatch.setattr(backfill_method_debate, "generate_method_debate", fake_generate)

    md_path = tmp_path / "2607.00001v1-test.md"
    md_path.write_text("---\ntitle: Test\nabstract: Test abstract\n---\nbody\n", encoding="utf-8")

    # Mock load_paper_text to return a tiny string.
    monkeypatch.setattr(backfill_method_debate, "load_paper_text", lambda *a, **kw: "fake paper text")

    result = backfill_method_debate.process_paper(str(md_path), dry_run=True)

    assert result is True
    assert called["n"] == 0, "generate_method_debate must not be called when dry_run=True"
