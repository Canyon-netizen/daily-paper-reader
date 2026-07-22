# Polaris 能力吸收迁移指南

**状态**: 8 个 PR 已全部 landed(代码完成)。本文是用户视角文档,**不重复 plan 文档**([plans/polaris-absorption.md](../plans/polaris-absorption.md)),只回答:

1. 这 7 个能力**已经做了什么**、**默认开/关**、**怎么开/怎么关**
2. 每个能力**会读/写哪些文件**、**JSON 形态长什么样**
3. **怎么回滚**(出问题怎么关掉)
4. **和 plan 的偏离**(代码跟 plan 描述不一致的地方)

适用范围:daily-paper-reader 单用户仓库,零服务器(GitHub Actions + Supabase + 浏览器 LLM)部署模型。

---

## TL;DR — 一页纸速查

| # | 能力 | 默认 | 开关 | 关闭后行为 |
|---|---|---|---|---|
| 1 | Pipeline Checkpoint | OFF | `pipeline.checkpoints.enabled` | 不读写 `.checkpoints/`,sub-step 总重跑 |
| 2 | Sextant Validate | OFF | `pipeline.validate.enabled` | 不跑 6 维核查,subprocess exit code 唯一判据 |
| 3 | LLM Stage Routing | **总是 on** | `llm_stage_models` 块(可不写) | 不写时所有 stage 走 `LLM_MODEL` env 单值 |
| 4 | Prompt Packs | OFF | `prompt_packs.enabled` + `prompt_packs.active.<target>` | 走硬编码 const(`SYSTEM_PROMPT` / `DEEPDIVE_SYSTEM_PROMPT`) |
| 5 | Concept Backlinks | OFF | `concepts.enabled` | 不调 LLM 提概念,frontmatter 不写 `wiki_compiled`/`concepts` |
| 6 | Topic v2 辩论 | OFF | `topic.v2.enabled` | v1 流程(纯 LLM 排序),`renderDebateStageSafe` no-op |
| 7 | Citation Guard | OFF | `citation_guard.enabled` | Deep Dive 不写 `*.citations.json`,`save-paper.yml` 不调 guard |

**通用回滚**:任何能力出问题,把对应 `*.enabled` 设回 `false` 即可。**零感知升级** — 老用户 cron 不会自动开启任何新能力。

**最低侵入启用**(推荐第一次尝鲜):

```yaml
# config.user.yaml — 只开 1-2 个,跑 1 周稳定再加
pipeline:
  checkpoints: { enabled: true }     # PR 1
  validate: { enabled: true }        # PR 2
citation_guard:
  enabled: true                     # PR 7 — 需要 S2/OpenAlex 公开 API,无 key
```

---

## PR 1: Pipeline Checkpoint

**目的**: 18 个 sub-step 的断点续跑 + 状态机骨架。出问题时不必从 Step 1 重跑。

### 开关

`config.user.yaml`:

```yaml
pipeline:
  checkpoints:
    enabled: true   # 默认 false
```

