import importlib.util
import pathlib
import sys
import unittest
import unittest.mock


def _load_module(module_name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(module_name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class FetchPaperAAAIOJSTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = pathlib.Path(__file__).resolve().parents[1]
        src_dir = root / "src"
        if str(src_dir) not in sys.path:
            sys.path.insert(0, str(src_dir))
        cls.mod = _load_module(
            "fetch_aaai_ojs_mod",
            src_dir / "maintain" / "fetchers" / "fetch_aaai_ojs.py",
        )

    def test_extract_issue_year(self):
        self.assertEqual(self.mod.extract_issue_year("AAAI-25 Technical Tracks 3"), 2025)
        self.assertIsNone(self.mod.extract_issue_year("IAAI-25 Student Abstracts"))

    def test_is_target_issue_title(self):
        self.assertTrue(self.mod.is_target_issue_title("AAAI-24 Technical Tracks 15", [2023, 2024, 2025]))
        self.assertFalse(self.mod.is_target_issue_title("IAAI-25 Student Abstracts", [2025]))

    def test_normalize_date_to_iso(self):
        self.assertEqual(
            self.mod._normalize_date_to_iso("2025-04-11"),
            "2025-04-11T00:00:00+00:00",
        )
        self.assertEqual(
            self.mod._normalize_date_to_iso("2025/04/11"),
            "2025-04-11T00:00:00+00:00",
        )

    def test_build_source_label(self):
        self.assertEqual(self.mod.build_source_label(2025), "AAAI-2025-Accepted")


class FetchPaperAAAISkipOnFailureTest(unittest.TestCase):
    """Per-issue soft-fail so one bad page doesn't kill the whole init."""

    @classmethod
    def setUpClass(cls):
        root = pathlib.Path(__file__).resolve().parents[1]
        src_dir = root / "src"
        if str(src_dir) not in sys.path:
            sys.path.insert(0, str(src_dir))
        cls.mod = _load_module(
            "fetch_aaai_ojs_mod",
            src_dir / "maintain" / "fetchers" / "fetch_aaai_ojs.py",
        )

    def test_collect_target_issue_urls_survives_archive_failure(self):
        """If the archive page fetch exhausts retries, return empty list
        instead of raising — better to skip today than fail the whole
        conference-init run."""
        import requests

        # Patch the module's _get so it raises the same exception real
        # ojs.aaai.org was returning in the GHA failure.
        def boom(url, **kw):
            raise requests.exceptions.ConnectionError(
                "Connection aborted.",
            )

        with unittest.mock.patch.object(self.mod, "_get", side_effect=boom):
            issues = self.mod.collect_target_issue_urls([2023, 2024, 2025])
        self.assertEqual(issues, [])

    def test_collect_issue_article_summaries_returns_empty_on_failure(self):
        """Single-issue failure shouldn't propagate; the issue is just skipped."""
        import requests

        issue = {
            "title": "AAAI-25 Technical Tracks 7",
            "url": "https://example.test/issue/7",
            "year": 2025,
        }

        def boom(url, **kw):
            raise requests.exceptions.ConnectionError("RST")

        with unittest.mock.patch.object(self.mod, "_get", side_effect=boom):
            out = self.mod.collect_issue_article_summaries(issue)
        self.assertEqual(out, [])

    def test_fetch_article_detail_returns_none_on_failure(self):
        import requests

        summary = {
            "article_id": "9999",
            "article_url": "https://example.test/article/9999",
            "issue_title": "AAAI-25 Technical Tracks 7",
            "year": 2025,
            "title": "Some Paper",
            "authors": [],
            "pdf_url": "",
        }

        def boom(url, **kw):
            raise requests.exceptions.ConnectionError("RST")

        with unittest.mock.patch.object(self.mod, "_get", side_effect=boom):
            out = self.mod.fetch_article_detail(summary)
        self.assertIsNone(out)


if __name__ == "__main__":
    unittest.main()
