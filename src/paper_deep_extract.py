"""Deep Extract — 深入抽取论文的指标、数据集、算力需求、局限性与可复现性评分。

输出 5 个字段:
  - reported_metrics: 论文报告的具体数值(如 BLEU-4: 32.4)
  - datasets: 使用的数据集/基准(如 ImageNet-1k)
  - compute_requirements: 训练算力需求(GPU 小时、模型参数量等)
  - limitations: 作者承认的局限性 + LLM 推断的局限性
  - replicability_score: 1-5 分可复现性评分 + 理由

跑法: python -m src.paper_deep_extract <arxiv_id>
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

# Stage name for LLM router
STAGE_NAME = "paper.deep_extract"

# Prompt pack directory (mirrors method_debate structure)
_PROMPT_PACK_DIR = Path(__file__).parent.parent / "config" / "prompts" / "paper-deep-extract"

logger = logging.getLogger(__name__)


def _load_prompt_pack(prompt_date: Optional[str] = None) -> str:
    """Load prompt body from config/prompts/paper-deep-extract/<date>/body.md.

    Falls back to inline default if file not found.
    """
    if prompt_date is None:
        # Try to find the latest available date
        if _PROMPT_PACK_DIR.exists():
            dates = sorted([d.name for d in _PROMPT_PACK_DIR.iterdir() if d.is_dir()], reverse=True)
            if dates:
                prompt_date = dates[0]

    if prompt_date:
        prompt_path = _PROMPT_PACK_DIR / prompt_date / "body.md"
        if prompt_path.exists():
            return prompt_path.read_text(encoding="utf-8")

    # Fallback inline prompt (minimal, relies on user providing full context)
    return """请从论文中提取以下信息,返回严格 JSON:

{
  "reported_metrics": [
    {"name": "指标名称", "value": "数值", "context": "评估环境/数据集"}
  ],
  "datasets": [
    {"name": "数据集名称", "role": "训练/评估/两者", "size": "规模(如有)"}
  ],
  "compute_requirements": {
    "params": "参数量(如 7B)",
    "gpu_hours": "GPU小时(如 1000)",
    "model_size": "模型大小(如 14GB)",
    "flops": "FLOPs(如 1e22)"
  },
  "limitations": ["局限性1", "局限性2"],
  "replicability_score": 3,
  "replicability_reason": "评分理由"
}

