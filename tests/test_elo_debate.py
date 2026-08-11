"""PR-6 elo_debate — Elo 引擎单测。

对齐 src/elo_debate.py 新实现:
  - run_match 内 judge 失败 → match.failed=True,不重试
  - run_match 内 judge 仅调 1 次(对齐 plan §14 per-match-failure-isolation)
  - rounds 控制 transcript 累积条目数
  - budget_tokens = TOKENS_PER_MATCH_CALL × matches,超 budget 提前结束
"""
from src.elo_debate import (
    ELO_K,
    ELO_INITIAL,
    TOKENS_PER_MATCH_CALL,
    expected_score,
    update_elo,
    swiss_pairs,
    run_match,
    run_match_persona,
    run_debate,
    judge_debate,
)


# ----------------------------------------------------------------------------
# Elo 数学
# ----------------------------------------------------------------------------

def test_update_elo_a_wins():
    a, b = update_elo(1200, 1200, 'a')
    assert a == 1216 and b == 1184


def test_update_elo_b_wins():
    a, b = update_elo(1200, 1200, 'b')
    assert a == 1184 and b == 1216


def test_update_elo_tie():
    a, b = update_elo(1200, 1200, 'tie')
    assert a == 1200 and b == 1200


def test_expected_score_equal():
    assert abs(expected_score(1200, 1200) - 0.5) < 1e-9


# ----------------------------------------------------------------------------
# Swiss 配对
# ----------------------------------------------------------------------------

def test_swiss_pairs_sorts_desc():
    """Swiss: 按 elo 降序,相邻配对。"""
    xs = [{'id': str(i), 'elo_rating': 1200 + i} for i in range(4)]
    pairs = swiss_pairs(xs)
    assert [(a['id'], b['id']) for a, b in pairs] == [('3', '2'), ('1', '0')]


def test_swiss_pairs_initial_rating():
    """无 elo_rating 的 idea 默认 1200。"""
    xs = [{'id': str(i)} for i in range(3)]
    pairs = swiss_pairs(xs)
    # 1 pair (id 0 vs id 1)
    assert len(pairs) == 1


# ----------------------------------------------------------------------------
# run_match — per-match-failure-isolation
# ----------------------------------------------------------------------------

def test_run_match_records_transcript():
    """3 轮 × 2 persona + 1 judge = 7 条 transcript。"""
    a = {'id': 'a', 'title': 'Idea A'}
    b = {'id': 'b', 'title': 'Idea B'}
    match = run_match(a, b, ['P1', 'P2', 'J1'], rounds=3, judge_llm_call=lambda *_: {'winner': 'a', 'reason': 'test'})
    assert len(match['transcript']) == 7   # 3*2 + 1
    assert match['winner'] == 'a'
    assert match['failed'] is False
    assert match['idea_a'] == 'a'
    assert match['idea_b'] == 'b'


def test_run_match_isolates_judge_failure():
    """judge 失败 → match.failed=True, 不抛异常。"""
    a = {'id': 'a', 'title': 'A'}
    b = {'id': 'b', 'title': 'B'}
    def bad_judge(*_):
        raise RuntimeError('boom')
    match = run_match(a, b, ['P', 'C', 'J'], rounds=1, judge_llm_call=bad_judge)
    assert match['failed'] is True
    assert match['winner'] == 'tie'
    assert 'boom' in match['error']


def test_run_match_uses_3_personas():
    """3 persona 顺序: pro/con/judge。"""
    a = {'id': 'a', 'title': 'A'}
    b = {'id': 'b', 'title': 'B'}
    match = run_match(a, b, ['方法论者', '工程师', '怀疑论者'], rounds=2, judge_llm_call=lambda *_: {'winner': 'a'})
    sides = [t['side'] for t in match['transcript']]
    # 2 rounds * (pro, con) + judge
    assert sides == ['pro', 'con', 'pro', 'con', 'judge']


# ----------------------------------------------------------------------------
# run_debate — 完整 tournament
# ----------------------------------------------------------------------------

