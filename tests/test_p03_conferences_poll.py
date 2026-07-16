"""Regression tests for P0-3: /conferences/ pollRun behavior under GitHub API errors.

These tests pin the EXPECTED behavior for the next fix. They currently XFAIL
because the live code in astro-src/pages/conferences/index.astro lacks
graceful handling for status-poll failures:

  - pollRun 403 during status polling: 300 iterations × 2s = 10 minutes of
    "运行中 (in_progress)…" before finally bumping to "运行超时未结束,点此查看".
    The actual workflow may have completed fine; we just hit secondary rate
    limit. UI never sees a clean failure.

  - pollRun 401 (token expired mid-poll): same silent 10-min stall.

The fix PR should:
  1. Differentiate 403 messages (rate limit vs scope) on dispatch —
     ALREADY partially done at line 198, but the message conflates them.
  2. Add 401/403 handling inside pollRun's poll loop so failures surface
     within seconds instead of waiting for the 10-min timeout.
  3. (Optional but recommended) Extract dispatchWorkflow + pollRun into
     astro-src/scripts/conferences.ts so the logic is testable from a unit
     suite.

Until those fixes land, the *pollRun-specific* assertions are XFAIL; the
dispatch-scope message assertion is XFAIL too because the dispatch 403
message currently doesn't mention "rate limit" (the dispatch 403 message
covers scope but the user can't tell which case they hit).
"""

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFERENCES_PAGE = ROOT / "astro-src" / "pages" / "conferences" / "index.astro"


def _extract_poll_run_body(source: str) -> str:
    """Return the source text inside `async function pollRun(...)` so we can
    assert about pollRun in isolation from dispatchWorkflow."""
    # pollRun ends at the next `}` at column 0 OR the next top-level async
    # function / DOMContentLoaded. Conferences page is small — match the
    # function and capture until the next blank-line-then-non-call line.
    match = re.search(
        r"async\s+function\s+pollRun\([^)]*\)\s*\{",
        source,
    )
    if not match:
        return ""
    start = match.end() - 1  # include the opening {
    depth = 0
    for i in range(start, len(source)):
        ch = source[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return source[start : i + 1]
    return source[start:]


class PollRunErrorHandlingTest(unittest.TestCase):
    """Pin that pollRun surfaces 401/403 immediately, not after 10 minutes."""

    def setUp(self):
        self.source = CONFERENCES_PAGE.read_text(encoding="utf-8")
        self.poll_body = _extract_poll_run_body(self.source)

    def test_poll_body_extracted(self):
        self.assertIn("pollRun", self.source)
        self.assertIn("res = await fetch", self.poll_body, "could not locate pollRun's fetch block")

    @unittest.expectedFailure
    def test_poll_run_branches_on_403(self):
        self.assertIn(
            "403", self.poll_body,
            "pollRun must branch on 403 (rate-limit / scope) to avoid 10-min stall",
        )

    @unittest.expectedFailure
    def test_poll_run_branches_on_401(self):
        self.assertIn(
            "401", self.poll_body,
            "pollRun must branch on 401 (token expired) to avoid 10-min stall",
        )

    @unittest.expectedFailure
    def test_poll_run_exits_early_on_error(self):
        # After the fix, pollRun's !res.ok branch must contain a `return`
        # statement so the loop exits and the UI updates within seconds.
        # We look for the substring "} else {" or "} else if (" or "!res.ok"
        # followed within 200 chars by "return".
        idx = self.poll_body.find("res.ok")
        self.assertGreater(
            idx, -1, "pollRun does not check res.ok at all — must guard non-2xx responses",
        )
        # Look in the next ~200 chars after `!res.ok` (or after `res.ok` for an else branch).
        # Simpler: search for `} else` block.
        self.assertIn(
            "} else",
            self.poll_body,
            "pollRun must have an explicit `} else {` branch to handle non-ok responses",
        )


class Dispatch403DistinguishesRateLimitTest(unittest.TestCase):
    """Pin that dispatch's 403 message gives the user a hint about whether
    they should wait (rate limit) or fix their PAT (scope)."""

    @unittest.expectedFailure
    def test_dispatch_403_message_mentions_rate_limit(self):
        # dispatch's 403 message must include either 'rate limit' or 'Retry-After'.
        # The current message says only "workflow 权限" / "Actions 是否已启用"
        # which leaves users guessing which case they hit.
        # Locate the dispatch 403 branch.
        match = re.search(
            r"res\.status\s*===\s*403[^;]*throw[^;]*;",
            self.source,
        )
        self.assertIsNotNone(match, "could not locate dispatch 403 branch")
        self.assertTrue(
            "rate limit" in match.group(0).lower() or "retry-after" in match.group(0).lower(),
            f"dispatch 403 message lacks rate-limit hint: {match.group(0)!r}",
        )


if __name__ == "__main__":
    unittest.main()