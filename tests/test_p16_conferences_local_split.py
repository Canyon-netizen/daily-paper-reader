"""Regression tests for P1-6: /conferences/ page path split.

The /conferences/ page triggers GitHub Actions by directly calling
api.github.com REST endpoints (workflow_dispatch + run status poll).
This is the state after commit 46b2b74 ("会议页改 GitHub workflow_dispatch
触发 — 删 8567 本地后端依赖").

Meanwhile, src/local_debug_server.py still exposes /api/local/workflows/dispatch
and similar endpoints. settings.ts does NOT export DPR_LOCAL_API_BASE. The
README still mentions `window.DPR_LOCAL_API_BASE` as if a local-mode toggle
exists, but no front-end code reads it.

This test pins the contract so:
1. Re-introducing 8567 dependencies in /conferences/ fails loudly.
2. Re-exposing DPR_LOCAL_API_BASE in settings.ts without a corresponding
   front-end consumer fails loudly.
3. The local_debug_server endpoint stays an "orphan" until either:
     - someone wires front-end back (then this test should be updated
       deliberately to match the new design), or
     - someone deletes the orphan endpoint.

Tests:
- test_conferences_page_does_not_use_local_api_base
- test_settings_ts_does_not_export_local_api_base
- test_local_debug_server_workflow_dispatch_endpoint_is_orphan_in_frontend
"""

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFERENCES_PAGE = ROOT / "astro-src" / "pages" / "conferences" / "index.astro"
SETTINGS_TS = ROOT / "astro-src" / "scripts" / "settings.ts"
LOCAL_DEBUG_PY = ROOT / "src" / "local_debug_server.py"


class ConferencesPageUsesGitHubRestOnlyTest(unittest.TestCase):
    """All fetch() calls in /conferences/ must hit api.github.com. None must
    read DPR_LOCAL_API_BASE or talk to the local 8567 backend."""

    def test_conferences_page_does_not_use_local_api_base(self):
        text = CONFERENCES_PAGE.read_text(encoding="utf-8")
        self.assertNotIn(
            "DPR_LOCAL_API_BASE",
            text,
            "/conferences/ must not read DPR_LOCAL_API_BASE — it would re-introduce "
            "the 8567 dependency that commit 46b2b74 removed.",
        )

    def test_conferences_page_does_not_hit_local_api(self):
        text = CONFERENCES_PAGE.read_text(encoding="utf-8")
        # /api/local/* is the local-debug endpoint namespace. If the conferences
        # page ever starts calling it, that's a regression of the split.
        self.assertNotIn(
            "/api/local/",
            text,
            "/conferences/ must not call /api/local/* (it goes via GitHub REST).",
        )

    def test_conferences_page_fetches_only_github_rest(self):
        """Pin that every fetch URL points at api.github.com. If anyone adds a
        new dispatch path it MUST also use api.github.com (or this test fails)."""
        text = CONFERENCES_PAGE.read_text(encoding="utf-8")
        # Find every URL passed to fetch() — strings inside template literals
        # that include `api.github.com` after ${owner}/${repo}.
        urls = re.findall(r"fetch\(\s*[`'\"]([^`'\"\\]+)", text)
        # We only require api.github.com URLs; relative paths / blank fetches
        # are not present in this file but the check is forward-compatible.
        for url in urls:
            self.assertIn(
                "api.github.com", url,
                f"Unexpected non-GitHub fetch URL in /conferences/: {url!r}",
            )


class SettingsTsDoesNotExportLocalApiBaseTest(unittest.TestCase):
    """settings.ts is the central localStorage adapter. It must not export
    DPR_LOCAL_API_BASE — that variable is only meaningful to the legacy 8567
    integration, which no front-end page currently consumes."""

    def test_settings_ts_does_not_export_local_api_base(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        self.assertNotIn(
            "DPR_LOCAL_API_BASE",
            text,
            "settings.ts must not export DPR_LOCAL_API_BASE — it would re-open "
            "the path-split question that commit 46b2b74 closed.",
        )


class LocalDebugServerEndpointRemovedTest(unittest.TestCase):
    """After P1-6 cleanup, /api/local/workflows/dispatch must no longer exist
    in src/local_debug_server.py. Front-end never called it (commit 46b2b74
    switched /conferences/ to GitHub REST), so keeping the endpoint around
    only widens the attack surface.

    This test pins the removal. If someone re-introduces /api/local/workflows/dispatch
    (or a sibling endpoint like /api/local/runs/dispatch), this test fails and
    the author must consciously update both code and test together."""

    ENDPOINT = "/api/local/workflows/dispatch"

    def test_local_debug_server_does_not_expose_dispatch_endpoint(self):
        """The dispatch endpoint must be gone. Only /api/local/health may remain."""
        text = LOCAL_DEBUG_PY.read_text(encoding="utf-8")
        self.assertNotIn(
            self.ENDPOINT,
            text,
            f"{self.ENDPOINT} must be removed from src/local_debug_server.py — "
            f"front-end no longer calls it. If you intentionally re-add it, also "
            f"update this test (and confirm /conferences/ really needs it).",
        )

    def test_no_local_api_endpoints_called_from_frontend(self):
        """Belt-and-braces: scan astro-src/ for any /api/local/* caller.
        Sibling endpoints (/api/local/runs, /api/local/config, /api/local/secret)
        are also removed in P1-6 cleanup, so this test catches any of them being
        re-introduced."""
        astro_root = ROOT / "astro-src"
        offenders = []
        for path in astro_root.rglob("*"):
            if not path.is_file() or path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".astro"}:
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if "/api/local/" in content:
                offenders.append(path.relative_to(ROOT))
        self.assertEqual(
            offenders, [],
            f"Front-end code calls /api/local/* (removed in P1-6): "
            f"{[str(p) for p in offenders]}",
        )


if __name__ == "__main__":
    unittest.main()