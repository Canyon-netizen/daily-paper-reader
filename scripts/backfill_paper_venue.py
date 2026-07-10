#!/usr/bin/env python3
"""Backfill venue / accepted fields into docs/papers/*.md frontmatter.

Why this exists
---------------
When the conference-init pipeline (src/maintain/init_aaai.py and friends)
synthesizes an MD note, it populates the `source` column with values like
"ICML-2025-Accepted" or "iclr-openreview". The front-end derives the human-
readable venue label (`venue` and `accepted` fields) from `source` on read
(see astro-src/lib/paper.ts::deriveVenue). But:

- Old notes (already in docs/papers/) lack `venue` / `accepted` in their
  frontmatter.
- Note-generator code might forget to emit them.

This script scans all docs/papers/*.md, parses frontmatter, derives the venue
fields, and writes them back. Idempotent: re-running after a no-change state
is a no-op.

Usage
-----
    python scripts/backfill_paper_venue.py            # writes in place
    python scripts/backfill_paper_venue.py --dry-run  # show what would change
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "docs" / "papers"

# Source-id → human-readable conference label. Keep in sync with
# astro-src/lib/paper.ts::deriveVenue.
# Accepts BOTH underscore ("icml_openreview") and hyphen ("icml-openreview")
# variants since the Supabase row's `source` column may have been written by
# different pipelines over time.
def _conf_label(s: str) -> str | None:
    return CONFERENCE_SOURCE_LABELS.get(s.lower().replace("-", "_"))


CONFERENCE_SOURCE_LABELS: dict[str, str] = {
    "aaai": "AAAI",
    "acl": "ACL",
    "emnlp": "EMNLP",
    "iclr_openreview": "ICLR",
    "icml_openreview": "ICML",
    "neurips_openreview": "NeurIPS",
}

# Uppercase tag → display label, for tagged values like "ICML-2025-Accepted".
# Mirrors the labels dict in deriveVenue.
TAG_TO_LABEL: dict[str, str] = {
    "AAAI": "AAAI",
    "ACL": "ACL",
    "EMNLP": "EMNLP",
    "ICLR": "ICLR",
    "ICML": "ICML",
    "NIPS": "NeurIPS",
    "NEURIPS": "NeurIPS",
}

ACCEPTED_STATUSES = {"accepted", "oral", "poster", "spotlight"}

FRONTMATTER_RE = re.compile(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$", re.MULTILINE)


def extract_venue(raw_source: str | None) -> tuple[str, bool]:
    """Pure function mirroring astro-src/lib/paper.ts::deriveVenue.

    Returns (venue, accepted). For non-conference sources or missing values,
    returns ("", False).
    """
    if not raw_source:
        return "", False
    source = str(raw_source).strip()
    if not source:
        return "", False

    # Tagged value like "ICML-2025-Accepted" or "NeurIPS-2023-Poster".
    # Allow mixed-case tag (NeurIPS contains lowercase s).
    tagged = re.match(r"^([A-Za-z]+)-(\d{4})-(.+)$", source)
    if tagged:
        tag, year, status = tagged.group(1), tagged.group(2), tagged.group(3)
        label = TAG_TO_LABEL.get(str(tag).upper())
        if label:
            accepted = str(status).lower() in ACCEPTED_STATUSES
            return f"{label} {year}", accepted

    label = _conf_label(source)
    if label:
        return label, False

    return "", False


def parse_frontmatter(text: str) -> tuple[dict, str] | None:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None
    try:
        data = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return None
    return data, m.group(2)


def render_frontmatter(data: dict, body: str) -> str:
    """Serialize frontmatter preserving key order; venue/accepted pinned last."""
    if not isinstance(data, dict):
        data = {}
    # Move venue/accepted to end so diffs are stable when keys reorder.
    venue = data.pop("venue", None)
    accepted = data.pop("accepted", None)
    parts: list[str] = []
    for k, v in data.items():
        # yaml.safe_dump quotes strings containing special chars; keep simple.
        parts.append(f"{k}: {yaml.safe_dump(v, default_flow_style=False, allow_unicode=True).rstrip()}")
    if venue:
        parts.append(f'venue: "{venue}"')
    if accepted is True:
        parts.append("accepted: true")
    elif accepted is False:
        parts.append("accepted: false")
    return "---\n" + "\n".join(parts) + "\n---\n" + body


def process_file(path: Path, dry_run: bool) -> tuple[bool, str]:
    text = path.read_text(encoding="utf-8")
    parsed = parse_frontmatter(text)
    if parsed is None:
        return False, "no-frontmatter"
    data, body = parsed
    source = data.get("source")
    venue, accepted = extract_venue(source)
    cur_venue = data.get("venue")
    cur_accepted = data.get("accepted")

    # Skip writing when derived values match what's already there.
    if cur_venue == venue and bool(cur_accepted) == accepted:
        return False, "unchanged"

    # For non-conference sources, the only "right" answer is venue="" / accepted=false.
    # If the frontmatter already lacks both keys AND the source isn't a conference,
    # there's nothing to backfill (the front-end will derive these on read).
    if not venue and not cur_venue and not cur_accepted and source not in (
        None,
        "",
        # Conference source ids that derive to {label, accepted=False} on plain (untagged) input.
        "aaai",
        "acl",
        "emnlp",
        "iclr_openreview",
        "iclr-openreview",
        "icml_openreview",
        "icml-openreview",
        "neurips_openreview",
        "neurips-openreview",
    ):
        return False, "skipped (non-conference, no venue needed)"

    data["venue"] = venue
    data["accepted"] = accepted
    new_text = render_frontmatter(data, body)
    if not dry_run:
        path.write_text(new_text, encoding="utf-8")
    return True, f"venue={venue!r} accepted={accepted}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Don't write changes")
    args = parser.parse_args()

    if not DOCS_DIR.exists():
        print(f"No {DOCS_DIR} directory; nothing to backfill.", file=sys.stderr)
        return 0

    changed = 0
    skipped = 0
    for path in sorted(DOCS_DIR.glob("*.md")):
        if path.name == "README.md":
            continue
        was_changed, reason = process_file(path, args.dry_run)
        if was_changed:
            changed += 1
            print(f"[{path.name}] {reason}")
        else:
            skipped += 1
    mode = "DRY-RUN" if args.dry_run else "WRITTEN"
    print(f"\n{mode}: {changed} changed, {skipped} unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())