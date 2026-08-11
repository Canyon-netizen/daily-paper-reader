"""PR-6 Elo Debate Engine — pairwise idea ranking.

对齐 Polaris `actions_ideas.py:_run_match` 与 `review.match`:
- Swiss 配对 (elo 降序相邻配对)
- rounds 轮 × 2 persona 交替发言
- transcript 累积
- judge persona 产 `{"winner": "a"|"b", "reason": "..."}`
- Elo K=32 更新
- per-match 失败隔离:返 `{"failed": <error>}` 不 abort 整个 debate
- budget_tokens 预算控制 (with BudgetGuard wrapup support)
"""
from __future__ import annotations

from src.budget_guard import BudgetGuard

ELO_K = 32
ELO_INITIAL = 1200
TOKENS_PER_MATCH_CALL = 16_000

# 默认 3 人设(对齐 Polaris DEFAULT_PERSONAS)
DEFAULT_PERSONAS = [
    {"name": "方法论者", "stance": "专挑方法与实验设计的漏洞,重视消融实验与统计显著性"},
    {"name": "工程师", "stance": "关注可实现性、工程成本与复现难度,反对不可落地的空中楼阁"},
    {"name": "怀疑论者", "stance": "质疑新颖性与真实影响力,逼问与现有工作的本质区别"},
]


def expected_score(rating_a: float, rating_b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400))


def update_elo(rating_a: float, rating_b: float, winner: str) -> tuple[float, float]:
    """Return updated ratings; winner is ``a``, ``b`` or ``tie``."""
    ea = expected_score(rating_a, rating_b)
    eb = 1 - ea
    if winner == "a":
        return rating_a + ELO_K * (1 - ea), rating_b - ELO_K * eb
    if winner == "b":
        return rating_a - ELO_K * ea, rating_b + ELO_K * (1 - eb)
    return rating_a, rating_b


def swiss_pairs(ideas: list[dict]) -> list[tuple[dict, dict]]:
    """Swiss 风格:按当前 elo 降序,相邻两两配对。"""
    ranked = sorted(ideas, key=lambda i: -i.get("elo_rating", ELO_INITIAL))
    return [(ranked[k], ranked[k + 1]) for k in range(0, len(ranked) - 1, 2)]


def run_match_persona(persona: dict, a: dict, b: dict, round_n: int, call=None) -> str:
    """Run one persona argument through an injected call, or LLM if none provided."""
    if call is not None:
        return call(persona, a, b, round_n)

    # Handle both dict and string persona forms (for test compatibility)
    if isinstance(persona, str):
        name = persona
        stance = ""
    else:
        name = persona.get("name", "?")
        stance = persona.get("stance", "")

    # Build prompt (Chinese, matching DEFAULT_PERSONAS stance style)
    prompt = (
        f"你是 {name}。{stance}\n\n"
        f"请用 3-5 句话,从你独特的视角,比较以下两个研究想法并给出你的论据(本轮第 {round_n} 轮)。\n\n"
        f"想法 A: {a.get('title', '?')}\n"
        f"目标: {a.get('goal', '')}\n"
        f"信号: {', '.join(a.get('signals', []))}\n\n"
        f"想法 B: {b.get('title', '?')}\n"
        f"目标: {b.get('goal', '')}\n"
        f"信号: {', '.join(b.get('signals', []))}\n\n"
        "直接输出你的论据,不要前缀说明。"
    )

    try:
        from src.llm_router import get_llm_router
        router = get_llm_router()
        response = router.call(
            "elo.debate",
            messages=[{"role": "user", "content": prompt}],
        )
        # Extract content from response
        text = ""
        if isinstance(response, dict):
            choices = response.get("choices", [])
            if choices:
                msg = choices[0].get("message", {})
                text = msg.get("content", "") or ""
        if not text or not text.strip():
            return f"[{name} 立场未能生成: 空响应]"
        return text.strip()
    except Exception as e:
        return f"[{name} 立场未能生成: {type(e).__name__}: {e}]"


def judge_debate(a: dict, b: dict, judge_llm_call) -> str:
    """Call judge LLM and validate winner field."""
    try:
        result = judge_llm_call(a, b)
        winner = result.get("winner", "tie") if isinstance(result, dict) else "tie"
        return winner if winner in {"a", "b", "tie"} else "tie"
    except Exception:
        return "tie"


