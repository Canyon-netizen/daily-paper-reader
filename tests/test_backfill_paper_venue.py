"""Unit tests for scripts/backfill_paper_venue.py::extract_venue.

Mirrors the logic in astro-src/lib/paper.ts::deriveVenue — both implementations
must stay in lockstep (the front-end consumes `venue` / `accepted` derived from
this function's output).
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running as `python -m pytest` from repo root without packaging.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from backfill_paper_venue import extract_venue  # noqa: E402


def test_untagged_conference_source_id() -> None:
    # Plain source-id from Supabase row, before backfill tagged a value.
    venue, accepted = extract_venue("icml-openreview")
    assert venue == "ICML", venue
    assert accepted is False


def test_iclr_accepted_tagged() -> None:
    venue, accepted = extract_venue("ICLR-2024-Accepted")
    assert venue == "ICLR 2024", venue
    assert accepted is True


def test_neurips_poster() -> None:
    venue, accepted = extract_venue("NeurIPS-2023-Poster")
    assert venue == "NeurIPS 2023", venue
    assert accepted is True


def test_aaai_oral() -> None:
    venue, accepted = extract_venue("AAAI-2025-Oral")
    assert venue == "AAAI 2025", venue
    assert accepted is True


def test_emnlp_spotlight() -> None:
    venue, accepted = extract_venue("EMNLP-2024-Spotlight")
    assert venue == "EMNLP 2024", venue
    assert accepted is True


def test_rejected_public_not_accepted() -> None:
    # OpenReview exposes Rejected-Public for transparency; should NOT badge as accepted.
    venue, accepted = extract_venue("ICML-2025-Rejected-Public")
    assert venue == "ICML 2025", venue
    assert accepted is False


def test_non_conference_source_empty() -> None:
    venue, accepted = extract_venue("arxiv")
    assert venue == ""
    assert accepted is False


def test_biorxiv_empty() -> None:
    venue, accepted = extract_venue("biorxiv")
    assert venue == ""
    assert accepted is False


def test_medrxiv_empty() -> None:
    venue, accepted = extract_venue("medrxiv")
    assert venue == ""
    assert accepted is False


def test_chemrxiv_empty() -> None:
    venue, accepted = extract_venue("chemrxiv")
    assert venue == ""
    assert accepted is False


def test_empty_string() -> None:
    venue, accepted = extract_venue("")
    assert venue == ""
    assert accepted is False


def test_none_input() -> None:
    venue, accepted = extract_venue(None)
    assert venue == ""
    assert accepted is False


def test_unknown_conference_tag() -> None:
    # Tagged value but the tag isn't in our known-conference list.
    venue, accepted = extract_venue("XYZ-2025-Accepted")
    assert venue == ""
    assert accepted is False


def test_whitespace_only() -> None:
    venue, accepted = extract_venue("   ")
    assert venue == ""
    assert accepted is False


# =============================================================================
# End-to-end backfill tests
# =============================================================================

from scripts.backfill_paper_venue import process_file  # noqa: E402


def test_backfill_writes_venue_for_conference_source(tmp_path) -> None:
    """A paper with source='icml-openreview' should gain venue='ICML' on first run."""
    p = tmp_path / "test.md"
    p.write_text(
        "---\n"
        "title: Test\n"
        "source: icml-openreview\n"
        "---\n"
        "Body text.\n",
        encoding="utf-8",
    )
    changed, reason = process_file(p, dry_run=False)
    assert changed is True, reason
    text = p.read_text(encoding="utf-8")
    assert 'venue: "ICML"' in text
    assert "accepted: false" in text


def test_backfill_writes_year_and_accepted_for_tagged(tmp_path) -> None:
    p = tmp_path / "test.md"
    p.write_text(
        "---\n"
        "title: Test\n"
        "source: NeurIPS-2024-Accepted\n"
        "---\n"
        "Body.\n",
        encoding="utf-8",
    )
    changed, _ = process_file(p, dry_run=False)
    assert changed is True
    text = p.read_text(encoding="utf-8")
    assert 'venue: "NeurIPS 2024"' in text
    assert "accepted: true" in text


def test_backfill_skips_non_conference(tmp_path) -> None:
    """arxiv/biorxiv/medrxiv/chemrxiv papers should NOT gain empty venue fields."""
    p = tmp_path / "test.md"
    p.write_text(
        "---\n"
        "title: Test\n"
        "source: arxiv\n"
        "---\n"
        "Body.\n",
        encoding="utf-8",
    )
    changed, _ = process_file(p, dry_run=False)
    assert changed is False, "arxiv paper should not be modified"
    text = p.read_text(encoding="utf-8")
    assert "venue:" not in text


def test_backfill_idempotent(tmp_path) -> None:
    """Running backfill twice yields identical content (no spurious diffs)."""
    p = tmp_path / "test.md"
    p.write_text(
        "---\n"
        "title: Test\n"
        "source: iclr-openreview\n"
        "---\n"
        "Body.\n",
        encoding="utf-8",
    )
    process_file(p, dry_run=False)
    first = p.read_text(encoding="utf-8")
    changed, _ = process_file(p, dry_run=False)
    assert changed is False, "Second run should be a no-op"
    assert p.read_text(encoding="utf-8") == first


def test_backfill_handles_already_tagged(tmp_path) -> None:
    """If frontmatter already has venue/accepted matching the derived values, no-op."""
    p = tmp_path / "test.md"
    p.write_text(
        "---\n"
        "title: Test\n"
        "source: ICML-2025-Accepted\n"
        'venue: "ICML 2025"\n'
        "accepted: true\n"
        "---\n"
        "Body.\n",
        encoding="utf-8",
    )
    changed, _ = process_file(p, dry_run=False)
    assert changed is False, "Already-correct frontmatter should not be touched"