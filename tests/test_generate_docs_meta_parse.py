import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class GenerateDocsMetaParseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        src_dir = root / "src"
        if str(src_dir) not in sys.path:
            sys.path.insert(0, str(src_dir))
        if "fitz" not in sys.modules:
            try:
                import fitz  # noqa: F401
            except Exception:
                import types

                fitz_stub = types.ModuleType("fitz")
                fitz_stub.open = lambda *args, **kwargs: None
                sys.modules["fitz"] = fitz_stub

        src_path = root / "src" / "6.generate_docs.py"
        spec = importlib.util.spec_from_file_location("gen6_mod", src_path)
        cls.mod = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(cls.mod)

    def test_parse_meta_from_front_matter(self):
        # repo 目录已重组 (commit 1615ae5 加 DD 子目录),path 含 /04/;
        # 用现有 paper 验证解析路径。
        md_path = Path("docs/papers/2026/06/04/2606.06087v1-latentskill.md")
        item = self.mod._parse_generated_md_to_meta(str(md_path), "pid", "quick")
        self.assertEqual(item["title_en"], "LatentSkill: From In-Context Textual Skills to In-Weight Latent Skills for LLM Agents")
        self.assertTrue(item["authors"].startswith("Aofan Yu"))
        self.assertEqual(item["date"], "2026-06-04")
        self.assertEqual(item["source"], "arxiv")
        self.assertEqual(item["selection_source"], "web_analyzer")

    def test_parse_fallback_to_legacy_meta_lines(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "paper.md"
            path.write_text(
                "\n".join(
                    [
                        "---",
                        "selection_source: fresh_fetch",
                        "title: Legacy title",
                        "---",
                        "**Authors**: Legacy A, Legacy B",
                        "**Date**: 20260301",
                        "**PDF**: https://example.com/paper.pdf",
                        "**TLDR**: legacy tldr text",
                        "",
                        "## Abstract",
                        "abstract body",
                    ]
                ),
                encoding="utf-8",
            )
            item = self.mod._parse_generated_md_to_meta(
                str(path),
                "legacy",
                "deep",
                "cache_hint",
            )
            self.assertEqual(item["authors"], "Legacy A, Legacy B")
            self.assertEqual(item["date"], "20260301")
            self.assertEqual(item["pdf"], "https://example.com/paper.pdf")
            self.assertEqual(item["tldr"], "legacy tldr text")
            self.assertEqual(item["selection_source"], "cache_hint")

    def test_parse_source_from_front_matter(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "paper.md"
            path.write_text(
                "\n".join(
                    [
                        "---",
                        "title: Test title",
                        "source: biorxiv",
                        "selection_source: fresh_fetch",
                        "---",
                        "## Abstract",
                        "abstract body",
                    ]
                ),
                encoding="utf-8",
            )
            item = self.mod._parse_generated_md_to_meta(str(path), "pid", "quick")
            self.assertEqual(item["source"], "biorxiv")
            self.assertEqual(item["selection_source"], "fresh_fetch")

    def test_extract_sidebar_tags_hides_composite_suffix(self):
        # llm_categories (4-dim) 优先路径;没有再回退 llm_tags。这两个 paper
        # 都是 categories 路径,测试期望 task / method 维度被采纳。
        paper = {
            "llm_score": 8.0,
            "llm_categories": {
                "venue": [],
                "task": ["reasoning", "retrieval"],
                "method": ["rag"],
                "type": ["empirical"],
            },
            "llm_tags": [
                "query:sr:composite",
                "query:sr",
                "keyword:equation-discovery",
            ],
        }
        tags = self.mod.extract_sidebar_tags(paper)
        self.assertEqual(tags[0], ("score", "8.0"))
        # 4-dim 顺序固定:venue → task → method → type
        self.assertIn(("task", "reasoning"), tags)
        self.assertIn(("task", "retrieval"), tags)
        self.assertIn(("method", "rag"), tags)
        self.assertIn(("type", "empirical"), tags)
        # llm_tags 在 llm_categories 路径里不读,旧 keyword/query 不出现
        self.assertNotIn(("query", "sr"), tags)
        self.assertNotIn(("query", "equation-discovery"), tags)

    def test_build_markdown_content_writes_media_json_front_matter(self):
        paper = {
            "title": "Figure Test",
            "authors": ["Ada Lovelace"],
            "published": "2026-03-26T00:00:00+00:00",
            "link": "https://arxiv.org/pdf/1234.5678",
            "abstract": "abstract body",
            "source": "arxiv",
            "_figure_assets": [
                {
                    "url": "assets/figures/arxiv/1234.5678/fig-001.webp",
                    "caption": "",
                    "page": 2,
                    "index": 1,
                    "width": 1280,
                    "height": 720,
                }
            ],
            "_table_assets": [
                {
                    "url": "assets/tables/arxiv/1234.5678/table-001.webp",
                    "caption": "",
                    "page": 3,
                    "index": 1,
                    "width": 1000,
                    "height": 560,
                }
            ],
        }
        md = self.mod.build_markdown_content(paper, "quick", "", "", [])
        meta = self.mod._parse_front_matter(md)
        self.assertIn("figures_json", meta)
        self.assertIn("tables_json", meta)
        figures = json.loads(meta["figures_json"])
        tables = json.loads(meta["tables_json"])
        self.assertEqual(len(figures), 1)
        self.assertEqual(figures[0]["url"], "assets/figures/arxiv/1234.5678/fig-001.webp")
        self.assertEqual(len(tables), 1)
        self.assertEqual(tables[0]["url"], "assets/tables/arxiv/1234.5678/table-001.webp")

    def test_maybe_generate_paper_media_accepts_biorxiv(self):
        calls = []

        def fake_ensure_paper_media(**kwargs):
            calls.append(kwargs)
            return (
                [{"url": "assets/figures/biorxiv/pid/fig-001.webp"}],
                [{"url": "assets/tables/biorxiv/pid/table-001.webp"}],
            )

        original = self.mod.ensure_paper_media
        self.mod.ensure_paper_media = fake_ensure_paper_media
        try:
            figures, tables = self.mod.maybe_generate_paper_media(
                {
                    "id": "biorxiv-abc",
                    "source": "biorxiv",
                },
                docs_dir="docs",
                paper_id="202603/26/biorxiv-abc",
                pdf_url="https://www.biorxiv.org/content/test.full.pdf",
            )
        finally:
            self.mod.ensure_paper_media = original

        self.assertEqual(len(figures), 1)
        self.assertEqual(len(tables), 1)
        self.assertEqual(calls[0]["source_key"], "biorxiv")

    def test_maybe_generate_paper_figures_keeps_legacy_return(self):
        original = self.mod.ensure_paper_media
        self.mod.ensure_paper_media = lambda **kwargs: (
            [{"url": "assets/figures/arxiv/pid/fig-001.webp"}],
            [{"url": "assets/tables/arxiv/pid/table-001.webp"}],
        )
        try:
            figures = self.mod.maybe_generate_paper_figures(
                {"id": "1234.5678", "source": "arxiv"},
                docs_dir="docs",
                paper_id="1234.5678",
                pdf_url="https://arxiv.org/pdf/1234.5678",
            )
        finally:
            self.mod.ensure_paper_media = original

        self.assertEqual(figures, [{"url": "assets/figures/arxiv/pid/fig-001.webp"}])

    def test_generate_glance_prompt_requires_richer_fields(self):
        captured = {}

        def fake_call_llm_structured_json(client, messages, **kwargs):
            captured["messages"] = messages
            return {
                "tldr": "这是一段足够长的中文速览摘要，用于覆盖研究背景、核心方法和主要贡献。",
                "motivation": "这是一段研究动机说明。",
                "method": "这是一段方法说明。",
                "result": "这是一段结果说明。",
                "conclusion": "这是一段结论说明。",
            }

        original_client = self.mod.LLM_CLIENT
        original_call = self.mod.call_llm_structured_json
        self.mod.LLM_CLIENT = object()
        self.mod.call_llm_structured_json = fake_call_llm_structured_json
        try:
            out = self.mod.generate_glance_overview("Title", "Abstract")
        finally:
            self.mod.LLM_CLIENT = original_client
            self.mod.call_llm_structured_json = original_call

        self.assertIn("**TLDR**", out)
        prompt = captured["messages"][2]["content"]
        self.assertIn("150-220个中文字符", prompt)
        self.assertIn("30-70个中文字符", prompt)
        self.assertIn("问题背景→核心方法→关键结果→贡献意义", prompt)
        self.assertNotIn("每个字段一句话概括", prompt)

    def test_process_paper_new_file_writes_md_and_defines_paper_source(self):
        """
        回归 commit c75c503 描述的 "process_paper 引用未定义 paper_source
        → NameError → 批量 try/except 吞掉 → 0 md 落盘" 旧 bug。

        期望:即便 pdf_url 非空(走 ensure_paper_formulas 路径),
        process_paper 也必须把 .md 写到磁盘,且 frontmatter 含 source。
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            docs_dir = str(root)
            paper = {
                "id": "2607.00001v1",
                "title": "Paper X",
                "abstract": "Abstract body long enough to pass heuristics.",
                "link": "https://arxiv.org/pdf/2607.00001v1",
                "pdf_url": "https://arxiv.org/pdf/2607.00001v1",
                "source": "arxiv",
                "authors": ["Author A"],
                "published": "2026-07-20T00:00:00+00:00",
                "llm_categories": {
                    "venue": ["arxiv"],
                    "task": ["rl"],
                    "method": [],
                    "type": ["empirical"],
                },
            }
            patches = [
                patch.object(self.mod, "ensure_text_content", return_value="txt body"),
                patch.object(
                    self.mod,
                    "maybe_generate_paper_media",
                    return_value=([], []),
                ),
                patch.object(
                    self.mod, "ensure_paper_formulas", return_value=[]
                ),
                patch.object(
                    self.mod,
                    "translate_title_and_abstract_to_zh",
                    return_value=("中文标题", "中文摘要"),
                ),
                patch.object(
                    self.mod,
                    "generate_glance_overview",
                    return_value="**TLDR**：一句话。\n**Motivation**：动机。\n**Method**：方法。\n**Result**：结果。\n**Conclusion**：结论。\n**Context**：语境。",
                ),
            ]
            for p in patches:
                p.start()
            try:
                pid, title = self.mod.process_paper(
                    paper, "quick", "20260720", docs_dir
                )
            finally:
                for p in patches:
                    p.stop()

            self.assertEqual(pid, "papers/2026/07/20/2607.00001v1-paper-x")
            self.assertEqual(title, "Paper X")

            md_files = list(Path(docs_dir, "papers").rglob("*.md"))
            self.assertEqual(
                len(md_files),
                1,
                f"expected exactly 1 .md, found {len(md_files)}: {md_files}",
            )
            md_text = md_files[0].read_text(encoding="utf-8")
            self.assertTrue(md_text.startswith("---"), "md must start with frontmatter")
            self.assertGreater(len(md_text), 200, "md suspiciously short")
            self.assertIn("source: arxiv", md_text)

    def test_process_paper_propagates_developer_bug(self):
        """
        回归:_process_section 的 except 子句只吞瞬时错误(requests /
        json / TimeoutError / ConnectionError / OSError),其他异常
        (这里是 NameError)必须冒泡让 daily commit 失败。
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            docs_dir = str(root)
            paper = {
                "id": "2607.00002v1",
                "title": "Bug paper",
                "abstract": "x" * 200,
                "link": "https://arxiv.org/pdf/2607.00002v1",
                "source": "arxiv",
                "published": "2026-07-20T00:00:00+00:00",
            }

            def broken_ensure(*args, **kwargs):
                raise NameError("simulated undefined symbol")

            patches = [
                patch.object(self.mod, "ensure_text_content", side_effect=broken_ensure),
                patch.object(self.mod, "maybe_generate_paper_media", return_value=([], [])),
                patch.object(self.mod, "ensure_paper_formulas", return_value=[]),
                patch.object(
                    self.mod,
                    "translate_title_and_abstract_to_zh",
                    return_value=("t", "a"),
                ),
                patch.object(
                    self.mod, "generate_glance_overview", return_value=""
                ),
            ]
            for p in patches:
                p.start()
            try:
                with ThreadPoolExecutor(max_workers=1) as ex:
                    fut = ex.submit(
                        self.mod.process_paper,
                        paper,
                        "quick",
                        "20260720",
                        docs_dir,
                    )
                    with self.assertRaises(NameError):
                        for f in as_completed([fut]):
                            f.result()
            finally:
                for p in patches:
                    p.stop()

    def test_verify_paper_md_was_written_catches_missing_and_small(self):
        from src.generate_docs_md_io import verify_paper_md_was_written

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # 缺失
            with self.assertRaises(RuntimeError):
                verify_paper_md_was_written(str(root / "missing.md"))
            # 过小
            tiny = root / "tiny.md"
            tiny.write_text("---", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                verify_paper_md_was_written(str(tiny))
            # 无 frontmatter
            no_fm = root / "nofm.md"
            no_fm.write_text("A" * 500, encoding="utf-8")
            with self.assertRaises(RuntimeError):
                verify_paper_md_was_written(str(no_fm))
            # 正常
            good = root / "good.md"
            good.write_text(
                "---\ntitle: T\n---\n\n# Body\n\n" + "A" * 500,
                encoding="utf-8",
            )
            verify_paper_md_was_written(str(good))


if __name__ == "__main__":
    unittest.main()
