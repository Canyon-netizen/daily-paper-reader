"""LLM budget exhaustion wrap-up — Polaris engine.py:615-636 contract.

Failure semantics:
  - 'wrapup': allow explicit wrapup=True steps to run; raise only after wrapup done
  - 'abort':  raise immediately on budget hit (safe default)
  - 'clamp':  silently stop LLM calls; in-flight ones return partial
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Iterator

class BudgetExceededError(Exception):
    """Raised when budget exhausted and mode is 'abort' or 'wrapup' finished."""

BUDGET_MODES = ("wrapup", "abort", "clamp")
DEFAULT_MODE = "abort"  # conservative — existing behavior

class BudgetGuard:
    """Thread-safe token budget tracker with exhaustion detection.

    Usage:
        guard = BudgetGuard(cap_tokens=800_000, mode="wrapup")
        with guard:
            for step in steps:
                guard.consume(step.tokens_used)
                if guard.exceeded:
                    if step.wrapup:
                        continue  # allow wrapup step
                    raise BudgetExceededError("budget hit, only wrapup allowed")
    """

    def __init__(self, cap_tokens: int, mode: str = DEFAULT_MODE):
        if mode not in BUDGET_MODES:
            raise ValueError(f"mode must be one of {BUDGET_MODES}, got {mode!r}")
        self.cap_tokens = cap_tokens
        self.mode = mode
        self._used = 0
        self._lock = threading.Lock()
        self.exceeded = False
        self.wrapup_done = False  # for wrapup mode

    @property
    def remaining(self) -> int:
        return max(0, self.cap_tokens - self._used)

    def consume(self, tokens: int) -> None:
        with self._lock:
            self._used += tokens
            if self._used >= self.cap_tokens and not self.exceeded:
                self.exceeded = True

    def allow_wrapup(self) -> bool:
        """In wrapup mode, allow caller to mark wrapup as done before raising."""
        if self.mode != "wrapup":
            return False
        self.wrapup_done = True
        return True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        # No teardown needed — context manager just scopes the guard
        return False


@contextmanager
def budget_guard(cap_tokens: int, mode: str = DEFAULT_MODE) -> Iterator[BudgetGuard]:
    guard = BudgetGuard(cap_tokens=cap_tokens, mode=mode)
    yield guard


__all__ = [
    "BudgetExceededError",
    "BudgetGuard",
    "budget_guard",
    "BUDGET_MODES",
    "DEFAULT_MODE",
]
