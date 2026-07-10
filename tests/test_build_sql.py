"""Regression tests for scripts/build_sql.py.

We test two things:

1. **Re-runs are deterministic**: running build_sql twice produces byte-identical
   output. This catches accidental nondeterminism in template rendering.

2. **No regenerated file diverges from its committed version** unless that file
   is currently in the `_KNOWN_DIVERGENT` allowlist. The allowlist records the
   intentional improvements this PR introduces:

   - ICML match file: bug fix (`match_icml_openreview_papers.sql:81` was missing
     the `p.` qualifier; now uses `coalesce(p.abstract, '')` like all siblings).
   - 9 schema files: HNSW index added (only `create_papers_schema.sql` had it
     before).

If you change a template or `sources.yaml` and the regenerated files differ from
the committed ones, the test fails — which is what you want: it forces a manual
review of the diff before commit.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD_SQL = ROOT / "scripts" / "build_sql.py"
SQL_DIR = ROOT / "sql"

# Filenames whose regeneration is *expected* to differ from the committed
# version, because this PR intentionally improves them. Anyone adding a new
# divergent file should also explain the reason here.
_KNOWN_DIVERGENT: dict[str, str] = {
    # ICML match file: bug fix.
    "match_icml_openreview_papers.sql": (
        "Fix: line 81 used bare `coalesce(abstract, '')` (missing `p.` qualifier); "
        "all 8 sibling match files use `coalesce(p.abstract, '')`. Template now "
        "always emits the `p.` prefix."
    ),
    # 9 schema files: HNSW index added.
    "create_aaai_papers_schema.sql": "Added HNSW index to bring in line with create_papers_schema.sql.",
    "create_acl_papers_schema.sql": "Added HNSW index.",
    "create_biorxiv_papers_schema.sql": "Added HNSW index.",
    "create_chemrxiv_papers_schema.sql": "Added HNSW index.",
    "create_emnlp_papers_schema.sql": "Added HNSW index.",
    "create_iclr_openreview_papers_schema.sql": "Added HNSW index.",
    "create_icml_openreview_papers_schema.sql": "Added HNSW index.",
    "create_medrxiv_papers_schema.sql": "Added HNSW index.",
    "create_neurips_openreview_papers_schema.sql": "Added HNSW index.",
    # 9 match files: now stamped with "GENERATED FROM ..." comment header.
    # Their SQL bodies are byte-identical to before (apart from the ICML fix
    # above); only the leading 2 comment lines change.
    "match_aaai_papers.sql": "Added GENERATED FROM header comment.",
    "match_acl_papers.sql": "Added GENERATED FROM header comment.",
    "match_biorxiv_papers.sql": "Added GENERATED FROM header comment.",
    "match_chemrxiv_papers.sql": "Added GENERATED FROM header comment.",
    "match_emnlp_papers.sql": "Added GENERATED FROM header comment.",
    "match_iclr_openreview_papers.sql": "Added GENERATED FROM header comment.",
    "match_medrxiv_papers.sql": "Added GENERATED FROM header comment.",
    "match_neurips_openreview_papers.sql": "Added GENERATED FROM header comment.",
    # anon policy file: same stamp + a blank line between grant-blocks is removed.
    "enable_conference_anon_read_policies.sql": "Added GENERATED FROM header comment.",
}


def _run_build_sql(check_only: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(BUILD_SQL), *(["--check"] if check_only else [])],
        capture_output=True,
        text=True,
        cwd=ROOT,
        encoding="utf-8",
    )


def test_build_sql_is_idempotent() -> None:
    """Re-running build_sql.py twice produces byte-identical output."""
    first = _run_build_sql()
    assert first.returncode == 0, first.stderr
    second = _run_build_sql()
    assert second.returncode == 0, second.stderr
    # Both runs wrote the same content; sampling a few files is enough.
    for name in (
        "create_aaai_papers_schema.sql",
        "match_icml_openreview_papers.sql",
        "enable_conference_anon_read_policies.sql",
    ):
        path = SQL_DIR / name
        assert path.exists(), f"{name} was not generated"
    # Re-running --check should pass now (no divergence left after we wrote).
    check = _run_build_sql(check_only=True)
    assert check.returncode == 0, (
        f"build_sql --check failed after two writes:\n{check.stderr}"
    )


def test_no_unexpected_drift() -> None:
    """Generated files match their committed version, except the known-divergent set.

    This test reads what's currently on disk (after test_build_sql_is_idempotent
    has populated them) and compares against git HEAD. The known-divergent files
    are exempt; any new divergence fails the test, forcing a manual review.
    """
    result = subprocess.run(
        ["git", "diff", "--name-only", "HEAD", "--", "sql/"],
        capture_output=True,
        text=True,
        cwd=ROOT,
        encoding="utf-8",
    )
    assert result.returncode == 0, result.stderr
    changed = {Path(line).name for line in result.stdout.splitlines() if line}
    unexpected = changed - set(_KNOWN_DIVERGENT)
    assert not unexpected, (
        "These sql/ files changed but are not in _KNOWN_DIVERGENT:\n  "
        + "\n  ".join(sorted(unexpected))
        + "\nIf the change is intentional, add it to _KNOWN_DIVERGENT with a"
        " reason. Otherwise, fix the template or sources.yaml."
    )


def test_icml_bug_is_fixed() -> None:
    """Regression: `match_icml_openreview_papers.sql` must use p.abstract, not abstract."""
    text = (SQL_DIR / "match_icml_openreview_papers.sql").read_text(encoding="utf-8")
    assert "coalesce(abstract, '')" not in text, (
        "ICML match file still has the bare `coalesce(abstract, '')` bug"
    )
    assert "coalesce(p.abstract, '')" in text, (
        "ICML match file should now use `coalesce(p.abstract, '')` like all siblings"
    )


def test_all_schemas_have_hnsw() -> None:
    """Every per-source schema file must have the HNSW index."""
    for path in sorted(SQL_DIR.glob("create_*_papers_schema.sql")):
        text = path.read_text(encoding="utf-8")
        assert "embedding_hnsw_idx" in text, f"{path.name} missing HNSW index"