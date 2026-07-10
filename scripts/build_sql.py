#!/usr/bin/env python3
"""Generate per-source SQL files from sql/_templates/* via sql/sources.yaml.

Why this exists
---------------
Before this script, 10 `create_*_papers_schema.sql` and 10 `match_*_papers.sql`
files were token-for-token copies that drifted apart: the ICML copy was missing
the `p.` qualifier in `match_icml_openreview_papers.sql:81` (bug), and the 10
copies did not have the HNSW index that `create_papers_schema.sql` had.

This script collapses them into a single template per kind, so all 10 sources
stay in lockstep. Adding an 11th source = append one entry to sql/sources.yaml
and re-run this script.

Usage
-----
    python scripts/build_sql.py             # write all files in place
    python scripts/build_sql.py --check     # exit non-zero if any file would change

Safe to re-run; produces deterministic output.
"""
from __future__ import annotations

import argparse
import difflib
import sys
from pathlib import Path
from string import Template

import yaml

ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = ROOT / "sql"
TEMPLATE_DIR = SQL_DIR / "_templates"
SOURCES_PATH = SQL_DIR / "sources.yaml"

DISPLAY_NAMES = {
    "aaai": "AAAI 官方 proceedings",
    "acl": "ACL Anthology",
    "biorxiv": "bioRxiv",
    "chemrxiv": "ChemRxiv",
    "emnlp": "EMNLP Anthology",
    "iclr_openreview": "ICLR OpenReview 投稿",
    "icml_openreview": "ICML OpenReview 投稿",
    "medrxiv": "medRxiv",
    "neurips_openreview": "NeurIPS OpenReview 投稿",
}

CONFERENCE_TAGS = {
    "aaai": "AAAI",
    "acl": "ACL",
    "emnlp": "EMNLP",
    "iclr_openreview": "ICLR",
    "icml_openreview": "ICML",
    "neurips_openreview": "NeurIPS",
}


def load_sources() -> list[dict]:
    with SOURCES_PATH.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    sources = data.get("sources") or []
    if not sources:
        raise RuntimeError("sql/sources.yaml has no sources")
    return sources


def _substitute(template_text: str, **kwargs: str) -> str:
    """string.Template wrapper that also expands __DOLLAR_QUOTE__ → $$.

    Postgres uses `$$ ... $$` as a dollar-quoted string literal. string.Template
    treats `$$` as an escape for a single `$`, which would emit a bare `$` and
    then treat the next characters as a placeholder (and fail). We sidestep this
    by using the placeholder `__DOLLAR_QUOTE__` in templates and expanding it
    to `$$` here.
    """
    expanded = Template(template_text).substitute(**kwargs)
    return expanded.replace("__DOLLAR_QUOTE__", "$$")


def render_schema(source: dict) -> str:
    schema_name = source["schema_name"]
    display_name = DISPLAY_NAMES.get(source["source_name"], source["source_name"])
    default_value = source.get("source_default_value")
    if default_value:
        source_default_clause = f" default '{default_value}'"
    else:
        source_default_clause = ""
    return _substitute(
        (TEMPLATE_DIR / "schema.sql.tmpl").read_text(encoding="utf-8"),
        display_name=display_name,
        schema_name=schema_name,
        source_default_clause=source_default_clause,
    )


def render_match(source: dict) -> str:
    schema_name = source["schema_name"]
    display_name = DISPLAY_NAMES.get(source["source_name"], source["source_name"])
    return _substitute(
        (TEMPLATE_DIR / "match.sql.tmpl").read_text(encoding="utf-8"),
        display_name=display_name,
        schema_name=schema_name,
        match_name=schema_name,
    )


def render_anon_read_policies(sources: list[dict]) -> str:
    policy_blocks: list[str] = []
    grant_select_blocks: list[str] = []
    grant_execute_blocks: list[str] = []
    verify_examples: list[str] = []
    for source in sources:
        if not source.get("anon_read_policy"):
            continue
        schema_name = source["schema_name"]
        source_id = source["source_name"]
        tag = CONFERENCE_TAGS.get(source_id)
        if not tag:
            raise RuntimeError(
                f"source {source_id!r} has anon_read_policy=true but no CONFERENCE_TAGS entry"
            )
        policy_blocks.append(
            f"""alter table public.{schema_name} enable row level security;

drop policy if exists "public read {schema_name}" on public.{schema_name};
create policy "public read {schema_name}"
on public.{schema_name}
for select
to anon, authenticated
using (
  source ~ '^{tag}-[0-9]{{4}}-(Accepted|Public|Rejected-Public|Withdrawn-Public)$'
);"""
        )
        grant_select_blocks.append(
            f"""grant select on table public.{schema_name} to anon, authenticated;"""
        )
        grant_execute_blocks.append(
            f"""grant execute on function public.match_{schema_name}_exact(vector, int, timestamptz, timestamptz)
to anon, authenticated;

grant execute on function public.match_{schema_name}_bm25(text, int, timestamptz, timestamptz)
to anon, authenticated;"""
        )
        verify_examples.append(
            f"""-- curl "$SUPABASE_URL/rest/v1/{schema_name}?select=id,title,source&source=like.{tag}-2025*&limit=1" \\
--   -H "apikey: $SUPABASE_ANON_KEY" \\
--   -H "Authorization: Bearer $SUPABASE_ANON_KEY\""""
        )
    if not policy_blocks:
        policy_blocks = ["-- (no sources opted into anon_read_policy)"]
    return _substitute(
        (TEMPLATE_DIR / "anon_read_policies.sql.tmpl").read_text(encoding="utf-8"),
        policy_blocks="\n\n".join(policy_blocks),
        grant_select_blocks="\n".join(grant_select_blocks) or "-- (no grants)",
        grant_execute_blocks="\n\n".join(grant_execute_blocks) or "-- (no grants)",
        verify_examples="\n--\n".join(verify_examples) or "-- (no verification examples)",
    )


def write_or_check(path: Path, content: str, check_only: bool) -> bool:
    """Return True if file is unchanged (or check passed)."""
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if existing == content:
        return True
    if check_only:
        diff = "".join(
            difflib.unified_diff(
                existing.splitlines(keepends=True),
                content.splitlines(keepends=True),
                fromfile=f"a/{path.name}",
                tofile=f"b/{path.name}",
            )
        )
        sys.stderr.write(diff)
        return False
    path.write_text(content, encoding="utf-8")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if any generated file differs from what's on disk.",
    )
    args = parser.parse_args()

    sources = load_sources()
    all_ok = True

    for source in sources:
        schema_path = SQL_DIR / f"create_{source['schema_name']}_schema.sql"
        match_path = SQL_DIR / f"match_{source['schema_name']}.sql"
        ok1 = write_or_check(schema_path, render_schema(source), args.check)
        ok2 = write_or_check(match_path, render_match(source), args.check)
        all_ok = all_ok and ok1 and ok2

    anon_path = SQL_DIR / "enable_conference_anon_read_policies.sql"
    ok3 = write_or_check(anon_path, render_anon_read_policies(sources), args.check)
    all_ok = all_ok and ok3

    if args.check and not all_ok:
        sys.stderr.write(
            "\nFAIL: generated SQL files are stale. Run `python scripts/build_sql.py`.\n"
        )
        return 1
    if not args.check:
        print(
            f"Generated {len(sources)} schema files + {len(sources)} match files + 1 anon policy file."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())