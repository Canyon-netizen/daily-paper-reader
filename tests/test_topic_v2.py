"""PR-6 topic_v2 orchestrator — 单测

覆盖:
    1. 信号采集 → Idea 生成
    2. Session 加载/保存
    3. 完整流程:signals → ideas → debate → 落盘
    4. CLI entry point
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.topic_v2 import (
    SESSION_STORE,
    DEFAULT_PERSONAS,
    DEFAULT_ROUNDS,
    _load_session, _save_session,
    _generate_ideas,
    run_topic_v2,
)


# ----------------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clean_session(tmp_path, monkeypatch):
    """每个测试用 tmp_path 替代 SESSION_STORE。"""
    monkeypatch.chdir(tmp_path)
    yield
    # cleanup
    f = Path(SESSION_STORE)
    if f.exists():
        f.unlink()


@pytest.fixture
def mock_signals():
    return {
        "concept_holes": [
            {"method": "rag", "problem": "hallucination", "method_papers": ["p1"], "problem_papers": ["p2"], "coverage": 2}
        ],
        "trends": [
            {"concept": "agent-benchmark", "recent_papers": 3}
        ],
        "limitations": [
            {"paper": "/p1.md", "excerpt": "本文存在 small sample 问题"}
        ],
        "survey_gap": [
            {"reason": "covered by survey"}
        ],
    }


@pytest.fixture
def stub_judge():
    """确定性 judge:每场 a 赢(对齐单测期望)。"""
    def _j(a, b):
        return {"winner": "a", "reason": "test stub"}
    return _j


# ----------------------------------------------------------------------------
# Session 读写
# ----------------------------------------------------------------------------

def test_load_session_empty(tmp_path):
    assert _load_session() == {}


def test_save_and_load_session(tmp_path):
    s = {"sessionId": "abc123", "foo": "bar"}
    _save_session(s)
    assert _load_session() == s
    assert json.loads(Path(SESSION_STORE).read_text(encoding="utf-8")) == s


# ----------------------------------------------------------------------------
# _generate_ideas
# ----------------------------------------------------------------------------

def test_generate_ideas_from_signals(mock_signals):
    ideas = _generate_ideas(mock_signals, "session_xyz")
    assert len(ideas) == 4   # 1 hole + 1 trend + 1 limit + 1 survey_gap
    # 每个 idea 必有 id + title + depth + goal + evidence + signals + parent_session_id
    for idea in ideas:
        assert "id" in idea and len(idea["id"]) >= 8
        assert idea["title"]
        assert idea["depth"] == "sketch"
        assert idea["goal"]
        assert idea["evidence"]
        assert idea["signals"]
        assert idea["parent_session_id"] == "session_xyz"


def test_generate_ideas_handles_empty_signals():
    ideas = _generate_ideas({}, "s")
    assert ideas == []


def test_generate_ideas_preserves_signal_type():
    """每条 idea 必带自己来源信号(signal traceability)。"""
    signals = {
        "concept_holes": [{"method": "a", "problem": "b", "method_papers": [], "problem_papers": [], "coverage": 0}],
        "trends": [{"concept": "x", "recent_papers": 2}],
        "limitations": [{"paper": "/p", "excerpt": "lim"}],
        "survey_gap": [{"reason": "gap"}],
    }
    ideas = _generate_ideas(signals, "s")
    sources = [i["signals"][0] for i in ideas]
    assert sources == ["concept_holes", "trends", "limitations", "survey_gap"]


# ----------------------------------------------------------------------------
# run_topic_v2 — 完整流程
# ----------------------------------------------------------------------------

def test_run_topic_v2_writes_session(tmp_path, mock_signals, stub_judge, monkeypatch):
    """集成测试: 走通 signals→ideas→debate→session 写盘。"""
    # 用 monkeypatch 替代 collect_signals,避免对真实仓库目录扫描
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    result = run_topic_v2(session_id="test_session", judge_llm_call=stub_judge)
    assert result["sessionId"] == "test_session"
    assert "debate_progress" in result
    progress = result["debate_progress"]
    assert progress["session_id"] == "test_session"
    assert progress["personas"] == DEFAULT_PERSONAS
    assert progress["rounds"] == DEFAULT_ROUNDS
    assert len(progress["ideas"]) == 4


def test_run_topic_v2_writes_archive_files(tmp_path, mock_signals, stub_judge, monkeypatch):
    """archive/<session_id>/debate/idea_<id>.json 应被写出。"""
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    result = run_topic_v2(session_id="archive_test", judge_llm_call=stub_judge)
    archive_dir = Path("archive") / "archive_test" / "debate"
    assert archive_dir.exists()
    files = list(archive_dir.glob("idea_*.json"))
    assert len(files) == 4
    # 每个文件含完整 idea dict
    first = json.loads(files[0].read_text(encoding="utf-8"))
    assert "id" in first and "title" in first and "elo_rating" in first


def test_run_topic_v2_new_session_id(tmp_path, mock_signals, stub_judge, monkeypatch):
    """不传 session_id 时,自动新建。"""
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    result = run_topic_v2(judge_llm_call=stub_judge)
    assert result["sessionId"]
    assert len(result["sessionId"]) == 8   # uuid4().hex[:8]


def test_run_topic_v2_stub_judge(tmp_path, mock_signals, monkeypatch):
    """无 judge 时,默认 stub 返 tie,ideas 仅按初始 elo 排序。"""
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    result = run_topic_v2(session_id="stub_test", judge_llm_call=None)
    progress = result["debate_progress"]
    # 所有 idea elo 应仍为 1200 (tie 不改 elo)
    for idea in progress["ideas"]:
        assert idea["elo_rating"] == 1200.0


# ----------------------------------------------------------------------------
# Elo 排名验证
# ----------------------------------------------------------------------------

def test_run_topic_v2_a_wins_elo_increases(tmp_path, mock_signals, stub_judge, monkeypatch):
    """stub_judge 总是返 'a' 赢,被 a 配对的 idea 排名应更靠前。"""
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    result = run_topic_v2(session_id="win_test", judge_llm_call=stub_judge)
    ideas = result["debate_progress"]["ideas"]
    # 第一个 idea(最高 elo)的 wins >= 1
    top_idea = ideas[0]
    assert top_idea["wins"] >= 1
    assert top_idea["elo_rating"] > 1200.0
