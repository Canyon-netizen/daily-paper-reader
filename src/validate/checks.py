"""PR-2 Sextant Validate - 6-dimensional deterministic checks implementation.

This module implements the 6 deterministic checks that mirror Polaris Sextant:
- no_error: Check that output file exists
- exit_code: Check that exit code matches expected value
- artifact_exists: Check that specified artifact file exists
- schema_valid: Check that JSON output conforms to schema requirements
- min_count: Check that array field meets minimum count requirement
- metric: Check that numeric metric meets comparison operation

Additionally implements LLM rubric evaluation (disabled by default).
"""
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

# Deterministic check kinds (excluding llm_rubric)
DETERMINISTIC_CHECK_KINDS = frozenset({
    "no_error", "exit_code", "artifact_exists",
    "schema_valid", "metric", "min_count",
})

# All check kinds including llm_rubric
CHECK_KINDS = DETERMINISTIC_CHECK_KINDS | {"llm_rubric"}

# Supported metric operations
METRIC_OPS = {">=", "<=", ">", "<", "=="}


def run_deterministic_checks(
    checks: List[Dict[str, Any]],
    *,
    output_path: Optional[Path] = None,
    output_payload: Optional[Dict[str, Any]] = None,
    exit_code: Optional[int] = None,
) -> Tuple[bool, List[str]]:
    """
    Execute all deterministic checks in order, short-circuiting on first failure.

    Args:
        checks: List of check specifications
        output_path: Path to output file
        output_payload: Parsed JSON content of output file (if .json)
        exit_code: Exit code from step execution

    Returns:
        Tuple of (all_passed: bool, reasons: List[str])
        where reasons contains status messages for each check executed
    """
    reasons = []
    for check in checks:
        kind = check["kind"]
        if kind not in DETERMINISTIC_CHECK_KINDS:
            continue

        # Execute check based on kind
        if kind == "no_error":
            ok = _check_no_error(output_path)
        elif kind == "exit_code":
            ok = _check_exit_code(exit_code, check.get("value", 0))
        elif kind == "artifact_exists":
            ok = _check_artifact_exists(output_path, check.get("key", ""))
        elif kind == "schema_valid":
            ok = _check_schema_valid(
                output_payload,
                check.get("field", ""),
                check.get("required_keys", [])
            )
        elif kind == "min_count":
            ok = _check_min_count(
                output_payload,
                check.get("field", ""),
                check.get("value", 0)
            )
        elif kind == "metric":
            ok = _check_metric(
                output_payload,
                check.get("name", ""),
                check.get("op", "="),
                check.get("value", 0)
            )
        else:
            # This shouldn't happen due to the kind filter above
            ok = False

        # Append result message
        reasons.append(f"[{kind}] {'PASS' if ok else 'FAIL'}")

        # Short-circuit on failure for deterministic checks
        if not ok:
            return False, reasons

    return True, reasons


def _check_no_error(output_path: Optional[Path]) -> bool:
    """Check that output file exists and is readable."""
    if not output_path:
        return False
    return output_path.exists() and output_path.is_file()


def _check_exit_code(exit_code: Optional[int], expected: int) -> bool:
    """Check that exit code matches expected value."""
    if exit_code is None:
        return False
    return exit_code == expected


def _check_artifact_exists(output_path: Optional[Path], key: str) -> bool:
    """Check that specified artifact file exists relative to output_path parent."""
    if not output_path or not key:
        return False
    artifact_path = output_path.parent / key
    return artifact_path.exists() and artifact_path.is_file()


def _check_schema_valid(
    payload: Optional[Dict[str, Any]],
    field: str,
    required_keys: List[str]
) -> bool:
    """Check that JSON payload field exists and contains all required keys."""
    if payload is None or not isinstance(payload, dict):
        return False

    # Check if field exists
    field_value = payload.get(field)
    if field_value is None:
        return False

    # For list fields, check first element
    if isinstance(field_value, list):
        if not field_value:
            return False
        # Check first non-null element
        for item in field_value:
            if item is not None and isinstance(item, dict):
                # All required keys must be present
                return all(key in item for key in required_keys)
        return False

    # For dict fields, check the dict directly
    if isinstance(field_value, dict):
        return all(key in field_value for key in required_keys)

    return False


def _check_min_count(
    payload: Optional[Dict[str, Any]],
    field: str,
    expected_min: int
) -> bool:
    """Check that array field has at least expected_min elements."""
    if payload is None or not isinstance(payload, dict):
        return False

    field_value = payload.get(field)
    if not isinstance(field_value, list):
        return False

    return len(field_value) >= expected_min


def _check_metric(
    payload: Optional[Dict[str, Any]],
    name: str,
    op: str,
    expected_value: Union[int, float]
) -> bool:
    """Check that numeric metric satisfies the comparison operation."""
    if payload is None or not isinstance(payload, dict):
        return False

    # Try to find the metric value
    metric_value = payload.get(name)
    if metric_value is None:
        return False

    # Ensure it's a number
    try:
        numeric_value = float(metric_value)
    except (ValueError, TypeError):
        return False

    # Perform comparison
    if op == ">=":
        return numeric_value >= expected_value
    elif op == "<=":
        return numeric_value <= expected_value
    elif op == ">":
        return numeric_value > expected_value
    elif op == "<":
        return numeric_value < expected_value
    elif op == "==":
        return numeric_value == expected_value
    else:
        return False


def _judge_rubric(
    rubric_checks: List[Dict[str, Any]],
    output_payload: Optional[Dict[str, Any]]
) -> Tuple[bool, str]:
    """
    Evaluate LLM rubric checks (placeholder implementation).

    In the real implementation, this would call an LLM to evaluate
    the output against the rubric. For now, we return a placeholder.

    Args:
        rubric_checks: List of rubric check specifications
        output_payload: Parsed JSON content of output file

    Returns:
        Tuple of (passed: bool, reason: str)
    """
    # Placeholder implementation - in reality this would call an LLM
    # For now, we assume rubric passes if we can parse the payload
    if output_payload is None:
        return False, "[llm_rubric] Cannot evaluate: no JSON payload"

    # For PR-2, we default to passing the rubric check
    # Real implementation would involve LLM call based on rubric template
    return True, "[llm_rubric] Rubric evaluation passed (placeholder)"