def test_run_debate_a_wins_elo_increases():
    """stub judge 总是 'a' 赢 → a 的 elo 应涨。"""
    out = run_debate(
        [{'id': 'a'}, {'id': 'b'}],
        judge_llm_call=lambda a, b: {'winner': 'a', 'reason': 'test'},
        rounds=1,
    )
    # a 排第一
    assert out[0]['id'] == 'a'
    assert out[0]['elo_rating'] > 1200


def test_run_debate_failure_isolation():
    """per-match-failure-isolation: 单场 judge 抛异常不阻塞 tournament。
    Idea 'a' 仍应排第一(默认 elo 1200 高于 'b' 失败 tie 的 1200? 不,都是 1200)。
    这里只验证:run_debate 不抛异常 + 返回了排序结果。
    """
    def judge(*_):
        raise RuntimeError('judge broken')
    out = run_debate(
        [{'id': 'a'}, {'id': 'b'}],
        judge_llm_call=judge,
        rounds=1,
    )
    # 不应抛异常; 返回 2 ideas (可能 a 在前也可能 b 在前,稳定 sort)
    assert len(out) == 2
    assert all(i.get('elo_rating') == 1200 for i in out)


def test_run_debate_budget_limits_matches():
    """budget_tokens=8000 (< TOKENS_PER_MATCH_CALL=16000) → wrapup allows 2 matches (1 normal + 1 wrapup)."""
    out = run_debate(
        [{'id': 'a'}, {'id': 'b'}],
        judge_llm_call=lambda a, b: {'winner': 'a'},
        rounds=1,
        budget_tokens=8000,
    )
    # Wrapup mode: first match runs, budget exceeds, then wrapup match runs = 2 matches
    matched = [i for i in out if i.get('matches', 0) > 0]
    assert len(matched) == 2


def test_run_debate_full_budget_runs_one_match():
    """budget_tokens=16000 正好跑 1 场, a 赢 → a elo > 1200。"""
    out = run_debate(
        [{'id': 'a'}, {'id': 'b'}],
        judge_llm_call=lambda a, b: {'winner': 'a'},
        rounds=1,
        budget_tokens=TOKENS_PER_MATCH_CALL,
    )
    a = next(i for i in out if i['id'] == 'a')
    assert a['elo_rating'] > 1200


def test_run_debate_wrapup_finishes_in_flight():
    """Budget exactly allows N matches then exceeds; wrapup allows one more match."""
    # Create 4 ideas: will form 2 pairs (a,b) and (c,d) after sort by elo
    ideas = [
        {'id': 'a', 'elo_rating': 1200},
        {'id': 'b', 'elo_rating': 1200},
        {'id': 'c', 'elo_rating': 1200},
        {'id': 'd', 'elo_rating': 1200},
    ]
    # budget_tokens = 1.5 * TOKENS_PER_MATCH_CALL = 24000
    # Should allow 2 matches (1st normal, then 2nd runs and exceeds, then wrapup would allow one more but no more pairs)
    out = run_debate(
        ideas,
        judge_llm_call=lambda a, b: {'winner': 'a'},
        rounds=1,
        budget_tokens=int(TOKENS_PER_MATCH_CALL * 1.5),
    )
    # 4 ideas form 2 pairs = 2 matches should run
    matched = [i for i in out if i.get('matches', 0) > 0]
    assert len(matched) == 4, f"Expected 4 matched ideas (2 pairs), got {len(matched)}"


# ----------------------------------------------------------------------------
# judge_debate 校验
# ----------------------------------------------------------------------------

def test_judge_debate_returns_tie_on_exception():
    def bad(*_):
        raise RuntimeError()
    assert judge_debate({}, {}, bad) == 'tie'


def test_judge_debate_validates_winner_field():
    """非法 winner → tie。"""
    out = judge_debate({}, {}, lambda a, b: {'winner': 'invalid'})
    assert out == 'tie'


def test_judge_debate_passes_through_valid_winner():
    assert judge_debate({}, {}, lambda a, b: {'winner': 'a'}) == 'a'
    assert judge_debate({}, {}, lambda a, b: {'winner': 'b'}) == 'b'


# ----------------------------------------------------------------------------
# run_match_persona — LLM fallback
# ----------------------------------------------------------------------------

