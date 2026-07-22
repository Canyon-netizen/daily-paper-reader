"""PR-7 Citation Guard 单测。

覆盖 plan §13 全部 10 个 case:
  1. library exact match (sim >= 0.99) → exact
  2. S2 fuzzy (sim=0.95) → exact
  3. OpenAlex fallback (sim=0.80) → minor
  4. 三源未命中 (sim=0.71) → fabricated
  5. year_tolerance=1 (年份差 1) → exact
  6. PASS_RATING 判定 supported/checked < 0.6 → pass=false
  7. 1 个 fabricated → pass=false
  8. _normalize_title lowercase + 去标点
  9. S2 429 指数退避
 10. CLI exit code 2 (fabricated > 0)

所有网络调用 mock,不真打外网。
"""
from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from citation_guard import (  # noqa: E402
    EXACT_SIMILARITY,
    MINOR_SIMILARITY,
    PASS_RATING,
    YEAR_TOLERANCE,
    CITE_MARKER_RE,
    CITE_REF_LINE_RE,
    _normalize_title,
    _similarity,
    _year_within_tolerance,
    check_citation_existence,
    extract_citations,
    main,
    review_passed,
    run_guard,
    search_library,
    search_openalex,
    search_semantic_scholar,
)


def _fake_s2_response(data: dict, status: int = 200) -> MagicMock:
    """造一个 urlopen context manager 替身"""
    resp = MagicMock()
    resp.read.return_value = json.dumps(data).encode("utf-8")
    resp.status = status
    cm = MagicMock()
    cm.__enter__.return_value = resp
    cm.__exit__.return_value = False
    return cm


def _fake_oa_response(data: dict) -> MagicMock:
    resp = MagicMock()
    resp.read.return_value = json.dumps(data).encode("utf-8")
    cm = MagicMock()
    cm.__enter__.return_value = resp
    cm.__exit__.return_value = False
    return cm


class TestNormalizeTitle(unittest.TestCase):
    """case 8: _normalize_title 算法"""

    def test_lowercase_and_strip_punct(self):
        # 大写 → 小写;标点 → 去
        self.assertEqual(_normalize_title("Attention Is All You Need!"), "attention is all you need")

    def test_unicode_cjk_kept(self):
        # CJK 字符保留
        self.assertEqual(_normalize_title("深度学习入门"), "深度学习入门")

    def test_empty(self):
        self.assertEqual(_normalize_title(""), "")
        self.assertEqual(_normalize_title("!!!"), "")

    def test_similarity_invariant_to_case_and_punct(self):
        a = "Attention Is All You Need"
        b = "ATTENTION IS ALL YOU NEED."
        # case + 句号 → 全等
        self.assertEqual(_normalize_title(a), _normalize_title(b))
        self.assertGreater(_similarity(a, b), 0.99)


class TestExtractCitations(unittest.TestCase):
    def test_extracts_refs_section(self):
        md = (
            "正文里提到 RAG [1] 和 Transformer [2]。\n\n"
            "## 参考文献\n\n"
            "[1] Lewis et al., 2020. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks\n"
            "[2] Vaswani et al., 2017. Attention Is All You Need\n"
        )
        refs = extract_citations(md)
        self.assertEqual(len(refs), 2)
        self.assertEqual(refs[0]["marker"], "[1]")
        self.assertEqual(refs[0]["year"], 2020)
        self.assertEqual(refs[1]["marker"], "[2]")
        self.assertEqual(refs[1]["year"], 2017)

    def test_ignores_refs_not_in_text(self):
        md = (
            "正文里只提到 [1]。\n\n"
            "## 参考文献\n\n"
            "[1] 真实存在的引用\n"
            "[2] 文中未出现的引用\n"
        )
        refs = extract_citations(md)
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["marker"], "[1]")

    def test_supports_chinese_header(self):
        md = (
            "## 七、相关工作\n\n"
            "正文 [1]。\n\n"
            "[1] Smith 2023. A New Method\n"
        )
        refs = extract_citations(md)
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["title"], "A New Method")
        self.assertEqual(refs[0]["year"], 2023)

    def test_no_ref_section(self):
        md = "只有正文,没有任何引用段。[1]"
        refs = extract_citations(md)
        self.assertEqual(refs, [])