未启用时 [src/main.py:165](src/main.py#L165) `pipeline_checkpoints_enabled()` 返 False,`run_step_with_checkpoint` 走 fallback 到原始 `run_step()`,**无 IO 开销**。

### 文件位置

```
archive/<run_date_token>/.checkpoints/<step_id>.json   # 状态文件
archive/<run_date_token>/.checkpoints/<step_id>.lock   # flock 并发锁
```

`<run_date_token>` 形如 `20260722`。`<step_id>` 形如 `4.1.llm_refine`、`6.2.docs.generate_paper_md.<arxiv_id>`(per-paper 段带后缀)。

### JSON 形态

```json
{
  "step_id": "4.1.llm_refine",
  "step_type": "llm_refine",
  "seq": 1,
  "rank": 4,
  "sub_rank": 1,
  "status": "succeeded",
  "started_at": "2026-07-22T10:30:42Z",
  "finished_at": "2026-07-22T10:31:08Z",
  "attempts": 1,
  "observation": { "input_hash": "sha256:...", "input_count": 47, "output_count": 31 },
  "verdict": null,
  "tokens": null,
  "provenance": null,
  "on_failure": "mark_needs_review",
  "wrapup": false
}
```

`status` 状态机: `pending` → `running` → `succeeded` / `failed` / `skipped`。

### 实现细节

- **原子写**: `mkstemp` + `os.replace`(仿 [src/generate_docs_md_io.py:28-47](src/generate_docs_md_io.py#L28) `atomic_write_text` 模式)
- **并发锁**: `fcntl.flock(LOCK_EX)`(Linux/macOS),Windows 降级 no-op(GH Actions ubuntu-latest 始终可用)
- **损坏降级**: 读 JSON 失败返 `None`,视为未跑(下次 cron 重跑)
- **PR 1 不引入自动重试**:`attempts` 累加但失败不重跑(失败由 `on_failure` 决策)

### 18 个 sub-step 表

详见 [src/pipeline_v2/state.py](src/pipeline_v2/state.py) `STEP_REGISTRY`。`6.2-6.4` 是 per-paper 的(`process_paper` 内部循环),checkpoint ID 运行时拼接 arxiv_id 后缀。

### 回滚

```yaml
pipeline:
  checkpoints: { enabled: false }
```

`.checkpoints/` 子目录保留无害 — 启用时自动续用旧状态。

### 风险

- GH Actions kill 时 `.lock` 残留 → flock 自带释放(进程死 = fd 关 = 锁释),无需 TTL 清理
- 删错 checkpoint 等于跳过未跑步骤 — **不要**手动 `rm` 单个 `<step_id>.json`

---

## PR 2: Sextant Validate

**目的**: 把"subprocess returncode == 0 即通过"升级到 6 维确定性核查。可选叠加 LLM rubric。

### 开关

```yaml
pipeline:
  validate:
    enabled: true
    contracts_dir: "src/validate/contracts"
    failure_handling: "mark_needs_review"  # 或 abort / clamp
    rubric_enabled: false                  # 慎开:每 step 多一次 LLM call
```

### 6 维 check 类型

| kind | 含义 | 失败时 default action |
|---|---|---|
| `no_error` | observation.error 短路 | abort |
| `exit_code` | subprocess exit code | abort |
| `artifact_exists` | 指定路径文件存在 | abort |
| `schema_valid` | JSON 输出含必需 keys | mark_needs_review |
| `min_count` | 列表/记录数 ≥ 阈值 | mark_needs_review |
| `metric` | 数值满足 op(>= / <= / > / < / ==) | clamp(截到合理范围) |
| `llm_rubric` | LLM 评估产物质量 | mark_needs_review |

对齐 Polaris `DETERMINISTIC_CHECK_KINDS`([sextant.py:47-101](../polaris/src/backend/app/agents/voyage/sextant.py#L47))。**DPR v1 不引入 `observation.error` 短路** — 所有失败走完整 6 维检查。

### contracts 文件

`src/validate/contracts/<step_id>.schema.json` — 每 step 一份契约,声明本 step 的 `checks` 数组:

```json
{
  "step_id": "4.1.llm_refine",
  "checks": [
    { "kind": "no_error" },
    { "kind": "exit_code", "value": 0 },
    { "kind": "artifact_exists", "key": "archive/20260722/rank/arxiv_papers_20260722.llm.json" },
    { "kind": "schema_valid", "field": "records", "required_keys": ["paper_id", "llm_score", "reasoning"] },
    { "kind": "min_count", "field": "records", "value": 20 }
  ]
}
```

### `verify()` 入口

```python
from src.validate import verify
verdict = verify(step_id="4.1.llm_refine", output_path=Path("..."), exit_code=0, acceptance=...)
# → {"passed": bool, "reason": str, "rubric_passed": bool|None}
```

### 失败处理策略

- `failure_handling: abort` — 立即停 cron,exit 非 0
- `failure_handling: mark_needs_review` — 写标记,继续走(默认)
- `failure_handling: clamp` — 数值越界截断,继续走

### 回滚

```yaml
pipeline:
  validate: { enabled: false }
```

`src/generate_docs_md_io.py:50-78` 的 `verify_paper_md_was_written` 保留作为兜底(`no_error + artifact_exists + min_size`)。

### 风险

- LLM rubric 增成本 → **默认 `rubric_enabled: false`**(只跑确定性 6 维)
- Schema 收紧太严老 archive 不通过 → schema 加 `version` 字段,旧文件不阻断

---

## PR 3: LLM Stage Routing

**目的**: 不同 stage(enrich / refine / deepdive / topic report 等)走不同 (provider, model, temperature)。取代 `LLM_MODEL` 单值 env。

### 开关

`config.yaml` 的 `llm_stage_models:` 块是**完全可选**。不写时所有 stage fallback `LLM_MODEL` env(`src/llm_router.py:60-63`)。

启用 = 显式写该块:

```yaml
llm_stage_models:
  enrich:           { provider_model: "blt/gemini-3-flash-preview",  temperature: 0.3 }
  refine:           { provider_model: "${LLM_MODEL}",                temperature: 0.2 }
  select:           { provider_model: "${LLM_MODEL}",                temperature: 0.2 }
  doc.generate:     { provider_model: "${LLM_MODEL}",                temperature: 0.5 }
  analyzer.system:  { provider_model: "deepseek/deepseek-chat",      temperature: 0.5 }
  analyzer.deepdive:{ provider_model: "openai/gpt-4o-mini",          temperature: 0.7 }
  topic.facet:      { provider_model: "${LLM_MODEL}",                temperature: 0.4 }
  topic.summary:    { provider_model: "${LLM_MODEL}",                temperature: 0.3 }
  topic.report:     { provider_model: "openai/gpt-4o-mini",          temperature: 0.6 }
  default:          { provider_model: "${LLM_MODEL}",                temperature: 0.5 }
  stream_stages:    [analyzer.deepdive, topic.report]
```

`${LLM_MODEL}` 占位符运行时从 env 解析。env 缺失抛 `ValueError`(显式 fail-fast)。

### 解析顺序(对齐 Polaris `router.py:142-146`)

```
routes[stage] → routes["default"] → env LLM_MODEL fallback
```

### 缓存

60s in-process dict cache(`ROUTE_CACHE_TTL = 60`)。改 config 后调 `reset_router_for_tests()` 或重启进程。

### Stage 列表

8 个 stage:

| stage | 调用点 |
|---|---|
| `enrich` | [src/0.enrich_config_queries.py](src/0.enrich_config_queries.py) |
| `refine` | [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) |
| `select` | [src/5.select_papers.py](src/5.select_papers.py) |
| `doc.generate` | [src/6.generate_docs.py](src/6.generate_docs.py) |
| `analyzer.system` | [astro-src/scripts/paper-analyzer.ts:1176](astro-src/scripts/paper-analyzer.ts#L1176) |
| `analyzer.deepdive` | [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) |
| `topic.facet` | [astro-src/scripts/topic-search.ts:797](astro-src/scripts/topic-search.ts#L797) `decomposeIdea` |
| `topic.summary` / `topic.report` / `topic.debate` | topic 模式内 |
| `default` | 兜底 |

### Usage 日志

每次调用追加到 `archive/llm_usage.jsonl`:

```jsonl
{"ts": "2026-07-22T10:30:42Z", "stage": "refine", "provider": "deepseek", "model": "deepseek-chat", "temperature": 0.2, "tokens_in": 18142, "tokens_out": 2841, "latency_ms": 1830, "cost_usd": 0.0014, "archive_date": "20260722"}
```

字段名对齐 Polaris `LLMUsage` 表。月聚合用 `python -m src.llm_usage_report`。

### 浏览器侧

[astro-src/lib/llm.ts](astro-src/lib/llm.ts) `resolveRoute(stage)` 与后端同构,独立 60s 缓存。**两套配置独立**(`config.yaml` 控 Actions,`dpr-config.json` 控浏览器)。

### 回滚

```yaml
# 删除 llm_stage_models 块(整块)
```

所有 stage 自动回退 `LLM_MODEL` env。**不恢复** [src/main.py:402-427](src/main.py#L402) `resolve_summary_step_env` 旁路(已吸进 router 后删除)。

### 风险

- 路由配错 model 名 → `resolve()` 失败回退 `default`,不抛异常
- Usage JSONL 体积爆炸 → 按月 rotate(目前未自动 rotate,100k calls × ~150B ≈ 15MB/月,可控)

---

## PR 4: Prompt Packs

**目的**: 可版本化的 prompt 模板,用户不 fork 代码就能换"NeurIPS 风格"/"ACL 风格"/"中文期刊风格"。

### 开关

```yaml
prompt_packs:
  enabled: false          # 默认关闭
  taxonomies_version: "2026-07-01"
  active:
    refine: null          # null = 走硬编码 const
    select: null
    doc.generate: null
    analyzer.system: null
    analyzer.deepdive: null
    topic.facet: null
    topic.cand: null
    topic.explore: null
    topic.summary: null
    topic.report: null
```

启用某 target:`active.<target>: "<pack_id>:<version>"`(例 `"nips-style:2026-07-15"`)

### Pack 目录结构

```
config/prompts/<pack_id>/<version>/
├── manifest.json
├── body.md
└── examples.jsonl         # 可选
```

**Pack ID 是目录名,version 是日期字符串(`YYYY-MM-DD`)**,而非 Polaris 的 int 版本号。

### manifest.json 样例

```json
{
  "pack_id": "nips-style",
  "version": "2026-07-15",
  "display_name": "NeurIPS 风格中文速读",
  "kind": "guidance",
  "targets": ["refine", "select", "doc.generate", "analyzer.system"],
  "body_file": "body.md",
  "examples_file": "examples.jsonl",
  "output_contract": "schemas/nips_skim_record.schema.json",
  "config": { "citation_style": "numbered", "max_chars": 2000 },
  "metadata": {
    "author": "maintainer",
    "created_at": "2026-07-15T00:00:00Z",
    "tags": ["neurips", "english-source", "cv"],
    "rating": 4.7
  }
}
```

### 加载机制

[src/prompt_pack.py](src/prompt_pack.py) `Pack.load(dir_path)`。失败 graceful fallback:

```python
from src.prompt_pack import inject_into_prompt
# 找不到 pack → 返 None → caller 走硬编码 const
```

对齐 Polaris `_TARGET_BUDGET_CHARS = 24000` — body + system_prompt 超过 24000 char 截断。

### Taxonomy 兼容

manifest 加载时校验 `taxonomies_version`。Pack body 引用的 category 词汇必须尊重 [src/taxonomy.py:14-18](src/taxonomy.py#L14) + [astro-src/lib/taxonomies.ts:21](astro-src/lib/taxonomies.ts#L21) + [config/taxonomies.json](config/taxonomies.json) 4-dim allowlist。

### Gist 同步

Gist key `dpr_prompt_packs_v1`(仿 [astro-src/scripts/settings.ts:574](astro-src/scripts/settings.ts#L574) `GIST_FILENAME='dpr-config.json'` + [settings.ts:12-21](astro-src/scripts/settings.ts#L12) `STORAGE_KEYS.*` 模式)。

### 回滚

```yaml
prompt_packs:
  active:
    refine: null    # 单 target 回退到硬编码 const
```

### 风险

- 用户随便写 pack 污染 prompt — `src/prompt_pack.py::_validate_manifest` 强制 manifest 字段
- Pack body 引用不存在 taxonomy 词汇 — `requires_taxonomies_version` 加载时校验
- 多个 pack 注入同一 target — `active.<target>` 只支持单 pin;`stack.<target>: [a, b, c]` v2 才支持

---

## PR 5: Concept Backlinks

**目的**: 论文笔记之间用概念图谱关联(`[[Concept]]` wikilink + `wiki/concepts/<slug>.md`),Obsidian/VSCode 渲染双向链接。

### 开关

```yaml
concepts:
  enabled: false                  # 默认关闭
  min_appearances: 2              # ≥2 篇出现才建独立 md
  max_concepts_per_paper: 7
  blacklist_file: "config/concept_blacklist.yaml"
  aliases_file: "config/concept_aliases.yaml"
  category_enum: [method, architecture, methodology, problem, metric, dataset, other]
  slug_pattern: "^[a-z0-9-]+$"
```

### 启用后行为

1. **Step 6 多调一次 LLM**(stage `concept.extract`)— 提取 3-7 个核心概念
2. **每篇 md frontmatter 追加 3 个字段**:
   ```yaml
   wiki_compiled: true
   wiki_compiled_at: "2026-07-22T10:30:00Z"
   concepts:
     - slug: retrieval-augmented-generation
       display_name: "Retrieval-Augmented Generation (RAG)"
       category: methodology
       novelty: 0.0
       centrality: 0.85
   ```
3. **`wiki/concepts/<slug>.md` 目录**自动生成/更新,含出处论文列表 + 反向链接
4. **新增页面** `/concepts`([astro-src/pages/concepts.astro](astro-src/pages/concepts.astro)) — 网格视图,可按"近 30 天热度"排序

### 7 类别枚举

对齐 Polaris `concepts.py:250-401` 7 类:`method / architecture / methodology / problem / metric / dataset / other`。

### Slug 算法

复用 Polaris `wiki_slug`([concepts.py:75](../polaris/src/backend/app/services/concepts.py#L75)):`name.lower()` 后非 word/非 CJK 字符塌缩为 `-`,空则回落 `sha256(name)[:12]`。

### `[[concept]]` 反向链接

复用 Polaris `WIKILINK_RE`([concepts.py:28](../polaris/src/backend/app/services/concepts.py#L28)):

```
[[Concept]] / [[Concept|alias]] / [[Concept#anchor]]
```

Embed mark `![[fig:N]]` 自动跳过。

### 回滚

```yaml
concepts:
  enabled: false
```

- 已生成的 `wiki/concepts/*.md` 保留(只是不再被引用)
- 已 wiki 化的 md `wiki_compiled: true` 不清
- 用户想清理手动 `rm -rf wiki/concepts/`

### 风险

- LLM 编造伪概念("FakeRAG") — `slug_pattern` + `blacklist_file`(100+ 词)+ `min_appearances: 2`
- 概念碎片化("RAG" vs "retrieval-augmented generation") — `aliases_file` 强制合并
- 文档库爆炸 — `min_appearances: 2` 限制

---

## PR 6: Topic v2 辩论

**目的**: Topic 模式加 Elo 辩论排序,挑出最有价值的 idea 优先精读。

### 开关

```yaml
topic:
  v2:
    enabled: false        # 默认关闭
    elo_k: 32              # K=32, 对齐 Polaris
    elo_initial: 1200      # 初始 1200, 对齐 Polaris
    debate_rounds: 3
    debate_max_ideas: 8    # 限制前 8 名参与
    budget_tokens: 800000
    personas: ["方法论者", "工程师", "怀疑论者"]
    hole_top_concepts: 8
    hole_max_pairs: 5
    trend_window_days: 90
    trend_max: 5
    dedup_threshold: 0.85
```

### 启用后行为

- Topic 模式 `renderSummaryStage` → `renderReportStage` 之间插入 `renderDebateStageSafe`([astro-src/scripts/topic-search.ts:2652](astro-src/scripts/topic-search.ts#L2652))
- 实际逻辑在 [astro-src/scripts/topic-search-v2.ts](astro-src/scripts/topic-search-v2.ts):
  - `judge(a, b, persona)` → 调 LLM(`resolveRoute('topic.debate')`)返 `'a' | 'b' | 'tie'`
  - `elo(rating_a, rating_b, winner)` → 标准 Elo 公式,K=32
  - Swiss 风格配对(按当前 elo 排序相邻配对)
  - 进度写 `localStorage['dpr_topic_session_v1'].debate_progress`
- **可视化**: `[session_id]/debate.astro` 页 + 简化排行(纯文本列表)
- **page URL**: `/topics/<session_id>/debate`

### 与 plan 的偏离(重要!)

[plans/polaris-absorption.md §14](plans/polaris-absorption.md) 估的 PR 6 是 1400 LOC,实际是 **282 LOC**(commit [7e4d5b0](.) + [747e3a1](.))。偏离项:

| plan 描述 | 实际实现 | 影响 |
|---|---|---|
| 4 信号采集(concept_holes / trends / limitations / survey_gap) | **未做** — [src/idea_signals.py](src/idea_signals.py) 是空架子 | 没法发现"研究缺口",只能 pairwise 排名现有 idea |
| Swiss 风格配对 | ✅ 做了 | — |
| Elo K=32 / initial 1200 / per-match-failure isolation | ✅ 做了 | — |
| archive/`<session>`/ideas/ 文件落盘 | **未做** — 仅 localStorage | 跨 session 不复用 |
| archive/`<session>`/debate/ transcript 落盘 | **未做** | 浏览器断电即丢 |
| persona 气泡 + 进度条 + Elo 排行榜可视化 | **简化版** — 纯文本排行,无进度条 | UX 简陋 |
| 单独辩论页 `/topics/`<session_id>`/debate` | ✅ 做了(壳子 page) | — |

**结论**: PR 6 是"v2 雏形"(核心 Elo + 钩子到位),不是 plan 描述的完整 4 信号 + 文件落盘 + 真可视化版。**未来想做完整版,得在这 282 LOC 上扩**,不是重写。

### 回滚

```yaml
topic:
  v2: { enabled: false }
```

`renderDebateStageSafe` 立即 no-op([topic-search-v2.ts:51](astro-src/scripts/topic-search-v2.ts#L51))。不修改 [topic-search.ts](astro-src/scripts/topic-search.ts) 现有代码。

### 风险

- LLM judge 引入 8 ideas × 3 rounds × 3 personas = 72+ LLM calls — `debate_max_ideas: 8` + `budget_tokens: 800000`
- 浏览器侧 debate 状态断电丢失 — 仅 localStorage(刷新不丢,清缓存丢)
- localStorage 大小 — `PER_SESSION_BYTES_LIMIT = 800KB`([topic-search.ts:85](astro-src/scripts/topic-search.ts#L85))

---

## PR 7: Citation Guard

**目的**: Deep Dive 8 章节的引用核查,LLM 编造的引用自动替换为 `[?]`,产物 `*.citations.json`。

### 开关

```yaml
citation_guard:
  enabled: false
  sources: ["semantic_scholar", "openalex", "in_library"]
  fabricated_action: "replace_with_question_mark"   # 或 remove / mark_only
  run_support_check: false                            # 默认关闭(LLM 评估 support 太贵)
  exact_similarity: 0.92                              # 对齐 Polaris EXACT_SIMILARITY
  minor_similarity: 0.75                              # 对齐 Polaris MINOR_SIMILARITY
  year_tolerance: 1                                   # 对齐 Polaris YEAR_TOLERANCE
  pass_rating: 6.0
  max_support_checks: 30
  s2_rate_limit_per_min: 100
  s2_retry_max: 5
```

### 三态存在性

对齐 Polaris `classify_fuzzy_hits`([paper_review.py:222-242](../polaris/src/backend/app/services/paper_review.py#L222)):

```
similarity >= 0.92 + year_tolerance  → exact
similarity >= 0.75                    → minor
otherwise                              → fabricated
```

### 三源核查顺序

1. **in_library** — 扫 `docs/papers/**/*.md` frontmatter,匹配 paper_id
2. **semantic_scholar** — `https://api.semanticscholar.org/graph/v1/paper/search?query=...`(公开 API,无 key)
3. **openalex** — `https://api.openalex.org/works?search=...`(polite pool,无需 mailto)

### CLI

```bash
python -m citation_guard docs/papers/2026/07/22/2510.18483v1-starbench-rpg.md
# 写出 2510.18483v1-starbench-rpg.citations.json
# 退出码: 0=pass / 1=调用错误 / 2=pass=false(fabricated > 0)
```

### 产物 JSON 形态

```json
{
  "paper_id": "2510.18483v1",
  "verified_at": "2026-07-22T20:00:00Z",
  "pass": false,
  "pass_rating": 6.0,
  "summary": {
    "total": 7, "exact": 5, "minor": 1, "fabricated": 1,
    "supported": 4, "partial": 1, "unsupported": 0, "not_checked": 2
  },
  "citations": [
    {
      "marker": "[5]",
      "raw_text": "Smith 2023, A New Method for X",
      "existence": "fabricated",
      "match": null,
      "reason": "[existence] S2+OpenAlex+library 三源未找到匹配"
    }
  ],
  "fabricated_action": "replace_with_question_mark"
}
```

### Pass 判定(对齐 Polaris `review_passed`)

```
pass = (no fabricated) AND (supported / checked) >= PASS_RATING / 10 = 0.6
```

### `save-paper.yml` 自动跑

用户在浏览器保存精读后,GitHub Action 自动调 `citation_guard` CLI,产物 commit 回仓库。

### 回滚

```yaml
citation_guard: { enabled: false }
```

已存在的 `*.citations.json` 保留(下次启用可增量更新)。

### 风险

- S2 API 限流(429)— 指数退避 1/2/4/8/16s,最多 5 次
- `minor` 引用(年份差 1)— v1 视为 `exact`,仅 `fabricated` 标红
- `NUMBER_TOLERANCE=0.01` markdown 上下文不直接适用 — v1 跳过 number check,只做 existence + support
- Proxy rate limit 30/分钟([functions/api/proxy.ts:43-80](functions/api/proxy.ts#L43))— Citation Guard 默认走 GH Actions CLI,不通过浏览器

---

## 与 plan 文档的总偏离

[plans/polaris-absorption.md](../plans/polaris-absorption.md) 是设计文档,本文是落地状态。**实际 LOC 比 plan 估的少约 40%**,主要因为:

- PR 6 大幅简化(plan 估 1400 LOC → 实际 282,见下文偏离表)
- 部分能力删掉了 plan 里描述但未真正实现的细节(如 `observation.error` 短路、`BLT_REWRITE_MODEL` 旁路、`resolve_summary_step_env` 旁路 — 已吸进 router)
- 没有引入 Polaris 的 Postgres / pgvector / Yjs CRDT / MCP — 这符合 plan 第 1240 行"不吸收清单"

**所有 plan 的"不吸收清单"仍生效** — 不引入多用户 / RBAC / SSH Experiment Lab / Yjs / Voyage 实时 UI / MCP Tool Registry / Plan 动态编辑 / 人工 gate。

---

## PR 6 v2 完整化(2026-07-22)

之前 PR 6 的实现只覆盖了 plan §14 的 ~30%(Elo 引擎 + 简化可视化)。本次 commit 把 plan 偏离项**实质性回填**:

| plan §14 描述 | v1 状态(282 LOC) | v2 完整化后 | 实现位置 |
|---|---|---|---|
| 4 信号采集(concept_holes/trends/limitations/survey_gap) | 函数存在但**不被调用** | ✅ 修 mojibake + 加 `concept_paper_map` + Swiss 排序 + limitation 段落扫描 | [src/idea_signals.py](../src/idea_signals.py) |
| orchestrator 入口 | ❌ 无 | ✅ `run_topic_v2(session_id, judge_llm_call)` 串 signals→ideas→debate→archive | [src/topic_v2.py](../src/topic_v2.py) |
| `archive/<session_id>/debate/idea_<id>.json` 落盘 | ❌ 无 | ✅ 每个 idea 单独 JSON | [src/topic_v2.py](../src/topic_v2.py) `_write_json` |
| Swiss 配对(elo 降序相邻) | TS 用相邻配对,**未排序** | ✅ Python + TS 都按 elo 降序排序后相邻配对 | [src/elo_debate.py:swiss_pairs](../src/elo_debate.py) + [topic-search-v2.ts:swissPairs](../astro-src/scripts/topic-search-v2.ts) |
| per-match failure isolation | TS 有 try/catch | ✅ Python + TS 双实现,transcript 累积,`failed=true` 不阻塞 | [src/elo_debate.py:run_match](../src/elo_debate.py) |
| judge persona 判定 | TS 单 prompt | ✅ Python `judge_debate(a, b, judge_llm_call)` 接口,3 persona 分工(对齐 Polaris DEFAULT_PERSONAS) | [src/elo_debate.py:DEFAULT_PERSONAS](../src/elo_debate.py) |
| budget_tokens 控制 | ❌ 无 | ✅ `run_debate` 用 `TOKENS_PER_MATCH_CALL * matches` 累计,超 `budget_tokens` 提前结束 | [src/elo_debate.py:run_debate](../src/elo_debate.py) |
| Elo K=32 / initial 1200 | ✅ | ✅ 不变(常量对齐) | 两端一致 |
| 真可视化(persona 气泡 + 进度条 + 排行榜) | 纯文本排行 | ✅ persona 气泡(`.topic-debate-bubble--{pro/con/judge}`)+ progress bar + leaderboard table + 每场对局明细 | [topic-search-v2.ts:showDebateVisualization](../astro-src/scripts/topic-search-v2.ts) |
| `#debate-stage` DOM 容器 | ❌ 无(v1 fallback 到 `#status-bar`) | ✅ topic.astro 加 stage 4.5 `<details id="stage-debate">` | [astro-src/pages/topic.astro](../astro-src/pages/topic.astro) |
| `TopicSession.debateProgress` 回写 | ❌ 字段存在但从不写 | ✅ `renderDebateStageSafe` 同步 localStorage → current session | [astro-src/scripts/topic-search.ts:renderDebateStageSafe](../astro-src/scripts/topic-search.ts) |
| innerHTML XSS 防护 | ❌ 直插未转义 | ✅ `escapeHtml()` 函数全链路 | [topic-search-v2.ts:escapeHtml](../astro-src/scripts/topic-search-v2.ts) |
| `s.title` undefined bug | ❌ Summary 没顶层 title | ✅ `s.summary?.title || s.title || s.arxivId` | [topic-search.ts:renderDebateStageSafe](../astro-src/scripts/topic-search.ts) |
| 跨语言一致性 | ❌ Python/TS 行为可能分歧 | ✅ `tests/test_idea_signals.py` + `tests/test_elo_debate.py` + `tests/test_topic_v2.py` 覆盖 Python;TS 端导出 `__testing__` 给 .test.ts 用 |

**新增**:
- `src/topic_v2.py` — 离线批处理 orchestrator,可由 `python -m src.topic_v2 [session_id]` 跑
- `tests/test_topic_v2.py` — 5 个单测覆盖完整流程

**测试状态**: Python 端 `tests/test_idea_signals.py` + `tests/test_elo_debate.py` + `tests/test_topic_v2.py` 通过。TS 端 `.test.ts` 框架已就位(见 `tests/test_paper_dedup.test.ts`),`topic-search-v2.ts` 的 `__testing__` export 提供 `expectedScore/updateElo/swissPairs/runMatch` 给 cross-language parity 测试用。

---

## 通用回滚策略

| 场景 | 操作 |
|---|---|
| 启用某能力后 cron 报错 | `*.enabled: false`,老 archive 目录结构无变化 |
| 想换 model / provider | 改 `llm_stage_models.<stage>.provider_model`,无需重启(60s 内生效) |
| 想换 prompt 风格 | 改 `prompt_packs.active.<target>` pin |
| 引用核查误报 | `citation_guard.fabricated_action: "mark_only"` |
| 概念图谱污染 | `concepts.enabled: false` + 手动 `rm -rf wiki/concepts/` |
| Topic 辩论卡住 | `topic.v2.enabled: false`,刷新页面 |
| checkpoint 文件损坏 | 删对应 `.checkpoints/<step_id>.json`,下次 cron 重跑 |

**永远不要**:
- 手动改 `archive/<date>/.checkpoints/*.json` 的 `status` 字段
- 删除单个 `<step_id>.json` 之外的 `.checkpoints/` 内容(`.lock` 文件由 flock 管理,删了立刻被重建)
- 把 `enabled: true` 当默认 — 升级时永远是 `false`,**用户主动开启**

---

## 验证清单(第一次启用)

1. `pipeline.checkpoints.enabled: true` → 跑一次 cron → 检查 `archive/<date>/.checkpoints/4.1.llm_refine.json` 存在且 `status=succeeded`
2. `pipeline.validate.enabled: true` → 同上 → 检查 verdict 字段非 null
3. `llm_stage_models.<stage>.provider_model` 改值 → 下次 cron 该 stage usage 日志 model 变化
4. `prompt_packs.active.refine: "default:2026-07-01"` → Step 4 refine 行为变化(对比 output diff)
5. `concepts.enabled: true` → 跑 cron → `docs/papers/.../xxx.md` 出现 `wiki_compiled: true`,`wiki/concepts/` 目录新增文件
6. `topic.v2.enabled: true` → 浏览器 Topic 模式 → 看到 Elo 排行列表
7. `citation_guard.enabled: true` → 浏览器精读 → 看 `*.citations.json` 出现,fabricated 引用替换为 `[?]`

---

## 文件索引

### 新增的 Python 模块
- [src/pipeline_v2/checkpoint.py](src/pipeline_v2/checkpoint.py) — PR 1
- [src/pipeline_v2/state.py](src/pipeline_v2/state.py) — PR 1
- [src/validate/__init__.py](src/validate/__init__.py) — PR 2
- [src/validate/checks.py](src/validate/checks.py) — PR 2
- [src/llm_router.py](src/llm_router.py) — PR 3
- [src/llm_usage_logger.py](src/llm_usage_logger.py) — PR 3
- [src/llm_usage_report.py](src/llm_usage_report.py) — PR 3
- [src/prompt_pack.py](src/prompt_pack.py) — PR 4
- [src/concept_slug.py](src/concept_slug.py) — PR 5
- [src/concept_extractor.py](src/concept_extractor.py) — PR 5
- [src/concept_index.py](src/concept_index.py) — PR 5
- [src/elo_debate.py](src/elo_debate.py) — PR 6
- [src/idea_signals.py](src/idea_signals.py) — PR 6
- [src/topic_v2.py](src/topic_v2.py) — PR 6 v2 完整化(orchestrator)
- [src/citation_guard.py](src/citation_guard.py) — PR 7

### 新增的前端模块
- [astro-src/scripts/topic-search-v2.ts](astro-src/scripts/topic-search-v2.ts) — PR 6
- [astro-src/pages/topics/[session_id]/debate.astro](astro-src/pages/topics/%5Bsession_id%5D/debate.astro) — PR 6
- [astro-src/pages/concepts.astro](astro-src/pages/concepts.astro) — PR 5

### 改动的核心文件
- [src/main.py](src/main.py) — PR 1(`run_step_with_checkpoint` + `pipeline_checkpoints_enabled`), PR 3(删 `resolve_summary_step_env`)
- [src/llm.py](src/llm.py) — PR 3(`ClientFactory.from_env` 接 router)
- [src/4.llm_refine_papers.py](src/4.llm_refine_papers.py) — PR 3(stage='refine'), PR 4(pack 注入)
- [src/6.generate_docs.py](src/6.generate_docs.py) — PR 5(concept 提取 hook)
- [astro-src/scripts/paper-analyzer.ts](astro-src/scripts/paper-analyzer.ts) — PR 3(stage='analyzer.*'), PR 4(pack 注入)
- [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts) — PR 6(`renderDebateStageSafe` 钩子)
- [config.yaml](config.yaml) — 7 个新顶层块
- [.github/workflows/save-paper.yml](.github/workflows/save-paper.yml) — PR 7(自动调 citation_guard)
- [functions/api/proxy.ts](functions/api/proxy.ts) — PR 7(S2/OpenAlex 加入 allow-list)

### 没改动的(plan 明确不吸收)
- 不引入 Polaris `src/backend/` 任何模块作为依赖
- 不引入 Postgres / pgvector / Yjs / MCP / SSH 远程执行
- 不引入 Voyage 实时 UI(Navigator 面板 / Sextant 红绿灯)
