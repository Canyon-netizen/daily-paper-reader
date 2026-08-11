"""Plan signals unit tests."""
from __future__ import annotations

import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from plan_signals import (
    SignalAction,
    apply_signal,
    evaluate_signals,
    DEFAULT_SIGNALS,
)


class TestEvaluateSignals(unittest.TestCase):
    """Test signal evaluation against step outputs."""

    def test_citation_fabricated_signal_fires(self):
        """citation_guard with fabricated > 0 should fire citation_guard_fabricated."""
        step_output = {"summary": {"fabricated": 1, "exact": 0, "minor": 0}}
        fired = evaluate_signals(step_output, DEFAULT_SIGNALS)
        names = [s.name for s in fired]
        self.assertIn("citation_guard_fabricated", names)

    def test_concepts_empty_signal_fires(self):
        """Empty concepts should fire concepts_empty."""
        step_output = {"concept_count": 0}
        fired = evaluate_signals(step_output, DEFAULT_SIGNALS)
        names = [s.name for s in fired]
        self.assertIn("concepts_empty", names)

    def test_validation_failed_signal_fires(self):
        """Failed validation should fire validation_failed."""
        step_output = {"verdict": "fail"}
        fired = evaluate_signals(step_output, DEFAULT_SIGNALS)
        names = [s.name for s in fired]
        self.assertIn("validation_failed", names)

    def test_no_signal_fires_on_clean_output(self):
        """Clean output (no issues) should not fire any signals."""
        step_output = {"summary": {"fabricated": 0}, "concept_count": 5, "verdict": "pass"}
        fired = evaluate_signals(step_output, DEFAULT_SIGNALS)
        self.assertEqual(len(fired), 0)


class TestApplySignal(unittest.TestCase):
    """Test signal action application to plan."""

    def test_apply_skip_next_removes_step(self):
        """skip_next should remove the named step from plan."""
        signal = SignalAction(
            name="test_skip",
            predicate=lambda x: True,
            action="skip_next",
            action_arg="paper-analyzer",
        )
        result = apply_signal(signal, ["a", "b", "paper-analyzer", "c"])
        self.assertEqual(result, ["a", "b", "c"])

    def test_apply_skip_next_with_none_removes_all(self):
        """skip_next with action_arg=None should clamp (empty plan)."""
        signal = SignalAction(
            name="test_clamp",
            predicate=lambda x: True,
            action="skip_next",
            action_arg=None,
        )
        result = apply_signal(signal, ["a", "b", "c"])
        self.assertEqual(result, [])

    def test_apply_escalate_prepends_marker(self):
        """escalate should prepend needs_review marker."""
        signal = SignalAction(
            name="test_escalate",
            predicate=lambda x: True,
            action="escalate",
            action_arg="needs_review",
        )
        result = apply_signal(signal, ["a", "b"])
        self.assertEqual(result, ["needs_review", "a", "b"])

    def test_apply_clamp_empties_plan(self):
        """clamp action should empty the plan."""
        signal = SignalAction(
            name="test_clamp",
            predicate=lambda x: True,
            action="clamp",
        )
        result = apply_signal(signal, ["a", "b"])
        self.assertEqual(result, [])

    def test_rerun_step_moves_to_front(self):
        """rerun_step should move the target to front."""
        signal = SignalAction(
            name="test_rerun",
            predicate=lambda x: True,
            action="rerun_step",
            action_arg="step_b",
        )
        result = apply_signal(signal, ["a", "step_b", "c"])
        self.assertEqual(result, ["step_b", "a", "c"])

    def test_unknown_action_returns_unchanged(self):
        """Unknown action should return plan unchanged."""
        signal = SignalAction(
            name="test_unknown",
            predicate=lambda x: True,
            action="unknown_action",
        )
        result = apply_signal(signal, ["a", "b"])
        self.assertEqual(result, ["a", "b"])


class TestMultipleSignalsChain(unittest.TestCase):
    """Test chaining multiple signals."""

    def test_multiple_signals_chain_correctly(self):
        """Applying 2 signals in sequence should result in correct end state."""
        # First: skip paper-analyzer
        signal1 = SignalAction(
            name="test_skip",
            predicate=lambda x: True,
            action="skip_next",
            action_arg="paper-analyzer",
        )
        plan = ["a", "b", "paper-analyzer", "c"]
        plan = apply_signal(signal1, plan)
        self.assertEqual(plan, ["a", "b", "c"])

        # Second: escalate
        signal2 = SignalAction(
            name="test_escalate",
            predicate=lambda x: True,
            action="escalate",
        )
        plan = apply_signal(signal2, plan)
        self.assertEqual(plan, ["needs_review", "a", "b", "c"])


class TestSignalPredicates(unittest.TestCase):
    """Test individual signal predicates."""

    def test_budget_exhausted_fires(self):
        """budget_exceeded=True should fire budget_exhausted."""
        step_output = {"budget_exceeded": True}
        fired = evaluate_signals(step_output, DEFAULT_SIGNALS)
        names = [s.name for s in fired]
        self.assertIn("budget_exhausted", names)

    def test_budget_not_exhausted_no_fire(self):
        """budget_exceeded=False should not fire budget_exhausted."""
        step_output = {"budget_exceeded": False}
        fired = evaluate_signals(step_output, DEFAULT_SIGNALS)
        names = [s.name for s in fired]
        self.assertNotIn("budget_exhausted", names)


if __name__ == "__main__":
    unittest.main()
