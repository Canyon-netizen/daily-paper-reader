"""Regression tests for P1-5: settings.ts as the single source of truth for
localStorage-backed state (user tags, hidden papers).

Before P1-5, user tags storage was split between:
  - astro-src/scripts/settings.ts: STORAGE_KEYS (no userTags entry)
  - astro-src/lib/user-tags.ts: its own STORAGE_KEY const, its own
    localStorage reads/writes, its own Gist sync helpers

This split risked:
  - localStorage key drift (settings.ts rename wouldn't update user-tags.ts)
  - Multiple write paths bypassing the central STORAGE_KEYS registry
  - Settings page not seeing updates when /papers/ drawer tags a paper
    (no emit event in the original lib/user-tags.ts)

After P1-5:
  - settings.ts owns all localStorage keys, types, write helpers, Gist
    sync helpers, and emit events.
  - lib/user-tags.ts is a thin re-export wrapper so existing callers
    (PaperLibrary.astro, settings-page.ts) don't need import changes.
  - lib/storage.ts re-exports the new userTags functions from settings.ts.
  - All writes (addTag / removeTag / setUserTags / clearAllUserTags /
    addHiddenPaper / removeHiddenPaper / clearHiddenPapers) emit
    'user-tags-change' or 'hidden-papers-change' CustomEvents.

This test pins:
1. STORAGE_KEYS contains both userTags and hiddenPapers (single registry).
2. lib/user-tags.ts re-exports from settings.ts (no body duplication).
3. lib/storage.ts re-exports the new userTags functions.
4. Every write path emits the matching CustomEvent on document.
5. Existing callers (PaperLibrary.astro, settings-page.ts) still import
   from the original paths.
"""

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SETTINGS_TS = ROOT / "astro-src" / "scripts" / "settings.ts"
LIB_STORAGE_TS = ROOT / "astro-src" / "lib" / "storage.ts"
LIB_USER_TAGS_TS = ROOT / "astro-src" / "lib" / "user-tags.ts"
PAPER_LIBRARY_ASTRO = ROOT / "astro-src" / "components" / "PaperLibrary.astro"
SETTINGS_PAGE_TS = ROOT / "astro-src" / "scripts" / "settings-page.ts"