class TestCheckCitationExistence(unittest.TestCase):
    """case 1-5, 9"""

    def test_case1_library_exact_match(self):
        lib = [{"id": "arxiv:2005.11401", "title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", "year": 2020}]
        cite = {"title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", "year": 2020}
        existence, match = check_citation_existence(cite, lib)
        self.assertEqual(existence, "exact")
        self.assertEqual(match["source"], "library")
        self.assertGreaterEqual(match["similarity"], 0.99)

    def test_case2_s2_fuzzy_match(self):
        cite = {"title": "Retrieval-Augmented Generation for Knowledg Intensive Tasks", "year": 2020}
        s2_data = {
            "data": [
                {"title": "Retrieval-Augmented Generation for Knowledge-Intensive Tasks", "year": 2020}
            ]
        }
        with patch("citation_guard.search_library", return_value=None), \
             patch("citation_guard.urllib.request.urlopen", return_value=_fake_s2_response(s2_data)):
            existence, match = check_citation_existence(cite, [])
        self.assertEqual(existence, "exact")
        self.assertEqual(match["source"], "semantic_scholar")
        self.assertGreaterEqual(match["similarity"], EXACT_SIMILARITY)

    def test_case3_openalex_minor_fallback(self):
        cite = {"title": "Attention Is All You Need", "year": 2017}
        with patch("citation_guard.search_library", return_value=None), \
             patch("citation_guard.search_semantic_scholar", return_value=[]), \
             patch("citation_guard.search_openalex", return_value=[
                 {"title": "Attention Is All You Need (minor variant)", "year": 2017}
             ]):
            existence, match = check_citation_existence(cite, [])
        self.assertEqual(existence, "minor")
        self.assertEqual(match["source"], "openalex")
        self.assertGreaterEqual(match["similarity"], MINOR_SIMILARITY)
        self.assertLess(match["similarity"], EXACT_SIMILARITY)

    def test_case4_three_sources_miss_fabricated(self):
        cite = {"title": "Totally Made Up Paper About Something Imaginary", "year": 2099}
        with patch("citation_guard.search_library", return_value=None), \
             patch("citation_guard.search_semantic_scholar", return_value=[
                 {"title": "Some Unrelated Work About Different Topics", "year": 2010}
             ]), \
             patch("citation_guard.search_openalex", return_value=[
                 {"title": "Yet Another Unrelated Paper Title", "year": 2010}
             ]):
            existence, match = check_citation_existence(cite, [])
        self.assertEqual(existence, "fabricated")
        self.assertIsNone(match)

    def test_case5_year_tolerance_one(self):
        # 库内 paper 2021,引用写 2020 → year_tolerance=1 ≤ YEAR_TOLERANCE → exact
        lib = [{"id": "arxiv:2101.00001", "title": "Some Paper About Topic X", "year": 2021}]
        cite = {"title": "Some Paper About Topic X", "year": 2020}
        existence, match = check_citation_existence(cite, lib)
        self.assertEqual(existence, "exact")
        self.assertEqual(match["year_tolerance"], 1)


class TestReviewPassed(unittest.TestCase):
    """case 6, 7"""

    def test_case6_supported_ratio_below_pass_rating(self):
        # 3 个 unsupported → supported/checked = 0/3 < 0.6 → pass=false
        summary = {
            "supported": 0,
            "partial": 0,
            "unsupported": 3,
            "fabricated": 0,
        }
        citations = [
            {"existence": "exact"},
            {"existence": "exact"},
            {"existence": "minor"},
        ]
        self.assertFalse(review_passed(summary, citations))

    def test_case6b_supported_ratio_above_pass_rating(self):
        # 6 supported / 3 unsupported → 6/9 ≈ 0.667 >= 0.6 → pass=true
        summary = {
            "supported": 6,
            "partial": 0,
            "unsupported": 3,
            "fabricated": 0,
        }
        citations = [{"existence": "exact"} for _ in range(9)]
        self.assertTrue(review_passed(summary, citations))

    def test_case7_single_fabricated_blocks_pass(self):
        # 1 fabricated + 高 support ratio → 仍然 pass=false
        summary = {
            "supported": 100,
            "partial": 0,
            "unsupported": 0,
            "fabricated": 1,
        }
        citations = [
            {"existence": "exact"} for _ in range(100)
        ] + [{"existence": "fabricated"}]
        self.assertFalse(review_passed(summary, citations))

    def test_no_checked_citations_pass(self):
        summary = {"supported": 0, "partial": 0, "unsupported": 0, "fabricated": 0}
        citations = []
        self.assertTrue(review_passed(summary, citations))


