# PR-3 — LLM Stage Routing 雏形

> **状态**：✅ **已实现**（2026-07-21 落地）
> **来源**：`plans/polaris-absorption.md` 能力 7（阶段化 LLM 路由 → DPR Stage Routing）
> **依赖**：无（与 PR-1/2 可并行；PR-4 依赖此 PR）
> **优先级**：高（立即收益：8 个 stage 可独立配 model；顺便吸掉 `resolve_summary_step_env` 旁路）
> **预估 LOC**：~400 行（`src/llm_router.py` + `src/llm_usage_logger.py` + `src/llm.py` 改动 + 8 处调用点 + `astro-src/lib/llm.ts` 浏览器侧）

---

## 1. 目标

把当前「所有 LLM call 共享 `LLM_MODEL` 环境变量」升级为「按 stage 路由到不同 (provider, model, temperature)」。

**核心痛点**：
- [src/llm.py:835-848 `parse_provider_model`](src/llm.py#L835) 解析 `'provider/model'`，所有 stage 共用 [src/llm.py:851 `ClientFactory.from_env()`](src/llm.py#L851) 一个 env
- 只有 Step 6 走 `resolve_summary_step_env()`（[src/main.py:402-427](src/main.py#L402)）旁路——只能配一个 stage
- 用户想让 deep dive 用 opus 但不想 enrich 也用 opus——做不到
- 没有 LLM usage 累计 / 成本可视化

**解决方案**：仿照 Polaris [E:/study/Polaris/src/backend/app/core/llm/router.py](E:/study/Polaris/src/backend/app/core/llm/router.py) `STAGES`（19 个） + `ModelRoute`（stage → (provider, model, temperature)）做精简版（DPR 实际 8 个 stage）。

---

## 2. 设计原则

1. **零破坏**：不引入 `llm_stage_models` 块时所有 stage fallback `LLM_MODEL` env
2. **吸掉 `resolve_summary_step_env` 旁路**——不再保留两条配置路径
3. **缓存 60s**（对齐 Polaris `_ROUTE_CACHE_TTL = 60s`）——in-process dict，无依赖
4. **DPR 实际只 8 个 stage**（vs Polaris 19 个），按 DPR 实际调用点命名
5. **Usage 写 JSONL**（对齐 Polaris `LLMUsage` 表字段）——`archive/llm_usage_<YYYY-MM>.jsonl`

---

## 3. 改动清单

### 新增文件

| 文件 | 行数 | 用途 |
|------|------|------|
| [src/llm_router.py](src/llm_router.py) | ~150 | `LLMRouter.resolve(stage)` + `call(stage, **kwargs)` + 60s 缓存 |
| [src/llm_usage_logger.py](src/llm_usage_logger.py) | ~80 | JSONL 追加，按月 rotate |
| [src/llm_usage_report.py](src/llm_usage_report.py) | ~60 | 按 date × stage × model 聚合 |
| [tests/test_llm_router.py](tests/test_llm_router.py) | ~100 | 单测：路由解析 + 缓存 + env fallback |
| `astro-src/lib/llm.ts` | +120 | 浏览器侧 `resolveRoute(stage)` + ROUTES 表 |

### 改动文件

| 文件 | 改动 |
|------|------|
| [src/llm.py:835-848](src/llm.py#L835) `parse_provider_model` | **不动**（router 调用它） |
| [src/llm.py:851 `ClientFactory.from_env`](src/llm.py#L851) | 改为 `from_env(stage: str = "default")`，内部走 router |
| [src/main.py:402-427](src/main.py#L402) `resolve_summary_step_env` | **删除**（被 router 吸掉） |
| [src/main.py:884-897](src/main.py#L884) Step 6 调用 | 去掉 `env=resolve_summary_step_env()` 参数 |
| [src/0.enrich_config_queries.py:19](src/0.enrich_config_queries.py#L19) | 删 `BLT_REWRITE_MODEL` env，改走 `llm_stage_models.enrich` |
| [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) | 调 `router.call("refine", ...)` |
| [src/5.select_papers.py](src/5.select_papers.py) | 调 `router.call("select", ...)`（若有 LLM call） |
| [src/6.generate_docs.py](src/6.generate_docs.py) | 调 `router.call("doc.generate", ...)` |
| [astro-src/scripts/paper-analyzer.ts](astro-src/scripts/paper-analyzer.ts) | 速读 / 精读两处调 `callChatCompletion` 改走 `resolveRoute` |
| [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts) | 5 处 LLM call 改走 `resolveRoute`（topic.facet / topic.summary / topic.report / topic.cand / topic.explore） |
| [config/config.yaml](config/config.yaml) | 新增 `llm_stage_models:` 块（示例见第 6 节） |

---

## 4. 8 个 Stage 列表（**DPR 实际 vs Polaris 19 个**）

| stage | 调用点 | DPR 默认 model | 对应 Polaris stage |
|-------|--------|----------------|---------------------|
| `enrich` | [src/0.enrich_config_queries.py:19](src/0.enrich_config_queries.py#L19) | `BLT_REWRITE_MODEL` env（删除，迁到 router） | (新, 接近 relevance) |
| `refine` | [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) | `LLM_MODEL` env | (新, 接近 forge.score) |
| `select` | [src/5.select_papers.py](src/5.select_papers.py) | `LLM_MODEL` env | (新, 接近 forge.score) |
| `doc.generate` | [src/6.generate_docs.py](src/6.generate_docs.py) | `LLM_MODEL` env | (新, 接近 librarian) |
| `analyzer.system` | [astro-src/scripts/paper-analyzer.ts:1176](astro-src/scripts/paper-analyzer.ts#L1176) | `LLM_DEFAULTS.model` ([settings.ts:85-88](astro-src/scripts/settings.ts#L85)) | (新) |
| `analyzer.deepdive` | [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) | 同上 | (新, 接近 writing) |
| `topic.facet` | [astro-src/scripts/topic-search.ts:797 `decomposeIdea`](astro-src/scripts/topic-search.ts#L797) | 同上 | (新) |
| `topic.summary` | `topic.summarizeOne` | 同上 | (新, 接近 reading) |
| `topic.report` | `topic.TOPIC_REPORT_SYSTEM` | 同上 | (新, 接近 librarian) |
| `default` | (兜底) | `LLM_MODEL` env | default |

---

## 5. Router 核心实现（`src/llm_router.py`）

```python
import os
import time
from typing import Any
from src.llm import ClientFactory, parse_provider_model

ROUTE_CACHE_TTL = 60  # 对齐 Polaris _ROUTE_CACHE_TTL = 60s

class LLMRouter:
    def __init__(self, config: dict):
        self.routes = config.get("llm_stage_models", {})
        self._cache: dict[str, dict] = {}
        self._usage_logger = None  # 懒加载

    def resolve(self, stage: str) -> dict:
        """返 {"provider_model": str, "temperature": float, "is_stream": bool}"""
        now = time.time()
        cached = self._cache.get(stage)
        if cached and now - cached["cached_at"] < ROUTE_CACHE_TTL:
            return cached["route"]

        # 对齐 Polaris 解析顺序:routes[stage] → routes["default"] → env fallback
        route = self.routes.get(stage, self.routes.get("default", {}))
        if not route:
            route = {"provider_model": os.environ.get("LLM_MODEL", "deepseek/deepseek-chat"), "temperature": 0.5}

        # 处理 ${LLM_MODEL} 占位符
        pm = route["provider_model"]
        if pm.startswith("${") and pm.endswith("}"):
            pm = os.environ.get(pm[2:-1], pm)

        resolved = {
            "provider_model": pm,
            "temperature": route.get("temperature", 0.5),
            "is_stream": stage in set(self.routes.get("stream_stages", [])),
            "cached_at": now,
        }
        self._cache[stage] = {"route": resolved, "cached_at": now}
        return resolved

    def call(
        self,
        stage: str,
        *,
        messages: list[dict],
        temperature: float | None = None,
        response_format: dict | None = None,
        stream: bool = False,
        **kwargs: Any,
    ) -> Any:
        """解析路由 + 调 LLM + 记录 usage。"""
        route = self.resolve(stage)
        provider, model = parse_provider_model(route["provider_model"])

        client = ClientFactory._create_client(
            provider, model,
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

    def _record_usage(self, stage, provider, model, temperature, response):
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
        except Exception as e:
            print(f"[WARN] usage log failed: {e}", flush=True)

    def invalidate_cache(self) -> None:
        """对齐 Polaris get_llm_router().invalidate_cache()。"""
        self._cache.clear()

# Module-level singleton（仿照 Polaris llm_admin）
_router_instance: LLMRouter | None = None

def get_llm_router(config: dict | None = None) -> LLMRouter:
    global _router_instance
    if _router_instance is None:
        from src.source_config import load_config
        cfg = config or load_config()
        _router_instance = LLMRouter(cfg)
    return _router_instance
```

---

## 6. 配置示例（`config/config.yaml` 新增块）

```yaml
llm_stage_models:
  enrich:
    provider_model: "blt/gemini-3-flash-preview"   # 解析走 src/llm.py:835 parse_provider_model
    temperature: 0.3
  refine:
    provider_model: "${LLM_MODEL}"                  # 显式回退到 env
    temperature: 0.2
  select:
    provider_model: "${LLM_MODEL}"
    temperature: 0.2
  doc.generate:
    provider_model: "${LLM_MODEL}"
    temperature: 0.5
  analyzer.system:
    provider_model: "deepseek/deepseek-chat"
    temperature: 0.5
  analyzer.deepdive:
    provider_model: "openai/gpt-4o-mini"
    temperature: 0.7
  topic.facet:
    provider_model: "${LLM_MODEL}"
    temperature: 0.4
  topic.summary:
    provider_model: "${LLM_MODEL}"
    temperature: 0.3
  topic.report:
    provider_model: "openai/gpt-4o-mini"
    temperature: 0.6
  default:
    provider_model: "${LLM_MODEL}"
    temperature: 0.5
  stream_stages:
    - "analyzer.deepdive"
    - "topic.report"
```

**`config.user.yaml` 启用示例**：

```yaml
llm_stage_models:
  analyzer.deepdive:
    provider_model: "minimax/MiniMax-M3"
    temperature: 0.7
```

**回滚**：删 `llm_stage_models` 块，所有 stage 自动回退 `LLM_MODEL` env。**不恢复** `resolve_summary_step_env`（已吸进 router）。

---

## 7. Usage 日志（**对齐 Polaris `LLMUsage` 表字段**）

**文件位置**：`archive/llm_usage_<YYYY-MM>.jsonl`（按月 rotate）

**单行 schema**：

```json
{"ts": "2026-07-21T18:30:42Z", "stage": "refine", "provider": "deepseek", "model": "deepseek-chat", "temperature": 0.2, "tokens_in": 18142, "tokens_out": 2841, "latency_ms": 1830, "cost_usd": 0.0014, "archive_date": "20260721", "user_id": "github:owner", "project_id": null, "voyage_id": null}
```

**字段名严格对齐 Polaris `LLMUsage`**：
- `stage` → `stage`
- `provider` → 自有（Polaris 不存 provider 名，只存 provider_id）
- `model` → `model`
- `tokens_in/out` → `prompt_tokens/completion_tokens`（DPR 改名方便读）
- `ts` → `created_at`
- `latency_ms` / `cost_usd` / `archive_date` → 自有扩展

### Token 估算（**对齐 Polaris `_ensure_usage` [router.py:178](E:/study/Polaris/src/backend/app/core/llm/router.py#L178)**）

```python
def _ensure_usage(usage: dict | None, prompt: str, completion: str) -> dict:
    if usage:
        return usage
    return {
        "tokens_in": len(prompt) // 4,
        "tokens_out": len(completion) // 4,
    }
```

### Usage 聚合（`src/llm_usage_report.py`）

```python
from collections import defaultdict

def aggregate(jsonl_path: str) -> dict:
    """对齐 Polaris usage_report(date × stage × model)。"""
    by_key = defaultdict(lambda: {"tokens_in": 0, "tokens_out": 0, "calls": 0, "cost_usd": 0.0})
    for line in read_jsonl(jsonl_path):
        date = line["ts"][:10]
        key = (date, line["stage"], line["model"])
        by_key[key]["tokens_in"] += line["tokens_in"]
        by_key[key]["tokens_out"] += line["tokens_out"]
        by_key[key]["calls"] += 1
        by_key[key]["cost_usd"] += line.get("cost_usd", 0.0)
    return dict(by_key)
```

---

## 8. 浏览器侧实现（`astro-src/lib/llm.ts` 增量）

```ts
const ROUTE_CACHE_TTL = 60_000;  // ms，对齐 Polaris 60s
const _routeCache = new Map<string, {route: Route, cachedAt: number}>();

interface Route {
  provider: string;
  model: string;
  temperature: number;
  isStream?: boolean;
}

const ROUTES: Record<string, Route> = {
  enrich: { provider: 'blt', model: 'gemini-3-flash-preview', temperature: 0.3 },
  analyzer_system: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.5 },
  analyzer_deepdive: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.7, isStream: true },
  topic_facet: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4 },
  topic_summary: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 },
  topic_report: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.6, isStream: true },
  default: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.5 },
};

export function resolveRoute(stage: string): Route {
  const cached = _routeCache.get(stage);
  if (cached && Date.now() - cached.cachedAt < ROUTE_CACHE_TTL) {
    return cached.route;
  }
  const route = ROUTES[stage] || ROUTES.default;
  _routeCache.set(stage, {route, cachedAt: Date.now()});
  return route;
}

export function invalidateRouteCache() {
  _routeCache.clear();
}
```

---

## 9. `resolve_summary_step_env` 删除清单

**被吸进 router 的功能**：
- `SUMMARY_MODEL` env → `llm_stage_models.doc.generate.provider_model`
- `SUMMARY_BASE_URL` env → `llm_stage_models.doc.generate` 加自定义 base 字段（v2）
- `SUMMARY_API_KEY` env → 同上

**PR-3 不引入自定义 base 字段**——保留环境变量 `LLM_BASE_URL` 全局覆盖，stage-level override 留给 v2。

**删除的代码**：[src/main.py:402-427](src/main.py#L402) 整段 `resolve_summary_step_env()` 函数 + [src/main.py:896](src/main.py#L896) `env=resolve_summary_step_env()` 参数。

---

## 10. 与 Polaris 的差异

| 维度 | Polaris | DPR PR-3 |
|------|---------|----------|
| 多 provider 抽象 | `LLMProvider` (OpenAICompat / Anthropic / Fake) | **复用现有 `ClientFactory._create_client`**（不动） |
| LLMUsage 存储 | Postgres 表 | **JSONL 文件**（按月 rotate） |
| Fernet 加密 API key | 是 | **不引入**（API key 走 GitHub Secrets） |
| 缓存 TTL | 60s | **60s**（完全相同） |
| STREAM_STAGES | 8 个 | **2 个**（`analyzer.deepdive` + `topic.report`） |
| ModelRoute 唯一性 | DB unique on stage | **YAML key 唯一** |
| Provider 缓存键 | (kind, base_url, api_key) 三元组 | **单 key `provider_model` 字符串** |
| `BLT_REWRITE_MODEL` 旁路 | 无 | **删除**（迁到 router 的 `enrich` stage） |

---

## 11. 测试方案

### 单测（`tests/test_llm_router.py`）

| # | 用例 | 期望 |
|---|------|------|
| 1 | `resolve("default")` 无 config | fallback `LLM_MODEL` env |
| 2 | `resolve("refine")` 有 config `${LLM_MODEL}` | 解析为 env 值 |
| 3 | `resolve("analyzer.deepdive")` 有 hardcoded | 返 hardcoded |
| 4 | 缓存命中 | 第二次 `resolve` 返 cached，60s 内不重读 config |
| 5 | `invalidate_cache()` 后 | 缓存清空，重新读 config |
| 6 | 未知 stage | fallback `default` |
| 7 | `${LLM_MODEL}` env 不存在 | 抛 `ValueError`（`LLM_MODEL` 必填） |
| 8 | `_ensure_usage` 估算 | tokens = chars / 4 |

### 手工测试

| # | 场景 | 期望 |
|---|------|------|
| 1 | 不配 `llm_stage_models`，跑 cron | 所有 stage 用 `LLM_MODEL` env（行为完全等同 PR-3 前） |
| 2 | 配 `analyzer.deepdive: minimax/MiniMax-M3` | 精读用 MiniMax-M3，速读仍用 deepseek |
| 3 | 跑一次 cron，`archive/llm_usage_<YYYY-MM>.jsonl` 增长 | 每行含 stage/model/tokens_in/tokens_out |
| 4 | 跑 `python -m src.llm_usage_report archive/llm_usage_2026-07.jsonl` | 输出按 (date, stage, model) 聚合表 |
| 5 | 浏览器侧 `/paper-analyzer` 点速读 | 调 deepseek-chat；点精读 | 调 minimax/MiniMax-M3（如配置） |
| 6 | 删 `llm_stage_models` 块 | router 回退 env，行为一致 |

---

## 12. 风险与回滚

| 风险 | 严重度 | 缓解 | 回滚 |
|------|--------|------|------|
| 用户配错 provider/model | 低 | `resolve()` 失败时 fallback `default`，不抛异常 | 删 `llm_stage_models` 块 |
| 路由过多导致 config 冗长 | 低 | v2 加 `inherit: true` 选项 | 同上 |
| 浏览器侧路由和 Actions 路由不一致 | 低 | README 明确两者独立配 | N/A（按预期） |
| 删 `resolve_summary_step_env` 破坏老配置 | 中 | 迁移指南：SUMMARY_* → llm_stage_models.doc.generate | 旧 env 仍可在 env 里读（router 兼容 `${LLM_MODEL}`） |
| `BLT_REWRITE_MODEL` 删除 | 低 | enrich stage 接管 | 同上 |
| Usage JSONL 体积爆炸 | 低 | 按月 rotate，100k 调用/月 ≈ 15MB | 删旧月份 |

**通用回滚**：从 `config.yaml` 删 `llm_stage_models` 块，所有 stage 自动回退 `LLM_MODEL` env。`resolve_summary_step_env` 已删除（不回滚）。

---

## 13. 验收清单

- [ ] `src/llm_router.py` + `src/llm_usage_logger.py` + `src/llm_usage_report.py` 全部存在
- [ ] 单测 8 个 case 全过
- [ ] 默认无 `llm_stage_models` 配置时 `main()` 行为完全等同 PR-3 前
- [ ] `llm_stage_models.analyzer.deepdive` 配为 minimax 时浏览器侧精读用 MiniMax-M3
- [ ] `resolve_summary_step_env` 函数已删除
- [ ] `BLT_REWRITE_MODEL` env 已删除
- [ ] `archive/llm_usage_<YYYY-MM>.jsonl` 正常追加
- [ ] `python -m src.llm_usage_report` 正确聚合
- [ ] PR-4 可以读到 `route()` 结果

---

## 14. Effort 估算

| 工作项 | 预估工时 |
|--------|---------|
| `src/llm_router.py` + 60s 缓存 | 1 天 |
| `src/llm_usage_logger.py` + JSONL rotate | 0.5 天 |
| `src/llm_usage_report.py` 聚合 | 0.3 天 |
| `src/llm.py` 改 `from_env(stage="default")` | 0.2 天 |
| `src/main.py` 删 `resolve_summary_step_env` + Step 6 调用 | 0.2 天 |
| `src/0.enrich_config_queries.py` 删 `BLT_REWRITE_MODEL` | 0.1 天 |
| 4 处 Python 调用点改 `router.call(stage, ...)` | 0.3 天 |
| `astro-src/lib/llm.ts` `resolveRoute` | 0.5 天 |
| 浏览器侧 8 处调用点改 `resolveRoute` | 0.5 天 |
| 单测 | 1 天 |
| 手工测试 + 修复 | 0.5 天 |
| **合计** | **5.1 天（≈ 1.5 周）** |