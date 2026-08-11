"""plan_signal — deterministic branch tables for known outcomes.

Polaris engine.py:731-763 contract:
  - known execution outcomes grow the plan through deterministic branch tables
  - NO LLM call to decide — pure code
  - signal → action mapping is data, not control flow

Signal sources: step output dicts / return values
Action targets: next step skip / rerun / escalate / clamp
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Sequence


@dataclass(frozen=True)
class SignalAction:
    """A deterministic branch: if signal matches, do action."""

    name: str  # human-readable
    predicate: Callable[[Any], bool]  # takes step output, returns True if signal fires
    action: str  # one of "skip_next", "rerun_step", "escalate", "clamp"
    action_arg: Any = None  # step_id to skip, etc.


# Default branch table — extend as new signals appear
DEFAULT_SIGNALS: list[SignalAction] = [
    SignalAction(
        name="citation_guard_fabricated",
        predicate=lambda out: out.get("summary", {}).get("fabricated", 0) > 0,
        action="skip_next",
        action_arg="4.llm_refine_papers",  # skip the step that consumes citations
    ),
    SignalAction(
        name="concepts_empty",
        predicate=lambda out: out.get("concept_count", 1) == 0,
        action="skip_next",
        action_arg="wiki-render",
    ),
    SignalAction(
        name="validation_failed",
        predicate=lambda out: out.get("verdict") == "fail",
        action="escalate",
        action_arg="needs_review",
    ),
    SignalAction(
        name="budget_exhausted",
        predicate=lambda out: out.get("budget_exceeded", False),
        action="skip_next",
        action_arg=None,  # skip all subsequent
    ),
]


def evaluate_signals(
    step_output: Any, signals: list[SignalAction] | None = None
) -> list[SignalAction]:
    """Return all signals that fire for a given step output."""
    signals = signals or DEFAULT_SIGNALS
    return [s for s in signals if s.predicate(step_output)]


def apply_signal(signal: SignalAction, plan: Sequence[str]) -> list[str]:
    """Apply signal action to a plan (list of step_ids). Returns modified plan.

    Actions:
      - skip_next: remove the named step from plan
      - rerun_step: insert named step at current position (default: just keep current)
      - escalate: prepend "needs_review" marker (no removal)
      - clamp: empty plan (caller stops)
    """
    plan = list(plan)
    if signal.action == "skip_next":
        target = signal.action_arg
        if target is None:
            return []  # clamp = empty plan
        return [s for s in plan if s != target]
    if signal.action == "rerun_step":
        target = signal.action_arg
        if target and target in plan:
            # move target to front
            return [target] + [s for s in plan if s != target]
        return plan
    if signal.action == "escalate":
        target = signal.action_arg or "needs_review"
        return [target] + list(plan)
    if signal.action == "clamp":
        return []
    return plan


def load_step_output(archive_dir: str, step_id: str) -> dict | None:
    """Load step output from archive directory.

    Looks for output files based on step_id pattern:
    - 1.fetch_arxiv -> raw/arxiv_papers_*.json
    - 2.* -> filtered/*.json
    - 3.rank_papers -> rank/*.json
    - 4.llm_refine_papers -> rank/*.llm.json
    - 5.select_papers -> recommend/*.json
    - 6.generate_docs -> (no output to check)
    - citation_guard -> *.citations.json

    Returns dict from JSON or None if not found.
    """
    import json
    import os
    from pathlib import Path

    base = Path(archive_dir)
    step_prefix = step_id.split(".")[0] if "." in step_id else step_id

    # Map step to output file pattern
    patterns: dict[str, list[str]] = {
        "1": ["raw/arxiv_papers_*.json"],
        "2.1": ["filtered/*bm25*.json"],
        "2.2": ["filtered/*embedding*.json"],
        "2.3": ["filtered/arxiv_papers_*.json"],
        "3": ["rank/arxiv_papers_*.json"],
        "4": ["rank/*.llm.json"],
        "5": ["recommend/*.json"],
        "citation_guard": ["**/*.citations.json"],
    }

    patterns_to_try = patterns.get(step_prefix, [])
    if not patterns_to_try:
        return None

    for pattern in patterns_to_try:
        matches = list(base.glob(pattern))
        if matches:
            # Take the most recent file
            latest = max(matches, key=lambda p: p.stat().st_mtime)
            try:
                with open(latest, encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
    return None


def check_citation_guard_signal(archive_dir: str, step_id: str) -> dict | None:
    """Check citation_guard output for fabricated citations.

    Looks for *.citations.json files in archive directory.
    Returns the citation summary dict if found, None otherwise.
    """
    import json
    import os
    from pathlib import Path

    base = Path(archive_dir)
    # Look for any citations file
    citations_files = list(base.glob("**/*.citations.json"))
    if not citations_files:
        return None

    # Take the most recent
    latest = max(citations_files, key=lambda p: p.stat().st_mtime)
    try:
        with open(latest, encoding="utf-8") as f:
            data = json.load(f)
            # Return the summary dict which contains fabricated count
            return data.get("summary")
    except (json.JSONDecodeError, OSError):
        return None
