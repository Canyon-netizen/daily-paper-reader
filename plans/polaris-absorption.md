# 让 daily-paper-reader 囊括 Polaris 的核心能力

## 摘要（一段话讲清楚目标）

`daily-paper-reader`（以下简称 DPR）目前是一条基于 GitHub Actions + Supabase + 浏览器 LLM 的"零服务器"流水线，每天抓取/打分/筛选 arXiv 论文并生成中文速读笔记；它缺的是 Polaris 那种"目标驱动、能自我核查、能从文献沉淀概念图谱"的研究循环能力。本文给出 7 项可落地能力的迁移方案：把 Polaris 的 Voyage 状态机收敛为 DPR 的"Pipeline Checkpoint"、把 Sextant 六维核查收敛为 DPR 的 Validate 步骤、把 Skill 体系收敛为可版本化的 Prompt Pack、把 Research Wiki 概念图谱收敛为 Concept Backlinks、把 Idea Forge + Elo 辩论收敛为 Topic v2、把 Paper Review 引用核查收敛为 Citation Guard、把 19 阶段 LLM 路由收敛为 Stage Routing。**目标不是"和 Polaris 集成"或"用 Polaris 的 API"——是让 DPR 自己长出这些能力**，DPR 仍然是 zero-server，所有新增能力以本地文件 / Supabase 表 / localStorage 三种形式落地，浏览器侧 LLM 仍是可选的快路径。

---

## 背景与动机

### DPR 现状

