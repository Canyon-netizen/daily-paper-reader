"""Tests for the merged bioRxiv / medRxiv fetcher.

Before PR-2 these lived in two separate files
(`tests/test_fetch_paper_biorxiv.py` and `tests/test_fetch_paper_medrxiv.py`),
each importing its own near-identical fetcher module. PR-2 collapses the two
fetchers into `src/maintain/fetchers/fetch_biorxiv_family.py`, so this file
parametrizes over the SOURCE_CONFIG table to cover both sources with one set
of assertions.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest


def _load_module(module_name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(module_name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class FetchBiorxivFamilyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = pathlib.Path(__file__).resolve().parents[1]
        src_dir = root / "src"
        if str(src_dir) not in sys.path:
            sys.path.insert(0, str(src_dir))
        cls.mod = _load_module(
            "fetch_biorxiv_family_mod",
            src_dir / "maintain" / "fetchers" / "fetch_biorxiv_family.py",
        )

    def _cfg(self, source_name: str):
        cfg = self.mod.SOURCE_CONFIG[source_name]
        # Mirror the constants the fetcher used to expose at module scope
        # (e.g. fetch_biorxiv.py::API_BASE) so callers can refactor against
        # this test without breaking the public contract.
        return cfg

    def test_biorxiv_paper_id_is_path_safe(self) -> None:
        cfg = self._cfg("biorxiv")
        paper_id = self.mod.build_paper_id(cfg["source_id"], "10.1101/2024.01.11.575298", "3")
        self.assertEqual(paper_id, "biorxiv-10-1101-2024-01-11-575298-v3")

    def test_medrxiv_paper_id_is_path_safe(self) -> None:
        cfg = self._cfg("medrxiv")
        paper_id = self.mod.build_paper_id(cfg["source_id"], "10.1101/2024.01.11.575298", "3")
        self.assertEqual(paper_id, "medrxiv-10-1101-2024-01-11-575298-v3")

    def test_biorxiv_normalize_record(self) -> None:
        cfg = self._cfg("biorxiv")
        raw = {
            "doi": "10.1101/859942",
            "version": "4",
            "title": "Prioritized neural processing",
            "authors": "El Zein, M.; Mennella, R.; Sequestro, M.;",
            "abstract": "Test abstract",
            "date": "2024-01-02",
            "category": "neuroscience",
        }
        normalized = self.mod.normalize_record(cfg, raw)
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["source"], "biorxiv")
        self.assertEqual(normalized["source_paper_id"], "10.1101/859942")
        self.assertEqual(normalized["primary_category"], "neuroscience")
        self.assertEqual(normalized["categories"], ["neuroscience"])
        self.assertTrue(normalized["link"].endswith(".full.pdf"))
        self.assertEqual(len(normalized["authors"]), 3)

    def test_medrxiv_normalize_record(self) -> None:
        cfg = self._cfg("medrxiv")
        raw = {
            "doi": "10.1101/859942",
            "version": "4",
            "title": "Prioritized neural processing",
            "authors": "El Zein, M.; Mennella, R.; Sequestro, M.;",
            "abstract": "Test abstract",
            "date": "2024-01-02",
            "category": "neuroscience",
        }
        normalized = self.mod.normalize_record(cfg, raw)
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["source"], "medrxiv")
        self.assertEqual(normalized["source_paper_id"], "10.1101/859942")
        self.assertIn("medrxiv.org", normalized["link"])
        self.assertTrue(normalized["link"].endswith(".full.pdf"))

    def test_source_config_has_expected_keys(self) -> None:
        for source_name in ("biorxiv", "medrxiv"):
            cfg = self.mod.SOURCE_CONFIG[source_name]
            for key in ("label", "source_id", "crawl_state_file", "seen_ids_file", "api_base", "abs_url_template"):
                self.assertIn(key, cfg, f"{source_name} missing {key!r}")


if __name__ == "__main__":
    unittest.main()