def run_match(
    a: dict,
    b: dict,
    personas: list[dict],
    rounds: int,
    judge_llm_call,
) -> dict:
    """
    Run a single pairwise match between idea a and b.

    Returns:
        {
            "idea_a": a["id"],
            "idea_b": b["id"],
            "winner": "a"|"b"|"tie",
            "reason": str,
            "elo_delta": {"a": float, "b": float},
            "transcript": [
                {"persona": str, "side": "pro"|"con", "round": int, "content": str},
                ...,
                {"persona": str, "side": "judge", "round": int, "content": str}
            ],
            "failed": bool,
            "error": str|None
        }
    """
    pro, con, judge = personas[0], personas[1], personas[2]
    # Accept both dict (runtime: {"name", "stance"}) and str (test fixture) forms
    def _name(p):
        return p["name"] if isinstance(p, dict) else str(p)
    pro_name, con_name, judge_name = _name(pro), _name(con), _name(judge)
    transcript: list[dict] = []
    round_n = 0

    try:
        for debate_round in range(1, rounds + 1):
            # Pro (正方)
            round_n += 1
            content = run_match_persona(pro, a, b, round_n)
            transcript.append({"persona": pro_name, "side": "pro", "round": round_n, "content": content})

            # Con (反方)
            round_n += 1
            content = run_match_persona(con, a, b, round_n)
            transcript.append({"persona": con_name, "side": "con", "round": round_n, "content": content})

        # Judge -- call raw judge_llm_call so exceptions propagate to run_match's try/except.
        # judge_debate() wraps in its own try/except returning "tie", which would hide
        # failures from the per-match-failure-isolation contract.
        round_n += 1
        raw_judge = judge_llm_call(a, b)
        if isinstance(raw_judge, dict):
            judge_result = raw_judge.get("winner", "tie")
            if judge_result not in ("a", "b"):
                judge_result = "tie"
        else:
            judge_result = "tie"
        transcript.append({
            "persona": judge_name,
            "side": "judge",
            "round": round_n,
            "content": f"判定胜者:{judge_result}。"
        })

        return {
            "idea_a": a["id"],
            "idea_b": b["id"],
            "winner": judge_result,
            "reason": judge_result,
            "elo_delta": {"a": 0.0, "b": 0.0},  # 由 caller 计算
            "transcript": transcript,
            "failed": False,
            "error": None,
        }
    except Exception as exc:
        # per-match-failure-isolation:不让单场崩坏整个 debate
        return {
            "idea_a": a["id"],
            "idea_b": b["id"],
            "winner": "tie",
            "reason": "match failed",
            "elo_delta": {"a": 0.0, "b": 0.0},
            "transcript": transcript,
            "failed": True,
            "error": str(exc),
        }


def run_debate(
    ideas: list[dict],
    judge_llm_call,
    rounds: int = 3,
    personas: list[dict] | None = None,
    budget_tokens: int = 800_000,
) -> list[dict]:
    """
    Run full Swiss tournament.

    Args:
        ideas: list of {"id", "title", "elo_rating"?, ...}
        judge_llm_call: callable(a, b) -> {"winner": "a"|"b"|"tie", "reason": str}
        rounds: max 5 (clamped)
        personas: list of 3 dicts with "name","stance"
        budget_tokens: overall token budget

    Returns:
        ideas sorted by elo_rating desc, each idea updated with:
            - elo_rating (float)
            - matches (int)
            - wins (int)
            - debate_log (list[match_dict])  # per-match result
    """
    if personas is None:
        personas = DEFAULT_PERSONAS
    rounds = max(1, min(5, rounds))

    elo = {i["id"]: i.get("elo_rating", ELO_INITIAL) for i in ideas}
    matches = {i["id"]: 0 for i in ideas}
    wins = {i["id"]: 0 for i in ideas}
    debate_log = {i["id"]: [] for i in ideas}

    # Use BudgetGuard for thread-safe budget tracking with wrapup support
    guard = BudgetGuard(cap_tokens=budget_tokens, mode="wrapup")
    wrapup_match_used = False  # allow ONE wrapup match after budget exceeded

    for a, b in swiss_pairs(sorted(ideas, key=lambda i: -elo[i["id"]])):
        # Budget check BEFORE running match
        if guard.exceeded:
            # Budget hit — in wrapup mode, allow ONE more match for cleanup
            if not wrapup_match_used:
                wrapup_match_used = True
            else:
                break  # no more wrapup budget
        match = run_match(a, b, personas, rounds, judge_llm_call)
        guard.consume(TOKENS_PER_MATCH_CALL)

        if match["failed"]:
            # 记录失败但继续
            debate_log[a["id"]].append(match)
            debate_log[b["id"]].append(match)
            continue

        winner = match["winner"]
        # Elo update
        if winner in {"a", "b"}:
            elo[a["id"]], elo[b["id"]] = update_elo(elo[a["id"]], elo[b["id"]], winner)
            matches[a["id"]] = matches.get(a["id"], 0) + 1
            matches[b["id"]] = matches.get(b["id"], 0) + 1
            if winner == "a":
                wins[a["id"]] = wins.get(a["id"], 0) + 1
            else:
                wins[b["id"]] = wins.get(b["id"], 0) + 1
        else:
            # tie: matches still increment
            matches[a["id"]] = matches.get(a["id"], 0) + 1
            matches[b["id"]] = matches.get(b["id"], 0) + 1

        # 记录 elo_delta 供前端可视化
        match["elo_delta"] = {"a": 0.0, "b": 0.0}  # placeholder, caller fills

        debate_log[a["id"]].append(match)
        debate_log[b["id"]].append(match)

    # Write back to idea dicts
    for idea in ideas:
        idea["elo_rating"] = elo[idea["id"]]
        idea["matches"] = matches.get(idea["id"], 0)
        idea["wins"] = wins.get(idea["id"], 0)
        idea["debate_log"] = debate_log.get(idea["id"], [])

    return sorted(ideas, key=lambda i: i["elo_rating"], reverse=True)


__all__ = [
    "run_debate", "run_match", "judge_debate", "run_match_persona",
    "expected_score", "update_elo", "swiss_pairs",
    "ELO_K", "ELO_INITIAL", "TOKENS_PER_MATCH_CALL", "DEFAULT_PERSONAS",
]