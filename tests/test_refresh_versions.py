import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
MAINTAIN_DIR = ROOT / "src" / "maintain"
if str(MAINTAIN_DIR) not in sys.path:
    sys.path.insert(0, str(MAINTAIN_DIR))

import refresh_versions as rv  # type: ignore


DEEP_MD = """---
title: Some Deep Paper
---
## 摘要
xx
## 论文详细总结（自动生成）
yy
"""

QUICK_MD = """---
title: Some Quick Paper
---
## TLDR
xx
## 动机
yy
"""


def _make_docs(tmp: str):
    papers = pathlib.Path(tmp) / "docs" / "papers"
    papers.mkdir(parents=True)
    return papers


class ScanAndParseTest(unittest.TestCase):
    def test_scan_parses_arxiv_id_version_and_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            papers = _make_docs(tmp)
            (papers / "2606.29340v1-phf-hidden-flow.md").write_text(DEEP_MD, encoding="utf-8")
            (papers / "2510.18483v2-starbench-rpg.md").write_text(QUICK_MD, encoding="utf-8")
            # 非 arXiv 源应被跳过
            (papers / "biorxiv-10-1101-2025-v3-foraging.md").write_text(QUICK_MD, encoding="utf-8")
            (papers / "README.md").write_text("# index", encoding="utf-8")

            found = rv.scan_local_papers(str(papers))
            by_id = {p.versioned_id: p for p in found}

            self.assertEqual(set(by_id), {"2606.29340v1", "2510.18483v2"})
            self.assertEqual(by_id["2606.29340v1"].canonical, "2606.29340")
            self.assertEqual(by_id["2606.29340v1"].version, 1)
            self.assertEqual(by_id["2606.29340v1"].section, "deep")
            self.assertEqual(by_id["2510.18483v2"].version, 2)
            self.assertEqual(by_id["2510.18483v2"].section, "quick")

    def test_dedupe_keeps_highest_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            papers = _make_docs(tmp)
            (papers / "2606.29340v1-phf.md").write_text(QUICK_MD, encoding="utf-8")
            (papers / "2606.29340v2-phf.md").write_text(QUICK_MD, encoding="utf-8")

            best = rv.dedupe_local_by_canonical(rv.scan_local_papers(str(papers)))
            self.assertEqual(set(best), {"2606.29340"})
            self.assertEqual(best["2606.29340"].version, 2)


class VersionQueryTest(unittest.TestCase):
    def _resp(self, latest_id: str):
        xml = (
            '<feed xmlns="http://www.w3.org/2005/Atom">'
            f"<entry><id>http://arxiv.org/abs/{latest_id}</id></entry>"
            "</feed>"
        )
        r = mock.Mock()
        r.status_code = 200
        r.text = xml
        return r

    def test_fetch_latest_version_parses_atom_id(self):
        with mock.patch.object(rv.requests, "get", return_value=self._resp("2606.29340v3")):
            self.assertEqual(rv.fetch_latest_version("2606.29340"), 3)

    def test_fetch_latest_version_handles_bad_status(self):
        r = mock.Mock()
        r.status_code = 503
        r.text = ""
        with mock.patch.object(rv.requests, "get", return_value=r):
            self.assertIsNone(rv.fetch_latest_version("2606.29340"))


class PruneTest(unittest.TestCase):
    def test_prune_removes_md_txt_and_figure_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            docs = pathlib.Path(tmp) / "docs"
            papers = docs / "papers"
            papers.mkdir(parents=True)
            (papers / "2606.29340v1-phf.md").write_text(DEEP_MD, encoding="utf-8")
            (papers / "2606.29340v1-phf.txt").write_text("body", encoding="utf-8")
            figdir = docs / "assets" / "figures" / "arxiv" / "2606.29340v1"
            figdir.mkdir(parents=True)
            (figdir / "fig-001.webp").write_text("x", encoding="utf-8")

            old = rv.scan_local_papers(str(papers))[0]

            # dry-run 不删除
            rv.prune_old_version(str(docs), old, dry_run=True)
            self.assertTrue((papers / "2606.29340v1-phf.md").exists())
            self.assertTrue(figdir.exists())

            # 实删
            rv.prune_old_version(str(docs), old, dry_run=False)
            self.assertFalse((papers / "2606.29340v1-phf.md").exists())
            self.assertFalse((papers / "2606.29340v1-phf.txt").exists())
            self.assertFalse(figdir.exists())


class RegenerateDryRunTest(unittest.TestCase):
    def test_dry_run_does_not_spawn_subprocess(self):
        with mock.patch.object(rv.subprocess, "run") as run:
            self.assertTrue(rv.regenerate_paper("2606.29340v2", "deep", dry_run=True))
            run.assert_not_called()

    def test_quick_section_appends_glance_only(self):
        captured = {}

        def _fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            m = mock.Mock()
            m.returncode = 0
            return m

        with mock.patch.object(rv.subprocess, "run", side_effect=_fake_run):
            rv.regenerate_paper("2510.18483v2", "quick", dry_run=False)
        self.assertIn("--glance-only", captured["cmd"])
        self.assertIn("--paper-id", captured["cmd"])
        self.assertIn("2510.18483v2", captured["cmd"])


if __name__ == "__main__":
    unittest.main()