如果某项信息未在论文中提及,不要编造,直接省略该字段。"""


def _repair_json(content: str) -> str:
    """Repair common JSON issues in LLM output."""
    # Remove markdown code block markers
    content = re.sub(r"^```(?:json)?\s*", "", content, flags=re.MULTILINE)
    content = re.sub(r"\s*```$", "", content, flags=re.MULTILINE)

    # Fix trailing commas
    content = re.sub(r",(\s*[\]\}])", r"\1", content)

    # Remove control characters
    content = re.sub(r"[\x00-\x1f\x7f]", "", content)

    return content


def _extract_balanced_blocks(content: str) -> list[str]:
    """Extract all balanced {...} blocks from content."""
    blocks = []
    depth = 0
    start = -1

    for i, ch in enumerate(content):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start != -1:
                blocks.append(content[start : i + 1])
                start = -1

    return blocks


def generate_deep_extract(
    title: str,
    abstract: str,
    paper_text: Optional[str] = None,
    prompt_date: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Generate deep extract for a paper.

    Args:
        title: Paper title
        abstract: Paper abstract
        paper_text: Full paper text (optional, if available)
        prompt_date: Optional prompt pack date (defaults to latest available)

    Returns:
        Dict with fields: reported_metrics, datasets, compute_requirements,
        limitations, replicability_score, replicability_reason,
        deep_extract_model, deep_extract_generated_at
        None on failure.
    """
    try:
        # Import LLM router
        from src.llm_router import call_llm_raw

        # Build prompt with inputs
        prompt_body = _load_prompt_pack(prompt_date)

        # Construct user message with paper content
        user_content = f"""论文标题: {title}

论文摘要: {abstract}
"""

        if paper_text:
            # Include first 8000 chars of paper text for context
            user_content += f"\n论文正文(前 8000 字符):\n{paper_text[:8000]}"

        user_content += f"""

请根据以上信息提取深度分析结果,返回严格 JSON 格式。不要输出任何解释性文字。"

{prompt_body}"""

        # Call LLM
        response = call_llm_raw(
            stage=STAGE_NAME,
            prompt=user_content,
            # Explicitly request JSON output
            schema={
                "type": "object",
                "properties": {
                    "reported_metrics": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "value": {"type": "string"},
                                "context": {"type": "string"},
                            },
                            "required": ["name", "value"],
                        },
                    },
                    "datasets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "role": {"type": "string"},
                                "size": {"type": "string"},
                            },
                            "required": ["name", "role"],
                        },
                    },
                    "compute_requirements": {
                        "type": "object",
                        "properties": {
                            "params": {"type": "string"},
                            "gpu_hours": {"type": "string"},
                            "model_size": {"type": "string"},
                            "flops": {"type": "string"},
                        },
                    },
                    "limitations": {"type": "array", "items": {"type": "string"}},
                    "replicability_score": {"type": "integer", "minimum": 1, "maximum": 5},
                    "replicability_reason": {"type": "string"},
                },
            },
        )

        if not response:
            logger.warning(f"[deep_extract] LLM returned empty response for {title[:30]}...")
            return None

        # Extract content from response
        content = ""
        if isinstance(response, dict):
            content = response.get("content", "")
        elif isinstance(response, str):
            content = response
        else:
            content = str(response)

        if not content:
            logger.warning(f"[deep_extract] No content in response for {title[:30]}...")
            return None

        # Clean reasoning blocks before parsing
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()

        # If still contains <think> (unclosed), drop everything up to last { that
        # starts the actual JSON
        if "<think>" in content:
            anchor = content.rfind('"reported_metrics"')
            if anchor > 0:
                depth = 0
                idx = anchor
                while idx > 0:
                    ch = content[idx]
                    if ch == "}":
                        depth += 1
                    elif ch == "{":
                        if depth == 0:
                            content = content[idx:]
                            break
                        depth -= 1
                    idx -= 1
            else:
                blocks = _extract_balanced_blocks(content)
                if blocks:
                    content = blocks[0]

        # Try to parse as JSON (4 fallback strategies)
        result = None
        parse_errors = []

        # Attempt 1: direct parse
        try:
            result = json.loads(content)
        except json.JSONDecodeError as e:
            parse_errors.append(f"direct: {e}")

        # Attempt 2: extract first { to last }
        if result is None:
            first_brace = content.find("{")
            last_brace = content.rfind("}")
            if first_brace != -1 and last_brace > first_brace:
                candidate = content[first_brace:last_brace + 1]
                try:
                    result = json.loads(candidate)
                except json.JSONDecodeError as e:
                    parse_errors.append(f"first-last: {e}")

        # Attempt 3: repair common issues
        if result is None:
            repaired = _repair_json(content)
            try:
                result = json.loads(repaired)
            except json.JSONDecodeError as e:
                parse_errors.append(f"repair: {e}")

        # Attempt 4: extract largest balanced { ... } block
        if result is None:
            for candidate in _extract_balanced_blocks(content):
                try:
                    parsed = json.loads(candidate)
                    if isinstance(parsed, dict):
                        result = parsed
                        break
                except json.JSONDecodeError:
                    continue

        if result is None:
            logger.warning(f"[deep_extract] Failed to parse JSON after 4 attempts: {'; '.join(parse_errors[:2])}")
            return None

        # Validate result structure
        if not isinstance(result, dict):
            logger.warning(f"[deep_extract] Result is not a dict")
            return None

        # Get model identifier from response
        model_id = os.getenv("LLM_MODEL") or "unknown"
        if isinstance(response, dict):
            model_id = response.get("model", model_id)

        # Generate timestamp
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        return {
            "reported_metrics": result.get("reported_metrics", []),
            "datasets": result.get("datasets", []),
            "compute_requirements": result.get("compute_requirements", {}),
            "limitations": result.get("limitations", []),
            "replicability_score": result.get("replicability_score", 3),
            "replicability_reason": result.get("replicability_reason", ""),
            "deep_extract_model": model_id,
            "deep_extract_generated_at": timestamp,
        }

    except Exception as e:
        logger.warning(f"[deep_extract] LLM call failed: {type(e).__name__}: {e}")
        return None


__all__ = [
    "generate_deep_extract",
    "STAGE_NAME",
]
