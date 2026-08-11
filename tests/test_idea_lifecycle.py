"""Tests for idea promotion lifecycle state machine.

States:
    sketch → candidate → under_review → promoted
                       ↘ rejected (terminal)
"""
from __future__ import annotations

import pytest
from src.idea_lifecycle import (
    transition,
    auto_promote_ideas,
    PromotionThresholds,
    PromotionGateError,
    InvalidTransitionError,
)


# ----------------------------------------------------------------------------
# Basic state transitions
# ----------------------------------------------------------------------------

def test_sketch_to_candidate_legal():
    """sketch → candidate is allowed."""
    idea = {"id": "abc", "status": "sketch", "scores": {"novelty": 7}}
    result = transition(idea, "candidate")
    assert result["status"] == "candidate"


def test_candidate_to_under_review_legal():
    """candidate → under_review is allowed."""
    idea = {"id": "abc", "status": "candidate", "matches": 3}
    result = transition(idea, "under_review")
    assert result["status"] == "under_review"


def test_under_review_to_promoted_legal():
    """under_review → promoted is allowed when thresholds met."""
    idea = {
        "id": "abc",
        "status": "under_review",
        "elo_rating": 1300,
        "matches": 3,
        "scores": {"novelty": 7, "feasibility": 6, "operability": 7, "impact": 8},
    }
    thresholds = PromotionThresholds(min_elo=1250, min_matches=2)
    result = transition(idea, "promoted", thresholds)
    assert result["status"] == "promoted"


def test_sketch_to_promoted_illegal():
    """Cannot jump from sketch directly to promoted."""
    idea = {"id": "abc", "status": "sketch", "elo_rating": 1300, "matches": 5}
    with pytest.raises(InvalidTransitionError) as exc:
        transition(idea, "promoted")
    assert "illegal transition" in str(exc.value)


def test_promoted_is_terminal():
    """Cannot transition from promoted."""
    idea = {"id": "abc", "status": "promoted"}
    with pytest.raises(InvalidTransitionError) as exc:
        transition(idea, "rejected")
    assert "terminal" in str(exc.value)


def test_rejected_is_terminal():
    """Cannot transition from rejected."""
    idea = {"id": "abc", "status": "rejected"}
    with pytest.raises(InvalidTransitionError) as exc:
        transition(idea, "candidate")
    assert "terminal" in str(exc.value)


# ----------------------------------------------------------------------------
# Promotion gate checks
# ----------------------------------------------------------------------------

def test_promotion_blocked_by_low_elo():
    """elo=1200 with threshold=1250 → PromotionGateError."""
    idea = {
        "id": "abc",
        "status": "under_review",
        "elo_rating": 1200,
        "matches": 3,
        "scores": {"novelty": 7, "feasibility": 6, "operability": 7, "impact": 8},
    }
    thresholds = PromotionThresholds(min_elo=1250, min_matches=2)
    with pytest.raises(PromotionGateError) as exc:
        transition(idea, "promoted", thresholds)
    assert "1200" in str(exc.value) and "1250" in str(exc.value)


def test_promotion_blocked_by_too_few_matches():
    """matches=1 with threshold=2 → PromotionGateError."""
    idea = {
        "id": "abc",
        "status": "under_review",
        "elo_rating": 1300,
        "matches": 1,
        "scores": {"novelty": 7, "feasibility": 6, "operability": 7, "impact": 8},
    }
    thresholds = PromotionThresholds(min_elo=1250, min_matches=2)
    with pytest.raises(PromotionGateError) as exc:
        transition(idea, "promoted", thresholds)
    assert "matches 1" in str(exc.value) and "threshold 2" in str(exc.value)


def test_promotion_blocked_by_low_avg_score():
    """scores avg=4/10 with threshold=0.6 → PromotionGateError."""
    idea = {
        "id": "abc",
        "status": "under_review",
        "elo_rating": 1300,
        "matches": 3,
        # avg = (3+4+5+4)/4 = 4, which is 0.4/10 → below 0.6
        "scores": {"novelty": 3, "feasibility": 4, "operability": 5, "impact": 4},
    }
    thresholds = PromotionThresholds(min_elo=1250, min_matches=2, min_support_ratio=0.6)
    with pytest.raises(PromotionGateError) as exc:
        transition(idea, "promoted", thresholds)
    assert "avg score" in str(exc.value)


# ----------------------------------------------------------------------------
# Auto-promotion
# ----------------------------------------------------------------------------

def test_auto_promote_walks_sketch_to_promoted():
    """Fully eligible idea → sketch → candidate → under_review → promoted."""
    idea = {
        "id": "abc",
        "status": "sketch",
        "scores": {"novelty": 7, "feasibility": 6, "operability": 7, "impact": 8},
        "elo_rating": 1300,
        "matches": 3,
    }
    thresholds = PromotionThresholds(min_elo=1250, min_matches=2)
    promoted, updated = auto_promote_ideas([idea], thresholds)

    assert len(promoted) == 1
    assert promoted[0]["status"] == "promoted"
    assert updated[0]["status"] == "promoted"


def test_auto_promote_stays_at_under_review():
    """Ineligible idea stays at under_review with promotion_error."""
    idea = {
        "id": "abc",
        "status": "sketch",
        "scores": {"novelty": 7, "feasibility": 6, "operability": 7, "impact": 8},
        # elo too low, should fail promotion gate
        "elo_rating": 1100,
        "matches": 3,
    }
    thresholds = PromotionThresholds(min_elo=1250, min_matches=2)
    promoted, updated = auto_promote_ideas([idea], thresholds)

    assert len(promoted) == 0
    assert updated[0]["status"] == "under_review"
    assert "promotion_error" in updated[0]


def test_transition_records_history():
    """status_history field is appended each time."""
    idea = {
        "id": "abc",
        "status": "sketch",
        "scores": {"novelty": 7},
    }
    result = transition(idea, "candidate")
    assert "status_history" in result
    assert len(result["status_history"]) == 1
    assert result["status_history"][0]["from"] == "sketch"
    assert result["status_history"][0]["to"] == "candidate"
    assert "at" in result["status_history"][0]

    # Second transition
    result2 = transition(result, "under_review")
    assert len(result2["status_history"]) == 2
    assert result2["status_history"][1]["from"] == "candidate"
    assert result2["status_history"][1]["to"] == "under_review"


def test_auto_promote_without_status_field():
    """Ideas without status field default to sketch."""
    idea = {
        "id": "abc",
        "scores": {"novelty": 7, "feasibility": 6, "operability": 7, "impact": 8},
        "elo_rating": 1300,
        "matches": 3,
    }
    thresholds = PromotionThresholds(min_elo=1250, min_matches=2)
    promoted, updated = auto_promote_ideas([idea], thresholds)

    assert len(promoted) == 1
    assert updated[0]["status"] == "promoted"


def test_auto_promote_without_scores_uses_signals():
    """sketch with signals but no scores can still become candidate."""
    idea = {
        "id": "abc",
        "status": "sketch",
        "signals": ["trends"],  # signals present
        # no scores
    }
    thresholds = PromotionThresholds(min_elo=1250, min_matches=2)
    promoted, updated = auto_promote_ideas([idea], thresholds)

    # Should progress to candidate (sketch → candidate)
    assert updated[0]["status"] == "candidate"
    # But not to under_review (needs matches)
    assert updated[0]["status"] != "under_review"
