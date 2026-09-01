"""Per-paper method debate feature — extract methods and generate pros/cons analysis."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from src.llm_router import get_llm_router

logger = logging.getLogger(__name__)

STAGE_NAME = "paper.method_debate"

# Prompt pack 路径(优先从这里读取,不存在则用下面的默认 prompt)
_PROMPT_PACK_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "config", "prompts", "method-debate", "2026-08-31"
)
_PROMPT_BODY_PATH = os.path.join(_PROMPT_PACK_DIR, "body.md")

# 内联默认 prompt(pack 不存在时使用)
_DEFAULT_PROMPT_BODY = """你是论文方法分析助手。请从论文中识别作者讨论的每个方法、框架、方案或协议，然后为每个生成优缺点分析。

任务范围（重要）：
- 不只识别作者新发明的方法，也要识别作者讨论、对比、引用的任何方法/框架/协议
- 包括：作者新提出的方法、对比论文中的被对比对象、综述论文中讨论的多种方法
- 对比论文中每个被对比对象都是独立方法（如"MCP vs A2A"中的 MCP 和 A2A）

输出严格的 JSON（不要输出任何其它文字、Markdown 代码块或解释）：
{"method_pros_cons": {"方法或框架1": {"pros": ["优点1", "优点2"], "cons": ["缺点1", "缺点2"]}}, "method_comparison": "跨方法对比总结"}

要求：
- 每个方法/框架 pros 和 cons 各 2-4 条，每条不超过 30 个中文字符
- 方法/框架名称简洁、准确（用论文中的原始名称，如"MCP"、"A2A"、"MetaEvolve"）
- 优缺点应具体可论证，引用论文中的实际数据或论点
- method_comparison 为 1-2 句话的跨方法对比
- 如果只有一个统一框架/方法，将 method_comparison 设为"本文主要讨论单一框架 [框架名]"
- 如果确实没有任何方法可分析，method_pros_cons 设为 {}，method_comparison 设为"本文未讨论独立的多种方法或框架"
"""


def _load_prompt_body() -> str:
    """从 config/prompts/method-debate/2026-08-31/body.md 读取 prompt,失败则用默认。"""
    try:
        if os.path.exists(_PROMPT_BODY_PATH):
            with open(_PROMPT_BODY_PATH, "r", encoding="utf-8") as f:
                body = f.read().strip()
            if body:
                return body
    except Exception as e:
        logger.warning(f"[method_debate] Failed to load prompt body: {e}, using default")
    return _DEFAULT_PROMPT_BODY


def generate_method_debate(
    title: str,
    abstract: str,
    paper_text: str | None = None,
) -> Optional[Dict[str, Any]]:
    """
    Generate method pros/cons analysis for a paper.

    Args:
        title: Paper title
        abstract: Paper abstract
        paper_text: Full paper text (optional). If provided, methods are extracted
                   from the full text. Otherwise, only from abstract.

    Returns:
        Dict with keys:
        - method_pros_cons: dict of method_name -> {pros: list, cons: list}
        - method_comparison: str (cross-method summary)
        - method_debate_model: str (model identifier)
        - method_debate_generated_at: str (ISO 8601 timestamp)

        Returns None on failure.
    """
    if not title:
        logger.warning("[method_debate] Missing title, skipping")
        return None

    try:
        router = get_llm_router()
    except Exception as e:
        logger.warning(f"[method_debate] Failed to get LLM router: {e}")
        return None

    # Build the prompt
    source_note = "source: abstract only" if not paper_text else ""
    payload = {
        "title": title,
        "abstract": abstract,
    }
    if paper_text:
        # Truncate paper text to avoid exceeding token limits
        # Take first ~8000 chars which should cover method sections
        payload["paper_text"] = paper_text[:8000]

    user_text = json.dumps(payload, ensure_ascii=False)

    # 优先从 config/prompts/method-debate/<version>/>/>body.md 读取(便于编辑),
    # 否则使用下面的内联默认 prompt。
    system_prompt = _load_prompt_body()

    user_prompt = f"""
{user_text}

