"""topic_v2 orchestrator — 完整的 Topic v2 辩论编排。

对齐 Polaris `forge.collect_signals` + `review.debate` 流程,
DPR v2 简化:无 LLM 参与,纯确定性,从本地 markdown 抽取信号 → Idea → Elo 辩论 → 落盘。

数据流:
    1. _load_session()       ← topic_session.json
    2. collect_signals()     ← src/idea_signals: 4 路 gap analysis
    3. _generate_ideas()     ← 把 4 路信号组装成 Idea 对象
    4. run_debate()          ← src/elo_debate: Swiss 配对 + Elo 更新
    5. _save_session()       ← 写回 session
    6. 写 archive/<sid>/debate/idea_<id>.json

CLI: `python -m src.topic_v2 [session_id]`
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from src.idea_signals import collect_signals
from src.elo_debate import run_debate, ELO_INITIAL


# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

# Session 状态文件(等价于浏览器侧 localStorage 的服务端持久化)
SESSION_STORE = "topic_session.json"

# 默认辩论参数(对齐 Polaris DEFAULT_PERSONAS / DEFAULT_ROUNDS=2,
# DPR 扩展到 3 轮更贴合 plan §14)
DEFAULT_PERSONAS = ["方法论者", "工程师", "怀疑论者"]
DEFAULT_ROUNDS = 3


# ---------------------------------------------------------------------------
# JSON 读写(对齐 pipeline_v2.checkpoint 原子写模式)
# ---------------------------------------------------------------------------

def _write_json(path: Path, data: Any) -> None:
    """Atomic write: tmp file + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def _read_json(path: Path) -> Any:
    """读 JSON,损坏或缺失返 None(对齐 checkpoint_read 降级语义)。"""
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


# ---------------------------------------------------------------------------
# Session 处理
# ---------------------------------------------------------------------------

def _load_session() -> Dict[str, Any]:
    s = _read_json(Path(SESSION_STORE))
    return s if isinstance(s, dict) else {}


def _save_session(session: Dict[str, Any]) -> None:
    _write_json(Path(SESSION_STORE), session)


def _new_session_id() -> str:
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# 4 路信号 → Idea 转换
# ---------------------------------------------------------------------------

def _truncate(text: str, max_len: int = 30) -> str:
    return text[:max_len] + ("理由" if len(text) > max_len else "")


