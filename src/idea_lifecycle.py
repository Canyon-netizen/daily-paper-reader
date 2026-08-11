"""Idea promotion lifecycle (Polaris services/ideas.py:456-559).

States:
    sketch → candidate → under_review → promoted
                       ↘ rejected (terminal)

Transitions:
    sketch → candidate: deterministic (after dedup + scoring)
    candidate → under_review: deterministic (after debate produces Elo)
    under_review → promoted: GATED (requires both Elo and support ratio thresholds)
    any → rejected: explicit rejection

Thresholds (configurable via constructor):
    min_elo: minimum Elo rating to be promotion-eligible (default 1250)
    min_support_ratio: minimum supported/checked ratio (default 0.6)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

IDEA_STATES = ("sketch", "candidate", "under_review", "promoted", "rejected")
TERMINAL_STATES = ("promoted", "rejected")


@dataclass(frozen=True)
class PromotionThresholds:
    """Thresholds required for promotion from under_review to promoted."""

    min_elo: float = 1250.0
    min_support_ratio: float = 0.6
    min_matches: int = 2  # must have played at least N debate matches


class PromotionGateError(Exception):
    """Raised when promotion requirements aren't met."""


class InvalidTransitionError(Exception):
    """Raised on illegal state transition."""


def transition(idea: dict, target: str, thresholds: PromotionThresholds | None = None) -> dict:
    """Transition idea to target state, enforcing rules.

    Returns updated idea dict. Raises InvalidTransitionError on illegal jumps.
    Raises PromotionGateError if going to 'promoted' without meeting thresholds.

    Legal transitions:
        sketch → candidate, rejected
        candidate → under_review, rejected
        under_review → promoted, rejected
        promoted → (terminal)
        rejected → (terminal)
    """
    thresholds = thresholds or PromotionThresholds()
    current = idea.get("status", "sketch")

    if current in TERMINAL_STATES:
        raise InvalidTransitionError(
            f"idea {idea.get('id')} is {current} (terminal); cannot transition"
        )

    if target not in IDEA_STATES:
        raise InvalidTransitionError(f"unknown target state: {target!r}")

    # Legal forward transitions
    legal_next = {
        "sketch": ("candidate", "rejected"),
        "candidate": ("under_review", "rejected"),
        "under_review": ("promoted", "rejected"),
    }
    if target not in legal_next.get(current, ()):
        raise InvalidTransitionError(
            f"illegal transition {current} → {target}; legal next: {legal_next.get(current, [])}"
        )

    # Gate check for promotion
    if target == "promoted":
        elo = float(idea.get("elo_rating", 0))
        if elo < thresholds.min_elo:
            raise PromotionGateError(
                f"elo {elo:.0f} below threshold {thresholds.min_elo:.0f}"
            )
        matches = int(idea.get("matches", 0))
        if matches < thresholds.min_matches:
            raise PromotionGateError(
                f"matches {matches} below threshold {thresholds.min_matches}"
            )
        scores = idea.get("scores") or {}
        # use avg of 4 dim scores if no support_ratio recorded
        if scores:
            avg_score = sum(scores.values()) / len(scores)
            if avg_score / 10 < thresholds.min_support_ratio:
                raise PromotionGateError(
                    f"avg score {avg_score:.1f}/10 below support threshold "
                    f"{thresholds.min_support_ratio}"
                )

    idea = dict(idea)  # don't mutate caller's dict
    idea["status"] = target
    idea["status_history"] = idea.get("status_history", []) + [
        {"from": current, "to": target, "at": _now_iso()}
    ]
    return idea


def _now_iso() -> str:
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def auto_promote_ideas(
    ideas: list[dict],
    thresholds: PromotionThresholds | None = None,
) -> tuple[list[dict], list[dict]]:
    """Run auto-promotion sweep: transition each idea as far as possible.

    Returns:
        (promoted_ideas, updated_ideas_with_failures)
        The second list has 'promotion_error' field for ideas that failed
        the gate (caller can decide to retry after more debate, or reject).
    """
    thresholds = thresholds or PromotionThresholds()
    promoted = []
    updated = []
    for idea in ideas:
        current = idea.get("status", "sketch")
        # Walk forward through legal transitions
        try:
            while current not in TERMINAL_STATES:
                next_state = _next_auto_state(current, idea, thresholds)
                if next_state is None:
                    break
                idea = transition(idea, next_state, thresholds)
                current = idea["status"]
            updated.append(idea)
            if current == "promoted":
                promoted.append(idea)
        except PromotionGateError as e:
            idea = dict(idea)
            idea["promotion_error"] = str(e)
            updated.append(idea)
    return promoted, updated


def _next_auto_state(current: str, idea: dict, thresholds: PromotionThresholds) -> str | None:
    """Determine next auto-transition. Returns None if should stop."""
    if current == "sketch":
        # After scoring/dedup, transition to candidate (deterministic)
        if idea.get("scores") or idea.get("signals"):
            return "candidate"
        return None
    if current == "candidate":
        # After debate, transition to under_review
        if idea.get("matches", 0) > 0:
            return "under_review"
        return None
    if current == "under_review":
        # Always attempt promotion - let transition() raise PromotionGateError if fails
        return "promoted"
    return None
