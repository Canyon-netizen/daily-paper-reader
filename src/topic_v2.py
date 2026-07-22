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
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from src.idea_signals import collect_signals
from src.elo_debate import run_debate


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
    return text[:max_len] + ("..." if len(text) > max_len else "")


def _generate_ideas(signals: Dict[str, List[Any]], session_id: str) -> List[Dict[str, Any]]:
    """把 4 路确定性信号组装成 Idea 列表。

    每个 Idea 字段对齐 Polaris Idea 模型(精简版):
        id / title / depth / goal / evidence / signals / parent_session_id
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
            "evidence": [{"source": "concept_holes", "detail": hole}],
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
            "evidence": [{"source": "trend", "detail": trend}],
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
            "evidence": [{"source": "limitation", "detail": excerpt}],
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
            "evidence": [{"source": "survey_gap", "detail": gap}],
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
                       传 None 时退化为随机/stub(用于离线批处理/测试)。

    Returns:
        更新后的 session dict,含 `debate_progress.ideas`(排序后)。
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

    # 3. 信号 → Idea 列表
    raw_ideas = _generate_ideas(signals, session_id)

    # 4. 跑 Elo 辩论
    #   judge_llm_call=None 时,所有 match 走 "tie" 路径,ideas 仅按当前 elo 排序。
    #   实际使用需要传 callable (生产环境: 调用 `resolveRoute('topic.debate')`)。
    def stub_judge(a, b):
        # 默认随机裁决,但保持接口与 run_debate 一致
        return {"winner": "tie", "reason": "no LLM judge configured"}

    ranked_ideas = run_debate(
        ideas=raw_ideas,
        judge_llm_call=judge_llm_call or stub_judge,
        rounds=DEFAULT_ROUNDS,
    )

    # 5. 写回 session
    session["debate_progress"] = {
        "session_id": session_id,
        "ideas": ranked_ideas,
        "updated_at": datetime.utcnow().isoformat(),
        "personas": DEFAULT_PERSONAS,
        "rounds": DEFAULT_ROUNDS,
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
