"""Unit tests for src/llm_router.LLMRouter (PR-3 §11).

覆盖 8 个用例：
  1. resolve("default") 无 config        → fallback LLM_MODEL env
  2. resolve("refine") + ${LLM_MODEL}    → 解析为 env 值
  3. resolve("analyzer.deepdive") hardcoded → 返 hardcoded
  4. 缓存命中                          → 第二次 resolve 返 cached，60s 内不重读 config
  5. invalidate_cache() 后             → 缓存清空，重新读 config
  6. 未知 stage                       → fallback default
  7. ${LLM_MODEL} env 不存在           → 抛 ValueError
  8. _ensure_usage 估算                → tokens = chars / 4
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

# Allow `import src.llm_router` without packaging.
ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from src.llm_router import (  # noqa: E402
    LLMRouter,
    ROUTE_CACHE_TTL,
    get_llm_router,
    reset_router_for_tests,
)
from src.llm_usage_logger import _ensure_usage  # noqa: E402


class TestLLMRouterResolve(unittest.TestCase):
    def setUp(self) -> None:
        # 每个用例独立 env
        self._saved = {}
        for k in ("LLM_MODEL",):
            if k in os.environ:
                self._saved[k] = os.environ.pop(k)
        reset_router_for_tests()

    def tearDown(self) -> None:
        for k, v in self._saved.items():
            os.environ[k] = v
        reset_router_for_tests()

    # 用例 1: resolve("default") 无 config → fallback LLM_MODEL env
    def test_resolve_default_fallback_env(self) -> None:
        os.environ["LLM_MODEL"] = "deepseek/deepseek-chat"
        router = LLMRouter(config={})
        route = router.resolve("default")
        self.assertEqual(route["provider_model"], "deepseek/deepseek-chat")
        self.assertEqual(route["temperature"], 0.5)
        self.assertFalse(route["is_stream"])

    # 用例 2: resolve("refine") + ${LLM_MODEL} → 解析为 env 值
    def test_resolve_refine_env_placeholder(self) -> None:
        os.environ["LLM_MODEL"] = "deepseek/deepseek-chat"
        router = LLMRouter(
            config={
                "llm_stage_models": {
                    "refine": {"provider_model": "${LLM_MODEL}", "temperature": 0.2},
                }
            }
        )
        route = router.resolve("refine")
        self.assertEqual(route["provider_model"], "deepseek/deepseek-chat")
        self.assertEqual(route["temperature"], 0.2)

    # 用例 3: resolve("analyzer.deepdive") hardcoded → 返 hardcoded
    def test_resolve_analyzer_deepdive_hardcoded(self) -> None:
        os.environ["LLM_MODEL"] = "deepseek/deepseek-chat"
        router = LLMRouter(
            config={
                "llm_stage_models": {
                    "analyzer.deepdive": {
                        "provider_model": "openai/gpt-4o-mini",
                        "temperature": 0.7,
                    },
                    "stream_stages": ["analyzer.deepdive", "topic.report"],
                }
            }
        )
        route = router.resolve("analyzer.deepdive")
        self.assertEqual(route["provider_model"], "openai/gpt-4o-mini")
        self.assertEqual(route["temperature"], 0.7)
        self.assertTrue(route["is_stream"])  # 显式 stream_stages 包含

    # 用例 4: 缓存命中 → 第二次 resolve 不重读 config
    def test_cache_hit_returns_same_route(self) -> None:
        os.environ["LLM_MODEL"] = "deepseek/deepseek-chat"
        router = LLMRouter(
            config={
                "llm_stage_models": {
                    "refine": {"provider_model": "${LLM_MODEL}", "temperature": 0.2},
                }
            }
        )
        first = router.resolve("refine")
        # mutate config — 缓存命中时应仍返回 first
        router.routes["refine"] = {"provider_model": "openai/gpt-4o", "temperature": 0.9}
        second = router.resolve("refine")
        self.assertEqual(first["provider_model"], second["provider_model"])
        self.assertEqual(first["temperature"], second["temperature"])
        # sanity: TTL = 60s
        self.assertEqual(ROUTE_CACHE_TTL, 60)

    # 用例 5: invalidate_cache() → 缓存清空，重新读 config
    def test_invalidate_cache_clears(self) -> None:
        os.environ["LLM_MODEL"] = "deepseek/deepseek-chat"
        router = LLMRouter(
            config={
                "llm_stage_models": {
                    "refine": {"provider_model": "${LLM_MODEL}", "temperature": 0.2},
                }
            }
        )
        first = router.resolve("refine")
        router.routes["refine"] = {"provider_model": "openai/gpt-4o", "temperature": 0.9}
        router.invalidate_cache()
        second = router.resolve("refine")
        self.assertNotEqual(first["provider_model"], second["provider_model"])
        self.assertEqual(second["provider_model"], "openai/gpt-4o")
        self.assertEqual(second["temperature"], 0.9)

    # 用例 6: 未知 stage → fallback default
    def test_unknown_stage_falls_back_to_default(self) -> None:
        os.environ["LLM_MODEL"] = "deepseek/deepseek-chat"
        router = LLMRouter(
            config={
                "llm_stage_models": {
                    "default": {"provider_model": "${LLM_MODEL}", "temperature": 0.5},
                    "refine": {"provider_model": "openai/gpt-4o-mini", "temperature": 0.2},
                }
            }
        )
        route = router.resolve("unknown-stage-xyz")
        self.assertEqual(route["provider_model"], "deepseek/deepseek-chat")
        self.assertEqual(route["temperature"], 0.5)

    # 用例 7: ${LLM_MODEL} env 不存在 → 抛 ValueError
    def test_missing_env_raises(self) -> None:
        # 必须没有 LLM_MODEL；setUp 已经清掉
        self.assertNotIn("LLM_MODEL", os.environ)
        router = LLMRouter(
            config={
                "llm_stage_models": {
                    "refine": {"provider_model": "${LLM_MODEL}", "temperature": 0.2},
                }
            }
        )
        with self.assertRaises(ValueError) as ctx:
            router.resolve("refine")
        self.assertIn("LLM_MODEL", str(ctx.exception))


class TestEnsureUsage(unittest.TestCase):
    # 用例 8: _ensure_usage 估算 → tokens = chars / 4
    def test_ensure_usage_estimates_chars_div_4(self) -> None:
        # provider returned usage → 原样用
        usage = _ensure_usage({"tokens_in": 12, "tokens_out": 34}, "x", "y")
        self.assertEqual(usage, {"tokens_in": 12, "tokens_out": 34})

        # 无 usage → 按 chars / 4 估
        prompt = "a" * 80   # 80/4 = 20
        completion = "b" * 200  # 200/4 = 50
        usage = _ensure_usage(None, prompt, completion)
        self.assertEqual(usage, {"tokens_in": 20, "tokens_out": 50})


class TestGetLLMRouterSingleton(unittest.TestCase):
    def test_singleton_returns_same_instance(self) -> None:
        reset_router_for_tests()
        os.environ["LLM_MODEL"] = "deepseek/deepseek-chat"
        r1 = get_llm_router(config={"llm_stage_models": {}})
        r2 = get_llm_router(config=None)
        self.assertIs(r1, r2)
        reset_router_for_tests()


if __name__ == "__main__":
    unittest.main()