class TestS2RateLimitBackoff(unittest.TestCase):
    """case 9: S2 429 指数退避"""

    def test_429_then_success(self):
        # 第 1-4 次抛 429,第 5 次返回 mock context manager
        from urllib.error import HTTPError

        http_err = HTTPError(url="http://x", code=429, msg="rate", hdrs={}, fp=None)

        ok_resp = MagicMock()
        ok_resp.read.return_value = json.dumps(
            {"data": [{"title": "Some Paper Title", "year": 2023}]}
        ).encode("utf-8")
        ok_cm = MagicMock()
        ok_cm.__enter__.return_value = ok_resp
        ok_cm.__exit__.return_value = False

        # side_effect 是 list 时,mock 会 *抛出* 异常实例
        side_effects = [http_err, http_err, http_err, http_err, ok_cm]

        sleeps: list[float] = []
        with patch("citation_guard.urllib.request.urlopen", side_effect=side_effects):
            hits = search_semantic_scholar("Some Paper Title", 2023, sleep_fn=sleeps.append)
        # 退避序列 1, 2, 4, 8(最后一次成功前不 sleep)
        self.assertEqual(sleeps, [1, 2, 4, 8])
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["title"], "Some Paper Title")

    def test_429_exhausted_returns_empty(self):
        from urllib.error import HTTPError

        http_err = HTTPError(url="http://x", code=429, msg="rate", hdrs={}, fp=None)
        side_effects = [http_err] * 5

        sleeps: list[float] = []
        with patch("citation_guard.urllib.request.urlopen", side_effect=side_effects):
            hits = search_semantic_scholar("X", None, retry_max=5, sleep_fn=sleeps.append)
        self.assertEqual(hits, [])
        # 4 次 sleep(最后一次 429 后不再 sleep)
        self.assertEqual(len(sleeps), 4)


class TestCLIExitCode(unittest.TestCase):
    """case 10: CLI exit code 2(fabricated > 0)"""

    def _write_md(self, tmpdir: Path) -> Path:
        md = tmpdir / "2510.00001v1-fake-paper.md"
        md.write_text(
            "正文 [1]。\n\n## 参考文献\n\n"
            "[1] Totally Fabricated Imaginary Reference, 2099. Nonexistent Work\n",
            encoding="utf-8",
        )
        return md

    def test_fabricated_returns_exit_code_2(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            md = self._write_md(tmp)
            with patch("citation_guard.search_library", return_value=None), \
                 patch("citation_guard.search_semantic_scholar", return_value=[]), \
                 patch("citation_guard.search_openalex", return_value=[]):
                rc = main([str(md)])
            self.assertEqual(rc, 2)
            # citations.json 已写出
            self.assertTrue(md.with_suffix(".citations.json").exists())

    def test_pass_returns_exit_code_0(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            md = tmp / "2510.00002v1-real-paper.md"
            md.write_text(
                "正文 [1]。\n\n## 参考文献\n\n"
                "[1] Exact Match Paper Title, 2024. Exact Match Paper Title\n",
                encoding="utf-8",
            )
            lib = [{"id": "arxiv:0000.00001", "title": "Exact Match Paper Title", "year": 2024}]
            with patch("citation_guard.search_library", return_value={
                "source": "library", "paper_id": "arxiv:0000.00001",
                "title": "Exact Match Paper Title", "year": 2024, "similarity": 1.0, "year_tolerance": 0
            }):
                rc = main([str(md), "--library", str(tmp / "lib.json")])
            self.assertEqual(rc, 0)

    def test_missing_md_returns_exit_code_1(self):
        rc = main(["/nonexistent/path.md"])
        self.assertEqual(rc, 1)


class TestRunGuardWritesOutput(unittest.TestCase):
    def test_run_guard_writes_citations_json(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            md = tmp / "2510.00003v1-test.md"
            md.write_text(
                "正文 [1]。\n\n## 参考文献\n\n"
                "[1] Real Paper, 2024. Real Paper Title\n",
                encoding="utf-8",
            )
            with patch("citation_guard.search_library", return_value={
                "source": "library", "paper_id": "x", "title": "Real Paper Title",
                "year": 2024, "similarity": 1.0, "year_tolerance": 0
            }):
                result = run_guard(md, {"library_papers": []})
            self.assertTrue(result["pass"])
            self.assertEqual(result["paper_id"], "2510.00003v1")
            self.assertEqual(result["summary"]["exact"], 1)
            out = json.loads(md.with_suffix(".citations.json").read_text(encoding="utf-8"))
            self.assertEqual(out["paper_id"], "2510.00003v1")


class TestYearToleranceHelper(unittest.TestCase):
    def test_within_tolerance(self):
        self.assertEqual(_year_within_tolerance(2020, 2021), 1)
        self.assertLessEqual(_year_within_tolerance(2020, 2021), YEAR_TOLERANCE)

    def test_missing_year_returns_tolerance(self):
        self.assertEqual(_year_within_tolerance(None, 2020), YEAR_TOLERANCE)
        self.assertEqual(_year_within_tolerance(2020, None), YEAR_TOLERANCE)


def urllib_error_cls(code: int):
    from urllib.error import HTTPError
    return HTTPError(url="http://x", code=code, msg="rate", hdrs={}, fp=None)


class TestConstants(unittest.TestCase):
    def test_constants_match_plan(self):
        self.assertAlmostEqual(EXACT_SIMILARITY, 0.92, places=2)
        self.assertAlmostEqual(MINOR_SIMILARITY, 0.75, places=2)
        self.assertEqual(YEAR_TOLERANCE, 1)
        self.assertAlmostEqual(PASS_RATING, 6.0, places=1)


if __name__ == "__main__":
    unittest.main()
