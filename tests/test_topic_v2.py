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
    """无 judge 时,显式 degraded status='not_configured',debate 不跑、debate_log 空。

    plan §4.2 PR-A:judge_llm_call=None 不再伪装成 tie,改返 degraded 状态。
    """
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    result = run_topic_v2(session_id="stub_test", judge_llm_call=None)
    progress = result["debate_progress"]
    # status 显式标 'not_configured',不是 'completed'
    assert progress["status"] == "not_configured"
    # rounds=0,personas 空 —— 不假装跑过辩论
    assert progress["rounds"] == 0
    assert progress["personas"] == []
    # 所有 idea elo 仍是初始 1200(debate 没动它);matches=0 wins=0 debate_log=[]
    for idea in progress["ideas"]:
        assert idea["elo_rating"] == 1200.0
        assert idea["matches"] == 0
        assert idea["wins"] == 0
        assert idea["debate_log"] == []
        # 单 idea 上的 status 同样标 'not_configured'(UI 渲染用)
        assert idea["debate_status"] == "not_configured"


def test_run_topic_v2_real_judge_uses_completed_status(tmp_path, mock_signals, monkeypatch):
    """传了真实 judge 时,status='completed',rounds > 0,personas 非空。"""
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    def real_judge(a, b):
        return {"winner": "a", "reason": "a is better"}

    result = run_topic_v2(session_id="real_judge", judge_llm_call=real_judge)
    progress = result["debate_progress"]
    assert progress["status"] == "completed"
    assert progress["rounds"] > 0
    assert len(progress["personas"]) > 0


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


# ----------------------------------------------------------------------------
# score_ideas — 四维评分
# ----------------------------------------------------------------------------
from src.topic_v2 import score_ideas


def test_no_ideas_returns_empty():
    """空输入 → 空输出,无 LLM 调用。"""
    result = score_ideas([])
    assert result == []


def test_scored_via_mock_call():
    """注入 mock llm_call,验证每个 idea 获得 scores + rationale。"""
    ideas = [
        {"id": "a1", "title": "Idea A", "goal": "Goal A", "signals": ["trends"]},
        {"id": "b2", "title": "Idea B", "goal": "Goal B", "signals": ["limitations"]},
    ]

    mock_response = json.dumps([
        {
            "id": "a1",
            "scores": {"novelty": 8, "feasibility": 6, "operability": 7, "impact": 9},
            "score_rationale": {
                "novelty": "很有新意",
                "feasibility": "技术可行",
                "operability": "实验设计清晰",
                "impact": "领域推进大",
            },
        },
        {
            "id": "b2",
            "scores": {"novelty": 5, "feasibility": 7, "operability": 8, "impact": 6},
            "score_rationale": {
                "novelty": "创新一般",
                "feasibility": "实现难度低",
                "operability": "消融实验可做",
                "impact": "有一定价值",
            },
        },
    ])

    result = score_ideas(ideas, llm_call=lambda p: mock_response)

    assert len(result) == 2
    # Idea A
    assert result[0]["scores"] == {"novelty": 8, "feasibility": 6, "operability": 7, "impact": 9}
    assert result[0]["score_rationale"]["novelty"] == "很有新意"
    # Idea B
    assert result[1]["scores"] == {"novelty": 5, "feasibility": 7, "operability": 8, "impact": 6}
    assert result[1]["score_rationale"]["feasibility"] == "实现难度低"


def test_scores_clamped_to_0_10():
    """LLM 返回超出范围分数,应被 clamp 到 0-10。"""
    ideas = [{"id": "c1", "title": "Idea C", "goal": "Goal C", "signals": []}]

    # 返回 15 和 -3,应该被 clamp 到 10 和 0
    mock_response = json.dumps([
        {
            "id": "c1",
            "scores": {"novelty": 15, "feasibility": -3, "operability": 5.5, "impact": 8},
            "score_rationale": {"novelty": "...", "feasibility": "...", "operability": "...", "impact": "..."},
        },
    ])

    result = score_ideas(ideas, llm_call=lambda p: mock_response)

    assert result[0]["scores"]["novelty"] == 10  # clamp from 15
    assert result[0]["scores"]["feasibility"] == 0   # clamp from -3
    assert result[0]["scores"]["operability"] == 6   # 5.5 -> 6
    assert result[0]["scores"]["impact"] == 8


