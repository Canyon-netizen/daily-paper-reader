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
    """budget_tokens=8000 (< TOKENS_PER_MATCH_CALL=16000) → 一场都不跑, elo 不变。"""
    out = run_debate(
        [{'id': 'a'}, {'id': 'b'}],
        judge_llm_call=lambda a, b: {'winner': 'a'},
        rounds=1,
        budget_tokens=8000,
    )
    assert all(i['elo_rating'] == 1200 for i in out)


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
