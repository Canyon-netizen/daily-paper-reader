"""LLM usage 日志 — 追加 JSONL，按月 rotate。

对齐 Polaris `LLMUsage` 表字段（plan §7）：
  ts / stage / provider / model / temperature / tokens_in / tokens_out /
  latency_ms / cost_usd / archive_date / user_id / project_id / voyage_id

文件位置：`archive/llm_usage_<YYYY-MM>.jsonl`（按月 rotate）。

API：
- `log_usage(stage, provider, model, temperature, response)` — 估 tokens 后追加一行。
- `_ensure_usage(usage, prompt, completion)` — token 估算（polars `router.py:178`）。
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
ARCHIVE_DIR = os.path.join(ROOT_DIR, "archive")


def _month_str(now: Optional[datetime] = None) -> str:
    n = now or datetime.now(timezone.utc)
    return n.strftime("%Y-%m")


def _today_str(now: Optional[datetime] = None) -> str:
    n = now or datetime.now(timezone.utc)
    return n.strftime("%Y%m%d")


def _usage_path(month: str) -> str:
    return os.path.join(ARCHIVE_DIR, f"llm_usage_{month}.jsonl")


def _extract_response_text(response: Any) -> str:
    """从 chat() 返回值中提取 prompt + completion 文本，用于 fallback 估算。"""
    prompt = ""
    completion = ""
    try:
        # ChatCompletion-like object（dict / openai sdk object 都可能）
        if isinstance(response, dict):
            choices = response.get("choices") or []
            if choices:
                msg = (choices[0] or {}).get("message") or {}
                completion = msg.get("content") or ""
        else:
            choices = getattr(response, "choices", None) or []
            if choices:
                msg = getattr(choices[0], "message", None)
                completion = getattr(msg, "content", "") or ""
        # 多数 chat() 不返回原始 prompt（router 没有 messages 上下文）→ 留空。
    except Exception:
        pass
    return prompt, completion


def _extract_usage(response: Any) -> Optional[Dict[str, int]]:
    """从 chat() 返回值提取 prompt/completion tokens（provider 实际返回）。"""
    usage = None
    try:
        if isinstance(response, dict):
            usage = response.get("usage")
        else:
            usage = getattr(response, "usage", None)
    except Exception:
        return None
    if not usage or not isinstance(usage, dict):
        return None
    pi = usage.get("prompt_tokens")
    co = usage.get("completion_tokens")
    if pi is None or co is None:
        return None
    return {"tokens_in": int(pi), "tokens_out": int(co)}


def _ensure_usage(usage: Optional[Dict[str, int]], prompt: str, completion: str) -> Dict[str, int]:
    """对齐 Polaris `_ensure_usage`：`router.py:178`。

    provider 返回 usage 时原样用；否则按 chars / 4 估算（英语 1 token ≈ 4 chars 经验值）。
    """
    if usage:
        return usage
    return {
        "tokens_in": len(prompt) // 4,
        "tokens_out": len(completion) // 4,
    }


def _compute_cost(provider: str, model: str, tokens_in: int, tokens_out: int) -> float:
    """估算 cost_usd。占位：plan 允许 0.0，按 Polaris 默认无 billing 时直接 0.0。"""
    # 真实定价留给后续 PR-?（Polaris 用 billing 表）。PR-3 不引入 pricing 数据。
    return 0.0


def log_usage(
    stage: str,
    provider: str,
    model: str,
    temperature: float,
    response: Any,
    *,
    user_id: str = "github:owner",
    project_id: Optional[str] = None,
    voyage_id: Optional[str] = None,
    latency_ms: Optional[int] = None,
    cost_usd: Optional[float] = None,
) -> None:
    """追加一行 JSONL。失败只 warn 不抛（router 不会因日志挂掉）。"""
    try:
        now = datetime.now(timezone.utc)
        prompt, completion = _extract_response_text(response)
        usage = _ensure_usage(_extract_usage(response), prompt, completion)
        tokens_in = int(usage.get("tokens_in", 0))
        tokens_out = int(usage.get("tokens_out", 0))

        record: Dict[str, Any] = {
            "ts": now.isoformat(),
            "stage": stage,
            "provider": provider,
            "model": model,
            "temperature": float(temperature),
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "latency_ms": int(latency_ms) if latency_ms is not None else 0,
            "cost_usd": float(cost_usd) if cost_usd is not None else _compute_cost(provider, model, tokens_in, tokens_out),
            "archive_date": _today_str(now),
            "user_id": user_id,
            "project_id": project_id,
            "voyage_id": voyage_id,
        }

        os.makedirs(ARCHIVE_DIR, exist_ok=True)
        path = _usage_path(_month_str(now))
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:  # pragma: no cover
        print(f"[WARN] log_usage failed: {e}", flush=True)