def test_partial_parse_keeps_idea_without_scores():
    """LLM 响应缺失部分 idea,缺失的 idea scores=None。"""
    ideas = [
        {"id": "x1", "title": "Idea X", "goal": "Goal X", "signals": []},
        {"id": "y2", "title": "Idea Y", "goal": "Goal Y", "signals": []},
    ]

    # 只返回第一个 idea 的评分
    mock_response = json.dumps([
        {
            "id": "x1",
            "scores": {"novelty": 7, "feasibility": 6, "operability": 5, "impact": 8},
            "score_rationale": {"novelty": "ok", "feasibility": "ok", "operability": "ok", "impact": "ok"},
        },
    ])

    result = score_ideas(ideas, llm_call=lambda p: mock_response)

    assert result[0]["scores"] == {"novelty": 7, "feasibility": 6, "operability": 5, "impact": 8}
    # y2 没有评分,scores 应该是 None
    assert result[1]["scores"] is None
    assert result[1]["score_rationale"] == {"novelty": "", "feasibility": "", "operability": "", "impact": ""}


def test_llm_failure_keeps_original():
    """LLM 调用抛出异常,所有 idea 保持 scores=None。"""
    ideas = [
        {"id": "z1", "title": "Idea Z", "goal": "Goal Z", "signals": []},
    ]

    def failing_llm(prompt):
        raise RuntimeError("LLM API error")

    result = score_ideas(ideas, llm_call=failing_llm)

    assert result[0]["scores"] is None
    assert result[0]["score_rationale"] == {"novelty": "", "feasibility": "", "operability": "", "impact": ""}


def test_llm_returns_non_json():
    """LLM 返回非 JSON,所有 idea 保持 scores=None。"""
    ideas = [{"id": "w1", "title": "Idea W", "goal": "Goal W", "signals": []}]

    result = score_ideas(ideas, llm_call=lambda p: "这不是 JSON")

    assert result[0]["scores"] is None


def test_max_ideas_limit():
    """max_ideas 参数限制批量大小。"""
    ideas = [
        {"id": f"i{j}", "title": f"Idea {j}", "goal": f"Goal {j}", "signals": []}
        for j in range(30)
    ]

    captured_prompt = []
    def capture_prompt(p):
        captured_prompt.append(p)
        return json.dumps([])  # 返回空,让所有 idea 无 scores

    result = score_ideas(ideas, llm_call=capture_prompt, max_ideas=20)

    # 验证 LLM 只收到 20 个 idea
    prompt = captured_prompt[0]
    assert '"id": "i0"' in prompt
    assert '"id": "i19"' in prompt
    assert '"id": "i20"' not in prompt


# ----------------------------------------------------------------------------
# 集成测试: run_topic_v2 中的 scoring
# ----------------------------------------------------------------------------

def test_scoring_runs_in_pipeline(tmp_path, mock_signals, stub_judge, monkeypatch):
    """验证 run_topic_v2 流程中 scoring 环节正常工作。"""
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    # Mock score_ideas to return scored ideas
    def mock_score(ideas, llm_call=None, *, max_ideas=20):
        scored = []
        for i in ideas:
            scored.append({
                **i,
                "scores": {"novelty": 7, "feasibility": 6, "operability": 5, "impact": 8},
                "score_rationale": {"novelty": "test", "feasibility": "test", "operability": "test", "impact": "test"},
            })
        return scored

    monkeypatch.setattr(topic_v2, "score_ideas", mock_score)

    result = run_topic_v2(session_id="score_test", judge_llm_call=stub_judge)
    progress = result["debate_progress"]

    # 验证 ideas 包含 scores 字段
    ideas = progress["ideas"]
    assert len(ideas) == 4
    for idea in ideas:
        assert "scores" in idea
        assert "score_rationale" in idea
        assert idea["scores"] == {"novelty": 7, "feasibility": 6, "operability": 5, "impact": 8}


