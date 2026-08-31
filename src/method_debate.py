"""Per-paper method debate feature — extract methods and generate pros/cons analysis."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from src.llm_router import get_llm_router

logger = logging.getLogger(__name__)

STAGE_NAME = "paper.method_debate"


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

    system_prompt = "你是论文方法分析助手。请从论文中识别作者提出的每个方法，然后为每个方法生成优缺点分析。"

    user_prompt = f"""
{user_text}

{source_note}

请基于上面的 JSON 数据，输出一个中文方法辩论分析，严格返回 JSON（不要输出任何其它文字）：
{{"method_pros_cons": {{"方法名": {{"pros": ["优点1", "优点2"], "cons": ["缺点1", "缺点2"]}}}}, "method_comparison": "跨方法对比总结"}}

要求：
- pros 和 cons 各 2-4 条，每条不超过 30 个中文字符
- method_comparison 为 1-2 句话的跨方法对比（如果只有一个方法，设为"本文未提出多个独立方法进行对比"）
- 如果论文未明确提出独立方法，method_pros_cons 设为 {{}}，method_comparison 设为"本文未明确提出独立方法"
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

        # Try to parse as JSON
        try:
            result = json.loads(content.strip())
        except json.JSONDecodeError:
            # Try to extract JSON from the response (in case there's extra text)
            import re

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

        # Get model identifier from response
        model_id = "deepseek/deepseek-chat"  # Default, matching config
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
