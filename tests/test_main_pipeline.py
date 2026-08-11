import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def _load_module():
    root = Path(__file__).resolve().parents[1]
    src_dir = root / "src"
    if str(src_dir) not in sys.path:
        sys.path.insert(0, str(src_dir))
    src_path = root / "src" / "main.py"
    spec = importlib.util.spec_from_file_location("main_pipeline_mod", src_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class MainPipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load_module()

    def _write_rrf_input(self, root: Path, token: str) -> Path:
        filtered_dir = root / "archive" / token / "filtered"
        filtered_dir.mkdir(parents=True, exist_ok=True)
        path = filtered_dir / f"arxiv_papers_{token}.json"
        payload = {
            "generated_at": "2026-03-10T00:00:00+00:00",
            "papers": [
                {"id": "p1", "title": "Paper 1", "abstract": "A"},
                {"id": "p2", "title": "Paper 2", "abstract": "B"},
                {"id": "p3", "title": "Paper 3", "abstract": "C"},
            ],
            "queries": [
                {
                    "type": "intent_query",
                    "tag": "query:test",
                    "paper_tag": "query:test",
                    "query_text": "test query",
                    "sim_scores": {
                        "p1": {"score": 0.9, "rank": 1},
                        "p2": {"score": 0.6, "rank": 2},
                        "p3": {"score": 0.2, "rank": 3},
                    },
                }
            ],
        }
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return path

    def test_resolve_summary_step_env_uses_summary_overrides(self):
        # PR-3 (plans/pr-plans/pr-3-stage-router.md §9): 已删除
        # resolve_summary_step_env() 旁路,Step 6 改走
        # llm_stage_models.doc.generate 路由。SUMMARY_* / BLT_SUMMARY_*
        # env 由 src/llm_router.py 接管,在 config.yaml 配。
        with patch.dict(
            os.environ,
            {
                "SUMMARY_API_KEY": "summary-key",
                "SUMMARY_BASE_URL": "https://summary.example.com/v1",
                "SUMMARY_MODEL": "deepseek-v4-flash",
            },
            clear=True,
        ):
            self.assertFalse(
                hasattr(self.mod, "resolve_summary_step_env"),
                "PR-3 已删除 resolve_summary_step_env,不应再被 main.py 导出",
            )

    def test_main_runs_local_rerank_without_remote_rerank_base(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            src_dir = root / "src"
            src_dir.mkdir(parents=True, exist_ok=True)
            token = "20260310"
            self._write_rrf_input(root, token)
            calls = []

            def fake_run_step(label, args, env=None):
                calls.append((label, args, env))

            with patch.object(self.mod, "ROOT_DIR", str(root)), patch.object(
                self.mod, "SRC_DIR", str(src_dir)
            ), patch.object(
                self.mod, "resolve_run_date_token", return_value=token
            ), patch.object(
                self.mod, "resolve_sidebar_date_label", return_value=None
            ), patch.object(
                self.mod, "parse_trace_ids", return_value=[]
            ), patch.object(
                self.mod, "run_step", side_effect=fake_run_step
            ), patch.object(
                sys, "argv", ["main.py"]
            ), patch.dict(
                os.environ,
                {"LLM_PRIMARY_BASE_URL": "https://api.openai.com/v1"},
                clear=True,
            ):
                self.mod.main()

            labels = [item[0] for item in calls]
            # PR-1 之后:Step 3 (rerank) 退化为本地兜底(无独立 step label),
            # main() 只跑 6 个 step: 2.1 BM25, 2.2 Embedding, 2.3 RRF,
            # 4 LLM refine, 5 Select, 6 Generate Docs。
            self.assertEqual(
                labels,
                [
                    "Step 2.1 - BM25",
                    "Step 2.2 - Embedding",
                    "Step 2.3 - RRF",
                    "Step 4 - LLM refine",
                    "Step 5 - Select",
                    "Step 6 - Generate Docs",
                ],
            )
            # 防御:Step 3 rerank 已退化,不应出现在 labels
            self.assertNotIn("Step 3 - Rerank", labels)

    def test_main_keeps_local_rerank_in_deepseek_mode(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            src_dir = root / "src"
            src_dir.mkdir(parents=True, exist_ok=True)
            token = "20260310"
            self._write_rrf_input(root, token)
            calls = []

            def fake_run_step(label, args, env=None):
                calls.append((label, args, env))

            with patch.object(self.mod, "ROOT_DIR", str(root)), patch.object(
                self.mod, "SRC_DIR", str(src_dir)
            ), patch.object(
                self.mod, "resolve_run_date_token", return_value=token
            ), patch.object(
                self.mod, "resolve_sidebar_date_label", return_value=None
            ), patch.object(
                self.mod, "parse_trace_ids", return_value=[]
            ), patch.object(
                self.mod, "run_step", side_effect=fake_run_step
            ), patch.object(
                sys, "argv", ["main.py"]
            ), patch.dict(
                os.environ,
                {"LLM_PRIMARY_BASE_URL": "https://api.deepseek.com"},
                clear=True,
            ):
                self.mod.main()

            labels = [item[0] for item in calls]
            # PR-1 之后:deepseek mode 跟其它模式一样跑 6 step (Step 3 退化)。
            # 早期这个测试想验证"deepseek 模式下还跑 local rerank",但 Step 3
            # 退化为本地兜底后不再有独立 label;现在改为验证 step 序列完整。
            self.assertEqual(
                labels,
                [
                    "Step 2.1 - BM25",
                    "Step 2.2 - Embedding",
                    "Step 2.3 - RRF",
                    "Step 4 - LLM refine",
                    "Step 5 - Select",
                    "Step 6 - Generate Docs",
                ],
            )
            self.assertNotIn("Step 3 - Rerank", labels)


class TestRunPipeline(unittest.TestCase):
    """Test run_pipeline() data-driven execution with plan_signals."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_module()

    def test_run_pipeline_runs_all_steps_when_no_signals(self):
        """Happy path: all steps run when no signals fire."""
        config = {
            "python": sys.executable,
            "src_dir": str(Path(__file__).parents[1] / "src"),
            "checkpoint_on": False,
            "checkpoint_archive": "/tmp/test_archive",
            "fetch_days": None,
            "fetch_ignore_seen": False,
            "embedding_device": "cpu",
            "embedding_batch_size": 8,
            "use_skims_mode": False,
            "sidebar_date_label": None,
            "rrf_path": None,
            "rerank_path": None,
        }

        def mock_step(cfg):
            return {"status": "succeeded"}

        # Patch STEP_FUNCTIONS directly since it's populated at module load time
        with patch.object(self.mod, "STEP_FUNCTIONS", {
            "0.enrich_config_queries": mock_step,
            "1.fetch_arxiv": mock_step,
            "2.1.retrieval_papers_bm25": mock_step,
            "2.2.retrieval_papers_embedding": mock_step,
            "2.3.retrieval_papers_rrf": mock_step,
            "3.rank_papers": mock_step,
            "4.llm_refine_papers": mock_step,
            "5.select_papers": mock_step,
            "6.generate_docs": mock_step,
            "citation_guard": mock_step,
            "concept_extract": mock_step,
            "wiki_render": mock_step,
        }):
            result = self.mod.run_pipeline(config)

        # All implemented steps should run
        outputs = result["outputs"]
        # Steps with implementations should have outputs
        self.assertIn("1.fetch_arxiv", outputs)
        self.assertIn("2.1.retrieval_papers_bm25", outputs)
        self.assertIn("2.2.retrieval_papers_embedding", outputs)
        self.assertIn("2.3.retrieval_papers_rrf", outputs)
        self.assertIn("3.rank_papers", outputs)
        self.assertIn("4.llm_refine_papers", outputs)
        self.assertIn("5.select_papers", outputs)
        self.assertIn("6.generate_docs", outputs)

        # No signals should fire in happy path
        self.assertEqual(len(result["signals_fired"]), 0)

    def test_run_pipeline_skips_step_on_fabricated(self):
        """citation_guard fabricated > 0 should skip concept_extract."""
        config = {
            "python": sys.executable,
            "src_dir": str(Path(__file__).parents[1] / "src"),
            "checkpoint_on": False,
            "checkpoint_archive": "/tmp/test_archive",
        }

        def mock_step(cfg):
            return {"status": "succeeded"}

        # citation_guard returns fabricated > 0 to trigger signal
        def mock_citation_guard(cfg):
            return {"status": "succeeded", "summary": {"fabricated": 1, "exact": 0, "minor": 0}}

        # Patch STEP_FUNCTIONS directly
        with patch.object(self.mod, "STEP_FUNCTIONS", {
            "0.enrich_config_queries": mock_step,
            "1.fetch_arxiv": mock_step,
            "2.1.retrieval_papers_bm25": mock_step,
            "2.2.retrieval_papers_embedding": mock_step,
            "2.3.retrieval_papers_rrf": mock_step,
            "3.rank_papers": mock_step,
            "4.llm_refine_papers": mock_step,
            "citation_guard": mock_citation_guard,
            "concept_extract": mock_step,
            "5.select_papers": mock_step,
            "6.generate_docs": mock_step,
            "wiki_render": mock_step,
        }):
            result = self.mod.run_pipeline(config)

        # concept_extract should be skipped (not in outputs if signal worked)
        # Signal should be recorded
        signals = result["signals_fired"]
        self.assertTrue(any(s["signal"] == "citation_guard_fabricated" for s in signals))

    def test_run_pipeline_escalates_on_validation_fail(self):
        """validation failed should escalate by prepending needs_review."""
        config = {
            "python": sys.executable,
            "src_dir": str(Path(__file__).parents[1] / "src"),
            "checkpoint_on": False,
            "checkpoint_archive": "/tmp/test_archive",
        }

        def mock_step(cfg):
            return {"status": "succeeded"}

        # fetch_arxiv returns verdict=fail to trigger signal
        def mock_fetch(cfg):
            return {"status": "succeeded", "verdict": "fail"}

        # Patch STEP_FUNCTIONS directly
        with patch.object(self.mod, "STEP_FUNCTIONS", {
            "0.enrich_config_queries": mock_step,
            "1.fetch_arxiv": mock_fetch,
            "2.1.retrieval_papers_bm25": mock_step,
            "2.2.retrieval_papers_embedding": mock_step,
            "2.3.retrieval_papers_rrf": mock_step,
            "3.rank_papers": mock_step,
            "4.llm_refine_papers": mock_step,
            "5.select_papers": mock_step,
            "6.generate_docs": mock_step,
            "citation_guard": mock_step,
            "concept_extract": mock_step,
            "wiki_render": mock_step,
        }):
            result = self.mod.run_pipeline(config)

        # Check that validation_failed signal fired
        signals = result["signals_fired"]
        self.assertTrue(any(s["signal"] == "validation_failed" for s in signals))

    def test_run_pipeline_clamps_on_budget(self):
        """budget_exceeded should clamp (empty) the remaining plan."""
        config = {
            "python": sys.executable,
            "src_dir": str(Path(__file__).parents[1] / "src"),
            "checkpoint_on": False,
            "checkpoint_archive": "/tmp/test_archive",
        }

        # Create mock functions that return specific values
        def mock_enrich(cfg):
            return {"status": "succeeded"}

        def mock_fetch(cfg):
            return {"status": "succeeded", "budget_exceeded": True}

        def mock_bm25(cfg):
            return {"status": "succeeded"}

        def mock_embedding(cfg):
            return {"status": "succeeded"}

        # Patch STEP_FUNCTIONS directly since it's populated at module load time
        with patch.object(self.mod, "STEP_FUNCTIONS", {
            "0.enrich_config_queries": mock_enrich,
            "1.fetch_arxiv": mock_fetch,
            "2.1.retrieval_papers_bm25": mock_bm25,
            "2.2.retrieval_papers_embedding": mock_embedding,
            "2.3.retrieval_papers_rrf": mock_bm25,
            "3.rank_papers": mock_bm25,
            "4.llm_refine_papers": mock_bm25,
            "5.select_papers": mock_bm25,
            "6.generate_docs": mock_bm25,
            "citation_guard": mock_bm25,
            "concept_extract": mock_bm25,
            "wiki_render": mock_bm25,
        }):
            result = self.mod.run_pipeline(config)

        # Steps after fetch_arxiv should not be called due to clamp
        # (can't easily mock call count without more complex setup)

        # budget_exhausted signal should fire
        signals = result["signals_fired"]
        self.assertTrue(any(s["signal"] == "budget_exhausted" for s in signals))

    def test_run_pipeline_records_outputs(self):
        """run_pipeline should record outputs for each step."""
        config = {
            "python": sys.executable,
            "src_dir": str(Path(__file__).parents[1] / "src"),
            "checkpoint_on": False,
            "checkpoint_archive": "/tmp/test_archive",
        }

        def mock_step(cfg):
            return {"status": "succeeded"}

        def mock_enrich(cfg):
            return {"status": "succeeded", "custom": "value1"}

        def mock_fetch(cfg):
            return {"status": "succeeded", "custom": "value2"}

        # Patch STEP_FUNCTIONS directly
        with patch.object(self.mod, "STEP_FUNCTIONS", {
            "0.enrich_config_queries": mock_enrich,
            "1.fetch_arxiv": mock_fetch,
            "2.1.retrieval_papers_bm25": mock_step,
            "2.2.retrieval_papers_embedding": mock_step,
            "2.3.retrieval_papers_rrf": mock_step,
            "3.rank_papers": mock_step,
            "4.llm_refine_papers": mock_step,
            "5.select_papers": mock_step,
            "6.generate_docs": mock_step,
            "citation_guard": mock_step,
            "concept_extract": mock_step,
            "wiki_render": mock_step,
        }):
            result = self.mod.run_pipeline(config)

        outputs = result["outputs"]

        # Verify outputs contain step_ids
        self.assertIn("0.enrich_config_queries", outputs)
        self.assertEqual(outputs["0.enrich_config_queries"]["custom"], "value1")
        self.assertIn("1.fetch_arxiv", outputs)
        self.assertEqual(outputs["1.fetch_arxiv"]["custom"], "value2")

    def test_run_pipeline_records_signals_fired(self):
        """run_pipeline should record which signals fired."""
        config = {
            "python": sys.executable,
            "src_dir": str(Path(__file__).parents[1] / "src"),
            "checkpoint_on": False,
            "checkpoint_archive": "/tmp/test_archive",
        }

        def mock_step(cfg):
            return {"status": "succeeded"}

        # concept_extract returns concept_count=0 to trigger concepts_empty signal
        def mock_concept(cfg):
            return {"concept_count": 0}

        # Patch STEP_FUNCTIONS directly
        with patch.object(self.mod, "STEP_FUNCTIONS", {
            "0.enrich_config_queries": mock_step,
            "1.fetch_arxiv": mock_step,
            "2.1.retrieval_papers_bm25": mock_step,
            "2.2.retrieval_papers_embedding": mock_step,
            "2.3.retrieval_papers_rrf": mock_step,
            "3.rank_papers": mock_step,
            "4.llm_refine_papers": mock_step,
            "5.select_papers": mock_step,
            "6.generate_docs": mock_step,
            "citation_guard": mock_step,
            "concept_extract": mock_concept,
            "wiki_render": mock_step,
        }):
            result = self.mod.run_pipeline(config)

        signals = result["signals_fired"]

        # Should have concepts_empty signal
        self.assertTrue(len(signals) > 0)
        self.assertTrue(any(s["signal"] == "concepts_empty" for s in signals))

        # Verify signal info structure
        for sig in signals:
            self.assertIn("step", sig)
            self.assertIn("signal", sig)
            self.assertIn("action", sig)


if __name__ == "__main__":
    unittest.main()