def test_scoring_failure_does_not_block_pipeline(tmp_path, mock_signals, stub_judge, monkeypatch):
    """验证 scoring 失败时,流程仍然产生有效 ideas。"""
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    # Mock score_ideas to raise exception
    def failing_score(ideas, llm_call=None, *, max_ideas=20):
        raise RuntimeError("Scoring failed")

    monkeypatch.setattr(topic_v2, "score_ideas", failing_score)

    result = run_topic_v2(session_id="score_fail_test", judge_llm_call=stub_judge)
    progress = result["debate_progress"]

    # 验证流程仍然完成,ideas 存在(虽然无 scores)
    assert len(progress["ideas"]) == 4
    assert progress["status"] == "completed"


# ----------------------------------------------------------------------------
# semantic_dedup_ideas tests
# ----------------------------------------------------------------------------

from src.topic_v2 import (
    dedup_ideas,
    semantic_dedup_ideas,
    normalize_idea_title,
)


def test_text_dedup_still_works():
    """Text normalization dedup behavior unchanged."""
    ideas = [
        {"title": "RL for Atari games", "goal": "beat the game"},
        {"title": "rl for atari games", "goal": "score high"},
        {"title": "RL for Atari", "goal": "win"},
    ]
    result = dedup_ideas(ideas, use_semantic=False)
    # First two normalize to same key "rl for atari games" → only first kept
    # Third normalizes to "rl for atari" → different key → kept
    assert len(result) == 2
    assert result[0]["title"] == "RL for Atari games"


def test_semantic_dedup_with_mock_embedding():
    """Two semantically similar ideas with different wording → one dropped."""
    ideas = [
        {"title": "Use reinforcement learning to play Atari", "goal": "achieve high scores"},
        {"title": "Apply RL for video game mastery", "goal": "reach top ranks"},
        {"title": "Natural language processing for translation", "goal": "improve accuracy"},
    ]
    # Mock embedding: first two are very similar (cosine ≈ 0.95), third is different
    import numpy as np
    def mock_embedding(texts):
        # Return vectors where first two are nearly identical
        vectors = []
        for i, t in enumerate(texts):
            if "Atari" in t or "RL" in t or "game" in t:
                vectors.append([0.9, 0.1, 0.0])  # Similar vector
            else:
                vectors.append([0.0, 0.0, 0.9])  # Different vector
        return np.array(vectors)

    result = semantic_dedup_ideas(ideas, embedding_call=mock_embedding, dedup_threshold=0.85)
    # First two should be deduped → 1 kept, third should remain → total 2
    assert len(result) == 2
    titles = [r["title"] for r in result]
    assert "Natural language processing for translation" in titles


def test_semantic_dedup_rerank_confirms():
    """Borderline cosine, but rerank confirms duplicate → drop."""
    ideas = [
        {"title": "RL agents in environments", "goal": "learn policies"},
        {"title": "Reinforcement learning in settings", "goal": "acquire strategies"},
    ]
    # Cosine is borderline (0.86), but rerank says high confidence duplicate
    import numpy as np
    def mock_embedding(texts):
        # Return vectors with borderline similarity
        return np.array([[0.8, 0.6], [0.86, 0.5]])

    def mock_rerank(a, b):
        return {"is_duplicate": True, "confidence": 0.8, "reason": "same research direction"}

    result = semantic_dedup_ideas(
        ideas,
        embedding_call=mock_embedding,
        rerank_call=mock_rerank,
        dedup_threshold=0.85,
        rerank_threshold=0.5,
    )
    # Rerank confirms duplicate → one dropped
    assert len(result) == 1


def test_semantic_dedup_rerank_overrides():
    """Borderline cosine, but rerank says NOT duplicate → keep both."""
    ideas = [
        {"title": "RL agents in environments", "goal": "learn policies"},
        {"title": "Reinforcement learning in settings", "goal": "acquire strategies"},
    ]
    import numpy as np
    def mock_embedding(texts):
        return np.array([[0.8, 0.6], [0.86, 0.5]])

    def mock_rerank(a, b):
        # LLM says different directions
        return {"is_duplicate": False, "confidence": 0.9, "reason": "different applications"}

    result = semantic_dedup_ideas(
        ideas,
        embedding_call=mock_embedding,
        rerank_call=mock_rerank,
        dedup_threshold=0.85,
        rerank_threshold=0.5,
    )
    # Rerank overrides cosine → keep both
    assert len(result) == 2


