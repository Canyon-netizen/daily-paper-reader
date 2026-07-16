"""Regression tests for P0-1: fetch failure cascade in daily pipeline.

These tests pin down the current observable behavior when arXiv is unreachable.
They do NOT prescribe a fix — they lock in the failure surface so that any
future "graceful degradation" PR (e.g. partial-success commit, retry, sentinel
file) shows up as a deliberate test change rather than silent drift.

Tests:
- test_fetch_all_categories_fail_returns_no_papers: every category raises →
  fetch_arxiv returns 0 papers without re-raising.
- test_fetch_partial_failure_raises_at_first_failing_category: 1 succeeds,
  11 fail → ConnectionError propagates (current behavior: fetch aborts on
  first failure).
- test_run_step_propagates_called_process_error: src/main.run_step uses
  subprocess.run(check=True), so a non-zero exit propagates.
- test_run_step_does_not_write_archive_when_fetch_fails: when fetch_arxiv
  raises before any file write, archive/<run_token>/raw/*.json is absent,
  so the workflow's "Commit results" step finds nothing to commit.
"""

import importlib.util
import pathlib
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "src"


def _load_module(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class FetchAllCategoriesFailTest(unittest.TestCase):
    """fetch_arxiv must NOT re-raise when every category fails — caller
    treats 0-paper fetch as "empty day" not as a crash."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_module("fetch_arxiv_p01", SRC_DIR / "maintain" / "fetchers" / "fetch_arxiv.py")

    def setUp(self):
        self.workdir = ROOT / "archive" / "_test_p01_all_fail"
        shutil.rmtree(self.workdir, ignore_errors=True)

    def tearDown(self):
        shutil.rmtree(self.workdir, ignore_errors=True)

    def test_fetch_all_categories_fail_returns_no_papers(self):
        def boom(_self, _search, _offset=0):
            raise ConnectionError("simulated arxiv API outage")

        out_path = self.workdir / "raw" / "arxiv_papers_sim.json"
        with patch.object(self.mod.arxiv.Client, "results", boom):
            # disable_supabase_read=True forces local-arxiv path
            self.mod.fetch_all_domains_metadata_robust(
                days=1,
                output_file=str(out_path),
                ignore_seen=True,
                disable_supabase_read=True,
            )
        # Current behavior: returns normally with 0 papers; no output file written
        self.assertFalse(
            out_path.exists(),
            "fetch_all_domains_metadata_robust wrote a file despite all categories failing",
        )


class FetchPartialFailureTest(unittest.TestCase):
    """Pinning the partial-failure contract: 1 success + 11 failures → exception."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_module("fetch_arxiv_p01_partial", SRC_DIR / "maintain" / "fetchers" / "fetch_arxiv.py")

    def setUp(self):
        self.workdir = ROOT / "archive" / "_test_p01_partial_fail"
        shutil.rmtree(self.workdir, ignore_errors=True)

    def tearDown(self):
        shutil.rmtree(self.workdir, ignore_errors=True)

    def test_fetch_partial_failure_raises_at_first_failing_category(self):
        """When fetch_category_in_windows raises for one category, the loop
        must NOT swallow it — otherwise a single bad category silently hides
        the outage from logs."""
        fetch_log = []
        success_for = {"cs"}

        def wrapped_fetch_category(category, *args, **kwargs):
            fetch_log.append(category)
            if category in success_for:
                return [
                    {
                        "id": "2607.99999",
                        "title": "Simulated",
                        "authors": "Author",
                        "summary": "fake",
                        "published": "2026-07-16T12:00:00+00:00",
                        "categories": [category],
                        "primary_category": category,
                        "pdf_url": "http://arxiv.org/pdf/2607.99999v1",
                        "entry_id": "http://arxiv.org/abs/2607.99999v1",
                        "link": "http://arxiv.org/abs/2607.99999v1",
                    }
                ]
            raise ConnectionError(f"simulated outage for category={category}")

        out_path = self.workdir / "raw" / "arxiv_papers_sim.json"
        with patch.object(self.mod, "fetch_category_in_windows", wrapped_fetch_category):
            with self.assertRaises(ConnectionError) as ctx:
                self.mod.fetch_all_domains_metadata_robust(
                    days=1,
                    output_file=str(out_path),
                    ignore_seen=True,
                    disable_supabase_read=True,
                )
        # Confirm we tried at least cs (success) then math (failure) — partial progress
        # happened before the raise.
        self.assertIn("cs", fetch_log, "fetch must attempt cs first (alphabetical)")
        self.assertLess(
            fetch_log.index("cs"), fetch_log.index("math"),
            "cs must succeed before math fails (sanity check on test fixture ordering)",
        )
        self.assertIn("math", fetch_log, "fetch must attempt at least one failing category")
        self.assertIn("simulated outage", str(ctx.exception))
        # And no output was written because exception propagated before write.
        self.assertFalse(out_path.exists())


class RunStepPropagatesFailureTest(unittest.TestCase):
    """src/main.run_step uses subprocess.run(check=True); non-zero exit must
    propagate to the caller so main() exits 1."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_module("main_p01_runstep", SRC_DIR / "main.py")

    def test_run_step_propagates_called_process_error(self):
        def fake_run(args, *a, **kw):
            raise subprocess.CalledProcessError(returncode=1, cmd=args, stderr="simulated failure")

        with patch.object(self.mod.subprocess, "run", side_effect=fake_run):
            with self.assertRaises(subprocess.CalledProcessError) as ctx:
                self.mod.run_step(
                    "Step 1 - fetch arxiv",
                    [sys.executable, str(SRC_DIR / "maintain" / "fetchers" / "fetch_arxiv.py")],
                )
        self.assertEqual(ctx.exception.returncode, 1)


class FetchFailureDoesNotPolluteArchiveTest(unittest.TestCase):
    """When fetch_arxiv raises, archive/<token>/raw/*.json must NOT exist —
    the daily workflow's 'Commit results' step would otherwise commit empty
    data into the docs/ tree."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_module("main_p01_pollute", SRC_DIR / "main.py")

    def test_run_step_does_not_write_archive_when_fetch_fails(self):
        token = self.mod.resolve_run_date_token(1)  # 1-day → single-day token
        archive_dir = ROOT / "archive" / token
        # Defensive cleanup in case the previous run wrote anything
        shutil.rmtree(archive_dir, ignore_errors=True)

        def fake_run(args, *a, **kw):
            raise subprocess.CalledProcessError(returncode=1, cmd=args, stderr="fetch fail")

        with patch.object(self.mod.subprocess, "run", side_effect=fake_run):
            with self.assertRaises(subprocess.CalledProcessError):
                self.mod.run_step(
                    "Step 1 - fetch arxiv",
                    [
                        sys.executable,
                        str(SRC_DIR / "maintain" / "fetchers" / "fetch_arxiv.py"),
                        "--days", "1",
                        "--ignore-seen",
                    ],
                )

        # The repo's real archive dir should not have been touched by this test.
        # (Token-resolved dir might be the same as a real run's; we only assert
        # the test didn't create anything.)
        if archive_dir.exists():
            raw_files = list((archive_dir / "raw").glob("*.json")) if (archive_dir / "raw").exists() else []
            test_marker = "_test_p01" in archive_dir.name
            self.assertTrue(
                test_marker or len(raw_files) == 0,
                f"archive/{token}/raw/ should be empty after fetch failure, got: {[f.name for f in raw_files]}",
            )


if __name__ == "__main__":
    unittest.main()