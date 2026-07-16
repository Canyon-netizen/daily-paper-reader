"""Regression tests for P0-3: /conferences/ pollRun behavior under GitHub API errors.

These tests pin the EXPECTED behavior. After the fix:
  - dispatchWorkflow and pollRun are extracted to astro-src/scripts/conferences.ts
    so the logic is unit-testable.
  - dispatchWorkflow differentiates 403 messages (rate limit vs scope).
  - pollRun surfaces 401/403 within seconds instead of spinning for the
    full 10-min timeout.

If a future PR regresses any of these (e.g. removes the 401 branch from
pollRun, or inlines pollRun back into the .astro <script>), the matching
test goes red and the regression is caught before merge.
"""

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFERENCES_PAGE = ROOT / "astro-src" / "pages" / "conferences" / "index.astro"
CONFERENCES_MODULE = ROOT / "astro-src" / "scripts" / "conferences.ts"


def _extract_function_body(source: str, fn_name: str) -> str:
    """Return the source text inside `function <fn_name>(...) { ... }`. Uses
    paren-balanced scanning so multi-line signatures with nested types
    (e.g. `options: { fetchImpl?: ... } = {}`) work.
    """
    needle = f"function {fn_name}"
    idx = source.find(needle)
    if idx == -1:
        return ""
    # Find the opening `(` of the parameter list.
    paren_open = source.find("(", idx + len(needle))
    if paren_open == -1:
        return ""
    # Walk forward tracking ( and [ depth. Body-internal (...) nesting still
    # raises paren_depth — that's fine: we only consider paren_depth==0
    # AFTER walking past the parameter list's closing ).
    i = paren_open + 1
    paren_depth = 1  # we are inside the parameter list now
    bracket_depth = 0
    while i < len(source):
        ch = source[i]
        if ch == "(":
            paren_depth += 1
        elif ch == ")":
            paren_depth -= 1
            if paren_depth == 0 and bracket_depth == 0:
                # end of param list — skip ws, optional `: ReturnType`
                i += 1
                while i < len(source) and source[i].isspace():
                    i += 1
                if i < len(source) and source[i] == ":":
                    i += 1
                    while i < len(source) and source[i] != "{":
                        i += 1
                break
        elif ch == "[":
            bracket_depth += 1
        elif ch == "]":
            bracket_depth -= 1
        i += 1
    if i >= len(source) or source[i] != "{":
        return ""
    start = i
    depth = 0
    for j in range(start, len(source)):
        ch = source[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return source[start : j + 1]
    return source[start:]


class PollRunErrorHandlingTest(unittest.TestCase):
    """pollRun must surface 401/403 immediately, not after 10 minutes."""

    def setUp(self):
        self.module_source = CONFERENCES_MODULE.read_text(encoding="utf-8")
        self.poll_body = _extract_function_body(self.module_source, "pollRun")

    def test_poll_body_extracted(self):
        self.assertIn("pollRun", self.module_source)
        self.assertIn(
            "await fetchImpl",
            self.poll_body,
            "could not locate pollRun's fetchImpl call",
        )

    def test_poll_run_branches_on_403(self):
        self.assertIn(
            "403",
            self.poll_body,
            "pollRun must branch on 403 (rate-limit / scope) to avoid 10-min stall",
        )

    def test_poll_run_branches_on_401(self):
        self.assertIn(
            "401",
            self.poll_body,
            "pollRun must branch on 401 (token expired) to avoid 10-min stall",
        )

    def test_poll_run_exits_early_on_error(self):
        # After the fix, pollRun's non-2xx branch must contain a `return`
        # statement so the loop exits and the UI updates within seconds.
        idx = self.poll_body.find("res.ok")
        self.assertGreater(
            idx, -1, "pollRun does not check res.ok at all — must guard non-2xx responses",
        )
        self.assertIn(
            "} else",
            self.poll_body,
            "pollRun must have an explicit `} else {` branch to handle non-ok responses",
        )
        # Sanity: at least one `return` exists inside the body (not just in helpers).
        self.assertIn(
            "return",
            self.poll_body,
            "pollRun must early-return on error so the UI updates within seconds",
        )


class Dispatch403DistinguishesRateLimitTest(unittest.TestCase):
    """dispatch's 403 message must hint at rate limit vs scope so users
    can distinguish "wait an hour" from "fix your PAT"."""

    def setUp(self):
        self.module_source = CONFERENCES_MODULE.read_text(encoding="utf-8")

    def test_dispatch_403_message_mentions_rate_limit(self):
        # Find the 403 branch inside dispatchWorkflow: span from the line
        # with `res.status === 403` until the next `}` that closes it.
        m = re.search(
            r"if\s*\(\s*res\.status\s*===\s*403\s*\)\s*\{",
            self.module_source,
        )
        self.assertIsNotNone(
            m, "could not locate dispatch 403 branch in conferences.ts",
        )
        # Walk braces from m.end()-1 forward to find the matching close.
        start = m.end() - 1
        depth = 0
        end = start
        for j in range(start, len(self.module_source)):
            ch = self.module_source[j]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = j + 1
                    break
        branch = self.module_source[start:end]
        self.assertTrue(
            "rate limit" in branch.lower() or "retry-after" in branch.lower(),
            f"dispatch 403 message lacks rate-limit hint: {branch!r}",
        )


class ConferencesLogicExtractedToModuleTest(unittest.TestCase):
    """Pin that dispatchWorkflow + pollRun live in a TS module that the
    .astro page imports, not inline in the .astro <script> block."""

    def test_module_file_exists(self):
        self.assertTrue(
            CONFERENCES_MODULE.exists(),
            "astro-src/scripts/conferences.ts must exist so dispatchWorkflow + "
            "pollRun are unit-testable from the astro-src/scripts layer.",
        )

    def test_module_exports_dispatch_and_poll(self):
        src = CONFERENCES_MODULE.read_text(encoding="utf-8")
        self.assertRegex(src, r"export\s+(?:async\s+)?function\s+dispatchWorkflow")
        self.assertRegex(src, r"export\s+(?:async\s+)?function\s+pollRun")

    def test_astro_page_imports_from_module(self):
        page = CONFERENCES_PAGE.read_text(encoding="utf-8")
        self.assertIn(
            "from '../../scripts/conferences'",
            page,
            "conferences/index.astro must import dispatchWorkflow + pollRun "
            "from ../../scripts/conferences so the implementation is shared.",
        )

    def test_astro_page_does_not_redefine_poll_run(self):
        page = CONFERENCES_PAGE.read_text(encoding="utf-8")
        # The page should NOT contain its own pollRun body — it must use
        # the imported one. If someone inlines pollRun back into the .astro
        # file, this test fails (catching regression of the extraction).
        self.assertNotIn(
            "async function pollRun",
            page,
            "conferences/index.astro must not redefine pollRun — use the imported one.",
        )


if __name__ == "__main__":
    unittest.main()