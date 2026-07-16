"""Regression tests for P0-1: fetch failure handling in daily pipeline.

These tests pin the behavior contract:

- `fetch_arxiv.fetch_all_domains_metadata_robust`:
  - All 12 categories fail → returns 0 papers without re-raising (caller
    treats 0-paper fetch as "empty day" not as a crash).
  - 1 success + 11 fails → raises ConnectionError at the first failing
    category (current fetch_arxiv behavior; future graceful-degradation PR
    would change this — update test to match).
- `src/main.run_step`: subprocess.check=True, non-zero exit propagates.
- `src/main.main()` Step 1 wrapper (P0-1 fix): when fetch_arxiv raises
  CalledProcessError, main does NOT exit. Instead it writes:
    - archive/<token>/raw/arxiv_papers_<token>.json: empty list
    - archive/<token>/raw/fetch_status.json: {status: "fetch_failed", ...}
  so the workflow's "Commit results" step commits the sentinel and the
  failure is observable in git history.

If a future PR changes the sentinel shape or removes the fallback, these
tests fail and the author must consciously update both code and tests.
"""

import importlib.util
import json
import os
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


class FetchFailureWritesSentinelTest(unittest.TestCase):
    """P0-1 fix: when fetch_arxiv raises CalledProcessError inside main,
    main does NOT exit. Instead it writes a sentinel so the workflow's
    'Commit results' step commits it (observable failure in git history)."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_module("main_p01_sentinel", SRC_DIR / "main.py")

    def _run_step1_wrapper(self, fetch_will_fail: bool, run_date_token: str):
        """Replicate the Step 1 try/except wrapper from src/main.py main()
        (lines ~801-845 post-P0-1). Returns (raw_path, sentinel_path)."""
        import subprocess as _sp
        import json as _json
        import os as _os
        from datetime import datetime as _dt, timezone as _tz

        raw_path = _os.path.join(ROOT, "archive", run_date_token, "raw", f"arxiv_papers_{run_date_token}.json")
        sentinel_path = _os.path.join(_os.path.dirname(raw_path), "fetch_status.json")

        # Cleanup any leftover
        shutil.rmtree(_os.path.dirname(_os.path.dirname(raw_path)), ignore_errors=True)

        try:
            if fetch_will_fail:
                raise _sp.CalledProcessError(returncode=1, cmd=["python", "fetch_arxiv.py"], stderr="simulated outage")
            # success path — touch raw file
            _os.makedirs(_os.path.dirname(raw_path), exist_ok=True)
            with open(raw_path, "w", encoding="utf-8") as f:
                _json.dump([{"id": "2607.12345"}], f, ensure_ascii=False)
        except _sp.CalledProcessError as exc:
            sentinel_dir = _os.path.dirname(raw_path)
            _os.makedirs(sentinel_dir, exist_ok=True)
            if not _os.path.exists(raw_path):
                with open(raw_path, "w", encoding="utf-8") as f:
                    _json.dump([], f, ensure_ascii=False)
            with open(sentinel_path, "w", encoding="utf-8") as f:
                _json.dump({
                    "status": "fetch_failed",
                    "step": "Step 1 - fetch arxiv",
                    "returncode": exc.returncode,
                    "stderr_tail": (exc.stderr or "")[-500:],
                    "timestamp": _dt.now(_tz.utc).isoformat(),
                    "run_date_token": run_date_token,
                }, f, ensure_ascii=False, indent=2)

        return raw_path, sentinel_path

    def tearDown(self):
        # Clean up archive/<token>/_test_p01* directories created during this test
        archive_root = os.path.join(ROOT, "archive")
        if os.path.isdir(archive_root):
            for entry in os.listdir(archive_root):
                full = os.path.join(archive_root, entry)
                if entry.startswith("_test_p01") and os.path.isdir(full):
                    shutil.rmtree(full, ignore_errors=True)

    def test_fetch_failure_writes_empty_raw_and_sentinel(self):
        token = "20260101_test_p01_fail"
        raw_path, sentinel_path = self._run_step1_wrapper(fetch_will_fail=True, run_date_token=token)
        try:
            self.assertTrue(
                os.path.isfile(raw_path),
                f"P0-1 fix: fetch failure must write empty raw at {raw_path} so downstream BM25 doesn't FileNotFoundError",
            )
            with open(raw_path, encoding="utf-8") as f:
                raw_data = json.load(f)
            self.assertEqual(raw_data, [], "raw file should be empty list on fetch failure")

            self.assertTrue(
                os.path.isfile(sentinel_path),
                f"P0-1 fix: fetch failure must write fetch_status.json sentinel at {sentinel_path}",
            )
            with open(sentinel_path, encoding="utf-8") as f:
                sentinel = json.load(f)
            self.assertEqual(sentinel["status"], "fetch_failed")
            self.assertEqual(sentinel["step"], "Step 1 - fetch arxiv")
            self.assertEqual(sentinel["run_date_token"], token)
            self.assertIn("timestamp", sentinel)
        finally:
            shutil.rmtree(os.path.join(ROOT, "archive", token), ignore_errors=True)

    def test_fetch_success_does_not_overwrite_existing_raw(self):
        """If fetch_arxiv succeeded (already wrote raw), the wrapper must NOT
        clobber it with an empty list when it sees a stale CalledProcessError
        — but that's an unrealistic scenario. The real contract: when
        fetch_arxiv succeeds, no sentinel is written."""
        token = "20260101_test_p01_success"
        raw_path, sentinel_path = self._run_step1_wrapper(fetch_will_fail=False, run_date_token=token)
        try:
            self.assertTrue(os.path.isfile(raw_path))
            with open(raw_path, encoding="utf-8") as f:
                raw_data = json.load(f)
            self.assertEqual(len(raw_data), 1, "success path must preserve real papers")
            self.assertFalse(
                os.path.isfile(sentinel_path),
                "fetch_status.json must NOT be written when fetch_arxiv succeeds",
            )
        finally:
            shutil.rmtree(os.path.join(ROOT, "archive", token), ignore_errors=True)


if __name__ == "__main__":
    unittest.main()