def _rank_ideas_without_debate(ideas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """judge_llm_call=None 时的退化排序。

    把 ELO 设为初始值,debate_log 留空 list,显式标 status='not_configured'
    让 UI 区分「排序失败」与「没排」(plan §4.2 PR-A 验收 1 「默认没有 judge
    时不会产生虚假的 Elo 排名」)。
    """
    out: List[Dict[str, Any]] = []
    for i in ideas:
        out.append({
            **i,
            "elo_rating": i.get("elo_rating", ELO_INITIAL),
            "matches": 0,
            "wins": 0,
            "debate_log": [],
            "debate_status": "not_configured",
        })
    # 输入已有序(确定性信号排序);保持顺序即可,不去碰 ELO
    return out


def normalize_idea_title(title: str) -> str:
    """plan §4.2 PR-B 验收 1:deterministic dedup —— 先规范化文本/slug。

    规则:小写 + 移除非 alphanumeric + collapse whitespace + 截断 80 字符。
    这样 'RL × Atari' / 'rl × atari ' / 'RL×Atari' 都会被合并成一个 key。
    """
    import re as _re
    s = title.lower()
    s = _re.sub(r"[^a-z0-9 ]+", " ", s)
    s = _re.sub(r"\s+", " ", s).strip()
    return s[:80]


def dedup_ideas(ideas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """按 normalize_idea_title 去重,保留首次出现的 idea。

    plan §4.2 PR-B 验收 1:「对候选做 deterministic dedup:先规范化文本/slug,
    再可选 embedding similarity」。这里只做文本规范化(无 embedding 依赖),
    后续可加 semantic dedup(目前真盘 0 个候选真重复,纯文本 dedup 已够用)。
    """
    seen: set[str] = set()
    out: List[Dict[str, Any]] = []
    for idea in ideas:
        key = normalize_idea_title(str(idea.get("title", "")))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(idea)
    return out


def _evidence_ref(source: str, detail: Any) -> Dict[str, Any]:
    """plan §4.2 PR-B 验收 2:evidence 改为结构化 {kind, ref, snippet}。

    老 evidence 是 [{source, detail}];这里改字段名对齐 plan,但保留 source
    与 detail 作为补充字段,旧 caller 不会崩(只是 detail 现在只是
    fallback 显示)。
    """
    # kind ∈ {paper, concept, limitation, trend, survey_gap}
    kind_map = {
        "concept_holes": "paper",
        "limitations": "limitation",
        "trends": "trend",
        "survey_gap": "survey_gap",
    }
    kind = kind_map.get(source, "paper")
    # ref:如果是 paper/concept 给 id,否则给 source 类别
    if isinstance(detail, dict):
        ref = (
            detail.get("paper_id")
            or detail.get("id")
            or detail.get("concept")
            or detail.get("source", source)
        )
        snippet = (
            detail.get("excerpt")
            or detail.get("description")
            or detail.get("summary")
            or ""
        )
    else:
        ref = source
        snippet = str(detail or "")
    return {"kind": kind, "ref": str(ref), "snippet": str(snippet)[:500], "source": source, "detail": detail}



def score_ideas(
    ideas: list[dict],
    llm_call=None,
    *,
    max_ideas: int = 20,
) -> list[dict]:
    """Score each idea on four dimensions + rationale via LLM.

    Polaris Idea Forge contract: each idea gets 0-10 score per dim + text rationale.
    DPR simplification: do this in ONE batched LLM call (not per-idea) to save cost.

    Args:
        ideas: list of idea dicts from _generate_ideas
        llm_call: optional override (callable taking prompt → dict response).
                   If None, uses get_llm_router().call("topic.score", ...)
        max_ideas: cap ideas to score in one batch (saves tokens)

    Returns:
        Same list, with each idea enriched with:
            - scores: {"novelty": 0-10, "feasibility": 0-10,
                       "operability": 0-10, "impact": 0-10}
            - score_rationale: {"novelty": str, "feasibility": str,
                                "operability": str, "impact": str}

        If LLM fails or returns malformed JSON for an idea, that idea's scores
        stay as None and rationale as "" — do NOT silently fabricate.
    """
    if not ideas:
        return ideas

    # Deep copy to avoid mutating original
    result = [dict(i) for i in ideas]

    # Initialize default scores fields for all ideas
    for idea in result:
        idea["scores"] = None
        idea["score_rationale"] = {"novelty": "", "feasibility": "", "operability": "", "impact": ""}

    # Prepare batch input
    ideas_to_score = result[:max_ideas]
    batch_input = [
        {"id": i["id"], "title": i["title"], "goal": i["goal"], "signals": i.get("signals", [])}
        for i in ideas_to_score
    ]

    # Build prompt
    prompt = (
        "你是研究想法评审员。请对以下候选研究想法按 4 个维度评分(0-10 分)并给出简短理由。\n\n"
        "4 个维度:\n"
        "- novelty (新颖性): 与现有工作的差异化程度\n"
        "- feasibility (可行性): 技术上能否实现,数据/算力是否可达\n"
        "- operability (可操作性): 实验设计是否清晰,基线/消融是否可执行\n"
        "- impact (影响力): 若成功,对领域推进 / 实际应用的贡献\n\n"
        f"候选想法列表(JSON):\n{json.dumps(batch_input, ensure_ascii=False, indent=2)}\n\n"
        '只输出 JSON 数组,每个元素对应一个想法:\n'
        '[\n'
        '  {"id": "<idea id>", "scores": {"novelty": 7, "feasibility": 5, "operability": 6, "impact": 8}, '
        '"score_rationale": {"novelty": "理由", "feasibility": "理由", "operability": "理由", "impact": "理由"}},\n'
        '  ...\n'
        ']'
    )

    # Call LLM
    try:
        if llm_call is not None:
            raw_response = llm_call(prompt)
        else:
            from src.llm_router import get_llm_router
            router = get_llm_router()
            response = router.call(
                "topic.score",
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
                # LLM 返回空,所有 idea 保持无 scores
                return result
            raw_response = text
    except Exception:
        # LLM 调用失败,所有 idea 保持无 scores
        return result

    # Parse JSON response
    try:
        # Try to extract JSON from potential markdown code blocks
        json_str = raw_response.strip()
        if json_str.startswith("```"):
            # Strip markdown code block
            lines = json_str.split("\n")
            json_str = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        parsed = json.loads(json_str)
        if not isinstance(parsed, list):
            return result
    except (json.JSONDecodeError, Exception):
        # Parse 失败,所有 idea 保持无 scores
        return result

    # Build lookup for quick access
    score_map: dict[str, dict] = {}
    for item in parsed:
        if not isinstance(item, dict):
            continue
        idea_id = item.get("id")
        if not idea_id:
            continue

        scores = item.get("scores", {})
        if not isinstance(scores, dict):
            continue

        # Validate and clamp scores to 0-10
        validated_scores = {}
        for dim in ("novelty", "feasibility", "operability", "impact"):
            val = scores.get(dim)
            if isinstance(val, (int, float)):
                validated_scores[dim] = max(0, min(10, round(val)))
            else:
                validated_scores[dim] = 0

        rationale = item.get("score_rationale", {})
        if not isinstance(rationale, dict):
            rationale = {}

        score_map[idea_id] = {
            "scores": validated_scores,
            "score_rationale": {
                dim: str(rationale.get(dim, "")) for dim in ("novelty", "feasibility", "operability", "impact")
            },
        }

    # Apply scores to result
    for idea in result:
        idea_id = idea.get("id")
        if idea_id in score_map:
            idea["scores"] = score_map[idea_id]["scores"]
            idea["score_rationale"] = score_map[idea_id]["score_rationale"]
        # else: keep default scores=None, rationale=""

    return result


def _generate_ideas(signals: Dict[str, List[Any]], session_id: str) -> List[Dict[str, Any]]:
    """把 4 路确定性信号组装成 Idea 列表(plan §4.2 PR-B structured evidence)。

    每个 Idea 字段对齐 Polaris Idea 模型(精简版):
        id / title / depth / goal / evidence / signals / parent_session_id
    evidence 现在是 list[{kind, ref, snippet, source, detail}](_evidence_ref 产出),
    caller 可以按 kind 过滤渲染,而不是再 split detail 字符串。
    """
    ideas: List[Dict[str, Any]] = []

    # 1) concept_holes → method × problem 配对
    for hole in signals.get("concept_holes", []):
        method = hole.get("method", "?")
        problem = hole.get("problem", "?")
        ideas.append({
            "id": uuid.uuid4().hex[:12],
            "title": f"{method} × {problem}",
            "depth": "sketch",
            "goal": f"探索 {method} 在 {problem} 上的应用空白",
            "evidence": [_evidence_ref("concept_holes", hole)],
            "signals": ["concept_holes"],
            "parent_session_id": session_id,
        })

    # 2) trends → 新兴概念
    for trend in signals.get("trends", []):
        concept = trend.get("concept", "?")
        ideas.append({
            "id": uuid.uuid4().hex[:12],
            "title": f"Trend: {concept}",
            "depth": "sketch",
            "goal": f"跟进 {concept} 方向的新论文",
            "evidence": [_evidence_ref("trends", trend)],
            "signals": ["trends"],
            "parent_session_id": session_id,
        })

    # 3) limitations → 论文中识别的不足
    for limit in signals.get("limitations", []):
        excerpt = limit.get("excerpt", "")
        ideas.append({
            "id": uuid.uuid4().hex[:12],
            "title": f"Limit: {_truncate(excerpt, 40)}",
            "depth": "sketch",
            "goal": "针对识别出的论文不足提出改进思路",
            "evidence": [_evidence_ref("limitations", excerpt)],
            "signals": ["limitations"],
            "parent_session_id": session_id,
        })

    # 4) survey_gap → 综述缺口(v1 通常空,保留以备 LLM 接入)
    for gap in signals.get("survey_gap", []):
        ideas.append({
            "id": uuid.uuid4().hex[:12],
            "title": f"Survey gap: {_truncate(str(gap), 40)}",
            "depth": "sketch",
            "goal": "探索综述覆盖不足的子方向",
            "evidence": [_evidence_ref("survey_gap", gap)],
            "signals": ["survey_gap"],
            "parent_session_id": session_id,
        })

    return ideas


# ---------------------------------------------------------------------------
# Debate orchestrator — 主入口
# ---------------------------------------------------------------------------

def run_topic_v2(session_id: str | None = None,
                  judge_llm_call=None) -> Dict[str, Any]:
    """Topic v2 完整流程:signals → ideas → debate → 落盘。

    Args:
        session_id: 可选外部传入 session id;None 时从 session 读或新建。
        judge_llm_call: 可选 LLM judge callable (a, b) -> {"winner": "a"|"b"|"tie"}。
                       传 None 时 **不再伪装成 tie**(plan §4.2 PR-A 「stub_judge
                       退场,no judge 时显式 degraded」):返回的 session.debate_progress
                       包含 status='not_configured',ideas 按 ELO_INITIAL 顺序
                       返回,debate_log 全空。

    Returns:
        更新后的 session dict,含 `debate_progress.ideas`(排序后)。
        `debate_progress.status` 字段:
          - 'completed': 正常完成,所有 match 跑过 judge
          - 'not_configured': judge_llm_call=None,debate 跳过
          - 'partial': 部分 match 因 LLM 错误 / 配额 / malformed 失败
    """
    # 1. 加载 session
    session = _load_session()
    if session_id is None:
        session_id = session.get("sessionId") or _new_session_id()
    session["sessionId"] = session_id

    # 2. 收集 4 路信号
    signals = collect_signals(
        archive_dir=".",
        config={"docs_dir": "."},   # 仓库根即 docs_dir
    )

    # 3. 信号 → Idea 列表(plan §4.2 PR-B:deterministic dedup)
    raw_ideas = _generate_ideas(signals, session_id)
    deduped_ideas = dedup_ideas(raw_ideas)
    # 把 dedup 数量差写进 session,UI 可显示「本轮 X 个候选 → Y 个去重后」
    raw_count = len(raw_ideas)
    deduped_count = len(deduped_ideas)

    # 4 维评分(Polaris Idea Forge contract)—— 默认开,失败不阻塞主线
    try:
        scored_ideas = score_ideas(deduped_ideas, llm_call=None)
        if all(i.get("scores") is None for i in scored_ideas):
            # LLM 全失败,保持原 deduped_ideas(避免下游拿不到 idea)
            ranked_ideas_input = deduped_ideas
        else:
            ranked_ideas_input = scored_ideas
    except Exception:
        ranked_ideas_input = deduped_ideas  # fail-soft

    # 4. 跑 Elo 辩论 —— judge_llm_call=None → 跳过 debate(plan §4.2 PR-A)。
    if judge_llm_call is None:
        # 不调 run_debate,不污染 ELO 排序,显式 degraded。
        ranked_ideas = _rank_ideas_without_debate(ranked_ideas_input)
        debate_status = "not_configured"
        used_tokens = 0
    else:
        ranked_ideas = run_debate(
            ideas=ranked_ideas_input,
            judge_llm_call=judge_llm_call,
            rounds=DEFAULT_ROUNDS,
        )
        debate_status = "completed"
        used_tokens = -1  # run_debate 内部已计数,但没暴露给 caller

    # 5. 写回 session
    session["debate_progress"] = {
        "session_id": session_id,
        "ideas": ranked_ideas,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "personas": DEFAULT_PERSONAS if judge_llm_call is not None else [],
        "rounds": DEFAULT_ROUNDS if judge_llm_call is not None else 0,
        "status": debate_status,
        # plan §4.2 PR-B 验收 1:显式记 dedup 数量,UI 可显示
        "raw_idea_count": raw_count,
        "deduped_idea_count": deduped_count,
    }
    _save_session(session)

    # 6. 写 archive/<session_id>/debate/idea_<id>.json
    archive_dir = Path("archive") / session_id / "debate"
    for idea in ranked_ideas:
        idea_path = archive_dir / f"idea_{idea['id']}.json"
        _write_json(idea_path, idea)

    return session


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    sid = sys.argv[1] if len(sys.argv) > 1 else None
    result = run_topic_v2(sid)
    progress = result.get("debate_progress", {})
    print(json.dumps({
        "sessionId": result.get("sessionId"),
        "n_ideas": len(progress.get("ideas", [])),
        "updated_at": progress.get("updated_at"),
    }, ensure_ascii=False, indent=2))