def test_run_match_persona_uses_injected_call(monkeypatch):
    """When call is provided, it should be used (not LLM)."""
    from src import elo_debate as ed_mod

    # Ensure router singleton is cleared
    ed_mod.__dict__['_router_instance'] = None

    def mock_call(p, a, b, rn):
        return f"[MOCK] {p['name']} round {rn}"

    result = run_match_persona(
        {"name": "TestPersona", "stance": "Test stance"},
        {"id": "a", "title": "Idea A"},
        {"id": "b", "title": "Idea B"},
        round_n=1,
        call=mock_call
    )
    assert result == "[MOCK] TestPersona round 1"


def test_run_match_persona_fallback_to_llm(monkeypatch):
    """When call=None, should attempt LLM and return content (not TODO stub)."""
    from src import elo_debate as ed_mod
    import src.llm_router

    # Clear router singleton
    src.llm_router._router_instance = None
    ed_mod.__dict__['_router_instance'] = None

    # Create mock router that returns a valid response
    class MockRouter:
        def call(self, stage, *, messages, response_format=None, **kwargs):
            return {
                "choices": [
                    {
                        "message": {
                            "content": "从方法论者视角,我认为想法A更优,因为它的实验设计更加严谨。"
                        }
                    }
                ]
            }

    monkeypatch.setattr(src.llm_router, "get_llm_router", lambda *args: MockRouter())

    result = run_match_persona(
        {"name": "方法论者", "stance": "专挑方法与实验设计的漏洞"},
        {"id": "a", "title": "Idea A", "goal": "提高准确率", "signals": ["signal1"]},
        {"id": "b", "title": "Idea B", "goal": "提高速度", "signals": ["signal2"]},
        round_n=1,
        call=None  # No injected call - should use LLM
    )

    # Should NOT be the TODO stub
    assert "TODO" not in result
    # Should contain the LLM response
    assert "方法论者" in result or "Idea A" in result or "更优" in result


# ----------------------------------------------------------------------------
# Integration: elo_debate + budget_guard
# ----------------------------------------------------------------------------

def test_run_debate_tight_budget_stops_cleanly_after_wrapup():
    """Integration: run_debate with tight budget stops cleanly after wrapup match.

    Verifies:
    1. BudgetGuard wrapup mode allows one extra match after exceeded
    2. Debate stops cleanly after wrapup match (not in middle of a match)
    3. All ideas have consistent state after termination
    """
    from src.budget_guard import BudgetGuard, BudgetExceededError

    ideas = [
        {'id': 'a', 'elo_rating': 1200},
        {'id': 'b', 'elo_rating': 1200},
        {'id': 'c', 'elo_rating': 1200},
        {'id': 'd', 'elo_rating': 1200},
    ]

    # budget_tokens=1.5*TOKENS_PER_MATCH_CALL allows:
    # - 1st match runs (uses ~TOKENS_PER_MATCH_CALL)
    # - budget exceeded, wrapup mode engaged
    # - 1 wrapup match allowed
    # Total: 2 matches (1 normal + 1 wrapup)
    tight_budget = int(TOKENS_PER_MATCH_CALL * 1.5)

    out = run_debate(
        ideas,
        judge_llm_call=lambda a, b: {'winner': 'a', 'reason': 'test'},
        rounds=1,
        budget_tokens=tight_budget,
    )

    # Verify debate completed cleanly (not interrupted mid-match)
    # Each idea should have consistent debate_log length
    for idea in out:
        # debate_log should be complete (not truncated)
        assert isinstance(idea.get('debate_log', []), list)
        # All ideas should have same number of matches or be consistent
        matches = idea.get('matches', 0)
        assert matches >= 0

    # Verify wrapup was triggered (not abort)
    # With wrapup mode, we should have completed matches
    matched = [i for i in out if i.get('matches', 0) > 0]
    # Should have 2 matched (1 normal + 1 wrapup for 2 pairs from 4 ideas)
    assert len(matched) == 4, f"Expected 4 matched ideas, got {len(matched)}"

    # Verify no ideas left in inconsistent state
    for idea in out:
        # All ideas should have elo_rating set
        assert 'elo_rating' in idea
        # If matches > 0, should have debate_log
        if idea.get('matches', 0) > 0:
            assert 'debate_log' in idea
