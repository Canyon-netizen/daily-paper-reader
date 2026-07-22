"""PR-6 Elo Debate Engine — pairwise idea ranking."""
from __future__ import annotations

ELO_K = 32
ELO_INITIAL = 1200
TOKENS_PER_MATCH_CALL = 16000


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
    ranked = sorted(ideas, key=lambda i: -i.get("elo_rating", ELO_INITIAL))
    return [(ranked[k], ranked[k + 1]) for k in range(0, len(ranked) - 1, 2)]


def run_match_persona(persona: str, a: dict, b: dict, round_n: int, call=None) -> str:
    """Run one persona argument through an injected call, if supplied."""
    if call is None:
        return f"以{persona}视角比较两个研究想法。"
    return call(persona, a, b, round_n)


def judge_debate(a: dict, b: dict, judge_llm_call) -> str:
    try:
        result = judge_llm_call(a, b)
        winner = result.get("winner", "tie") if isinstance(result, dict) else "tie"
        return winner if winner in {"a", "b", "tie"} else "tie"
    except Exception:
        return "tie"


def run_debate(ideas: list[dict], judge, rounds: int = 3, *, budget_tokens: int = 800_000) -> list[dict]:
    elo = {i["id"]: i.get("elo_rating", ELO_INITIAL) for i in ideas}
    used_tokens = 0
    for a, b in swiss_pairs(sorted(ideas, key=lambda i: -elo[i["id"]])):
        for round_n in range(rounds):
            if used_tokens >= budget_tokens:
                break
            try:
                winner = judge(a, b, round_n)
                used_tokens += TOKENS_PER_MATCH_CALL
                if winner in {"a", "b"}:
                    elo[a["id"]], elo[b["id"]] = update_elo(elo[a["id"]], elo[b["id"]], winner)
            except Exception as exc:
                a.setdefault("debate_errors", []).append({"round": round_n, "error": str(exc)})
        if used_tokens >= budget_tokens:
            break
    for idea in ideas:
        idea["elo_rating"] = elo[idea["id"]]
    return sorted(ideas, key=lambda i: i["elo_rating"], reverse=True)

__all__ = ["run_debate", "judge_debate", "run_match_persona", "expected_score", "update_elo", "swiss_pairs", "ELO_K", "ELO_INITIAL", "TOKENS_PER_MATCH_CALL"]