class StorageKeysCentralRegistryTest(unittest.TestCase):
    """STORAGE_KEYS in settings.ts must include BOTH hiddenPapers AND userTags,
    so a single rename changes all references."""

    def test_storage_keys_includes_hidden_papers(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        self.assertRegex(text, r"hiddenPapers:\s*'dpr_hidden_papers_v1'")

    def test_storage_keys_includes_user_tags(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        self.assertRegex(text, r"userTags:\s*'dpr_user_tags_v1'")


class LibUserTagsIsReExportTest(unittest.TestCase):
    """lib/user-tags.ts must NOT duplicate settings.ts bodies. It must
    re-export the canonical functions so all writes go through settings.ts
    (which emits events + owns Gist sync)."""

    def test_user_tags_ts_does_not_contain_localstorage_setitem(self):
        """Banned pattern: any direct localStorage.setItem in lib/user-tags.ts
        means the file still owns storage, defeating the centralization."""
        text = LIB_USER_TAGS_TS.read_text(encoding="utf-8")
        self.assertNotIn(
            "localStorage.setItem",
            text,
            "lib/user-tags.ts must not write localStorage directly — re-export from settings.ts",
        )

    def test_user_tags_ts_re_exports_from_storage(self):
        """Must re-export userTags functions from './storage' (which forwards
        to settings.ts)."""
        text = LIB_USER_TAGS_TS.read_text(encoding="utf-8")
        self.assertRegex(
            text,
            r"export\s*\{[^}]*loadUserTags[^}]*\}\s*from\s*'\./storage'",
            "lib/user-tags.ts must re-export userTags functions from './storage'",
        )
        self.assertRegex(
            text,
            r"export\s*\{[^}]*addTag[^}]*\}\s*from\s*'\./storage'",
        )

    def test_user_tags_ts_keeps_flatten_and_merge_helpers(self):
        """flattenUserTags / mergeWithPaperTags are pure helpers — no localStorage
        access — so they can stay in lib/. Verify they still exist so PaperLibrary
        imports don't break."""
        text = LIB_USER_TAGS_TS.read_text(encoding="utf-8")
        self.assertIn("export function flattenUserTags", text)
        self.assertIn("export function mergeWithPaperTags", text)


class LibStorageReExportsUserTagsTest(unittest.TestCase):
    """lib/storage.ts must forward the userTags functions from settings.ts."""

    def test_storage_re_exports_load_user_tags(self):
        text = LIB_STORAGE_TS.read_text(encoding="utf-8")
        self.assertRegex(text, r"loadUserTags")
        # Must come from settings, not from user-tags (which would re-create the cycle)
        # Allow multi-line import blocks (the function may sit in a list with
        # other names before the closing `}` + `from`).
        self.assertRegex(
            text,
            r"loadUserTags[\s\S]*?from\s*'\.\./scripts/settings'",
            "lib/storage.ts must re-export userTags functions from scripts/settings",
        )

    def test_storage_re_exports_gist_user_tags_helpers(self):
        text = LIB_STORAGE_TS.read_text(encoding="utf-8")
        self.assertRegex(text, r"pullUserTagsFromGist")
        self.assertRegex(text, r"pushUserTagsToGist")


class WriteOpsEmitEventsTest(unittest.TestCase):
    """All write operations on userTags / hiddenPapers must dispatch a
    CustomEvent on document, so settings-page.ts panels can refresh."""

    def test_user_tags_add_emits_event(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        # addTag body must end with emitUserTagsChange()
        idx = text.find("export function addTag(")
        self.assertGreater(idx, -1, "addTag not found in settings.ts")
        # Walk forward to next 'export function' to bound the function body.
        end = text.find("\nexport function", idx + 1)
        body = text[idx:end if end > 0 else len(text)]
        self.assertIn(
            "emitUserTagsChange()",
            body,
            "addTag must emit 'user-tags-change' on every successful write",
        )

    def test_user_tags_remove_emits_event(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        idx = text.find("export function removeTag(")
        self.assertGreater(idx, -1)
        end = text.find("\nexport function", idx + 1)
        body = text[idx:end if end > 0 else len(text)]
        self.assertIn("emitUserTagsChange()", body)

    def test_user_tags_set_emits_event(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        idx = text.find("export function setUserTags(")
        self.assertGreater(idx, -1)
        end = text.find("\nexport function", idx + 1)
        body = text[idx:end if end > 0 else len(text)]
        # setUserTags has multiple emit sites; ensure at least one.
        self.assertIn("emitUserTagsChange()", body)

    def test_user_tags_clear_emits_event(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        idx = text.find("export function clearAllUserTags(")
        self.assertGreater(idx, -1)
        end = text.find("\n", idx)
        # clearAllUserTags is short — find next export after it
        end = text.find("\nexport ", idx + 1)
        body = text[idx:end if end > 0 else len(text)]
        self.assertIn("emitUserTagsChange()", body)

    def test_hidden_papers_add_emits_event(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        idx = text.find("export function addHiddenPaper(")
        self.assertGreater(idx, -1)
        end = text.find("\nexport function", idx + 1)
        body = text[idx:end if end > 0 else len(text)]
        self.assertIn(
            "emitHiddenPapersChange()",
            body,
            "addHiddenPaper must emit 'hidden-papers-change'",
        )

    def test_hidden_papers_remove_emits_event(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        idx = text.find("export function removeHiddenPaper(")
        self.assertGreater(idx, -1)
        end = text.find("\nexport function", idx + 1)
        body = text[idx:end if end > 0 else len(text)]
        self.assertIn("emitHiddenPapersChange()", body)

    def test_hidden_papers_clear_helper_exists(self):
        """clearHiddenPapers wraps saveHiddenPapersRaw + emit. The previous
        settings-page direct saveHiddenPapersRaw([]) call bypassed the emit."""
        text = SETTINGS_TS.read_text(encoding="utf-8")
        self.assertRegex(
            text,
            r"export function clearHiddenPapers\(",
            "settings.ts must export clearHiddenPapers for the 'clear local' button",
        )
        # It must emit too.
        idx = text.find("export function clearHiddenPapers(")
        end = text.find("\nexport ", idx + 1)
        body = text[idx:end if end > 0 else len(text)]
        self.assertIn("emitHiddenPapersChange()", body)


class SettingsPageListensToEventsTest(unittest.TestCase):
    """settings-page.ts must listen to 'user-tags-change' and 'hidden-papers-change'
    so its panels refresh when /papers/ drawer tags or hides papers."""

    def test_settings_page_listens_user_tags_change(self):
        text = SETTINGS_PAGE_TS.read_text(encoding="utf-8")
        self.assertRegex(
            text,
            r"addEventListener\(\s*['\"]user-tags-change['\"]",
            "settings-page.ts must listen to 'user-tags-change' to refresh the user tags panel",
        )

    def test_settings_page_listens_hidden_papers_change(self):
        text = SETTINGS_PAGE_TS.read_text(encoding="utf-8")
        self.assertRegex(
            text,
            r"addEventListener\(\s*['\"]hidden-papers-change['\"]",
            "settings-page.ts must listen to 'hidden-papers-change' to refresh the hidden papers panel",
        )

    def test_settings_page_uses_clear_hidden_papers(self):
        """The 'clear local' button must use clearHiddenPapers (which emits),
        not saveHiddenPapersRaw([]) directly (which doesn't)."""
        text = SETTINGS_PAGE_TS.read_text(encoding="utf-8")
        # Find the hidden-clear-btn click handler
        idx = text.find("hidden-clear-btn")
        self.assertGreater(idx, -1, "hidden-clear-btn handler not found")
        # Look at the next ~30 lines
        snippet = text[idx:idx + 1000]
        self.assertIn("clearHiddenPapers()", snippet)
        # Strip // line comments before checking for forbidden direct write,
        # so the explanatory comment ("走 clearHiddenPapers() 而不是直接
        # saveHiddenPapersRaw([])") doesn't trip the assertion.
        stripped = "\n".join(
            line for line in snippet.splitlines() if not line.lstrip().startswith("//")
        )
        self.assertNotIn(
            "saveHiddenPapersRaw([])",
            stripped,
            "hidden-clear handler must use clearHiddenPapers(), not saveHiddenPapersRaw([])",
        )


class PaperLibraryStillImportsFromLibTest(unittest.TestCase):
    """PaperLibrary.astro must still import from '../lib/user-tags' (not switch
    to '../scripts/settings') — keeps import surface stable for /papers/."""

    def test_paper_library_imports_user_tags_from_lib(self):
        text = PAPER_LIBRARY_ASTRO.read_text(encoding="utf-8")
        self.assertRegex(
            text,
            r"from\s*'\.\./lib/user-tags'",
            "PaperLibrary.astro must keep importing from '../lib/user-tags'",
        )


class EventNameStabilityTest(unittest.TestCase):
    """Event names are part of the public API. Changing them breaks any
    future consumer listening across pages. Lock them in."""

    def test_user_tags_event_name(self):
        text = SETTINGS_TS.read_text(encoding="utf-8")
        m = re.search(r"new CustomEvent\(['\"]([^'\"]+)['\"]\)", text)
        # Just verify both events are dispatched (we know by write tests above);
        # here we lock the exact names.
        self.assertIn("'user-tags-change'", text)
        self.assertIn("'hidden-papers-change'", text)


if __name__ == "__main__":
    unittest.main()