{source_note}

请基于上面的 JSON 数据，输出一个中文方法分析，严格返回 JSON（不要输出任何其它文字、Markdown 代码块或解释）：
{{"method_pros_cons": {{"方法或框架名": {{"pros": ["优点1", "优点2"], "cons": ["缺点1", "缺点2"]}}}}, "method_comparison": "跨方法对比总结"}}

要求：
- 每个方法/框架 pros 和 cons 各 2-4 条，每条不超过 30 个中文字符
- 方法/框架名称简洁、准确（用论文中的原始名称）
- 优缺点应具体可论证，引用论文中的实际数据或论点
- method_comparison 为 1-2 句话的跨方法对比
- 如果只有一个统一框架/方法，将 method_comparison 设为"本文主要讨论单一框架 [框架名]"
- 如果确实没有任何方法可分析，method_pros_cons 设为 {{}}，method_comparison 设为"本文未讨论独立的多种方法或框架"
- Output must be strict JSON only, no markdown, no fences, no extra text.
"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    try:
        # Use router.call which auto-resolves the stage config
        response = router.call(
            STAGE_NAME,
            messages=messages,
        )

        # Extract content from response
        content = ""
        if isinstance(response, dict):
            choices = response.get("choices", [])
            if choices:
                msg = choices[0].get("message", {})
                content = msg.get("content", "") or ""

        if not content or not content.strip():
            logger.warning(f"[method_debate] Empty response for title: {title[:50]}")
            return None

        # Strip <think>...</think> reasoning blocks before parsing
        # (MiniMax reasoning models and DeepSeek-R1 emit these before the answer)
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()

        # Try to parse as JSON
        try:
            result = json.loads(content)
        except json.JSONDecodeError:
            # Try to extract JSON from the response (in case there's extra text)
            match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", content, re.DOTALL)
            if match:
                try:
                    result = json.loads(match.group(0))
                except json.JSONDecodeError as e:
                    logger.warning(f"[method_debate] Failed to parse JSON: {e}")
                    return None
            else:
                logger.warning(f"[method_debate] No JSON found in response")
                return None

        # Validate result structure
        if not isinstance(result, dict):
            logger.warning(f"[method_debate] Result is not a dict")
            return None

        method_pros_cons = result.get("method_pros_cons", {})
        method_comparison = result.get("method_comparison", "")

        # Ensure method_comparison has a default value
        if not method_comparison:
            method_comparison = "本文未提出多个独立方法进行对比"

        # Get model identifier from response (fall back to env LLM_MODEL if missing)
        model_id = os.getenv("LLM_MODEL") or "unknown"
        if isinstance(response, dict):
            model_id = response.get("model", model_id)

        # Generate timestamp
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        return {
            "method_pros_cons": method_pros_cons,
            "method_comparison": method_comparison,
            "method_debate_model": model_id,
            "method_debate_generated_at": timestamp,
        }

    except Exception as e:
        logger.warning(f"[method_debate] LLM call failed: {type(e).__name__}: {e}")
        return None


def load_paper_text(paper_id: str, docs_dir: str = "docs/papers") -> Optional[str]:
    """
    Load paper text from local .txt file.

    Args:
        paper_id: Paper ID (e.g., "2607.21971v1")
        docs_dir: Base directory for papers

    Returns:
        Paper text content or None if not found
    """
    import glob
    import os

    # Search for .txt file matching the paper_id
    # Normalize paper_id: remove version suffix for directory lookup
    base_id = paper_id.split("v")[0] if "v" in paper_id else paper_id

    # Try various paths
    search_patterns = [
        os.path.join(docs_dir, "**", base_id, "*.txt"),
        os.path.join(docs_dir, "**", f"{base_id}*.txt"),
    ]

    for pattern in search_patterns:
        matches = glob.glob(pattern, recursive=True)
        if matches:
            try:
                with open(matches[0], "r", encoding="utf-8") as f:
                    return f.read()
            except Exception:
                continue

    return None


__all__ = [
    "generate_method_debate",
    "load_paper_text",
    "STAGE_NAME",
]