def test_embedding_unavailable_falls_back_to_text():
    """Embedding call fails → falls through to text-only."""
    ideas = [
        {"title": "RL for games", "goal": "win"},
        {"title": "RL for gaming", "goal": "score"},
        {"title": "NLP translation", "goal": "accuracy"},
    ]

    def failing_embedding(texts):
        raise RuntimeError("Embedding service unavailable")

    result = semantic_dedup_ideas(ideas, embedding_call=failing_embedding)
    # Should return ideas unchanged (text-only fallback)
    assert len(result) == 3


def test_rerank_unavailable_trusts_cosine():
    """Rerank fails → trusts Stage 2 cosine verdict."""
    ideas = [
        {"title": "RL agents in environments", "goal": "learn policies"},
        {"title": "Reinforcement learning in settings", "goal": "acquire strategies"},
    ]
    import numpy as np
    def mock_embedding(texts):
        # High similarity (0.95) above threshold
        return np.array([[0.9, 0.4], [0.95, 0.3]])

    def failing_rerank(a, b):
        raise RuntimeError("Rerank unavailable")

    result = semantic_dedup_ideas(
        ideas,
        embedding_call=mock_embedding,
        rerank_call=failing_rerank,
        dedup_threshold=0.85,
    )
    # Rerank fails but cosine above threshold → drop duplicate
    assert len(result) == 1


def test_semantic_dedup_uses_router_when_no_override(monkeypatch):
    """Without rerank_call override, get_llm_router should be called."""
    ideas = [
        {"title": "RL agents", "goal": "learn"},
        {"title": "RL bots", "goal": "train"},
    ]
    import numpy as np

    # Mock embedding to return high similarity
    def mock_embedding(texts):
        return np.array([[0.9, 0.4], [0.95, 0.3]])

    # Track if router was called
    router_called = []

    class MockRouter:
        def call(self, stage, messages):
            router_called.append(stage)
            # Return a valid response that says NOT duplicate
            return {
                "choices": [{"message": {"content": "{\"is_duplicate\": false, \"confidence\": 0.1, \"reason\": \"different\"}"}}]
            }

    # Mock at the import source, not at the usage point
    import src.llm_router
    monkeypatch.setattr(src.llm_router, "get_llm_router", lambda: MockRouter())

    result = semantic_dedup_ideas(
        ideas,
        embedding_call=mock_embedding,
        dedup_threshold=0.85,
    )

    # Router should have been called for topic.dedup
    assert "topic.dedup" in router_called or len(router_called) > 0


# ----------------------------------------------------------------------------
# Idea lifecycle promotion
# ----------------------------------------------------------------------------

def test_run_topic_v2_returns_promoted_ideas(tmp_path, mock_signals, stub_judge, monkeypatch):
    """End-to-end: run_topic_v2 should populate session['promoted_ideas']."""
    from src import topic_v2
    monkeypatch.setattr(topic_v2, "collect_signals", lambda *a, **kw: mock_signals)

    # Mock score_ideas to return high scores so promotion can succeed
    def mock_score(ideas, llm_call=None, *, max_ideas=20):
        scored = []
        for i in ideas:
            scored.append({
                **i,
                "scores": {"novelty": 8, "feasibility": 7, "operability": 7, "impact": 8},
                "score_rationale": {"novelty": "test", "feasibility": "test", "operability": "test", "impact": "test"},
            })
        return scored

    monkeypatch.setattr(topic_v2, "score_ideas", mock_score)

    result = run_topic_v2(session_id="promote_test", judge_llm_call=stub_judge)

    # promoted_ideas should be present in session
    assert "promoted_ideas" in result
    # With stub_judge (a always wins), at least one idea should have high elo
    # and be promoted if it meets thresholds
    promoted = result["promoted_ideas"]
    # All ideas should have status field after auto_promote
    ideas = result["debate_progress"]["ideas"]
    for idea in ideas:
        assert "status" in idea
    # If promotion succeeded, promoted list should have ideas with status=promoted
    if promoted:
        for p in promoted:
            assert p["status"] == "promoted"

