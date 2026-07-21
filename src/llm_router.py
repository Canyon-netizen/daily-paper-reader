"""LLM Stage Router — 按 stage 路由到不同 (provider, model, temperature)。

对齐 Polaris `src/backend/app/core/llm/router.py`（精简版）：
- `LLMRouter.resolve(stage)` + 60s in-process 缓存。
- `LLMRouter.call(stage, **kwargs)`：解析路由 → 调 LLM → 记录 usage。
- `LLMRouter.invalidate_cache()`：清缓存（参考 Polaris `get_llm_router().invalidate_cache()`）。
- module-level singleton `get_llm_router(config=None)`。

零破坏：
- 未配置 `llm_stage_models` 时，所有 stage fallback `LLM_MODEL` env。
- 删除 `resolve_summary_step_env` / `BLT_REWRITE_MODEL` 旁路，统一走 router。
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

from src.llm import ClientFactory, parse_provider_model

# 对齐 Polaris _ROUTE_CACHE_TTL = 60s
ROUTE_CACHE_TTL = 60

# 默认 fallback（plan §5）：env 取不到时兜底；保持显式 provider/model 字符串。
_DEFAULT_FALLBACK_PM = "deepseek/deepseek-chat"
_DEFAULT_TEMPERATURE = 0.5


def _interpolate_env(value: Any) -> Any:
    """处理 `${LLM_MODEL}` 占位符 → 解析为 env value。"""
    if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
        env_key = value[2:-1]
        resolved = os.environ.get(env_key)
        if resolved is None:
            # 必填 env 不存在 → 抛 ValueError（plan §11 测试 7）
            raise ValueError(f"环境变量 {env_key} 必填但未设置")
        return resolved
    return value


class LLMRouter:
    def __init__(self, config: Dict[str, Any]):
        self.routes = config.get("llm_stage_models", {}) or {}
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._usage_logger = None  # 懒加载

    def resolve(self, stage: str) -> Dict[str, Any]:
        """返 `{"provider_model": str, "temperature": float, "is_stream": bool, "cached_at": float}`。"""
        now = time.time()
        cached = self._cache.get(stage)
        if cached and now - cached["cached_at"] < ROUTE_CACHE_TTL:
            return cached["route"]

        # 对齐 Polaris 解析顺序:routes[stage] → routes["default"] → env fallback
        route = self.routes.get(stage)
        if not route:
            route = self.routes.get("default")
        if not route:
            route = {
                "provider_model": os.environ.get("LLM_MODEL", _DEFAULT_FALLBACK_PM),
                "temperature": _DEFAULT_TEMPERATURE,
            }

        # 处理 ${LLM_MODEL} 占位符
        pm = _interpolate_env(route.get("provider_model", _DEFAULT_FALLBACK_PM))

        resolved = {
            "provider_model": pm,
            "temperature": route.get("temperature", _DEFAULT_TEMPERATURE),
            "is_stream": stage in set(self.routes.get("stream_stages", []) or []),
            "cached_at": now,
        }
        self._cache[stage] = {"route": resolved, "cached_at": now}
        return resolved

    def call(
        self,
        stage: str,
        *,
        messages: list[dict],
        temperature: Optional[float] = None,
        response_format: Optional[dict] = None,
        stream: bool = False,
        **kwargs: Any,
    ) -> Any:
        """解析路由 + 调 LLM + 记录 usage。

        与 `ClientFactory._create_client(...).chat(...)` 行为对齐；温度缺省走路由默认。
        """
        route = self.resolve(stage)
        provider, model = parse_provider_model(route["provider_model"])

        client = ClientFactory._create_client(
            provider,
            model,
            api_key=None,  # 复用 env
            base_url=None,
        )

        actual_temp = temperature if temperature is not None else route["temperature"]
        response = client.chat(
            messages=messages,
            temperature=actual_temp,
            response_format=response_format,
            stream=stream,
            **kwargs,
        )

        # 记录 usage
        self._record_usage(stage, provider, model, actual_temp, response)
        return response

    def _record_usage(self, stage: str, provider: str, model: str, temperature: float, response: Any) -> None:
        """对齐 Polaris LLMUsage 字段。"""
        try:
            from src.llm_usage_logger import log_usage

            log_usage(
                stage=stage,
                provider=provider,
                model=model,
                temperature=temperature,
                response=response,
            )
        except Exception as e:  # pragma: no cover - 用例不期望走到这
            print(f"[WARN] usage log failed: {e}", flush=True)

    def invalidate_cache(self) -> None:
        """对齐 Polaris `get_llm_router().invalidate_cache()`。"""
        self._cache.clear()


# Module-level singleton（仿照 Polaris llm_admin）
_router_instance: Optional[LLMRouter] = None


def get_llm_router(config: Optional[Dict[str, Any]] = None) -> LLMRouter:
    """获取 router 单例。首次调用时从 config.yaml 读取 `llm_stage_models`。"""
    global _router_instance
    if _router_instance is None:
        cfg = config
        if cfg is None:
            # 懒加载 config；用 src/0/4/6 都用的 source_config.load_config_with_source_migration
            try:
                from src.source_config import load_config_with_source_migration

                ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
                cfg_path = os.path.join(ROOT_DIR, "config.yaml")
                cfg = load_config_with_source_migration(cfg_path, write_back=False) or {}
            except Exception:
                # 测试 / 离线场景：fallback 到空 dict，由 env 兜底
                cfg = {}
        _router_instance = LLMRouter(cfg)
    return _router_instance


def reset_router_for_tests() -> None:
    """测试用：清空 module-level singleton。"""
    global _router_instance
    _router_instance = None