DPR 的主流程在 [src/main.py:636](src/main.py#L636) `main()` 编排，整条链路是 subprocess 链 + 共享文件系统 + 共享 env。**Stage 入口**（精确到行号）：

- Step 0 enrich：[src/main.py:761-765](src/main.py#L761) → `src/0.enrich_config_queries.py`（默认模型 `gemini-3-flash-preview` via env `BLT_REWRITE_MODEL`，[0.enrich_config_queries.py:19](src/0.enrich_config_queries.py#L19)）
- Step 1 fetch：[src/main.py:788-797](src/main.py#L788) → `src/maintain/fetchers/fetch_arxiv.py`，**try/except 写 `fetch_status.json` 哨兵**（[src/main.py:798-825](src/main.py#L798)，`status=fetch_failed/returncode/stderr_tail/timestamp/run_date_token`）
- Step 2.1 BM25：[src/main.py:828-831](src/main.py#L828) → `src/2.1.retrieval_papers_bm25.py`（in-process `BM25Index`，k1=1.5/b=0.75，weights `MAIN=1.0/RELATED=0.5/QUERY=0/DEFAULT_OR_SOFT=0.3`，[2.1.retrieval_papers_bm25.py:47-59](src/2.1.retrieval_papers_bm25.py#L47)）
- Step 2.2 Embedding：[src/main.py:834-844](src/main.py#L834) → `src/2.2.retrieval_papers_embedding.py`（E5 prefix `query:` / `passage:`，[src/filter.py:20](src/filter.py#L20)，模型 `BAAI/bge-small-en-v1.5` 默认 384-dim）
- Step 2.3 RRF：[src/main.py:847-850](src/main.py#L847) → `src/2.3.retrieval_papers_rrf.py`（`--top-n 200 --rrf-k 60`）
- Step 3 Rerank：[src/main.py:853-865](src/main.py#L853) → `src/3.rank_papers.py`（`should_skip_rerank` 在 [src/main.py:290](src/main.py#L290)；`prepare_rerank_fallback` [src/main.py:380-399](src/main.py#L380)）
- Step 4 LLM Refine：[src/main.py:868-871](src/main.py#L868) → `src/4.llm_refine_papers.py`（hardcoded system prompt 在 [4.llm_refine_papers.py:352-357](src/4.llm_refine_papers.py#L352)，JSON schema `rerank_batch` [4.llm_refine_papers.py:431](src/4.llm_refine_papers.py#L431)）
- Step 5 Select：[src/main.py:874-881](src/main.py#L874) → `src/5.select_papers.py`（4 modes `standard/extend/spark/skims` 在 [5.select_papers.py:24-50](src/5.select_papers.py#L24)）
- Step 6 Generate Docs：[src/main.py:884-897](src/main.py#L884) → `src/6.generate_docs.py`，env override by `resolve_summary_step_env`（[src/main.py:402-427](src/main.py#L402)）

架构是"流水"而不是"循环"——每一步只看上游产出物，**没有跨日状态机、没有可重入检查点、没有"自我修订"概念**。浏览器侧 [astro-src/scripts/paper-analyzer.ts:1176-1232](astro-src/scripts/paper-analyzer.ts#L1176) `SYSTEM_PROMPT` 和 [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) `DEEPDIVE_SYSTEM_PROMPT` 都是硬编码 module-level `const ... = \`...\`` 字符串；topic 模式（[astro-src/scripts/topic-search.ts:3](astro-src/scripts/topic-search.ts#L3) 5 阶段）有 localStorage 持久化（`SESSION_KEY='dpr_topic_session_v1'` 在 [topic-search.ts:64](astro-src/scripts/topic-search.ts#L64)）但缺概念沉淀层。`LLM_MODEL` 是**单值**——`src/llm.py:835-848` `parse_provider_model` 读 `LLM_MODEL` env（[src/llm.py:851-871 ClientFactory.from_env()](src/llm.py#L851)），TS 侧 [astro-src/scripts/settings.ts:85-88](astro-src/scripts/settings.ts#L85) `LLM_DEFAULTS = {baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat'}`，`STORAGE_KEYS.llm = 'dpr_analyzer_v1'`（[astro-src/scripts/settings.ts:12](astro-src/scripts/settings.ts#L12)），**所有 stage 共用同一个 model**——只有 Step 6 走 `resolve_summary_step_env()` 旁路 override。

### Polaris 现状

Polaris 的核心是 "Voyage 三件套 + 六阶段流水线"：[E:/study/Polaris/src/backend/app/agents/voyage/navigator.py](E:/study/Polaris/src/backend/app/agents/voyage/navigator.py) 把目标拆解成 step plan（开放任务 incremental edit，管道任务用 deterministic plan），[E:/study/Polaris/src/backend/app/agents/voyage/helm.py](E:/study/Polaris/src/backend/app/agents/voyage/helm.py) 单步执行并把异常塞进 `observation["error"]`，[E:/study/Polaris/src/backend/app/agents/voyage/sextant.py](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py) 做 `no_error | exit_code | artifact_exists | schema_valid | metric | min_count | llm_rubric` 6 维验收，调用顺序严格 deterministic-first / LLM-last（[E:/study/Polaris/src/backend/app/agents/voyage/sextant.py:47-101](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L47)）。每一步都持久化到 `voyage_steps`（含 `seq/rank/observation/verdict/attempts/tokens/provenance`）——**状态机抗崩溃**。在内容层：Literature 阶段用 arXiv + S2 + OpenAlex 三源抓取 + PyMuPDF 提图 + Librarian 编译出 5 段 wiki（`LIBRARIAN_SYSTEM_PROMPT` [E:/study/Polaris/src/backend/app/services/wiki_compile.py:35-57](E:/study/Polaris/src/backend/app/services/wiki_compile.py#L35)） + `[[Concept]]` wikilink + `![[fig:N]]` marker（`WIKILINK_RE` [E:/study/Polaris/src/backend/app/services/concepts.py:28](E:/study/Polaris/src/backend/app/services/concepts.py#L28)） + pgvector `concepts` 表构图谱（Vector(1024)）；Idea 阶段走 Forge 多信号（4 信号 [E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py:353](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L353) `_HOLE_TOP_CONCEPTS=8` / `_HOLE_MAX_PAIRS=5` / `_TREND_WINDOW_DAYS=90`）+ Elo 辩论（K=32, 初始 1200，`_TOKENS_PER_MATCH_CALL=16_000`）选最优；Paper 阶段用 fact_pack 强约束 `\cite` / `\includegraphics` / 数字 (`NUMBER_TOLERANCE=0.01`) 三类硬护栏，Paper Review 用 `EXACT_SIMILARITY=0.92` / `MINOR_SIMILARITY=0.75` / `YEAR_TOLERANCE=1` 把引用分类 exact/minor/fabricated，`PASS_RATING=6.0` 是 final pass 门槛。

### 为什么"整合"不够，要"囊括"

DPR 的 zero-server 哲学（GitHub Actions cron + Supabase + 浏览器 LLM + 本地 markdown 落盘）是**第一类资产**——一旦引入 Polaris 的 FastAPI 后端、Yjs CRDT、SSH 实验编排，零服务器就破了。Polaris 的"管线能力"和"内容质量护栏"是**第二类资产**——这一类完全可以脱壳：DPR 拿到的是 `navigator/sextant` 的**契约形状**（step/observation/verdict/output_contract），而不是 Polaris 的运行时；拿到的是 `fact_pack.metrics` 的**约束语义**（数字必须命中），而不是 LaTeX 编译流程。**所以"囊括"=保留 DPR 的零服务器骨架 + 引入 Polaris 的能力契约**。DPR 的 fetch 哨兵（[src/main.py:805-819](src/main.py#L805) 写 `fetch_status.json` + 空 raw）就是天然的"sextant-style 错误短路"雏形，可以直接推广到所有 step。

### 明确不动的东西

- **多用户 / RBAC / `project_members`**：DPR 是单用户仓库脚本（fork-to-personal-use 模型，用户身份 = GitHub repo owner），多用户语义直接绕开。
- **SSH Experiment Lab / GPU 调度**：DPR 没有任何"跑实验"概念——Polaris 的 `Runner` 协议（[E:/study/Polaris/src/backend/app/agents/voyage/runner.py:36-80](E:/study/Polaris/src/backend/app/agents/voyage/runner.py#L36) 含 `RemoteHostRunner`/`ContainerRunner`）完全跳过。
- **实时 LaTeX+CRDT 协同编辑**：浏览器只读，不编辑 .tex；Yjs Room 永不会引入。
- **WebSocket / SSE 长连接**：DPR 浏览器侧是 Astro 静态站 + Cloudflare Pages（仅 [functions/api/proxy.ts](functions/api/proxy.ts) 一个端点），最大并发即一次 LLM call。
- **Voyage 阶段化 UI（Navigator 面板 / Sextant 红绿灯）**：DPR 的"状态"全部以"文件"和"GitHub commit"为载体，不画仪表盘。
- **MCP Tool Registry**（[E:/study/Polaris/src/backend/app/tools/registry.py](E:/study/Polaris/src/backend/app/tools/registry.py) 26 工具）：DPR 无 agent 进程。

---

## 设计原则

1. **零服务器骨架不动**——所有新能力落到本地文件、Supabase 表、localStorage 三种载体，**复用** [functions/api/proxy.ts:139-153](functions/api/proxy.ts#L139) allow-list 体系（不引入新端点）。
2. **能力以"契约"形式迁移，不以"运行时"形式迁移**——DPR 拿到 Polaris 的 step 形状、verification 维度、citation 分类法，但不引入 `navigator.py` / `sextant.py` / `engine.py` 作为依赖。
3. **每条数据形态都给出 JSON Schema 样例**——"可以写出来"才算吸收；空喊"加入 Skill"不算。
4. **可回滚优先于"性感"**——任何 breaking change 必须有 `_v1/` 影子数据并跑 1 个完整 cron 再切主路径。
5. **浏览器侧 LLM 仍是最快路径**——所有 Stage Routing 必须能在 settings `dpr-config.json` 显式降级到浏览器侧 `callChatCompletion`（[astro-src/lib/llm.ts](astro-src/lib/llm.ts)），与 [astro-src/scripts/settings.ts:465-516](astro-src/scripts/settings.ts#L465) `PROVIDER_PRESETS` 兼容。
6. **Polaris 的"审查"语义（fabricated citation / ±0.01 / exit_code）严格保留**——这些是质量护栏，不是 UI 装饰。
7. **新能力以"可选"形式开启**——所有 config 新增字段都有 `enabled: false` 默认值，老用户 cron 不破。config 仍走 `config.yaml` + `config.user.yaml`（[src/source_config.py:88-108](src/source_config.py#L88) `_deep_merge`）双层覆盖机制。
8. **Taxonomy 是单一真源**——所有 prompt 注入都尊重 [src/taxonomy.py:14-18](src/taxonomy.py#L14) + [astro-src/lib/taxonomies.ts:21](astro-src/lib/taxonomies.ts#L21) + [config/taxonomies.json](config/taxonomies.json) 的 4-dim allowlist（task/method/type + venue 派生）。

---

## 路线图 — 7 个能力章节

### 能力 1: Voyage 状态机 → DPR Pipeline Checkpoint

**动机**：DPR 现在的 6 步流水线（[src/main.py:761-897](src/main.py#L761) 7 段 subprocess）是"subprocess + 共享 filesystem"链：每个 step `subprocess.run(["python", "src/X.py"])`，stdout 打印、env 继承、archive 共享。一旦第 4 步 LLM 503 重试成功但第 5 步 select 出错，整条链路回到 Step 1 重新跑——既浪费 BLT 配额又污染 `archive/<date>/` 目录。Polaris 的 [E:/study/Polaris/src/backend/app/agents/voyage/engine.py](E:/study/Polaris/src/backend/app/agents/voyage/engine.py) + `voyage_steps` 表 + `voyage_runs.cursor` 解决了"半成品可恢复"问题，DPR 要的不是数据库，而是**文件系统版的检查点**——直接借鉴 DPR 自己的 `fetch_status.json` 哨兵（[src/main.py:805-819](src/main.py#L805)）模式推广到所有 step。

**Polaris 参考实现**（**逐条对应到 file:line**）：

- 状态枚举：`planning / executing / verifying / replanning / paused_gate / paused_error` + 终态 `done / failed / cancelled` —— 写死在 [E:/study/Polaris/src/backend/app/agents/voyage/engine.py:1-24](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L1)。
- 单一真源是 `voyage_steps` 行表（每 step 一行）；`run.plan` 是 `_regen_plan_snapshot` 在 [E:/study/Polaris/src/backend/app/agents/voyage/engine.py:696](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L696) 重新派生的快照。
- 7 步 loop body 在 `_loop` [E:/study/Polaris/src/backend/app/agents/voyage/engine.py:322-403](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L322)，按 `rank, seq` 顺序走、找首个非 `passed` 行——那就是 cursor：

```python
# engine.py:330-334
rows = await self._active_rows(session, run)
node_index, node = next(
    ((i, r) for i, r in enumerate(rows) if r.status != "passed"),
    (len(rows), None),
)
```

- canonical step row 形状由 `_new_step_row` 在 [E:/study/Polaris/src/backend/app/agents/voyage/engine.py:280-303](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L280) 定义，字段：`run_id, seq, rank, title, action, params, acceptance={"text": ..., "checks": [...]}, requires_gate=..., budget={"max_attempts": ...}, provenance={"plan_iteration": ..., "on_failure": ..., "wrapup": bool}, status="pending"`。
- 崩溃恢复：`VoyageEngine.resume(run_id)` 在 [E:/study/Polaris/src/backend/app/agents/voyage/engine.py:134-153](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L134) 把 `status='failed' or 'running'` 的行重置回 `pending` + `attempt=0`，然后再入 `_drive`。
- 预算自动暂停：`_budget_exceeded` 在 [engine.py:606-612](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L606) 比较 `run.usage.total_tokens` 到 `run.budget.max_tokens`（**DPR 对照点：把 `archive/llm_usage.jsonl` 当天的 `tokens_in+tokens_out` sum 与 `config.yaml.pipeline.budget.max_tokens_per_run` 比对**）。
- Human gate：`_gate_cleared` 在 [engine.py:422-489](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L422)。DPR v1 不引入。
- 失败分发：在 `_handle_failure` [engine.py:632-678](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L632)：
  - `observation.error` AND `attempt < max_attempts` → 行保持 `pending`，追加 `diagnosis`，原地重试；
  - `step_def["on_failure"] == "fail"` → `failed`，不 replan；
  - `run.mode == "pipeline"` → `paused_error`（确定行为）；
  - `run.mode == "template"` → `Navigator.replan`（确定分支表）；
  - `run.mode == "loop"` → `Navigator.on_result`（LLM 提议的 edit）。
  - `MAX_REPLANS = 2` 在 [engine.py:47](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L47)。

**DPR 实现**：

新增 `src/pipeline_v2/checkpoint.py` + `src/pipeline_v2/state.py`（放在 `src/pipeline_v2/` 子包，不污染 `src/main.py` 顶层）。每个 step 入口 `read()` 自身 checkpoint 文件，存在则 `status` 是 `succeeded` 就跳过；不存在或 `failed` 就重跑。重跑粒度按"step 子阶段"细分（不是 6 步，而是 18 个子阶段——见下表），**直接对照** Polaris `voyage_steps` 的 `seq/rank` 概念。

**JSON 数据形态**（每 step，对齐 Polaris `_new_step_row` 字段名，**模仿 DPR `fetch_status.json` 哨兵 [src/main.py:805-819](src/main.py#L805) 的写盘风格**）：

```json
{
  "step_id": "4.llm_refine.arxiv_2026-07-21",
  "step_type": "llm_refine",
  "seq": 1,
  "rank": 4,
  "sub_rank": 1,
  "status": "succeeded",          // pending | running | succeeded | failed | skipped
  "started_at": "2026-07-21T18:30:42Z",
  "finished_at": "2026-07-21T18:31:08Z",
  "attempts": 2,
  "observation": {
    "input_hash": "sha256:3a9c...",
    "input_count": 47,
    "output_count": 31,
    "elapsed_ms": 26412,
    "error": null,
    "self_check": null
  },
  "acceptance": {
    "text": "min_count >= 20, llm_score in [0,1]",
    "checks": [
      {"kind": "no_error"},
      {"kind": "exit_code", "value": 0},
      {"kind": "artifact_exists", "key": "archive/20260721/rank/arxiv_papers_20260721.llm.json"},
      {"kind": "schema_valid", "field": "records", "required_keys": ["paper_id", "llm_score", "reasoning"]},
      {"kind": "min_count", "field": "records", "value": 20},
      {"kind": "metric", "name": "llm_score", "op": ">=", "value": 0.0}
    ]
  },
  "verdict": {
    "passed": true,
    "reason": "[min_count] 31 records, >= 20",
    "rubric_passed": null
  },
  "tokens": { "in": 18142, "out": 2841, "model": "deepseek-chat" },
  "provenance": {
    "code_version": "git:abc1234",
    "config_hash": "sha256:81af...",
    "llm_provider": "deepseek",
    "llm_route": "stage:refine"
  },
  "on_failure": "mark_needs_review",
  "wrapup": false
}
```

**Step 子阶段表**（共 18 个，对应 6 步的细分，**精确对照 DPR 现状**）：

| rank | step_type | 备注 | DPR 现状入口 |
|------|-----------|------|--------------|
| 0.1 | `enrich_config_queries` | 仅 `--run-enrich` | [src/main.py:761-765](src/main.py#L761) |
| 1.1 | `fetch.raw` | 含 arxiv/biorxiv/medrxxiv/chemrxiv/openreview/aaai/acl 7 个子源 | [src/main.py:788-797](src/main.py#L788) |
| 2.1 | `retrieval.bm25` | 现有 in-process + Supabase RPC fallback | [src/main.py:828-831](src/main.py#L828) |
| 2.2 | `retrieval.embedding` | E5 + BGE-small-en-v1.5 | [src/main.py:834-844](src/main.py#L834) |
| 2.3 | `retrieval.rrf` | `--rrf-k 60` | [src/main.py:847-850](src/main.py#L847) |
| 3.1 | `rank.blt` 或 `rank.fallback` | `should_skip_rerank` [main.py:290](src/main.py#L290) | [src/main.py:853-865](src/main.py#L853) |
| 4.1 | `llm_refine` | system_prompt [4.llm_refine_papers.py:352-357](src/4.llm_refine_papers.py#L352) | [src/main.py:868-871](src/main.py#L868) |
| 5.1 | `select.deep_dive` | `MODES` [5.select_papers.py:24-50](src/5.select_papers.py#L24) | [src/main.py:874-881](src/main.py#L874) |
| 5.2 | `select.quick_skim` | 同上 | [src/main.py:874-881](src/main.py#L874) |
| 6.1 | `docs.generate_readme` | `docs/<date>/README.md` | [src/main.py:884-897](src/main.py#L884) |
| 6.2 | `docs.generate_paper_md` | `process_paper` [6.generate_docs.py:1599](src/6.generate_docs.py#L1599) | [src/main.py:884-897](src/main.py#L884) |
| 6.3 | `docs.ensure_figures` | [src/paper_figures.py](src/paper_figures.py) `ensure_paper_media` | 同 6.1 |
| 6.4 | `docs.ensure_formulas` | [src/paper_formulas.py](src/paper_formulas.py) `ensure_paper_formulas` | 同 6.1 |
| 6.5 | `docs.update_sidebar` | `_sidebar.md` | 同 6.1 |

**与 Polaris 的差异**：

- Polaris 用 Postgres 持久化 `voyage_runs` / `voyage_steps`，DPR 用 JSON 文件 + `.lock` 防并发。**DPR 复用现有 `fetch_status.json` 哨兵**（[src/main.py:805-819](src/main.py#L805)）的命名 + 字段风格。
- Polaris 步骤可以分布式回放（ARQ 队列），DPR 在 GitHub Actions 单进程内回放，锁就是 `flock` syscall。
- Polaris 的 `_handle_failure` 4 模式分发 D P R v1 简化为 1 模式：失败一律 `mark_needs_review`（不引入 `Navigator.replan`，因为没有 LLM-as-planner）。
- Polaris 的 `_apply_plan_edit` 7 条不变量 D P R v1 不用 plan edit（subprocess 链是确定性的），v2 才考虑用 LLM 提议 plan。
- Polaris `MAX_REPLANS = 2` D P R 不引入此概念。

**与现有 config 的关系**：
- `config.yaml` 新增 `pipeline.checkpoints.enabled: false`（默认关，向后兼容）。
- 开启时 [src/main.py:761-897](src/main.py#L761) 每个 subprocess 入口插入 `checkpoint_read()`，出口插入 `checkpoint_write()`。
- 沿用 `config.user.yaml` overlay（[src/source_config.py:88-108](src/source_config.py#L88) `_deep_merge`）——用户在 `config.user.yaml` 单独开 checkpoint 不污染 base。

**回滚**：把 `pipeline.checkpoints.enabled` 设回 `false` 即可，老 archive 目录结构无变化（新增 `.checkpoints/` 子目录独立）。

**风险**：
- 文件 IO 在并发 cron 下竞态——必须用 `flock(LOCK_EX)` 包裹（仿照 Polaris `_gate_cleared` 的"行级条件 UPDATE"语义）。
- GitHub Actions 容器中途 kill 不会触发 finally——必须用 atexit + signal handler。
- checkpoint 写一半时 panic——每个 checkpoint 用 `*.tmp` + atomic rename（**直接复用 [src/generate_docs_md_io.py:28-47 `atomic_write_text`](src/generate_docs_md_io.py#L28) 模式**）。
- `voyage_runs.cursor` 在 Polaris 持久化，DPR 用文件名（`<step_id>.json` 已存在的最后一个非 `passed` 即 cursor）——删错 checkpoint 等于跳过未跑步骤。

**Effort**：M（2 周）。文件：新增 `src/pipeline_v2/checkpoint.py`（~200 行）+ `src/pipeline_v2/state.py`（~150 行），改动 [src/main.py:761-897](src/main.py#L761)（~40 行 + 18 个 subprocess 包裹）。

---

### 能力 2: Sextant 核查 → DPR Validate Step

**动机**：DPR 的每一步骤现在只信"subprocess returncode == 0"，但这是**最弱验收**。比如 [src/4.llm_refine_papers.py](src/4.llm_refine_papers.py) 即使 LLM 全返回空 JSON，只要 exit 0，pipeline 就继续——下游 5/6 步拿到空输入就沉默地产出空文档。Polaris 的 Sextant 用 7 维验收（`DETERMINISTIC_CHECK_KINDS` 6 维 + `llm_rubric`）能在"程序没崩"和"结果可用"之间拉开距离。DPR 已经有的两个"半成品质量控制"是：
1. `fetch_status.json` 哨兵（[src/main.py:798-825](src/main.py#L798)）—— Step 1 单独的错误捕获。
2. `verify_paper_md_was_written(md_path, min_size=200)`（[src/generate_docs_md_io.py:50-78](src/generate_docs_md_io.py#L50)）—— Step 6 写盘后的 `no_error + artifact_exists + min_size` 雏形。

把这两段抽成 6 维 validate hook，挂到每个 step 出口。

**Polaris 参考实现**（**逐条对应到 file:line**）：

- 主入口 `Sextant.verify` 在 [E:/study/Polaris/src/backend/app/agents/voyage/sextant.py:47](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L47)。
- 校验 kind 集合在 [E:/study/Polaris/src/backend/app/agents/voyage/checks.py:22-25](E:/study/Polaris/src/backend/app/agents/voyage/checks.py#L22)：
  ```python
  DETERMINISTIC_CHECK_KINDS = frozenset({
      "no_error", "exit_code", "artifact_exists",
      "schema_valid", "metric", "min_count"
  })
  CHECK_KINDS = DETERMINISTIC_CHECK_KINDS | {"llm_rubric"}
  ```
- 校验 spec 形状在 [E:/study/Polaris/src/backend/app/agents/voyage/checks.py:8-17](E:/study/Polaris/src/backend/app/agents/voyage/checks.py#L8)：
  ```python
  {"kind": "no_error"}
  {"kind": "exit_code", "value": 0}
  {"kind": "artifact_exists", "key": "artifacts.demo-report.md"}
  {"kind": "schema_valid", "field": "plan", "required_keys": ["primary_metric"]}
  {"kind": "metric", "name": "accuracy", "op": ">=", "value": 0.8}
  {"kind": "min_count", "field": "papers", "value": 1}
  {"kind": "llm_rubric", "rubric": "..."}
  ```
- `metric` 支持的 `op`：`>=, <=, >, <, ==`（[checks.py:27-33](E:/study/Polaris/src/backend/app/agents/voyage/checks.py#L27)）。
- 校验结果：`verdict = {"passed": bool, "reason": str}`（[checks.py:172-178](E:/study/Polaris/src/backend/app/agents/voyage/checks.py#L172)）。失败的确定性 check 的 `reason` 永远是 actionable 的，格式 `f"[{kind}] {error}"`，例如 `"[metric] 指标 accuracy = 0.72，不满足 >= 0.8"`。
- 评估顺序严格 deterministic-first / LLM-last（[sextant.py:47-101](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L47)）：
  1. **Step 1** —— `observation.error` 短路（[sextant.py:51-52](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L51)）：若设置，直接返回 `{"passed": False, "reason": <error>}`，零 LLM 成本。
  2. **Step 2** —— `self_check` 短路（[sextant.py:54-60](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L54)）：若 action 返回了 `observation["self_check"] = {"passed": bool, "reason": ...}`，原样接受。
  3. **Step 3** —— 结构化 `checks`（[sextant.py:62-79](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L62)）：调 `run_deterministic_checks`。若全部通过且没有 `llm_rubric` → 直接 return verdict；否则循环 `llm_rubric` 项走 `_judge`，全部通过 → `{"passed": True, "reason": "全部检查通过（含 LLM 判定）"}`。
  4. **Step 4** —— 遗留路径（[sextant.py:81-101](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L81)）：`DETERMINISTIC_ACTIONS = {"sleep", "artifact.write"}` → 自动通过。

**DPR 实现**：

新增 `src/validate/` 子包（**直接对照 Polaris [E:/study/Polaris/src/backend/app/agents/voyage/sextant.py](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py) 命名**）：
- `src/validate/__init__.py` —— 导出 `verify(step_id, output_path, acceptance, observation) -> verdict`
- `src/validate/checks.py` —— 6 维 predicate 实现（**字段名严格对齐 Polaris [checks.py:8-17](E:/study/Polaris/src/backend/app/agents/voyage/checks.py#L8)**）
- `src/validate/contracts/` —— 每个 step 一份 `<step_id>.schema.json`（例如 `4.llm_refine.schema.json`）

Validate 在 subprocess 出口、`checkpoint_write()` 之前调用；verdict 写进 checkpoint 的 `verdict` 字段。**DPR 已经有的 `verify_paper_md_was_written`（[src/generate_docs_md_io.py:50-78](src/generate_docs_md_io.py#L50)）就是 Sextant 雏形——重写它走新 `verify()` 入口**。

**contracts/4.llm_refine.schema.json 样例**（**严格遵循 Polaris [checks.py:8-17](E:/study/Polaris/src/backend/app/agents/voyage/checks.py#L8) 字段名**）：

```json
{
  "step_id": "4.llm_refine",
  "checks": [
    { "kind": "no_error" },
    { "kind": "exit_code", "value": 0 },
    { "kind": "artifact_exists", "key": "archive/20260721/rank/arxiv_papers_20260721.llm.json" },
    { "kind": "schema_valid", "field": "records", "required_keys": ["paper_id", "llm_score", "reasoning"] },
    { "kind": "min_count", "field": "records", "value": 20 },
    { "kind": "metric", "name": "llm_score", "op": ">=", "value": 0.0 },
    { "kind": "metric", "name": "llm_score", "op": "<=", "value": 1.0 },
    { "kind": "llm_rubric", "rubric": "rubrics/llm_refine_quality.md" }
  ],
  "on_fail": "mark_needs_review"
}
```

**与 Polaris 的差异**：

- Polaris 的 LLM rubric 是"重新叫 LLM 评估产物质量"（expensive）；DPR 把它降级为 `mark_needs_review`——失败的记录打 `needs_review: true` 标记，下游 step 6 在 docs 顶部插入 `[LLM 复核未通过]` 提示（不重做）。`llm_rubric` 默认 `enabled: false`。
- Polaris 的 `output_contract`（JSON Schema 验证）是 Skill 携带的；DPR 让它直接以 `contracts/*.schema.json` 静态文件存在（每个 step 一份，不动态注入）。
- DPR 复刻 Polaris [sextant.py:47-101](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L47) 的 4 步评估顺序到 `src/validate/__init__.py::verify` 函数（不引入 `self_check` 短路，v1 不需要）。
- DPR 复刻 Polaris `_MAX_ATTEMPTS = 3`（[sextant.py:20](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L20)）到 `src/validate/checks.py::_judge_max_attempts = 3`。
- **DPR 现有 `verify_paper_md_was_written`**（[src/generate_docs_md_io.py:50-78](src/generate_docs_md_io.py#L50) `min_size=200` 阈值）——升级为完整 6 维 check：保留 `no_error`（文件存在 + ≥200 bytes）+ 新增 `schema_valid`（frontmatter 含必需字段）+ 新增 `min_count`（sections 数量 ≥ 1）。

**Schema 样例**（`schemas/llm_refine_record.schema.json`，与 Polaris `schema_valid.required_keys` 对齐）：

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["paper_id", "llm_score", "reasoning"],
  "properties": {
    "paper_id": { "type": "string", "pattern": "^[0-9]{4}\\.[0-9]{4,5}(v\\d+)?$" },
    "llm_score": { "type": "number", "minimum": 0, "maximum": 1 },
    "reasoning": { "type": "string", "minLength": 20 }
  }
}
```

**失败处理策略表**：

| predicate 失败 | action | reason | 对应 Polaris 行为 | DPR 现有参照 |
|----------------|--------|--------|-------------------|--------------|
| `no_error` | abort | 文件压根没写出 | [sextant.py:51-52](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L51) 短路 | `verify_paper_md_was_written` |
| `exit_code != 0` | abort | subprocess 已失败 | [checks.py exit_code 分支](E:/study/Polaris/src/backend/app/agents/voyage/checks.py) | `fetch_status.json` |
| `artifact_exists` | abort | 同上 | [checks.py artifact_exists 分支](E:/study/Polaris/src/backend/app/agents/voyage/checks.py) | 同上 |
| `schema_valid` | mark_needs_review | 记录级错误，可继续 | [checks.py schema_valid 分支](E:/study/Polaris/src/backend/app/agents/voyage/checks.py) | (新) |
| `min_count` | mark_needs_review | 数量不足，少数条目仍可用 | [checks.py min_count 分支](E:/study/Polaris/src/backend/app/agents/voyage/checks.py) | (新) |
| `metric` out of range | clamp | 把 llm_score 截到 [0,1] | [checks.py metric 分支](E:/study/Polaris/src/backend/app/agents/voyage/checks.py) | (新) |
| `llm_rubric` 失败 | mark_needs_review | 质量低，留标记 | [sextant.py:103-141 _judge](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L103) | (新) |

**配置开关**：`config.yaml.pipeline.validate.enabled: false`（默认关），开启后每个 step 必跑。**沿用 `config.user.yaml` overlay**（[src/source_config.py:88-108](src/source_config.py#L88)）。

**回滚**：同 checkpoint——`enabled: false` 即全跳过；`verify_paper_md_was_written` 保留作为兜底。

**风险**：

- LLM rubric 引入新 LLM call 会增成本——默认把 `llm_rubric.predicate.enabled` 设为 `false`，只跑 6 维确定性检查（Polaris 同样可配置 rubric 关）。
- Schema 收紧太严会让历史 archive 不兼容——schema 用 `version` 字段，旧文件不阻断。
- `observation.error` 短路（Polaris Step 1）D P R v1 不引入——所有失败都走完整 6 维检查（多花点时间换统一路径）。

**Effort**：M（2 周）。文件：新增 `src/validate/__init__.py`（~100 行）+ `src/validate/checks.py`（~150 行，对齐 Polaris [sextant.py](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py)）+ `src/validate/contracts/`（~15 个 schema）+ `src/validate/rubrics/`（~5 个 markdown rubric），改动每个 step 主脚本（~10 处插入 validate 调用）+ 重写 [src/generate_docs_md_io.py:50-78](src/generate_docs_md_io.py#L50) `verify_paper_md_was_written` 走新入口。

---

### 能力 3: Skill 系统 → DPR Prompt Packs

**动机**：DPR 现在所有 LLM prompt 都是**硬编码 module-level `const ... = \`...\`` 字符串**：
- [astro-src/scripts/paper-analyzer.ts:1176-1232](astro-src/scripts/paper-analyzer.ts#L1176) `SYSTEM_PROMPT`（速读）
- [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) `DEEPDIVE_SYSTEM_PROMPT`（8 章节精读）
- [astro-src/scripts/topic-search.ts:92-186](astro-src/scripts/topic-search.ts#L92) `DECOMPOSE_SYSTEM`（5 facet categories：`method, data_task, structure_property, application_transfer, evaluation_benchmark`）
- [astro-src/scripts/topic-search.ts:188-235](astro-src/scripts/topic-search.ts#L188) `EXPLORE_FROM_SEEDS_SYSTEM`（4-6 方向：`cross_domain/method_transfer/reverse/combination`）
- [astro-src/scripts/topic-search.ts:240-255](astro-src/scripts/topic-search.ts#L240) `FILTER_CANDIDATES_SYSTEM`（N→M 候选）
- [src/4.llm_refine_papers.py:352-357](src/4.llm_refine_papers.py#L352) Python `system_prompt`（Research Relevance Evaluator，0-10 分）

用户想换"会议风格"（NeurIPS vs ACL vs 中文期刊）或换"领域 prompt 模板"（CV vs NLP vs Robotics）只能 fork 代码。Polaris 的 Skill 系统用 `skills → skill_versions → project_skills` 三表 + `snapshot_for_project` 在 voyage 启动时把 `checkpoint["skills"] = {target: [...]}` 注入（[engine.py:240-252](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L240)）——这意味着 prompt 是**版本化、可按项目加载**的。

**Polaris 参考实现**（**逐条对应到 file:line**）：

- 文件：
  - 读 / 渲染：[E:/study/Polaris/src/backend/app/agents/voyage/skillset.py](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py)
  - CRUD / 项目启用 / 快照：[E:/study/Polaris/src/backend/app/services/skills.py](E:/study/Polaris/src/backend/app/services/skills.py)
  - 内置种子：[E:/study/Polaris/src/backend/app/services/builtin_skills.py](E:/study/Polaris/src/backend/app/services/builtin_skills.py)
  - 市场：[E:/study/Polaris/src/backend/app/services/skill_market.py](E:/study/Polaris/src/backend/app/services/skill_market.py)
- Skill 4 kinds：`guidance / rubric / persona / workflow`。
- Schema（[app/schemas/skill.py::SkillManifest](E:/study/Polaris/src/backend/app/schemas/skill.py)）：
  ```python
  class SkillManifest(BaseModel):
      targets: list[str]              # 注入点
      personas: list[dict] | None      # kind="persona"
      steps: list[dict] | None         # kind="workflow"（用 Navigator schema 验证）
  ```
- `SkillVersion` row：`(skill_id, version=int, manifest=SkillManifest(...).model_dump(mode="json"), body=str, changelog=str|None, created_by=user_id)`。
- `scope`：`builtin`（只读，全局唯一 slug）或 `user`（per-owner）。
- **11 个内置 skill**（[builtin_skills.py:11+](E:/study/Polaris/src/backend/app/services/builtin_skills.py#L11)）：

| slug | kind | target |
|------|------|--------|
| `relevance-rubric-cs-ai` | rubric | `wiki.score_relevance` |
| `librarian-note-style` | guidance | `wiki.compile` |
| `gap-analysis-lenses` | guidance | `forge.gap_analysis` |
| `idea-scoring-rubric` | rubric | `forge.score` |
| `idea-generation-quality` | guidance | `forge.generate` |
| `conference-review-rubric` | rubric | `review.referees` |
| `academic-writing-style` | guidance | `writing.section` |
| `abstract-writing` | guidance | `writing.section(abstract)` |
| `related-work-writing` | guidance | `writing.related_work` |
| `debate-personas-classic` | persona | `review.debate` |
| `referee-personas-strict` | persona | `review.referees` |

- 实际消费的 target：`navigator.free_plan` / `wiki.score_relevance` / `wiki.compile` / `wiki.link_concepts` / `forge.gap_analysis` / `forge.generate` / `forge.score` / `forge.dedup` / `review.debate`（`_personas` 在 [actions_ideas.py:841-849](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L841)）/ `review.referees`（`_personas` 在 [actions_review.py:120-123](E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py#L120)）/ `writing.section`（及参数化 `writing.section(abstract)`），`writing.related_work`（[navigator.py:339-352](E:/study/Polaris/src/backend/app/agents/voyage/navigator.py#L339)）。
- 加载 & 注入流程：
  1. **Snapshot** 由 [services/skills.py:335-370 `snapshot_for_project`](E:/study/Polaris/src/backend/app/services/skills.py#L335) 生成。
  2. **Engine 一次性写**：`_ensure_skills_snapshot` 在 [engine.py:240-252](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L240) 把它放进 `run.checkpoint["skills"]`。Docstring 明确："此后本次 run 只读快照：中途改技能不影响进行中任务，断点恢复无需再查技能表"。
  3. **Reader**（[skillset.py](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py)）：
     - `skill_guidance(checkpoint, *targets)`（[line 40](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L40)）：拼接 guidance / rubric bodies，上限 `_TARGET_BUDGET_CHARS = 24000`（截断时加 marker）。
     - `skill_personas(checkpoint, target)`（[line 59](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L59)）。
     - `skill_workflows(checkpoint)`（[line 69](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L69)）。
     - `skill_output_contract(checkpoint, target)`（[line 77](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L77)）+ `check_output_contract(contract, content)`（[line 147](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L147)）：Sextant 跑的确定性 JSON Schema 验证。

**DPR 实现**：

引入"Prompt Pack"概念，**新文件载体是 `config/prompts/` 目录**（与 `config.yaml` / `config.user.yaml` / `config/taxonomies.json` 同级），不引入数据库。Manifest 描述"这个 pack 在哪些 target 注入"（对齐 Polaris `targets` 枚举）。**Gist 同步 key：`dpr_prompt_packs_v1`**（仿照 [astro-src/scripts/settings.ts:574](astro-src/scripts/settings.ts#L574) `GIST_FILENAME = 'dpr-config.json'` + [astro-src/scripts/settings.ts:12-21](astro-src/scripts/settings.ts#L12) `STORAGE_KEYS.*` 模式）。

**DPR 注入点 → Polaris target 映射**：

| DPR step（精确到行号） | DPR 注入点名 | Polaris 对应 target | 当前硬编码位置 |
|----------|--------------|---------------------|----------------|
| [src/0.enrich_config_queries.py](src/0.enrich_config_queries.py) | `enrich` | (新) | [0.enrich_config_queries.py:22-73](src/0.enrich_config_queries.py#L22) |
| [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) | `refine` | (新, 近似 forge.score) | Python hardcoded |
| [src/5.select_papers.py](src/5.select_papers.py) | `select` | (新) | (无 LLM call) |
| [src/6.generate_docs.py](src/6.generate_docs.py) | `doc.generate` | (新, 近似 librarian) | (无 LLM call) |
| [astro-src/scripts/paper-analyzer.ts:1176-1232](astro-src/scripts/paper-analyzer.ts#L1176) | `analyzer.system` | (新) | TS const |
| [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) | `analyzer.deepdive` | (新, 近似 writing.section) | TS const |
| [astro-src/scripts/topic-search.ts:92-186](astro-src/scripts/topic-search.ts#L92) | `topic.facet` | (新) | TS const |
| [astro-src/scripts/topic-search.ts:240-255](astro-src/scripts/topic-search.ts#L240) | `topic.cand` | (新) | TS const |
| [topic-search.ts:188-235](astro-src/scripts/topic-search.ts#L188) | `topic.explore` | (新) | TS const |
| `summarizeOne` (topic-search.ts) | `topic.summary` | (新) | (TS const) |
| `TOPIC_REPORT_SYSTEM` | `topic.report` | (新) | (TS const) |

**Manifest JSON 样例**（`config/prompts/nips-style/2026-07-15/manifest.json`，对齐 Polaris `SkillManifest` schema）：

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
  "personas": null,
  "steps": null,
  "config": {
    "citation_style": "numbered",
    "max_chars": 2000
  },
  "metadata": {
    "author": "maintainer",
    "created_at": "2026-07-15T00:00:00Z",
    "tags": ["neurips", "english-source", "cv"],
    "rating": 4.7
  }
}
```

**body.md 样例**（节选）：

```markdown
# NeurIPS 风格中文速读 Prompt

## 角色
你是 NeurIPS 评审，熟悉 ML/AI 领域术语，输出面向中文 ML 研究者。

## 强制字段
- tldr: 中文 150-220 字
- motivation: 30-70 字
- method: 30-70 字，含核心方法名（保留英文）
- result: 30-70 字，含 SOTA 数字（与 abstract 数字一致）
- conclusion: 30-70 字
- categories.venue: ["neurips"] 或 ["arxiv"]
- categories.task: 从 taxonomies 选（[src/taxonomy.py:20-22](src/taxonomy.py#L20) allowlist）

## 反模式
- 不要写"本文提出了一种新方法"（废话）
- 不要复述 abstract 原文
- 不要给出 abstract 没提到的 SOTA 数字
```

**DPR 加载机制**（伪代码，仿照 Polaris `snapshot_for_project` + `skill_guidance` 思路）：

```python
# src/prompt_pack.py
TARGET_BUDGET_CHARS = 24000  # 对齐 Polaris _TARGET_BUDGET_CHARS

def load_active_pack(target: str, config) -> Optional[Pack]:
    """从 config.prompt_packs.active[target] 找到 pack_id + version，载入。"""
    pin = config.get(f"prompt_packs.active.{target}")  # e.g. "nips-style:2026-07-15"
    if not pin:
        return None  # 走默认 hardcoded
    pack_id, version = pin.split(":")
    return Pack.load(f"config/prompts/{pack_id}/{version}/")

def inject_into_prompt(prompt: str, target: str, config) -> str:
    pack = load_active_pack(target, config)
    if pack is None:
        return prompt
    injected = f"{pack.body}\n\n---\n\n{prompt}"
    if len(injected) > TARGET_BUDGET_CHARS:
        injected = injected[:TARGET_BUDGET_CHARS - 50] + "\n\n... [truncated to 24000 chars]"
    return injected
```

**Gist 同步**（**复用 [astro-src/scripts/settings.ts:399 pushHiddenPapersToGist](astro-src/scripts/settings.ts#L399) + [settings.ts:574 GIST_FILENAME](astro-src/scripts/settings.ts#L574) 模式**）：新增 `dpr_prompt_packs_v1` key，存到 `dpr-config.json` Gist，与现有 `dpr-config.json` 同文件 / 不同 key 命名空间。

**config.yaml 新增**（**与 Polaris 4 kind 兼容**）：

```yaml
prompt_packs:
  active:
    enrich: "default:2026-07-01"
    refine: "nips-style:2026-07-15"
    select: "default:2026-07-01"
    doc.generate: "nips-style:2026-07-15"
    analyzer.system: "nips-style:2026-07-15"
    analyzer.deepdive: "deepdive-v2:2026-07-10"
    topic.facet: "default:2026-07-01"
    topic.cand: "default:2026-07-01"
    topic.explore: "default:2026-07-01"
    topic.summary: "default:2026-07-01"
    topic.report: "default:2026-07-01"
  builtin_packs:
    - "default"
    - "nips-style"
    - "acl-style"
    - "deepdive-v2"
  kind_compat:
    "nips-style": "guidance"
    "acl-style": "guidance"
    "deepdive-v2": "guidance"
    "default": "guidance"
```

**与 Polaris 的差异**：

- Polaris 的 Skill 是 DB 版本（`skill_versions` 表 + `SkillVersion.version=int`），DPR 用 git 版本（每个 pack 一个目录，含 immutable version 子目录），`version` 用日期字符串 `YYYY-MM-DD` 而非 int。
- Polaris 的 `SkillMarketplace`（`skill_listings` + `skill_ratings`）DPR 不引入——避免"评分"语义；改用 `metadata.rating` 字段（纯信息，不强制）。
- Polaris 的 `workflow` Skill（seed free-plan with steps template，对应 `navigator.free_plan`）DPR 落地为 `config/prompts/<name>/<version>/steps.json`，被 Topic v2 用（参见能力 5）。
- Polaris 的 `_TARGET_BUDGET_CHARS = 24000`（[skillset.py:40](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L40)）DPR 完整复刻，避免 prompt 爆炸。
- Polaris `skill_output_contract`（[skillset.py:77](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L77)）DPR 落地为 `manifest.output_contract` 字段 + JSON Schema 文件。
- **Taxonomy 兼容**：所有 pack body 涉及的 category 词汇必须尊重 [src/taxonomy.py:14-18](src/taxonomy.py#L14) + [astro-src/lib/taxonomies.ts:21](astro-src/lib/taxonomies.ts#L21) 单一真源——`manifest.config.taxonomies_version: "2026-07-01"` 字段在加载时校验。

**回滚**：`prompt_packs.active.<target>: null` 即回退到 hardcoded 默认（`SYSTEM_PROMPT` 在 [paper-analyzer.ts:1176-1232](astro-src/scripts/paper-analyzer.ts#L1176) 不动）。

**风险**：

- 用户随便写 pack 污染 prompt——提供 `config/prompts/_schemas/pack_manifest.schema.json` 强制 manifest 字段，CI (`ci.yml`) 加 `python -m prompt_pack.lint_all`。
- Pack body 引用了不存在 taxonomy 词汇——manifest 加 `requires_taxonomies_version: "2026-07-01"`，加载时校验。
- Gist 同步冲突——`dpr_prompt_packs_v1` key 单独 ns，与 `dpr_analyzer_v1`（[settings.ts:12](astro-src/scripts/settings.ts#L12)）/`dpr_analyzer_provider_v1`（[settings.ts:13](astro-src/scripts/settings.ts#L13)）不冲突。
- 多个 pack 注入同一 target——`active.<target>` 只支持单 pin；多 pack 走 `prompt_packs.stack.<target>: [a, b, c]` 顺序拼接（v2）。

**Effort**：L（3 周）。文件：新增 `src/prompt_pack.py`（~150 行，对齐 [skillset.py](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py) 接口）+ `config/prompts/_schemas/`（~3 个 schema）+ 4 个内置 pack（~4 × 30 行 markdown），改动 [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) / [src/5.select_papers.py](src/5.select_papers.py) / [src/6.generate_docs.py](src/6.generate_docs.py) / [astro-src/scripts/paper-analyzer.ts:1176](astro-src/scripts/paper-analyzer.ts#L1176) / [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) 5 处。

---

### 能力 4: Research Wiki 概念图谱 → DPR Concept Backlinks

**动机**：DPR 现在产出 `docs/papers/.../<id>-<slug>.md`（frontmatter 形状在 [src/6.generate_docs.py:1181-1198](src/6.generate_docs.py#L1181)），但这些 md 之间是**零关联**——读者看完一篇不知道"上一篇/下一篇"为什么相关。Polaris 的 Research Wiki 用 Librarian 编译产出 `[[Concept]]` wikilink + `![[fig:N]]` marker + pgvector `concepts` 表（Vector(1024)）构建项目级概念图谱，每个 concept 节点有 `embedding` 字段，可在 `knowledge_graph` MCP tool 中被查。DPR 不引入 Postgres/pgvector，但 `[[wikilink]]` 语义可以在 markdown 层完全模拟——让 Obsidian / VSCode 都能渲染。

**Polaris 参考实现**（**逐条对应到 file:line**）：

- 文件：
  - 单 paper 编译：[E:/study/Polaris/src/backend/app/services/wiki_compile.py](E:/study/Polaris/src/backend/app/services/wiki_compile.py)
  - concept 库 + wikilink 解析：[E:/study/Polaris/src/backend/app/services/concepts.py](E:/study/Polaris/src/backend/app/services/concepts.py)
  - Obsidian 打包：[E:/study/Polaris/src/backend/app/services/wiki_export.py](E:/study/Polaris/src/backend/app/services/wiki_export.py)
- **Compile-don't-retrieve**：每篇 `Paper` 一次性"编译"进 `wiki_content` markdown。5 段结构（`LIBRARIAN_SYSTEM_PROMPT` 在 [wiki_compile.py:35-57](E:/study/Polaris/src/backend/app/services/wiki_compile.py#L35)）：TL;DR / 研究背景与动机 / 方法 / 实验与结果 / 讨论与可借鉴点。
- `compile_paper`（[wiki_compile.py:122-165](E:/study/Polaris/src/backend/app/services/wiki_compile.py#L122)）调 LLM 最多 2 次：第一次缺 `![[fig:N]]` marker 时，第二次强插。`strip_invalid_figure_markers`（[line 60](E:/study/Polaris/src/backend/app/services/wiki_compile.py#L60)）丢掉 `![[fig:N]]` 中 N 不在 paper `figures` 集合的行。
- **`[[concept]]` 反向链接**（[concepts.py:28](E:/study/Polaris/src/backend/app/services/concepts.py#L28)）：
  ```python
  WIKILINK_RE = re.compile(r"\[\[([^\[\]|#]+?)(?:[|#][^\[\]]*)?\]\]")
  ```
  三种形式：`[[Concept]]` / `[[Concept|alias]]` / `[[Concept#anchor]]`。Embed mark `![[fig:N]]` 被跳过（[concepts.py:67-68](E:/study/Polaris/src/backend/app/services/concepts.py#L67)）。
- `extract_wikilinks`（[line 59](E:/study/Polaris/src/backend/app/services/concepts.py#L59)）：去重 + 保序。`wiki_slug`（[line 75](E:/study/Polaris/src/backend/app/services/concepts.py#L75)）：`name.lower()` 后非 word/非 CJK 字符塌缩为 `-`，空则回落 `sha256(name)[:12]`。
- `link_all_paper_concepts`（[concepts.py:250-401](E:/study/Polaris/src/backend/app/services/concepts.py#L250)）per-project 同步：(1) 抽 wikilink，(2) 创缺 concept 行，(3) `fetch_concept_definitions` 批大小 `_DEF_BATCH_SIZE = 40` 产 `{name, definition, category}`（category ∈ `method, architecture, methodology, problem, metric, dataset, other`），(4) 填 `paper_concepts` 关联行，(5) 清理过期 link，(6) 删 orphan concept。`backfill=True` 用于手动修复；自动路径 backfill 上限 `_AUTO_BACKFILL_CAP = 60` 最旧 placeholder。
- **Obsidian export**（[wiki_export.py:101-211 `build_obsidian_zip`](E:/study/Polaris/src/backend/app/services/wiki_export.py#L101)）：内存 zipfile：
  ```
  index.md
  papers/<slug>.md                  (frontmatter: title/arxiv_id/year/relevance/status/concepts)
  papers/figures/<slug>-fig-<N>.png
  concepts/<slug>.md                (frontmatter: name/category)
  trends.md
  ```

**DPR 实现**：

把"概念"定义为"全局可复用的命名实体"（如 `RAG`、`LoRA`、`Diffusion Model`、`MCTS`），存储在**新目录 `wiki/concepts/<concept_slug>.md`**（推荐放在 `wiki/` 而非 `docs/_concepts/`，与 `docs/papers/` 平行，因为 wiki 是"项目级沉淀"而 `docs/` 是"论文笔记"——目录分离让两个 git workflow 解耦）。每篇速读笔记在生成时由 Step 6 调用 LLM 提取 `concepts: [<list>]`（放 frontmatter），然后**追加**到 `wiki/concepts/<slug>.md` 末尾的 `## 出处` 段（带 `[[<paper_id>-<slug>]]` 双向链接）。**frontmatter 新增字段**：`wiki_compiled: bool` + `wiki_compiled_at: ISO`，区分"已 wiki 化"和"仅速读"两态。

**frontmatter 改造**（**严格保留 [src/6.generate_docs.py:1181-1198](src/6.generate_docs.py#L1181) 现有 8 字段，加 3 个新字段**）：

```python
# 现有（src/6.generate_docs.py:1181-1198）—— 不动
lines = ["---"]
lines.append(f"title: {yaml_escape_value(title)}")
if zh_title:
    lines.append(f"title_zh: {yaml_escape_value(zh_title)}")
lines.append(f"authors: {yaml_escape_value(', '.join(authors) if authors else 'Unknown')}")
lines.append(f"date: {yaml_escape_value(published or 'Unknown')}")
lines.append(f"generated_at: {yaml_escape_value(...)}")
if pdf_url:
    lines.append(f"pdf: {yaml_escape_value(pdf_url)}")
if categories:
    lines.append(f"categories: {categories_to_yaml_inline(categories)}")  # 用 [src/taxonomy.py:108 categories_to_yaml_inline](src/taxonomy.py#L108)
if tags_list:
    lines.append(f"tags: [{', '.join(t for t in tags_list)}]")
lines.append("---")

# 新增（wiki 化时）—— 复用 [src/generate_docs_md_io.py:80-102 upsert_front_matter_field](src/generate_docs_md_io.py#L80)
upsert_front_matter_field(md_text, "wiki_compiled", "true")
upsert_front_matter_field(md_text, "wiki_compiled_at", iso_now)
upsert_front_matter_field(md_text, "concepts", yaml_inline([...]))
```

**概念文件样例**（`wiki/concepts/retrieval-augmented-generation.md`，对齐 Polaris `wiki_export.py` 的 concept frontmatter 字段）：

```markdown
---
concept_id: retrieval-augmented-generation
display_name: Retrieval-Augmented Generation
category: methodology
created_at: 2026-07-21
---

# Retrieval-Augmented Generation (RAG)

由 Patrick Lewis et al. (2020) 提出，将"信息检索 + 文本生成"组合，
用外部知识库缓解 LLM 幻觉。

## 出处

- [[2510.18483v1-starbench-rpg]] — STARBench RPG benchmark
- [[2410.12345v2-xxx-yyy]] — ...

## 反向链接

（由 build_concept_index.py 自动生成）

## 邻近概念

- [[knowledge-distillation]] — 都属于"参数化 vs 非参数化记忆"
- [[prompt-engineering]] — 都属于 LLM 适配层
```

**DPR 概念提取 Prompt**（在 [src/6.generate_docs.py](src/6.generate_docs.py) 调用 LLM）：

```text
从以下论文中提取 3-7 个核心概念，输出 JSON：
{"concepts": [{"name": "概念显示名", "slug": "kebab-case", "category": "method|architecture|methodology|problem|metric|dataset|other", "novelty": 0-1, "centrality": 0-1}]}

novelty: 这个概念在 2025 年是否是"新提出的"（1=新，0=已有）
centrality: 这个概念在这篇论文里的中心程度

category 严格使用 7 个枚举值（对齐 Polaris [concepts.py:250-401](E:/study/Polaris/src/backend/app/services/concepts.py#L250) 7 类别）。
只输出已有领域概念（如 RAG / LoRA / Diffusion），不要编造。
```

**frontmatter 新增字段**：

```yaml
wiki_compiled: true
wiki_compiled_at: "2026-07-21T19:00:00Z"
concepts:
  - slug: retrieval-augmented-generation
    display_name: Retrieval-Augmented Generation (RAG)
    category: methodology
    novelty: 0.0
    centrality: 0.85
  - slug: agent-benchmark
    display_name: Agent Benchmark
    category: dataset
    novelty: 0.6
    centrality: 0.7
```

**DPR 反向链接构建**（`src/concept_index.py`）：

```python
# build_concept_index.py
def rebuild():
    """扫描 docs/papers/**.md（frontmatter.concepts 已 wiki 化的），对每个 concept 更新其 wiki/concepts/<slug>.md 的"出处"和"反向链接"段。"""
    for paper in glob("docs/papers/**/*.md"):
        if not paper.frontmatter.wiki_compiled:
            continue
        for c in paper.frontmatter.concepts:
            update_concept_page(c.slug, paper, link=True)
            append_reverse_link(c.slug, paper)
```

**与 Polaris 的差异**：

- Polaris 用 `Vector(1024)` 嵌入做概念语义匹配（O(n) 扫描 → ANN 检索）；DPR 在 v1 只用**字符串匹配 + slug 等价**（O(n) 但 n 是文档数，< 10K 完全够用）。v2 才会引入 embedding（届时改用浏览器侧 BGE 算 embedding，写到 frontmatter `concept_embeddings: [...]`），**不引入 pgvector**（Polaris 的 `chunks.py:137` semantic_search 走的是 raw SQL pgvector，DPR 没 Postgres）。
- Polaris 的 `knowledge_graph` MCP tool（出图）DPR 落地为 `wiki/concepts/_graph.json`（静态 JSON，含 nodes + edges），浏览器侧用 [astro-src/pages/concepts.astro](astro-src/pages/concepts.astro) 渲染。
- Polaris 的 `[[concept]]` 是 Obsidian 标准 wikilink（`WIKILINK_RE` [concepts.py:28](E:/study/Polaris/src/backend/app/services/concepts.py#L28)）——DPR 直接复用，零工作量（Obsidian 用户开仓库即看到）。
- Polaris `wiki_slug`（[concepts.py:75](E:/study/Polaris/src/backend/app/services/concepts.py#L75)）的 `name.lower()` + 非 word/非 CJK 字符塌缩规则 D P R 完整复用，**不另写 slug 算法**。
- Polaris `_DEF_BATCH_SIZE = 40` 的批量 LLM 调概念定义 D P R 跳过（不需要 definition LLM，slug + display_name 已够）。
- Polaris 7 个 category（`method, architecture, methodology, problem, metric, dataset, other`）D P R 完整复用为 enum。
- **DPR 现有 `paper_paths.paper_id`（[src/paper_paths.py:166](src/paper_paths.py#L166)）产生 `papers/YYYY/MM/DD/<arxiv-id>-<slug>` 不含扩展名——`[[<id>]]` 链接用此 ID 一致引用**。
- **DPR 复用 [src/generate_docs_md_io.py:109-131 `upsert_auto_block`](src/generate_docs_md_io.py#L109) + [src/generate_docs_md_io.py:133-154 `upsert_glance_block_in_text`](src/generate_docs_md_io.py#L133) 在已生成的 md 上追加 `## 出处` 段（不重写全文）**。

**新增页面**（`astro-src/pages/concepts.astro`）：
- 顶部：概念网格（按"近 30 天热度"排序）
- 单个 concept 点击：进 `wiki/concepts/<slug>.md`（Obsidian 渲染）+ 出处论文列表
- 搜索框：客户端 fuzzy search 整个 `wiki/concepts/` 目录

**配置开关**：`config.yaml.concepts.enabled: false`（默认关）。开启后 Step 6 多调用 1 次 LLM（提取概念）+ 运行 `build_concept_index.py`（写文件，不调 LLM）。

**回滚**：
- 把 `concepts.enabled` 设 `false`，Step 6 跳过概念提取。
- 已生成的 `wiki/concepts/*.md` 保留（只是不再被引用，不会被删除）——用户想清理手动 `rm -rf wiki/concepts/`。
- 已 wiki 化的 md `wiki_compiled: true` 不清，让用户决定是否手动 `sed -i 's/wiki_compiled: true/wiki_compiled: false/'`。

**风险**：
- LLM 编造概念（"FakeRAG"）——manifest 加 `concept_slug_pattern: "^[a-z0-9-]+$"` + 白名单（`config/concept_blacklist.yaml` 含 100+ 已知伪概念）。
- 概念碎片化（"RAG" 和 "retrieval-augmented generation" 当两个）——slug 生成时强制 lowercase + hyphen，且维护 `config/concept_aliases.yaml`（"RAG" → "retrieval-augmented-generation"）。
- 文档库爆炸（每概念一个 md）——加 `concept_min_appearances: 2`（只在 ≥2 篇出现的概念才建独立 md）。
- 现有 `docs/_sidebar.md` 全局 sidebar 不包含 wiki 页面——v1 在 sidebar 顶部加 "Wiki" 折叠区。
- **`[astro-src/lib/paper.ts::backfillVenueDim](astro-src/lib/paper.ts)`**（会议名派生自 source 字段）——wiki 概念的 `category` 也照此风格从 `source` 派生，不引入新枚举。

**Effort**：L（3 周）。文件：新增 `src/concept_extractor.py`（~150 行）+ `src/concept_index.py`（~200 行）+ `astro-src/pages/concepts.astro`（~300 行）+ `astro-src/lib/concept_graph.ts`（~120 行）+ 改 [src/6.generate_docs.py](src/6.generate_docs.py) ~30 行 + 改 [src/generate_docs_md_io.py:80-154](src/generate_docs_md_io.py#L80) 支持 `wiki_compiled` 字段。

---

### 能力 5: Idea Forge 多信号 + Elo 辩论 → DPR Topic v2

**动机**：[astro-src/scripts/topic-search.ts:3](astro-src/scripts/topic-search.ts#L3) 的 5 阶段 Topic 模式（`输入 → 拆解 → 搜索 → 总结 → 追问`）只做"用 LLM 拆解研究方向 → 找论文 → 出报告"——但**不解决"什么方向值得研究"**。Polaris 的 Idea Forge 用 4 信号（概念共现缺口 / 论文 limitations / 趋势速度 / 综述缺口）产生 idea 候选，再用 Elo 辩论（K=32, 3 personas: 方法论者/工程师/怀疑论者）排序。DPR 不想引入完整 Forge，但 Topic v2 可以借鉴"多信号 + 辩论排序"把"选哪些论文进入 deep_dive"这件事做得更聪明。

**Polaris 参考实现**（**逐条对应到 file:line**）：

- 文件：
  - 状态/晋升：[E:/study/Polaris/src/backend/app/services/ideas.py](E:/study/Polaris/src/backend/app/services/ideas.py)
  - 7 步 pipeline + debate/review：[E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py)
- **多信号 gap analysis**（`forge.collect_signals` 在 [actions_ideas.py:353](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L353)）。4 个**确定性**信号：
  1. **概念共现缺口**（`concept_holes`）—— `_concept_paper_map`（[line 269](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L269)）连 `Concept × paper_concepts × Paper`。`_concept_holes`（[line 287](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L287)）**纯确定性、无 LLM**：取 top `_HOLE_TOP_CONCEPTS = 8` 个 method/architecture/methodology 概念 + top 8 个 problem 概念（按 paper 数），枚举**零共现**的对，按组合覆盖度排序，返回 top `_HOLE_MAX_PAIRS = 5`。
  2. **趋势速度**（`trends`）—— `_trend_concepts`（[line 320](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L320)）：SQL aggregate over `created_at >= utcnow() - 90 days`（`_TREND_WINDOW_DAYS`），取 top `_TREND_MAX = 5` 个 ≥2 recent paper 的概念。
  3. **论文 limitations**（`limitations`）—— `_limitation_excerpts`（[line 338](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L338)）扫 `paper.full_text_path` 段关键词。
  4. **综述缺口**（`survey_gap`）—— `forge.gap_analysis`（[line 433](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L433)）调 LLM。
- **四维打分**（`forge.score` action，[actions_ideas.py:607-651](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L607)，`_SCORE_DIMS = ("novelty", "feasibility", "operability", "impact")` [line 57](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L57)）：
  - `SCORE_SYSTEM_PROMPT`（[line 84](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L84)）：`{"novelty": 0-10, "feasibility": 0-10, "operability": 0-10, "impact": 0-10, "rationale": {...}}`。
- **语义去重**（`forge.dedup`，[actions_ideas.py:657-766](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L657)）：
  1. `cand_texts = f"{title}\n{summary}"[:2000]`。
  2. `ctx.llm.embed(cand_texts, ...)` 产向量。`NotImplementedError` → 跳过，全过。
  3. `cosine_similarity`（[line 160](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L160)）。
  4. `cosine > threshold`（默认 `0.85` from `DEFAULT_FORGE_KNOBS["dedup_threshold"]`）。
- **Elo pairwise debate tournament**（`review.pair` + `review.match` + `review.summarize`）：
  - Plan 由 `Navigator.review_plan`（[navigator.py:237-258](E:/study/Polaris/src/backend/app/agents/voyage/navigator.py#L237)）发 2 步 plan。
  - **Pairing**：`review.pair`（[actions_ideas.py:859-901](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L859)）按 `Idea.elo_rating DESC, created_at` 排，Swiss 风格相邻配对。
  - **Match**：`review.match`（[line 1097](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L1097)）+ `_run_match`（[line 968](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L968)）：
    1. `rounds` 轮（默认 2，最大 5），两 persona 交替发言，transcript 累积。
    2. Judge persona 产 `{"winner": "a"|"b", "reason": "..."}`。
    3. `elo_update(idea_a.elo, idea_b.elo, winner)`，K=32。
    4. Per-match 失败隔离：返 `{"failed": <error>}` 不 abort voyage。
  - **Persona 解析优先级**（`_personas` [actions_ideas.py:841-849](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L841)）：显式 `params.personas` > `skill_personas("review.debate")` > 内置 `DEFAULT_PERSONAS`。
- **Tournament budget**（[services/ideas.py:146](E:/study/Polaris/src/backend/app/services/ideas.py#L146)）：`budget = {"max_tokens": matches * (2 * rounds + 1) * _TOKENS_PER_MATCH_CALL}`，`_TOKENS_PER_MATCH_CALL = 16_000`。

**DPR 实现**：

把"Topic v2"加在现有 Topic 模式的 `renderSummaryStage` 之后、`renderReportStage` 之前——即"已经搜到 30-50 篇候选 → 排序时引入辩论"。**新文件 `astro-src/scripts/topic-search-v2.ts`**，新增 stages 1.5（gap signals）+ 4.5（Elo debate among top ideas），**不修改** 现有 [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts) 5 阶段。**数据落点**：`archive/<topic_session_id>/ideas/` 目录（每 idea 一份 JSON，辩论日志同目录）——**不引入 Supabase 表**，纯文件系统。

**DPR 信号采集**（4 信号，全部可本地算，**严格对齐 Polaris `_HOLE_TOP_CONCEPTS=8` / `_HOLE_MAX_PAIRS=5` / `_TREND_WINDOW_DAYS=90` / `_TREND_MAX=5` / `DEFAULT_FORGE_KNOBS["dedup_threshold"]=0.85`**）：

| 信号 | 采集方式 | 落盘 | Polaris 对应 |
|------|----------|------|--------------|
| 概念共现缺口 | 扫 `wiki/concepts/*.md` 反向链接频次 + `docs/papers/**/concepts` 段，按 slug 配对零共现 | `signals/concept_holes.json` | [actions_ideas.py:287 `_concept_holes`](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L287) |
| 趋势速度 | 统计过去 90 天每概念出现频次，按月移动平均排序 | `signals/trends.json` | [actions_ideas.py:320 `_trend_concepts`](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L320) |
| 论文 limitations | Step 6 提取每篇 `limitations: "..."` frontmatter 段（已存在） | 已存在 frontmatter | [actions_ideas.py:338 `_limitation_excerpts`](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L338) |
| 综述缺口 | 关键词 `"survey" OR "review"` 检索过去 2 年但无新综述覆盖的概念 | `signals/survey_gaps.json` | [actions_ideas.py:433 `forge.gap_analysis`](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L433) |

**Elo 辩论伪代码**（`src/elo_debate.py`，严格对齐 Polaris K=32 / initial 1200 / per-match-failure-isolation 语义）：

```python
ELO_K = 32                # 对齐 Polaris Idea.elo K
ELO_INITIAL = 1200        # 对齐 Polaris Idea.elo 初值
TOKENS_PER_MATCH_CALL = 16000  # 对齐 Polaris _TOKENS_PER_MATCH_CALL

def run_debate(ideas: List[Idea], personas: List[str], rounds: int = 3) -> List[Idea]:
    """对 ideas 跑 pairwise debate，更新 elo_rating（Swiss 风格配对，非随机）。"""
    elo = {i.id: ELO_INITIAL for i in ideas}
    sorted_ideas = sorted(ideas, key=lambda i: -elo[i.id])
    pairs = [(sorted_ideas[2*k], sorted_ideas[2*k+1]) for k in range(len(sorted_ideas) // 2)]
    for a, b in pairs:
        winner = judge_debate(a, b, personas)  # LLM 返 "a" / "b" / "tie"
        if winner == "tie":
            continue
        Ra, Rb = elo[a.id], elo[b.id]
        Ea = 1 / (1 + 10 ** ((Rb - Ra) / 400))
        Eb = 1 - Ea
        if winner == "a":
            elo[a.id] += ELO_K * (1 - Ea)
            elo[b.id] += ELO_K * (0 - Eb)
        else:
            elo[b.id] += ELO_K * (1 - Eb)
            elo[a.id] += ELO_K * (0 - Ea)
    for i in ideas:
        i.elo_rating = elo[i.id]
    return sorted(ideas, key=lambda i: i.elo_rating, reverse=True)
```

**Idea 数据形态**（`archive/<topic_session_id>/ideas/idea_001.json`，对齐 Polaris `ideas` 表字段 `elo_rating, matches, wins`）：

```json
{
  "idea_id": "idea_001",
  "session_id": "topic_2026-07-21_abc",
  "title": "用 RAG + Reflection 缓解 LLM 工具调用幻觉",
  "depth": "sketch",
  "scores": {
    "novelty": 7,
    "feasibility": 8,
    "operability": 6,
    "impact": 7.5,
    "rationale": {
      "novelty": "已有 RAG + Reflection 组合工作但未在工具调用场景",
      "feasibility": "现有 RAG 工具链成熟，Reflection prompt 易实现"
    }
  },
  "elo_rating": 1245,
  "matches": 6,
  "wins": 4,
  "evidence": [
    {"paper_id": "2510.18483v1", "claim": "工具调用幻觉率 23%"},
    {"paper_id": "2410.12345v2", "claim": "Reflection 降低幻觉 8%"}
  ],
  "goal": {
    "explore": "现有 reflection 方法在工具调用场景的有效性",
    "refine": "具体到 multi-turn agent 的 reflection 频次策略"
  },
  "signals": ["concept_holes:RAG×Reflection", "trends:agent-benchmark"],
  "debate_log": "debate/idea_001.json"
}
```

**debate log 样例**（`archive/<topic_session_id>/debate/idea_001.json`，对齐 Polaris `ReviewSession` shape）：

```json
{
  "idea_id": "idea_001",
  "session_type": "idea_match",
  "matches": [
    {
      "round": 1,
      "match": {"a": "idea_001", "b": "idea_002"},
      "personas": ["方法论者", "工程师", "怀疑论者"],
      "transcript": [
        {"persona": "方法论者", "content": "idea_001 的 reflection 机制缺乏理论保证..."},
        {"persona": "工程师", "content": "从实现角度看 reflection 增加 30% 延迟..."},
        {"persona": "怀疑论者", "content": "idea_001 的 novelty 仅 0.7，已有类似工作..."}
      ],
      "judge": {"winner": "a", "reason": "idea_001 evidence 更强"},
      "elo_delta": {"a": 12, "b": -12}
    }
  ]
}
```

**浏览器侧入口**：在 [astro-src/pages/topic.astro:176](astro-src/pages/topic.astro#L176) `renderSummaryStage` 后增加 `renderDebateStage`（可视化"哪些 idea 在打擂"，带进度条 + persona 气泡），完成后跳 [astro-src/pages/topic.astro:191](astro-src/pages/topic.astro#L191) `renderReportStage`。**不修改** 现有 [astro-src/scripts/topic-search.ts:797 `decomposeIdea`](astro-src/scripts/topic-search.ts#L797) / [:2746 `doDecompose`](astro-src/scripts/topic-search.ts#L2746) / [:188-235 `EXPLORE_FROM_SEEDS_SYSTEM`](astro-src/scripts/topic-search.ts#L188)——v2 是新文件 [astro-src/scripts/topic-search-v2.ts](astro-src/scripts/topic-search-v2.ts) 平级。

**与 Polaris 的差异**：

- Polaris 把 idea 存 DB（`ideas` 表）并跨 session 复用；DPR 落 `archive/<session_id>/ideas/` 文件系统，仅本 session 用。
- Polaris 用 Postgres `review_sessions`；DPR 用 `archive/<session_id>/debate/` 目录。
- Polaris 的 3 personas 是后端固定（`DEFAULT_PERSONAS` = 建设性支持者 / 复现怀疑派 / 中立方法论裁判，[actions_ideas.py:841-849](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L841)）；DPR 让用户在 settings 改（`topic.v2.personas: ["方法论者", "工程师", "怀疑论者", "<自定义>"]`）。
- Polaris 的 Elo K=32、初始 1200 全局共享；DPR 每个 session 独立（"我今天这场辩论"），K=32 / 1200 沿用（不改常数值）。
- Polaris 的 budget 计算（`matches * (2 * rounds + 1) * 16_000`）DPR 用同样公式预算 token 上限，超 `topic.v2.budget_tokens` 时提前结束。
- Polaris 的 per-match-failure-isolation 语义 D P R 完整复刻——`run_match` 失败返 `{"failed": <error>}`，不让整个 debate 崩。
- Polaris 配对用 Swiss 风格（按当前 elo 排序相邻配对）D P R 完整复刻，不走 random。

**配置开关**（**沿用 Polaris 4 个常量默认值**）：

```yaml
topic:
  v2:
    enabled: false
    elo_k: 32                  # 对齐 ELO_K
    elo_initial: 1200          # 对齐 ELO_INITIAL
    debate_rounds: 3
    debate_max_ideas: 8        # 限制前 8 名参与，剩下按 novelty 直接排
    budget_tokens: 800000      # matches * (2*3+1) * 16000 ≈ 8*7*16000 = 896000
    personas: ["方法论者", "工程师", "怀疑论者"]
    hole_top_concepts: 8       # 对齐 _HOLE_TOP_CONCEPTS
    hole_max_pairs: 5          # 对齐 _HOLE_MAX_PAIRS
    trend_window_days: 90      # 对齐 _TREND_WINDOW_DAYS
    trend_max: 5               # 对齐 _TREND_MAX
    dedup_threshold: 0.85      # 对齐 DEFAULT_FORGE_KNOBS["dedup_threshold"]
```

**回滚**：`topic.v2.enabled: false` 即回退到 v1（纯 LLM 排序），不动现有数据；[astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts) 不动。

**风险**：
- LLM debate 引入 6+ 次 LLM call（2 ideas/match × 3 rounds × 3 personas）——加 `topic.v2.debate_max_ideas: 8` 限制范围。
- 浏览器侧 debate 状态断电丢失——复用 `localStorage['dpr_topic_session_v1']`（[topic-search.ts:64](astro-src/scripts/topic-search.ts#L64)），加 `debate_progress` 字段。
- LLM judge 偏向"说更多"而非"说得对"——rubric 加"reason 必须 < 50 字且引用 evidence"。
- concept_hole 算的太慢（O(n²) 配对）——`wiki/concepts/` 限制在 200 个以内，O(200²) = 40K 次 string compare 完全可接受。
- **localStorage 大小**（[topic-search.ts:80-82](astro-src/scripts/topic-search.ts#L80) `TOTAL_BYTES_LIMIT=4MB / PER_SESSION=800KB`）——debate transcript 可能膨胀，rubric 限制每 match transcript ≤ 2KB。

**Effort**：XL（5 周）。文件：新增 `src/elo_debate.py`（~200 行，对齐 Polaris [actions_ideas.py:968 _run_match](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L968)）+ `src/idea_signals.py`（~250 行，对齐 Polaris 4 信号 [actions_ideas.py:353](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L353)）+ `astro-src/scripts/topic-search-v2.ts`（~500 行，含 Elo 辩论）+ 改 [astro-src/pages/topic.astro:176-191](astro-src/pages/topic.astro#L176) 插入新 stage。

---

### 能力 6: Paper Review 引用核查 → DPR Citation Guard

**动机**：[astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) `DEEPDIVE_SYSTEM_PROMPT` 让 LLM 写"## 七、相关工作"段时**几乎必然编造引用**——这是 LLM 已知缺陷。DPR 现在的 docs 没有任何引用字段（速读只有 4 段 500-800 字），但 Deep Dive 8 章节会写大量 [1] [2] 这种引用标记，必须有护栏。Polaris 的 Paper Review 用 6 步（`citation_check → fact_check → render → referees×3 → meta_review → guardrail`）且**严格分类**（`EXACT_SIMILARITY=0.92` / `MINOR_SIMILARITY=0.75` / `YEAR_TOLERANCE=1` 判定 fabricated，1 个 fabricated 强制 `review_passed=False`）。DPR 不写 LaTeX，但"精读里的引用必须可核"是同等级需求。

**Polaris 参考实现**（**逐条对应到 file:line**）：

- 文件：
  - LaTeX 解析 + 存在性 + 支持 + fact-check + 聚合：[E:/study/Polaris/src/backend/app/services/paper_review.py](E:/study/Polaris/src/backend/app/services/paper_review.py)
  - BibTeX / CSL-JSON export：[E:/study/Polaris/src/backend/app/services/citations.py](E:/study/Polaris/src/backend/app/services/citations.py)
  - voyage action：[E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py](E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py)
- **三态存在性**（`classify_fuzzy_hits` 在 [paper_review.py:222-242](E:/study/Polaris/src/backend/app/services/paper_review.py#L222)）：
  ```python
  def classify_fuzzy_hits(title, year, hits) -> tuple[str, str|None]:
      # sim = difflib.SequenceMatcher.ratio() on _normalize_title (lowercase + strip punct)
      # EXACT_SIMILARITY = 0.92
      # MINOR_SIMILARITY = 0.75
      # YEAR_TOLERANCE = 1
      if best_sim >= 0.92 and _year_ok(year, best_year):  return "exact", best_title
      if best_sim >= 0.75:                                return "minor", best_title
      return "fabricated", None
  ```
- `check_citation_existence`（[paper_review.py:282-320](E:/study/Polaris/src/backend/app/services/paper_review.py#L282)）：
  1. **Library exact match**：若 fact-pack `citations[].paper_id` 在项目里能解析到 `Paper` 行 → `existence="exact"`，`source="library"`。
  2. **Remote fuzzy match**：`match_citation_remote`（[line 245](E:/study/Polaris/src/backend/app/services/paper_review.py#L245)）调 `SemanticScholar.search_papers(title, limit=5)` → fallback `OpenAlexClient.search_works(title, limit=5)`。
- **三态支持**由 LLM step `review.citation_check`（[actions_review.py:252-304](E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py#L252)）填：
  ```python
  SUPPORT_SYSTEM_PROMPT = """{"support": "supported" | "partial" | "unsupported", "reason": "..."}"""
  ```
  上限 `MAX_SUPPORT_CHECKS = 30`。
- **数字 fact-check**（两层）：
  1. **确定性**（[paper_review.py:378-457 `scan_fact_issues`](E:/study/Polaris/src/backend/app/services/paper_review.py#L378)）：`_PERCENT_NUM_RE`（`42\%`/`42%`）+ `_DECIMAL_RE`（`3.14`）+ `_number_ok`（[line 352](E:/study/Polaris/src/backend/app/services/paper_review.py#L352)）+ `NUMBER_TOLERANCE = 0.01`。
  2. **Claim 采样**（[actions_review.py:331-371 `review.fact_check`](E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py#L331)）。
- **1 个 fabricated 引用强制失败**于 `review_passed`（[paper_review.py:554-559](E:/study/Polaris/src/backend/app/services/paper_review.py#L554)）：
  ```python
  def review_passed(meta: dict, citation_check: dict) -> bool:
      has_fabricated = any(
          i.get("existence") == "fabricated"
          for i in citation_check.get("items") or []
      )
      return float(meta.get("rating") or 0) >= PASS_RATING and not has_fabricated
  ```
  `PASS_RATING = 6.0`。

**DPR 实现**：

把"Citation Guard"作为 Deep Dive 生成后的**独立 step**。落地为 **新文件 `src/citation_guard.py`**（精确名匹配 Polalis `paper_review.py`），**在 Step 4 LLM Refine 后、Step 6 Generate Docs 前调用**（即 [src/main.py:868-871](src/main.py#L868) 之后、[src/main.py:884-897](src/main.py#L884) 之前；DPR 现有 `process_paper` 在 [src/6.generate_docs.py:1599](src/6.generate_docs.py#L1599) 写盘时加 hook）。

**Citation Guard 数据形态**（`docs/papers/2026/07/21/2510.18483v1-starbench-rpg.citations.json`，**严格对齐 Polaris [paper_review.py:554-559](E:/study/Polaris/src/backend/app/services/paper_review.py#L554) `review_passed` 字段**）：

```json
{
  "paper_id": "2510.18483v1",
  "verified_at": "2026-07-21T20:00:00Z",
  "pass": false,
  "pass_rating": 6.0,
  "summary": {
    "total": 7,
    "exact": 5,
    "minor": 1,
    "fabricated": 1,
    "supported": 4,
    "partial": 1,
    "unsupported": 0,
    "not_checked": 2
  },
  "citations": [
    {
      "marker": "[1]",
      "raw_text": "Lewis et al., 2020, Retrieval-Augmented Generation",
      "existence": "exact",
      "support": "supported",
      "match": {
        "source": "library",
        "paper_id": "arxiv:2005.11401",
        "title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        "year": 2020,
        "similarity": 1.0,
        "year_tolerance": 0
      },
      "support_reason": "原文引用与 Lewis 2020 论文标题 100% 匹配"
    },
    {
      "marker": "[5]",
      "raw_text": "Smith 2023, A New Method for X",
      "existence": "fabricated",
      "support": "not_checked",
      "match": null,
      "reason": "[existence] S2+OpenAlex+library 三源未找到匹配（最高相似度 0.71 < 0.92 EXACT_SIMILARITY；0.71 < 0.75 MINOR_SIMILARITY；判定 fabricated）"
    }
  ],
  "fabricated_action": "replace_with_question_mark"
}
```

**判定规则**（**逐条对齐 Polaris constants**）：

| Polaris 常量 | DPR 落点 | 值 |
|--------------|----------|----|
| `EXACT_SIMILARITY` ([paper_review.py:222-242](E:/study/Polaris/src/backend/app/services/paper_review.py#L222)) | `src/citation_guard.py::EXACT_SIMILARITY` | `0.92` |
| `MINOR_SIMILARITY` ([paper_review.py:222-242](E:/study/Polaris/src/backend/app/services/paper_review.py#L222)) | `src/citation_guard.py::MINOR_SIMILARITY` | `0.75` |
| `YEAR_TOLERANCE` ([paper_review.py:222-242](E:/study/Polaris/src/backend/app/services/paper_review.py#L222)) | `src/citation_guard.py::YEAR_TOLERANCE` | `1` |
| `NUMBER_TOLERANCE` ([paper_review.py:352](E:/study/Polaris/src/backend/app/services/paper_review.py#L352)) | `src/citation_guard.py::NUMBER_TOLERANCE` | `0.01` |
| `MAX_SUPPORT_CHECKS` ([actions_review.py:222](E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py#L222)) | `src/citation_guard.py::MAX_SUPPORT_CHECKS` | `30` |
| `MAX_GUARDRAIL_REGENS` ([paper_review.py:501-540](E:/study/Polaris/src/backend/app/services/paper_review.py#L501)) | `src/citation_guard.py::MAX_GUARDRAIL_REGENS` | `2` |
| `PASS_RATING` ([paper_review.py:554-559](E:/study/Polaris/src/backend/app/services/paper_review.py#L554)) | `src/citation_guard.py::PASS_RATING` | `6.0` |

**判定流程**（**逐条对齐 Polaris [paper_review.py:282-320 check_citation_existence](E:/study/Polaris/src/backend/app/services/paper_review.py#L282)**）：

1. **Library exact match**（对齐 Polaris step 1）：扫 `docs/papers/**/*.md` frontmatter 提取 `paper_id`（[src/paper_paths.py:166 `paper_id`](src/paper_paths.py#L166) 形式 `papers/YYYY/MM/DD/<arxiv-id>-<slug>`）；若 `[[<paper_id>-<slug>]]` 在仓库中已存在 → `existence="exact"`，`source="library"`。
2. **S2 fuzzy match**（对齐 Polaris step 2 path 1）：调 `https://api.semanticscholar.org/graph/v1/paper/search?query=<title>&limit=5`，`difflib.SequenceMatcher.ratio()` 算相似度（**完整复用 Polaris `_normalize_title` 算法** = lowercase + strip punct）。
3. **OpenAlex fallback**（对齐 Polaris step 2 path 2）：调 `https://api.openalex.org/works?search=<title>&per_page=5`。
4. 三规则按顺序匹配：先 in-library → `exact`；再 S2 / OpenAlex 满足 `EXACT_SIMILARITY=0.92` + `YEAR_TOLERANCE=1` → `exact`；满足 `MINOR_SIMILARITY=0.75` → `minor`；都未命中 → `fabricated`。
5. **Support 检查**（对齐 Polaris `actions_review.py:252-304 citation_check`）：对所有 `existence != "fabricated"` 的引用，LLM 调 `{"support": "supported" | "partial" | "unsupported", "reason": "..."}`。上限 `MAX_SUPPORT_CHECKS = 30`。
6. **Pass 判定**（对齐 Polaris `paper_review.py:554-559 review_passed`）：`pass = (no fabricated) && (summary.supported / summary.checked) ≥ PASS_RATING / 10 = 0.6`。

**Fail 行为**（v1）：

- 把 `fabricated` 引用替换为 `[?]` 占位符（**复用 [src/generate_docs_md_io.py:80-102 `upsert_front_matter_field`](src/generate_docs_md_io.py#L80) + [src/generate_docs_md_io.py:109-131 `upsert_auto_block`](src/generate_docs_md_io.py#L109) 在已写盘 md 上修改**）
- 在文档顶部加 `> ⚠️ 1 处引用未通过核查（见 `*.citations.json`）`
- 浏览器侧可视化用红色徽章显示

**CLI 模式**（`src/citation_guard.py`）：

```bash
python -m citation_guard docs/papers/2026/07/21/2510.18483v1-starbench-rpg.md
# 写出 2510.18483v1-starbench-rpg.citations.json
# 若 fabricated > 0，退出码 2（区别于 0=pass / 1=error）
```

GitHub Action [save-paper.yml](.github/workflows/save-paper.yml) 在用户保存精读后**自动**调用 `citation_guard` CLI，把结果写回 commit。

**与 Polaris 的差异**：

- Polaris 6 步流水线是"提交前 review"（`review.guardrail` 阻塞 submission）；DPR 是"生成后 audit"（不阻塞 commit，只标记）——`review_passed` 降级为信息性字段，不阻止 save。
- Polaris 的 `referees×3`（每 referee 一份 guardrail）DPR 简化为单次 LLM 提取 + 规则判定——不引入 LLM-as-judge 评审（成本太高）。`MAX_GUARDRAIL_REGENS = 2` 不复用。
- Polaris 的 `meta.rating ≥ 6.0`（`PASS_RATING`）DPR 简化为"`summary.fabricated == 0` AND `(supported / checked) ≥ 0.6`"——`PASS_RATING / 10` 因为 D P R 没有 1-10 评审 score。
- Polaris 的 `support` LLM 步骤（`_validate_support` [actions_review.py:222](E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py#L222)）D P R 完整复用，但默认 `enabled: false`（避免 7 引用 × 1 LLM call 的额外成本）。
- Polaris 的 LaTeX number fact-check（`scan_fact_issues` [paper_review.py:378-457](E:/study/Polaris/src/backend/app/services/paper_review.py#L378)）D P R 跳过（不写 LaTeX），但 `NUMBER_TOLERANCE=0.01` 复刻到 markdown 数字校验（如果用户启用）。
- Polaris 的 aggregate_reviews 加权算法 D P R 不复用（DPR 是 per-paper，不是 per-manuscript aggregation）。
- **DPR 现有 Step 4 LLM Refine system_prompt 位置**（[src/4.llm_refine_papers.py:352-357](src/4.llm_refine_papers.py#L352)）——这里是 LLM 已经产 `cite-of-papers` 的地方，Citation Guard 在它之后接。

**Sources 选择**（DPR 已有的 + 新增）：
- `semantic_scholar`：用 Polaris 同款 API（`https://api.semanticscholar.org/graph/v1/paper/search?query=...`），但 DPR 不引入 API key（rate limit 100/分钟够个人用）。
- `openalex`：polite pool（mailto），同 Polaris。
- in_library：扫 `docs/papers/**/*.md` frontmatter 提取 `paper_id`（**复用 [src/paper_paths.py:166](src/paper_paths.py#L166) `paper_id` 函数**）。
- **CORS 走 [functions/api/proxy.ts](functions/api/proxy.ts) 端点**——浏览器侧跑时 S2/OpenAlex 走 [functions/api/proxy.ts:139-153](functions/api/proxy.ts#L139) allow-list（需要把 `api.semanticscholar.org` + `api.openalex.org` 加入 allow-list）。

**配置开关**：
- `config.yaml.citation_guard.enabled: false`（默认关）
- `config.yaml.citation_guard.sources: ["semantic_scholar", "openalex", "in_library"]`（对齐 Polaris 顺序）
- `config.yaml.citation_guard.fabricated_action: "replace_with_question_mark"`（其他可选：`remove` / `mark_only`）
- `config.yaml.citation_guard.run_support_check: false`（默认关，省 LLM call）

**回滚**：
- `citation_guard.enabled: false` 即跳过——保存流程不变。
- 已存在的 `*.citations.json` 文件不删，下次开可增量更新。

**风险**：
- S2 API 限流（429）——加指数退避（与 Polaris 一致：1s/2s/4s/8s/16s，最多 5 次重试）。
- 用户在浏览器侧跑 citation guard 会暴露 S2 API key（虽然 S2 公开 API 无 key）——DPR 全部走 GitHub Actions 后端 CLI，浏览器只读结果。
- `minor` 引用（年份差 1）用户体验差——v1 把 `minor` 视为 `exact`，仅 `fabricated` 才标红。
- `NUMBER_TOLERANCE=0.01` 在 markdown 上下文不直接适用（用户写"准确率 0.78 ± 0.02"会被误判）——v1 跳过 number check，仅做 existence + support。
- [functions/api/proxy.ts:43-80](functions/api/proxy.ts#L43) rate limit `RATE_LIMIT_TOKENS=30 / 60_000ms`——浏览器侧批量跑会被限流，v1 默认走 CLI 不走浏览器。

**Effort**：M（2 周）。文件：新增 `src/citation_guard.py`（~300 行，对齐 Polaris [paper_review.py:222-320](E:/study/Polaris/src/backend/app/services/paper_review.py#L222) + [actions_review.py:252-304](E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py#L252)）+ `astro-src/scripts/citation-guard.ts`（~250 行）+ 改 [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) 在生成后插入 guard 步骤 + 改 [src/6.generate_docs.py:1599](src/6.generate_docs.py#L1599) `process_paper` 在写盘后调 guard + 改 [save-paper.yml](.github/workflows/save-paper.yml) 调用 CLI + 改 [functions/api/proxy.ts:139-153](functions/api/proxy.ts#L139) allow-list 加 S2/OpenAlex 域名。

---

### 能力 7: 阶段化 LLM 路由 → DPR Stage Routing

**动机**：DPR 现在所有 LLM call 走同一个 `LLM_MODEL` 环境变量（[src/llm.py:851-871 `ClientFactory.from_env`](src/llm.py#L851) 读 `os.environ.get("LLM_MODEL")`），从 Step 0 关键词改写到 Step 6 深度精读都用同一个 model——这既浪费（小任务用 128K 模型太贵）又不灵活（用户想让 deep dive 切到 opus 但不想让 enrich 也用 opus）。**DPR 现有的 1 个旁路**：`resolve_summary_step_env()`（[src/main.py:402-427](src/main.py#L402)）让 Step 6 单独 override env，**但仅 1 个 stage**——Polaris 的 `core/llm/router.py` 把 19 个 stage 分别路由到 (provider, model, temperature)，缓存 60s，每次调用写 `LLMUsage` 计入 user+project+voyage。

**Polaris 参考实现**（**逐条对应到 file:line**）：

- 文件：
  - admin CRUD：[E:/study/Polaris/src/backend/app/services/llm_admin.py](E:/study/Polaris/src/backend/app/services/llm_admin.py)
  - runtime stage→provider 解析：[E:/study/Polaris/src/backend/app/core/llm/router.py](E:/study/Polaris/src/backend/app/core/llm/router.py)
  - DB 模型：[E:/study/Polaris/src/backend/app/models/llm_config.py](E:/study/Polaris/src/backend/app/models/llm_config.py)
- DB schema：`LLMProviderConfig`（`llm_providers`：`id/name/kind/base_url/api_key_encrypted(Fernet)/enabled`）+ `ModelRoute`（`model_routes`：`id/stage(unique)/provider_id/model/temperature`）+ `LLMUsage`（`llm_usage`：`id/user_id/project_id/voyage_id/stage/model/prompt_tokens/completion_tokens/created_at/updated_at`）。
- **19 stages**（[router.py:29-48](E:/study/Polaris/src/backend/app/core/llm/router.py#L29)）：
  ```python
  STAGES = (
      "default", "navigator", "sextant", "interview", "relevance",
      "forge", "forge_signal", "goal_explore", "proposal", "proposal_review",
      "debate", "experiment", "writing", "review", "reading",
      "librarian", "embedding", "rerank",
  )
  ```
  **正好 19 个**。每个 `ModelRoute` 把一个 stage 绑到一个 provider（含 model + 可选 temperature）。
- `STREAM_STAGES`（[router.py:71-73](E:/study/Polaris/src/backend/app/core/llm/router.py#L71)）：`{navigator, debate, experiment, writing, proposal, review, librarian, present}` —— 8 个 stream，token delta 按 `_STREAM_FLUSH_CHARS = 80` chunk 刷新。
- **Provider kinds**（`_provider_for` [router.py:124-140](E:/study/Polaris/src/backend/app/core/llm/router.py#L124)）：`openai_compat` / `anthropic` / `fake`。Provider 实例按 `(kind, base_url, api_key)` 缓存。
- **解析回退**（[router.py:142-146](E:/study/Polaris/src/backend/app/core/llm/router.py#L142)）：`routes[stage] → routes["default"] → _FALLBACK_ROUTE`。缓存 `_ROUTE_CACHE_TTL = 60s`。Admin 改动调 `get_llm_router().invalidate_cache()`。
- **每次调用的 `LLMUsage` attribution**：每次 `complete()` / `embed()` / `rerank()` / `stream()` 在 [router.py](E:/study/Polaris/src/backend/app/core/llm/router.py) 调 `_record_usage(stage, model, usage, user_id, project_id, voyage_id)`。调用方传 IDs（如 [actions_ideas.py:151-152](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L151)）。
- Provider 不返 usage 时的 token 估算：`_ensure_usage`（[line 178](E:/study/Polaris/src/backend/app/core/llm/router.py#L178)）：`len(content) / 4` for both prompt and completion。

**DPR 实现**：

引入"Stage Routing"概念。**载体：`LLM_STAGE_MODELS` map in `config.yaml`**（**与 Polaris `model_routes` 表的 stage → (provider, model, temperature) 同构**）——`src/llm.py` 在不破坏现有 `LLM_MODEL` 单值语义的前提下**新增** `route_llm_call(stage, **kwargs)` 函数（仿照 [src/llm.py:851-871 `ClientFactory.from_env`](src/llm.py#L851)）。

**关键约束**：DPR 现有 [src/llm.py:835-848 `parse_provider_model`](src/llm.py#L835) 解析 `'provider/model'` 字符串，**所有 stage 共享一个 env**（`LLM_MODEL` 必填，[src/llm.py:851](src/llm.py#L851)）。新增路由**不破坏**这条主路径——仅在 `route_llm_call` 内做 stage → override 查找；找不到时 fallback 到 `LLM_MODEL` env。**对 Step 6 已有旁路**（[src/main.py:402-427 `resolve_summary_step_env`](src/main.py#L402)）——把它的逻辑吸进统一 router，**取代**这个特殊 case。

**DPR 的 stage 列表**（vs Polaris 19 个，DPR 实际只 8 个，**stage 名严格对齐 Polaris 命名**）：

| stage | 调用点 | DPR 默认 model | 对应 Polaris stage |
|-------|--------|----------------|---------------------|
| `enrich` | [src/0.enrich_config_queries.py](src/0.enrich_config_queries.py) | `BLT_REWRITE_MODEL` env 默认 `gemini-3-flash-preview`（[0.enrich_config_queries.py:19](src/0.enrich_config_queries.py#L19)） | (新, 接近 relevance) |
| `refine` | [src/4.llm_refine_papers.py:352](src/4.llm_refine_papers.py#L352) | `LLM_MODEL` env | (新, 接近 forge.score) |
| `select` | [src/5.select_papers.py](src/5.select_papers.py) | `LLM_MODEL` env | (新, 接近 forge.score) |
| `doc.generate` | [src/6.generate_docs.py](src/6.generate_docs.py) | `LLM_MODEL` env | (新, 接近 librarian) |
| `analyzer.deepdive` | [astro-src/scripts/paper-analyzer.ts:1496](astro-src/scripts/paper-analyzer.ts#L1496) | `LLM_DEFAULTS.model` = `deepseek-chat`（[settings.ts:85-88](astro-src/scripts/settings.ts#L85)） | (新, 接近 writing) |
| `topic.facet` | [astro-src/scripts/topic-search.ts:797 `decomposeIdea`](astro-src/scripts/topic-search.ts#L797) | 同上 | (新) |
| `topic.summary` | `topic.summarizeOne` | 同上 | (新, 接近 reading) |
| `topic.report` | `topic.TOPIC_REPORT_SYSTEM` | 同上 | (新, 接近 librarian) |
| `default` | (兜底) | `LLM_MODEL` env | default |

**config.yaml 新增 `LLM_STAGE_MODELS`**（**对齐 Polaris ModelRoute schema**）：

```yaml
# 取代 [src/main.py:402-427 resolve_summary_step_env](src/main.py#L402) 旁路
llm_stage_models:
  enrich:
    provider_model: "blt/gemini-3-flash-preview"   # 解析走 [src/llm.py:835 parse_provider_model](src/llm.py#L835)
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
```

**Router 实现**（`src/llm.py` 增量，**严格对齐 Polaris [router.py:124-146](E:/study/Polaris/src/backend/app/core/llm/router.py#L124) 解析逻辑**）：

```python
# src/llm.py 增量
ROUTE_CACHE_TTL = 60  # 对齐 Polaris _ROUTE_CACHE_TTL = 60s

class LLMRouter:
    def __init__(self, config):
        self.routes = config.get("llm_stage_models", {})
        self._cache = {}  # stage → (provider, model, temperature, cached_at)
    
    def resolve(self, stage: str) -> dict:
        now = time.time()
        if stage in self._cache and now - self._cache[stage]["cached_at"] < ROUTE_CACHE_TTL:
            return self._cache[stage]
        # 对齐 Polaris: routes[stage] → routes["default"] → env fallback
        route = self.routes.get(stage, self.routes.get("default", {}))
        if not route:
            return {"provider_model": os.environ.get("LLM_MODEL", "deepseek-chat"), "temperature": 0.0}
        # 处理 ${LLM_MODEL} 占位符
        pm = route["provider_model"]
        if pm.startswith("${") and pm.endswith("}"):
            pm = os.environ.get(pm[2:-1], "deepseek-chat")
        self._cache[stage] = {**route, "provider_model": pm, "cached_at": now}
        return self._cache[stage]
    
    def call(self, stage: str, **kwargs):
        route = self.resolve(stage)
        provider_model = route["provider_model"]
        # 解析走现有 [src/llm.py:835 parse_provider_model](src/llm.py#L835)
        provider, model = parse_provider_model(provider_model)
        client = ClientFactory.create(provider, model)
        return client.chat(temperature=route.get("temperature", 0.5), **kwargs)
    
    def invalidate_cache(self):
        """对齐 Polaris get_llm_router().invalidate_cache()。"""
        self._cache.clear()
```

**Usage 日志**（**对齐 Polaris `LLMUsage` 表字段，简化写 JSONL**）：

```jsonl
{"ts": "2026-07-21T18:30:42Z", "stage": "refine", "provider": "deepseek", "model": "deepseek-chat", "temperature": 0.2, "tokens_in": 18142, "tokens_out": 2841, "latency_ms": 1830, "cost_usd": 0.0014, "archive_date": "20260721", "user_id": "github:owner", "project_id": null, "voyage_id": null}
{"ts": "2026-07-21T18:31:08Z", "stage": "analyzer.deepdive", "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.7, "tokens_in": 42500, "tokens_out": 8120, "latency_ms": 31200, "cost_usd": 0.0214, "archive_date": "20260721"}
```

写入 `archive/llm_usage.jsonl`（追加，cron 启动时按月 rotate）。**字段名严格对齐 Polaris `LLMUsage` 表**（`stage/model/prompt_tokens/completion_tokens/created_at/updated_at` → DPR `stage/model/tokens_in/tokens_out/ts/...`）。

**Token 估算**（**对齐 Polaris `_ensure_usage` [router.py:178](E:/study/Polaris/src/backend/app/core/llm/router.py#L178)**）：

```python
def _ensure_usage(usage: dict | None, prompt: str, completion: str) -> dict:
    if usage:
        return usage
    return {
        "tokens_in": len(prompt) // 4,
        "tokens_out": len(completion) // 4,
    }
```

**Usage 聚合**（**对齐 Polaris `usage_report` [llm_admin.py:128-166](E:/study/Polaris/src/backend/app/services/llm_admin.py#L128)**）：

```python
# src/llm_usage_report.py
def aggregate(jsonl_path: str) -> dict:
    """对齐 Polaris usage_report(date × stage × model)。"""
    by_key = defaultdict(lambda: {"tokens_in": 0, "tokens_out": 0, "calls": 0})
    for line in read_jsonl(jsonl_path):
        date = line["ts"][:10]
        key = (date, line["stage"], line["model"])
        by_key[key]["tokens_in"] += line["tokens_in"]
        by_key[key]["tokens_out"] += line["tokens_out"]
        by_key[key]["calls"] += 1
    return dict(by_key)
```

**Stream stages**（**对齐 Polaris `STREAM_STAGES` [router.py:71-73](E:/study/Polaris/src/backend/app/core/llm/router.py#L71) 的 8 个**）：

```yaml
llm_stage_models:
  stream_stages:
    - "analyzer.deepdive"   # 8 章节长文，stream
    - "topic.report"        # Topic 报告，stream
  # 其他 stage 默认 non-stream
  # 对齐 Polaris STREAM_STAGES: {navigator, debate, experiment, writing, proposal, review, librarian, present}
```

**浏览器侧**（`astro-src/lib/llm.ts` 增量）的等价实现（**对齐 Polaris `_provider_for` 缓存语义 + [astro-src/scripts/settings.ts:465-516 PROVIDER_PRESETS](astro-src/scripts/settings.ts#L465) 复用**）：

```ts
const ROUTE_CACHE_TTL = 60_000;  // ms，对齐 Polaris 60s
let _routeCache: Map<string, {route: Route, cachedAt: number}> = new Map();

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
```

**与 Polaris 的差异**：

- Polaris 的 `LLMProvider` 抽象支持多 provider（OpenAICompat / Anthropic / Fake，[router.py:124-140](E:/study/Polaris/src/backend/app/core/llm/router.py#L124)）；DPR 仅用 BLT + 9 个 provider（[src/llm.py:912-938](src/llm.py#L912) 列 `deepseek, siliconflow, ollama, blt/bltcy/plato, cstcloud, minimax/minimaxi, glm/zhipu, kimi/moonshot` + fallback `LLMClient`），**复用现有 `ClientFactory.from_env()` 解析**，不引入多 provider 抽象层。
- Polaris 的 `LLMUsage` 写 DB（可跨 voyage 汇总）；DPR 写 JSONL（按月手动汇总到 `docs/usage/<YYYY-MM>.md`）。
- Polaris 缓存 60s（`_ROUTE_CACHE_TTL = 60s`）；DPR 也 60s（in-process dict，**常量名完全相同**）。
- Polaris 的 Fernet 加密 API key D P R 不引入（API key 已通过 GitHub Secrets 加密存，runtime 再读 env）。
- Polaris `STREAM_STAGES` 8 个 stage（[router.py:71-73](E:/study/Polaris/src/backend/app/core/llm/router.py#L71)）D P R v1 只 stream 2 个（`analyzer.deepdive` + `topic.report`），其他 non-stream——避免浏览器侧 stream 处理复杂度。
- Polaris 的 `ModelRoute` 强约束"one route per stage"（DB unique on `stage`）D P R 复刻为 YAML key 唯一（同一 stage 不能配两次）。
- Polaris 的 provider 缓存 `(kind, base_url, api_key)` 三元组 D P R 简化为单 key `provider_model` 字符串。
- **DPR 现有 Step 6 旁路**（[src/main.py:402-427 `resolve_summary_step_env`](src/main.py#L402)）——**吸进 router 后删除**，避免两套配置并存。

**配置开关**：`llm_stage_models` 字段**完全可选**——不存在时所有 stage 用 `LLM_MODEL` env（向后兼容老 config）。

**回滚**：从 `config.yaml` 删 `llm_stage_models` 块，所有 stage 自动回退到 `LLM_MODEL` env。**不恢复** `resolve_summary_step_env` 旁路（已吸进 router）。

**风险**：
- 用户配错 provider/model（如 `gpt-5` 还不存在）——`resolve()` 失败时回退 `default`，不抛异常。
- 路由过多导致 config 冗长——提供 `llm_stage_models.inherit: true` 选项，让所有 stage 默认继承 `default`。
- 浏览器侧路由和 GitHub Actions 路由不一致——README 明确两者独立配（`config.yaml` 控 Actions，`dpr-config.json` 控浏览器）。
- Usage JSONL 体积爆炸——按月 rotate（`archive/llm_usage_<YYYY-MM>.jsonl`），每月 100k 调用 × ~150 bytes/行 ≈ 15MB，可控。
- **DPR 现有 Step 0 走 `BLT_REWRITE_MODEL`**（[src/0.enrich_config_queries.py:19](src/0.enrich_config_queries.py#L19) 默认 `gemini-3-flash-preview`）——router 升级后**统一**走 `llm_stage_models.enrich.provider_model`，**删除** `BLT_REWRITE_MODEL` 旁路。

**Effort**：M（2 周）。文件：新增 `src/llm_router.py`（~150 行，对齐 Polaris [router.py](E:/study/Polaris/src/backend/app/core/llm/router.py)）+ `src/llm_usage_logger.py`（~80 行，对齐 Polaris [router.py:178 _ensure_usage](E:/study/Polaris/src/backend/app/core/llm/router.py#L178)）+ `src/llm_usage_report.py`（~60 行，对齐 Polaris [llm_admin.py:128-166 usage_report](E:/study/Polaris/src/backend/app/services/llm_admin.py#L128)）+ 改 [src/llm.py:851-871 ClientFactory.from_env](src/llm.py#L851) 调用 router + 改 [src/main.py:402-427 resolve_summary_step_env](src/main.py#L402) 删旁路 + 改 [astro-src/lib/llm.ts](astro-src/lib/llm.ts) 增加 ROUTES 表 + 改 8 个调用点的 model 选取逻辑（~50 行分散改动）+ 改 [src/0.enrich_config_queries.py:19](src/0.enrich_config_queries.py#L19) 删 `BLT_REWRITE_MODEL` 旁路。

---

## 不吸收清单（每个 1 段说明理由）

**多用户 / RBAC / `project_members` 表**：DPR 是单用户仓库脚本（fork-to-personal-use 模型），用户身份 = GitHub repo owner。引入 RBAC 需要 OAuth provider + session 管理 + 权限中间件——这是另一个量级的工程。Polaris 的 `project_members(role, can_*_flags)` 字段在 DPR 完全无对应语义。**做法**：保留单用户，但所有"项目级"概念（concept graph / skill pack）都用 git 目录隔离，不引入任何 access control 字段。

**SSH Experiment Lab / GPU 调度 / `experiments` 表**：DPR 没有"跑实验"概念——它是论文**阅读**工具，不是论文**生产**工具。Polaris 的 [E:/study/Polaris/src/backend/app/agents/voyage/runner.py:36-80](E:/study/Polaris/src/backend/app/agents/voyage/runner.py#L36) `Runner` 协议含 `RemoteHostRunner = SSHExecutor`（[runner.py:84](E:/study/Polaris/src/backend/app/agents/voyage/runner.py#L84)）和 `ContainerRunner`（[runner.py:146-329](E:/study/Polaris/src/backend/app/agents/voyage/runner.py#L146)）——DPR 完全跳过。**做法**：v1 完全不引入；v2 才会考虑"为某篇论文写 reproduction code"功能，但仍不会走 SSH 远程执行（用户本地跑即可）。

**实时 LaTeX+CRDT 协同编辑 / Yjs Room**：DPR 浏览器只读，不编辑 .tex。Polaris 的 `manuscript_files` + `manuscript_file_versions` + Yjs CRDT + WebSocket `manuscript.ai_writing` 频道是**为多用户同时写论文设计**的，DPR 是单用户单方向（AI 写 → 用户读）。**做法**：不引入任何实时编辑能力；浏览器侧永远只渲染静态 markdown。

**MCP Tool Registry（[E:/study/Polaris/src/backend/app/tools/registry.py](E:/study/Polaris/src/backend/app/tools/registry.py) 26 个工具）**：DPR 没有 agent 进程（pipeline 是 deterministic 的）——`tool_loop.run_tool_loop` 没有任何 agent 调它。Polaris 的 MCP（[E:/study/Polaris/src/backend/app/mcp/dispatch.py](E:/study/Polaris/src/backend/app/mcp/dispatch.py) JSON-RPC 2.0，Streamable HTTP + stdio）服务于"agent 自我查库"，DPR 不需要外部 agent 接入。**做法**：所有 DPR 私有数据用文件系统 + frontmatter + JSONL，Supabase 仅用作外部论文库的只读 vector store。**新功能（如 Citation Guard）走 [functions/api/proxy.ts](functions/api/proxy.ts) 端点**——扩展 allow-list，不引入 MCP。

**Voyage 阶段化 UI（Navigator 面板 / Sextant 红绿灯）**：DPR 的"运行中状态"对用户不可见（cron 跑完才 push commit）。Polaris 的实时仪表盘是"agent 调给研究员看"的设计，DPR 用户不需要（也不应该）等论文生成——DPR 是"早上醒来 email 收到今天推的论文"。**做法**：所有 stage 状态只写文件，事后通过 `cat archive/<date>/.checkpoints/*.json` 调试，**永远不画仪表盘**。

**Plan 编辑动态插入（[engine.py:765-837 _apply_plan_edit](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L765)）**：Polaris 允许 LLM 在 `loop` mode 下提议 plan edit（`Navigator.on_result`），DPR 的 pipeline 是 deterministic subprocess 链——v1 完全没有"LLM 提议 plan edit"的概念。**做法**：v1 跳过；v2 才会考虑让 LLM 在失败时提议重跑哪几步。

**Gates / 人工审批（[engine.py:422-489 _gate_cleared](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L422)）**：Polaris 在 `compute_budget / idea_goal / idea_pivot` 3 个 gate 暂停等用户审——DPR 是 cron 跑完直接 commit，没有"半路等用户"语义。**做法**：v1 跳过；v2 才会考虑"实验预算超限时 push GitHub Issue 等 maintainer 确认"。

**Backfill Concept Definition 批 LLM（[concepts.py:250-401 _DEF_BATCH_SIZE=40](E:/study/Polaris/src/backend/app/services/concepts.py#L250)）**：Polaris 调 LLM 产 `{name, definition, category}` 写入 `concepts` 表。DPR 不需要 LLM 写 definition——slug + display_name + 出处已够，**跳过 definition LLM 节省成本**。

**Pre-print `enrich_config_queries` (`BLT_REWRITE_MODEL`)**：保留为 router 的 `enrich` stage 入口（不删除这条 path），但**配置从 env 迁到 `llm_stage_models.enrich.provider_model`**——这是能力 7 的范畴，不在本节"不吸收"中。

---

## 落地路径（按时间顺序的 PR 拆分）

### PR 1: 引入 Pipeline Checkpoint 骨架

- **目标**：在 [src/main.py:761-897](src/main.py#L761) `main()` 包装 18 个 sub-step 的 `read/write`，默认 disabled。
- **依赖**：无。
- **破坏向后兼容**：否（`pipeline.checkpoints.enabled: false` 默认）。
- **回滚**：删 `pipeline.checkpoints` 配置块，archive 目录结构无破坏。
- **预估 LOC**：~400（`src/pipeline_v2/checkpoint.py` + `src/pipeline_v2/state.py` + main.py 改动 + 1 个单测）。
- **关键 Polaris 参照**：[engine.py:330-334](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L330) cursor 遍历 + [engine.py:280-303](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L280) `_new_step_row` 字段 + [engine.py:606-612](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L606) budget check。
- **关键 DPR 参照**：[src/main.py:798-825](src/main.py#L798) `fetch_status.json` 哨兵（仿其写盘风格）。

### PR 2: Sextant Validate（确定性 6 维，无 LLM rubric）

- **目标**：实现 `no_error / exit_code / artifact_exists / schema_valid / metric / min_count` 6 个 predicate；默认 `llm_rubric` predicate 关闭。
- **依赖**：PR 1（checkpoint 写 verdict）。
- **破坏向后兼容**：否（`pipeline.validate.enabled: false` 默认）。
- **回滚**：删 `pipeline.validate` 块。
- **预估 LOC**：~700（`src/validate/__init__.py` + `src/validate/checks.py` + `src/validate/contracts/` + `src/validate/rubrics/` + 改 6 个主脚本 + 重写 [src/generate_docs_md_io.py:50-78](src/generate_docs_md_io.py#L50) `verify_paper_md_was_written`）。
- **关键 Polaris 参照**：[sextant.py:47-101](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L47) 4 步评估顺序 + [checks.py:8-17](E:/study/Polaris/src/backend/app/agents/voyage/checks.py#L8) spec 形状 + [checks.py:22-25](E:/study/Polaris/src/backend/app/agents/voyage/checks.py#L22) DETERMINISTIC_CHECK_KINDS。

### PR 3: LLM Stage Routing 雏形

- **目标**：在 [src/llm.py:851-871](src/llm.py#L851) `ClientFactory.from_env()` 旁边引入 `LLMRouter.route_llm_call(stage, **kwargs)`，8 个 stage 走 `llm_stage_models`；其他 stage 用 `LLM_MODEL` env 兜底。**取代** [src/main.py:402-427](src/main.py#L402) `resolve_summary_step_env()` 旁路。
- **依赖**：无（与 PR 1/2 独立可并行）。
- **破坏向后兼容**：否（无 `llm_stage_models` 配置时全部用 `LLM_MODEL` env）。
- **回滚**：删 `llm_stage_models` 配置块；不恢复 `resolve_summary_step_env`（已吸进 router）。
- **预估 LOC**：~400（`src/llm_router.py` + `src/llm_usage_logger.py` + 改 [src/llm.py](src/llm.py) + 改 [src/main.py:402-427](src/main.py#L402) + 改 8 处调用点）。
- **关键 Polaris 参照**：[router.py:29-48](E:/study/Polaris/src/backend/app/core/llm/router.py#L29) 19 STAGES + [router.py:124-146](E:/study/Polaris/src/backend/app/core/llm/router.py#L124) provider 解析 + [router.py:178](E:/study/Polaris/src/backend/app/core/llm/router.py#L178) `_ensure_usage`。

### PR 4: Prompt Pack 1.0（4 个内置 pack）

- **目标**：实现 prompt 加载机制 + 4 个 pack（`default` / `nips-style` / `acl-style` / `deepdive-v2`），存在 `config/prompts/` 目录 + Gist key `dpr_prompt_packs_v1`。
- **依赖**：PR 3（路由生效后，pack 才能被 route 到）。
- **破坏向后兼容**：否（`prompt_packs.active` 全 null 时走 hardcoded）。
- **回滚**：设所有 `active.<target>: null`。
- **预估 LOC**：~800（`src/prompt_pack.py` + 4 × 50 行 pack + 改 5 处注入点）。
- **关键 Polaris 参照**：[builtin_skills.py:11+](E:/study/Polaris/src/backend/app/services/builtin_skills.py#L11) 11 内置 + [skillset.py:40](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L40) `skill_guidance` 24000 cap + [services/skills.py:335-370](E:/study/Polaris/src/backend/app/services/skills.py#L335) `snapshot_for_project`。
- **关键 DPR 参照**：[astro-src/scripts/paper-analyzer.ts:1176-1232](astro-src/scripts/paper-analyzer.ts#L1176) `SYSTEM_PROMPT` const（替换入口）+ [src/4.llm_refine_papers.py:352-357](src/4.llm_refine_papers.py#L352) Python prompt（替换入口）+ [astro-src/scripts/settings.ts:574](astro-src/scripts/settings.ts#L574) `GIST_FILENAME`（Gist 同步模式）。

### PR 5: Concept Backlinks v1（字符串匹配版）

- **目标**：实现 concept 提取 + 反向链接构建 + `astro-src/pages/concepts.astro` 页面 + `wiki/concepts/` 目录 + frontmatter `wiki_compiled/wiki_compiled_at/concepts` 新字段。
- **依赖**：PR 4（doc_generate 阶段才有 LLM 可调）。
- **破坏向后兼容**：否（`concepts.enabled: false` 默认）。
- **回滚**：`concepts.enabled: false`；手动 `rm -rf wiki/concepts/`；保留 `wiki_compiled: true` 不动。
- **预估 LOC**：~1100（`src/concept_extractor.py` + `src/concept_index.py` + `concepts.astro` + `concept_graph.ts` + 改 [src/6.generate_docs.py](src/6.generate_docs.py) + 改 [src/generate_docs_md_io.py:80-154](src/generate_docs_md_io.py#L80)）。
- **关键 Polaris 参照**：[wiki_compile.py:35-57](E:/study/Polaris/src/backend/app/services/wiki_compile.py#L35) 5 段结构 + [concepts.py:28](E:/study/Polaris/src/backend/app/services/concepts.py#L28) WIKILINK_RE + [concepts.py:75](E:/study/Polaris/src/backend/app/services/concepts.py#L75) wiki_slug + [concepts.py:250-401](E:/study/Polaris/src/backend/app/services/concepts.py#L250) link_all_paper_concepts。
- **关键 DPR 参照**：[src/6.generate_docs.py:1181-1198](src/6.generate_docs.py#L1181) 现有 frontmatter 形状（加 3 个新字段）+ [src/paper_paths.py:166](src/paper_paths.py#L166) `paper_id` 函数（链接 ID 形式）+ [src/generate_docs_md_io.py:80-154](src/generate_docs_md_io.py#L80) frontmatter/auto block 工具。

### PR 6: Topic v2 辩论 stage

- **目标**：在 [astro-src/pages/topic.astro:176-191](astro-src/pages/topic.astro#L176) 插入 `renderDebateStage`；新文件 [astro-src/scripts/topic-search-v2.ts](astro-src/scripts/topic-search-v2.ts) 含 Elo 辩论 + gap signals；后端 `src/elo_debate.py` + `src/idea_signals.py`。
- **依赖**：PR 4（用 prompt pack 注入 persona 文本）。
- **破坏向后兼容**：否（`topic.v2.enabled: false` 默认；**不修改** 现有 [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts)）。
- **回滚**：`topic.v2.enabled: false`，回退到 v1 流程。
- **预估 LOC**：~1400（`src/elo_debate.py` + `src/idea_signals.py` + `astro-src/scripts/topic-search-v2.ts` + 改 [astro-src/pages/topic.astro:176-191](astro-src/pages/topic.astro#L176)）。
- **关键 Polaris 参照**：[actions_ideas.py:353](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L353) 4 信号 + [actions_ideas.py:968](E:/study/Polaris/src/backend/app/agents/voyage/actions_ideas.py#L968) `_run_match` + K=32 / 1200 / `_TOKENS_PER_MATCH_CALL=16000`。
- **关键 DPR 参照**：[astro-src/scripts/topic-search.ts:797 `decomposeIdea`](astro-src/scripts/topic-search.ts#L797) / [:2746 `doDecompose`](astro-src/scripts/topic-search.ts#L2746) / [:188-235 `EXPLORE_FROM_SEEDS_SYSTEM`](astro-src/scripts/topic-search.ts#L188) / [topic-search.ts:64](astro-src/scripts/topic-search.ts#L64) `SESSION_KEY` / [topic-search.ts:80-82](astro-src/scripts/topic-search.ts#L80) `TOTAL_BYTES_LIMIT`。

### PR 7: Citation Guard CLI + 浏览器 hook

- **目标**：Python CLI `src/citation_guard.py`（在 Step 4 与 Step 6 之间调用）+ 浏览器侧 `astro-src/scripts/citation-guard.ts` + `save-paper.yml` 自动跑 + 扩展 [functions/api/proxy.ts:139-153](functions/api/proxy.ts#L139) allow-list 加 S2/OpenAlex 域名。
- **依赖**：PR 5（需要 concept graph 知道哪些 paper 已被仓库收录过）。
- **破坏向后兼容**：否（`citation_guard.enabled: false` 默认；`save-paper.yml` 新增 step 失败不阻塞原流程）。
- **回滚**：`citation_guard.enabled: false`；保留生成的 `*.citations.json` 不删。
- **预估 LOC**：~900（`src/citation_guard.py` + `astro-src/scripts/citation-guard.ts` + 改 `save-paper.yml` + 改 [functions/api/proxy.ts:139-153](functions/api/proxy.ts#L139)）。
- **关键 Polaris 参照**：[paper_review.py:222-242](E:/study/Polaris/src/backend/app/services/paper_review.py#L222) `classify_fuzzy_hits`（`EXACT_SIMILARITY=0.92` / `MINOR_SIMILARITY=0.75` / `YEAR_TOLERANCE=1`）+ [paper_review.py:554-559](E:/study/Polaris/src/backend/app/services/paper_review.py#L554) `review_passed` (`PASS_RATING=6.0`) + [actions_review.py:252-304](E:/study/Polaris/src/backend/app/agents/voyage/actions_review.py#L252) `citation_check` LLM support。
- **关键 DPR 参照**：[src/4.llm_refine_papers.py:352-357](src/4.llm_refine_papers.py#L352) system_prompt 位置（Step 4 LLM 已产 cite-of-papers）+ [src/6.generate_docs.py:1599](src/6.generate_docs.py#L1599) `process_paper` 写盘入口（Step 6 调 guard）+ [src/main.py:868-897](src/main.py#L868) Step 4→6 调用顺序。

### PR 8: 文档 & 迁移指南

- **目标**：写 `docs/migration-polaris-absorption.md`，解释 7 个能力的开关、JSON 形态、回滚方法。
- **依赖**：PR 1-7 全部 merged。
- **破坏向后兼容**：否（纯文档）。
- **回滚**：N/A。
- **预估 LOC**：~500（纯 markdown）。

**总 LOC 估算**：~6200 行（Python ~3000 + TS ~2500 + 配置/文档/测试 ~700）。

**总时间估算**：4 人月（4 个 PR 并行，每个 PR 1 周 + 1 周 buffer）。

---

## 用户视角（终端用户看到什么变化）

### 新增页面

1. **`/concepts`**（`astro-src/pages/concepts.astro`，PR 5 引入）：所有 `wiki/concepts/*.md` 的网格视图，可按"近 30 天热度" / "字母序" / "概念等级" 排序；点击进入单个概念页（含 Obsidian 风格反向链接 + 出处论文列表）。
2. **`/topics/<session_id>/debate`**（PR 6 引入）：Topic v2 模式下的辩论过程可视化（persona 气泡 + 进度条 + Elo 排行榜）。
3. **`/papers/<id>/citations`**（PR 7 引入）：单篇精读的引用核查报告（绿/黄/红徽章 + 详情 JSON）。

### 新增配置项（`config.yaml` + `config.user.yaml`）

```yaml
pipeline:
  checkpoints: { enabled: false }
  validate: { enabled: false }
llm_stage_models:
  enrich: { provider_model: "blt/gemini-3-flash-preview", temperature: 0.3 }
  refine: { provider_model: "${LLM_MODEL}", temperature: 0.2 }
  select: { provider_model: "${LLM_MODEL}", temperature: 0.2 }
  doc.generate: { provider_model: "${LLM_MODEL}", temperature: 0.5 }
  analyzer.deepdive: { provider_model: "openai/gpt-4o-mini", temperature: 0.7 }
  topic.facet: { provider_model: "${LLM_MODEL}", temperature: 0.4 }
  topic.summary: { provider_model: "${LLM_MODEL}", temperature: 0.3 }
  topic.report: { provider_model: "openai/gpt-4o-mini", temperature: 0.6 }
  default: { provider_model: "${LLM_MODEL}", temperature: 0.5 }
  stream_stages: [analyzer.deepdive, topic.report]
prompt_packs:
  active:
    refine: "default:2026-07-01"
    select: "default:2026-07-01"
    doc.generate: "default:2026-07-01"
    analyzer.deepdive: "deepdive-v2:2026-07-10"
concepts:
  enabled: false
topic:
  v2:
    enabled: false
    elo_k: 32
    elo_initial: 1200
    debate_rounds: 3
    personas: ["方法论者", "工程师", "怀疑论者"]
citation_guard:
  enabled: false
  sources: ["semantic_scholar", "openalex", "in_library"]
  fabricated_action: "replace_with_question_mark"
```

### 新增按钮

- 浏览器侧 Deep Dive 页新增"**运行引用核查**"按钮（PR 7）。
- Topic 模式新增"**开启辩论排序**"开关（PR 6）。
- 速读笔记页底部新增"**查看相关概念**"链接（PR 5）。

### 3 个典型场景的 before/after

#### 场景 1: 个人研究者（CV 方向博士生）

**Before**：
1. 早上收到 GitHub Action 邮件：今日 5 篇 deep dive + 25 篇 quick skim
2. 点开每篇 800 字速读，看 30 分钟
3. 完事，没有任何"下一篇该看啥"的引导
4. 想找方向：手动复制论文标题到 arXiv 搜"cited by"

**After**：
1. 早上同样收到邮件（行为不变）
2. 点开 1 篇速读 → 看到底部"**相关概念**"链接（如 "Diffusion Model"、"LoRA"）→ 跳 `/concepts/diffusion-model` → 看到"近 30 天 12 篇 diffusion 论文"，但"LoRA 组合"只有 2 篇（信号：研究缺口）
3. 沿概念图谱走，发现"LoRA + Video Diffusion"是低覆盖区 → 进 Topic 模式
4. Topic v2 辩论：8 个 idea 打擂 3 轮 → 选 Elo 最高的"LoRA 适配视频扩散的时空一致性"作为下周阅读方向
5. 阅读 3 篇 deep dive，自动 Citation Guard 标出 1 处 fabricated 引用

#### 场景 2: 实验室主页（多用户但只读）

**Before**：实验室 GitHub Pages 部署 DPR 仓库，访客只能读 docs。
**After**：
- 访客可在 `/concepts` 浏览实验室近期关注的概念图谱（仍只读）
- 引用核查结果直接展示在精读页（增加可信度）
- 没有任何"用户登录"或"评论"功能（保持零服务器）

#### 场景 3: 论文精读（单篇 deep dive 8 章节）

**Before**：
- 浏览器侧点"生成 8 章节精读" → 等待 → 拿到 markdown
- 完事，没有任何引用核查（容易引用编造）

**After**：
- 浏览器侧点"生成 8 章节精读 + 引用核查"
- 完成后顶部出现 1 条警告：`> ⚠️ 1 处引用未通过核查`
- 点开"查看引用核查报告" → 看到 `[5] Smith 2023, A New Method for X` 标红，理由"三源未找到匹配"
- 手动删除该引用或换真实引用

---

## 风险与回滚

| 风险 | 严重度 | 缓解 | 回滚 |
|------|--------|------|------|
| Pipeline Checkpoint 在 GitHub Actions kill 时残留 `.lock` | 中 | `flock` + `atexit` + signal handler；`.lock` 文件 TTL 1 小时自动清理 | `pipeline.checkpoints.enabled: false` |
| Sextant Schema 收紧太严导致老 archive 不通过 | 中 | Schema 加 `version: 1` 字段；旧文件不阻断 | `pipeline.validate.enabled: false` |
| Prompt Pack body 引用不存在 taxonomy 词汇 | 低 | manifest `requires_taxonomies_version` 校验 | `prompt_packs.active.<target>: null` |
| 概念提取 LLM 编造伪概念 | 高 | `concept_slug_pattern` + `concept_blacklist.yaml`（100+ 词） + `concept_min_appearances: 2` | `concepts.enabled: false` |
| Topic v2 debate 引入 6+ LLM call 成本 | 中 | `topic.v2.debate_max_ideas: 8` 限制范围 | `topic.v2.enabled: false` |
| Citation Guard S2 API 限流 | 低 | 指数退避（1/2/4/8/16s，最多 5 次） | `citation_guard.enabled: false` |
| [functions/api/proxy.ts:43-80](functions/api/proxy.ts#L43) rate limit 30/分钟 | 低 | Citation Guard 默认走 GitHub Actions CLI，不走浏览器 | 同上 |
| LLM 路由配错 model 名 | 低 | `resolve()` 失败时回退 `default`，不抛异常 | 删 `llm_stage_models` 配置块 |
| 浏览器侧路由和 Actions 路由不一致 | 低 | README 明确两者独立配 | N/A（按预期） |
| 7 个能力一起开导致 cron 超时 | 中 | 每个能力独立 enabled 开关，README 推荐"先开 1-2 个，跑 1 周稳定后再加" | 逐个 `enabled: false` |
| 配置文件膨胀（7 个新块） | 低 | README 给出 minimal config 模板（仅必要字段） | N/A |

**通用回滚策略**：所有 7 个能力都以 `enabled: false` 默认开启；用户**零感知**升级到新版本（不会自动开启任何新能力）。开启任一能力失败，把对应配置块 `enabled` 改回 `false` 即可。

**数据兼容性**：
- 新增 `archive/<date>/.checkpoints/` / `archive/<date>/debate/` / `archive/llm_usage.jsonl` 子目录不影响老 archive。
- 新增 frontmatter 字段（`wiki_compiled/wiki_compiled_at/concepts`）在 `enabled: false` 时不写入，老 markdown 兼容。
- 新增 `wiki/concepts/*.md` 不影响老 `docs/papers/` 内容。
- **`config.user.yaml`**（[src/source_config.py:49-74](src/source_config.py#L49) `user_config_path` + [src/source_config.py:88-108](src/source_config.py#L88) `_deep_merge`）——所有 `enabled: false` 放 user overlay，base `config.yaml` 永远不动。

---

## TL;DR for maintainer（5 行）

1. **先做什么**：PR 1（Pipeline Checkpoint 骨架） + PR 3（LLM Stage Routing 雏形）——这两个**纯增量、零破坏、立刻收益**（cron 可断点续跑 + 8 个 stage 可独立配 model），分别对应 Polaris [engine.py:330-334](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L330) cursor 遍历 和 [router.py:29-48](E:/study/Polaris/src/backend/app/core/llm/router.py#L29) 19 STAGES 路由；PR 3 还要**吸掉** [src/main.py:402-427](src/main.py#L402) `resolve_summary_step_env` 旁路。
2. **接着做**：PR 2（Sextant 6 维确定性核查，不带 LLM rubric）——把"subprocess 退出码 == 0 即通过"的弱验收升级到"产物可用"级别，对齐 Polaris [sextant.py:47-101](E:/study/Polaris/src/backend/app/agents/voyage/sextant.py#L47) 4 步评估顺序；**重写** [src/generate_docs_md_io.py:50-78](src/generate_docs_md_io.py#L50) `verify_paper_md_was_written` 走新入口。
3. **然后做**：PR 4（Prompt Pack 1.0，4 个内置 pack）+ PR 5（Concept Backlinks v1 字符串匹配版）——让 docs 之间有"概念级"关联，复刻 Polaris [skillset.py:40](E:/study/Polaris/src/backend/app/agents/voyage/skillset.py#L40) `_TARGET_BUDGET_CHARS=24000` 和 [concepts.py:250-401](E:/study/Polaris/src/backend/app/services/concepts.py#L250) link_all_paper_concepts；PR 5 frontmatter 加 `wiki_compiled/wiki_compiled_at/concepts` 三个字段（保留 [src/6.generate_docs.py:1181-1198](src/6.generate_docs.py#L1181) 现有 8 字段）。
4. **暂缓**：PR 6（Topic v2 辩论）——成本高（`matches * (2*3+1) * _TOKENS_PER_MATCH_CALL=16000`）、收益对单用户边际、需 PR 4 成熟后再做；新文件 [astro-src/scripts/topic-search-v2.ts](astro-src/scripts/topic-search-v2.ts) **不修改** 现有 [astro-src/scripts/topic-search.ts](astro-src/scripts/topic-search.ts)。
5. **永远不动**：多用户 / RBAC / SSH Experiment Lab（[runner.py:36-80](E:/study/Polaris/src/backend/app/agents/voyage/runner.py#L36)）/ Yjs CRDT / Voyage 实时 UI / MCP Tool Registry（[registry.py](E:/study/Polaris/src/backend/app/tools/registry.py) 26 工具）/ Plan 动态编辑（[engine.py:765-837](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L765)）/ 人工 gate（[engine.py:422-489](E:/study/Polaris/src/backend/app/agents/voyage/engine.py#L422)）——DPR 的零服务器哲学是核心资产，引入任何一个都破。
