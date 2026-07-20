"""tests/test_backfill_txt_from_md.py — 回填 .txt 工具的单元测试。

覆盖三条核心路径:
  1. 同目录有"同 arXiv id、slug 不同"的兄弟 .txt → 改名复用(不抓网络)。
  2. 无兄弟 .txt → 走 fetch_fulltext;返回文本 > 阈值 → 写盘。
  3. fetch 返回过短文本 → 不写盘,返回 False(不产假 .txt)。
另外校验 find_missing / audit 计数逻辑。
"""

import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import backfill_txt_from_md as bt  # type: ignore


MD_TEMPLATE = """---
title: Dummy Paper
date: 2026-07-17
pdf: 'https://arxiv.org/pdf/{aid}'
source: arxiv
---

## Abstract

dummy
"""


class BackfillTxtTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.day = pathlib.Path(self._tmp.name) / "2026" / "07" / "17"
        self.day.mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def _write_md(self, name: str, aid: str) -> pathlib.Path:
        p = self.day / name
        p.write_text(MD_TEMPLATE.format(aid=aid), encoding="utf-8")
        return p

    def test_rename_sibling_txt(self):
        """bare-id .md + slug-form 兄弟 .txt → 改名,不触发抓取。"""
        md = self._write_md("2607.14877v1.md", "2607.14877v1")
        sib = self.day / "2607.14877v1-pac-learning-something.txt"
        sib.write_text("X" * 5000, encoding="utf-8")

        with mock.patch.object(bt, "fetch_fulltext") as fetch:
            ok = bt.ensure_txt_for_md(md, log=lambda *_: None)
        self.assertTrue(ok)
        fetch.assert_not_called()  # 复用兄弟,不抓网络
        self.assertTrue((self.day / "2607.14877v1.txt").exists())
        self.assertFalse(sib.exists())  # 已改名

    def test_fetch_when_no_sibling(self):
        """无兄弟 .txt → 抓取,长文本写盘。"""
        md = self._write_md("2607.15182v1.md", "2607.15182v1")
        with mock.patch.object(bt, "fetch_fulltext", return_value="Y" * 5000):
            ok = bt.ensure_txt_for_md(md, log=lambda *_: None)
        self.assertTrue(ok)
        out = self.day / "2607.15182v1.txt"
        self.assertTrue(out.exists())
        self.assertEqual(len(out.read_text(encoding="utf-8")), 5000)

    def test_short_text_not_written(self):
        """抓取返回过短(<=MIN_TXT_BYTES)→ 不写盘,返回 False。"""
        md = self._write_md("2607.15182v1.md", "2607.15182v1")
        with mock.patch.object(bt, "fetch_fulltext", return_value="short"):
            ok = bt.ensure_txt_for_md(md, log=lambda *_: None)
        self.assertFalse(ok)
        self.assertFalse((self.day / "2607.15182v1.txt").exists())

    def test_idempotent_when_txt_exists(self):
        """已有精确同名 .txt → no-op True,不抓取。"""
        md = self._write_md("2607.15182v1.md", "2607.15182v1")
        (self.day / "2607.15182v1.txt").write_text("Z" * 3000, encoding="utf-8")
        with mock.patch.object(bt, "fetch_fulltext") as fetch:
            ok = bt.ensure_txt_for_md(md, log=lambda *_: None)
        self.assertTrue(ok)
        fetch.assert_not_called()

    def test_find_missing_counts(self):
        """find_missing 只数缺精确同名 .txt 的 .md;README 排除。"""
        self._write_md("2607.15182v1.md", "2607.15182v1")          # 缺
        have = self._write_md("2607.14171v1.md", "2607.14171v1")   # 有
        (self.day / "2607.14171v1.txt").write_text("A" * 2000, encoding="utf-8")
        (self.day / "README.md").write_text("readme", encoding="utf-8")

        with mock.patch.object(bt, "DOCS_PAPERS", pathlib.Path(self._tmp.name)):
            missing = bt.find_missing()
        names = {m.name for m in missing}
        self.assertIn("2607.15182v1.md", names)
        self.assertNotIn("2607.14171v1.md", names)
        self.assertNotIn("README.md", names)


if __name__ == "__main__":
    unittest.main()
