"""PR-2 Sextant Validate - Main validation entry point.

This module provides the verify() function that implements the 6-dimensional
deterministic validation framework for checkpoint evaluation.
"""
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from .checks import (
    DETERMINISTIC_CHECK_KINDS,
    METRIC_OPS,
    run_deterministic_checks,
    _check_schema_valid,
    _check_min_count,
    _check_metric,
    _judge_rubric
)


def verify(
    step_id: str,
    *,
    output_path: Optional[Path] = None,
    exit_code: Optional[int] = None,
    acceptance: Optional[Dict[str, Any]] = None,
    observation: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Perform 6-dimensional validation on a step output.

    Args:
        step_id: The identifier of the step being validated.
        output_path: Path to the output file (must end with .json)
        exit_code: Exit code from the step execution
        acceptance: Acceptance criteria configuration
        observation: Observation data including potential errors

    Returns:
        Dict with validation results:
        {
            "passed": bool,           # Overall validation passed
            "reason": str,            # Reason for failure or success
            "rubric_passed": bool,    # Result of LLM rubric evaluation (if enabled)
        }
    """
    # Step 1: observation.error 短路 (Short-circuit on observation error)
    if observation and observation.get("error"):
        reason = f"[observation.error] {observation['error']}"
        return {
            "passed": False,
            "reason": reason,
            "rubric_passed": None,
        }

    # Step 2: 解析 output_payload（仅 .json 后缀）
    # Parse output_payload (only for .json files)
    output_payload = None
    if output_path and output_path.suffix == ".json":
        try:
            output_payload = _load_json(output_path)
        except Exception as e:
            return {
                "passed": False,
                "reason": f"[output_parse_error] failed to parse JSON: {str(e)}",
                "rubric_passed": None,
            }

    # Step 3: 跑确定性 check（确定性检查）
    # Run deterministic checks in strict order
    acceptance_dict = acceptance or {}
    checks = acceptance_dict.get("checks", [])
    deterministic_checks = [c for c in checks if c["kind"] in DETERMINISTIC_CHECK_KINDS]
    rubric_checks = [c for c in checks if c["kind"] == "llm_rubric"]

    all_passed, reasons = run_deterministic_checks(
        deterministic_checks,
        output_path=output_path,
        output_payload=output_payload,
        exit_code=exit_code,
    )

    if not all_passed:
        return {
            "passed": False,
            "reason": "; ".join(reasons),
            "rubric_passed": None,
        }

    # Step 4: 跑 llm_rubric（仅当启用）
    # Run LLM rubric (only if enabled)
    if rubric_checks and acceptance.get("rubric_enabled", False):
        rubric_passed, rubric_reason = _judge_rubric(rubric_checks, output_payload)
        return {
            "passed": rubric_passed,
            "reason": rubric_reason,
            "rubric_passed": rubric_passed,
        }

    # If we reach here, all deterministic checks passed and rubric is either disabled or not applicable
    return {
        "passed": True,
        "reason": "All validation checks passed",
        "rubric_passed": None,
    }


def _load_json(path: Path) -> Dict[str, Any]:
    """Safely load JSON from a file path."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)