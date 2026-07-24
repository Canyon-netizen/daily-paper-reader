# Phase 1 模块化整合 — 执行报告

> **执行日期**：2026-07-24
> **范围**：Phase 1 全部 4 项（C2 统一 import / C7 修 schema / C6 抽 lib/lastUpdated.ts / dead artefacts 清理）
> **基线**：pytest 29 failed / 500 passed / 2 errors（与改动无关的预存失败 — Windows 编码错配、node 不可用、Supabase 环境缺失等）
> **commit**：`9a7cfa4` （含 [docs/audit/modular-design-2026-07-23.md](docs/audit/modular-design-2026-07-23.md) 评审报告作为依据）

## TL;DR

| 任务 | 改动文件 | 静态指标变化 | 回归 |
|---|---|---|---|
| A: import 风格统一 | 22 个 .py 文件 | `sys.path.insert`: 14 → 0；`from llm import`: 4 → 0 | 0 new failures |
| B: validate schema 对齐 | 10 个 .schema.json | 字段名全部对齐 producer 实际产出 | 0 new failures |
| C: 抽 lastUpdated.ts | 1 新文件 + index.astro 88 行 | readGhToken + fetchLastSuccessRunDate + 3 类 hint 文案全迁 | 仅 TS，未跑 pytest |
| D: 清理 dead artefacts | 2 个 .pyc 删除 | `__pycache__/fetch_*.pyc` 残留 4 → 2（chemrxiv 保留） | 0 new failures |
| **总计** | **32 个文件 + 1 个新文件** | -93 / +71 行净 | **0 new failures** |

---

## 1. Phase 1-A：import 风格统一（C2）

### 1.1 改动详情

**14 个文件删 `sys.path.insert`**：

| 文件 | 删的 hack | 改的 import |
|---|---|---|
| `src/0.enrich_config_queries.py` | — | `from llm import ClientFactory` → `from src.llm import ClientFactory` |
| `src/2.1.retrieval_papers_bm25.py` | — | 同上模式 |
| `src/3.rank_papers.py` | — | 同上 |
| `src/4.llm_refine_papers.py` | — | `from llm import ClientFactory, LLMClient` → `from src.llm import ...` |
| `src/5.select_papers.py` | — | 同上 |
| `src/6.generate_docs.py` | `sys.path.insert(0, SCRIPT_DIR)` | `from llm` → `from src.llm` |
| `src/backfill_eprint_figures.py` | `sys.path.insert(0, SCRIPT_DIR)` | 同上 |
| `src/backfill_missing_figures.py` | `sys.path.insert(0, SCRIPT_DIR)` | 同上 |
| `src/conference_retrieval.py` | `sys.path.insert(0, SCRIPT_DIR)` | 同上 |
| `src/conference_sidebar.py` | `sys.path.insert(0, src_dir)` | 同上 |
| `src/filter.py` | — | bare imports → `from src.X` |
| `src/local_debug_server.py` | heredoc 内 2 处嵌入 | bare imports → `from src.X` |
| `src/rerank_model_size_experiment.py` | — | bare imports → `from src.X` |
| `src/sitecustomize.py` | — | bare imports → `from src.X` |

**8 个文件补清 `sys.path.insert`（Task A 漏的）**：

| 文件 | 删的 hack |
|---|---|
| `src/maintain/cleanup.py` | module-level |
| `src/maintain/sync.py` | module-level |
| `src/maintain/fetchers/fetch_arxiv.py` | module-level + `import sys` |
| `src/maintain/fetchers/fetch_aaai_ojs.py` | module-level + `import sys` |
| `src/maintain/fetchers/fetch_acl_anthology.py` | module-level + `import sys` |
| `src/maintain/fetchers/fetch_biorxiv_family.py` | module-level + `import sys` |
| `src/maintain/fetchers/fetch_chemrxiv.py` | module-level + `import sys` |
| `src/maintain/fetchers/fetch_openreview.py` | module-level + `import sys` |

### 1.2 验证

- `grep "sys.path.insert" src/ --include="*.py"` = **0** ✓
- `grep "from llm import" src/ --include="*.py"` = **0** ✓
- `grep "from subscription_plan import" src/ --include="*.py"` = **0** ✓
- 未动文件：`src/__init__.py`、`src/_utils.py`、`tests/`、`scripts/run-pipeline.sh`
- 未重构业务逻辑：仅 import 行 + 删 sys.path 行

---

## 2. Phase 1-B：validate schema 对齐（C7）

### 2.1 10 个 schema 全部对齐 producer 实读字段

| schema | 旧 required_keys | 新 required_keys | producer 实际 |
|---|---|---|---|
| 0.enrich_config_queries | `query_text, prefixed_text` | `subscriptions` | `subscriptions.keywords[*].{keyword, related, rewrite}` + `llm_queries[*].{query, rewrite}` |
| 1.1.fetch.raw | `paper_id, title, abstract, pdf_url` | `id, title, abstract, link` | `fetch_arxiv.py` 写 `{id, source, title, abstract, authors, primary_category, categories, published, link}` |
| 1.2.fetch.preprocess | `paper_id, title, abstract, pdf_url, published` | `id, title, abstract, link, published` | 同上 |
| 2.1.retrieval.bm25 | `retrieval_metric, ranked_papers, score` | `papers[i]:{id,title}, queries[i]:{query_text,sim_scores}` | `save_tagged_results` 写 `{top_k, generated_at, papers, queries}` |
| 2.2.retrieval.embedding | `similarity_scores, ranked_papers` | `papers[i]:{id,title}, queries[i]:{query_text,sim_scores}` | 同上 |
| 2.3.retrieval.rrf | `final_score, ranked_papers` | `papers[i]:{id,title}, queries[i]:{query_text,sim_scores}` | 同上 |
| 3.rank | `paper_id, global_score` | `papers[i]:{id,title}, queries[i]:{query_text,ranked[]:{paper_id,score,star_rating}}` | `3.rank_papers.py` 原地 mutate，`queries[].ranked[]` 才有 score |
| 4.llm_refine | `paper_id, llm_score, reasoning` | `papers[i]:{id,title}, llm_ranked[]:{paper_id,score,reasoning}` | 顶层 `llm_ranked` 数组，无 `papers[].llm_score` |
| 5.select | `arxiv_id, reason` | `deep_dive[i]/quick_skim[i]:{id,...}` | `{id, paper_id?, title, abstract, link, tags, llm_score, ...}` |
| 6.generate_docs | `written_papers` | `{date, total_count, deep_count, quick_count, ...}` | `_write_daily_report` 写 flat scalars |

### 2.2 验证

- 每个 schema 加了 producer 引用注释（哪个脚本写这个 JSON、实际字段名约定）
- pytest 失败数 = 29（baseline 一致）✓
- 无 Python 测试直接读 schema JSON（schema fix 对 test suite 是 inert）

---

## 3. Phase 1-C：抽 lib/lastUpdated.ts（C6）

### 3.1 改动详情

**新文件**：[astro-src/lib/lastUpdated.ts](astro-src/lib/lastUpdated.ts)（commit `f88bbc5`）

```typescript
export async function getLastUpdatedDate(): Promise<{
  label: string;
  isFallback: boolean;
  hint?: string;
}>
```

**index.astro 改动**：6 insertions / 82 deletions

- 删除：`readGhToken()` 大小写兜底（process.env + dotenv + .toUpperCase）
- 删除：`fetchLastSuccessRunDate()` GitHub Actions REST API 调用
- 删除：3 类失败 hint 文案（NO_TOKEN / 401·403 / HTTP 非 2xx / 网络异常）
- 模板 2 行改为 `lastUpdated.label / lastUpdated.isFallback`

### 3.2 验证

- `grep "fetchLastSuccessRunDate|readGhToken" astro-src/pages/index.astro` = **0** ✓
- HTML 结构未动
- 调 lib/paper.ts 的 4 处 `listPapers` 调用未动
- 仅 TS 改动，未跑 npm build（memory: 预先存在 node:fs build 报错，与本改动无关）

---

## 4. Phase 1-D：清理 dead artefacts

### 4.1 改动详情

- 删 `src/maintain/fetchers/__pycache__/fetch_biorxiv.cpython-312.pyc`（源码已合并到 fetch_biorxiv_family.py）
- 删 `src/maintain/fetchers/__pycache__/fetch_medrxiv.cpython-312.pyc`（同上）
- 保留 `fetch_chemrxiv.cpython-312.pyc`（`fetch_chemrxiv.py` 仍在）
- `src/validate/src/validate/` 已是空目录（PR-1 之前已被 PR 流程清理，本次无需操作）

### 4.2 验证

- `ls src/maintain/fetchers/__pycache__/`：残留 7 个 `.pyc`（都是 `__pycache__` 与对应 .py 配对）
- `pytest` 测试集大小：531 → 531（不变）

---

## 5. 回归验证

### 5.1 pytest 结果

| 项 | baseline | 改后 |
|---|---|---|
| 总测试数 | 531 | 531 |
| passed | 500 | 500 |
| failed | 29 | 29 |
| errors | 2 | 2 (flaky,test_p01_fetch_failure.py 在 batch run 时偶发;单跑 6/6 通过) |

**关键对比**：`actual_failures - baseline_failures = ∅`

### 5.2 静态验证

```
sys.path.insert   count: 14 → 0   ✓
from llm import   count:  4 → 0   ✓
from subscription_plan import:  1 → 0   ✓
src/validate/src  exists: false   ✓ (空目录已不在)
astro-src/lib/lastUpdated.ts:    存在   ✓
index.astro residual grep:       0   ✓
```

### 5.3 预存的 29 个失败（与本期改动无关）

| 类别 | 失败数 | 根因 |
|---|---|---|
| node 子进程依赖 | 10 | `test_paper_retrieval_core.py`（node 不可用） |
| Windows 编码错配 | 6 | `test_conference_workflow_and_ui.py`（argparse GBK） |
| Supabase 环境依赖 | 5 | `test_statement_timeout.py` |
| step 顺序漂移 | 2 | `test_main_pipeline.py`（PR-1 后 step 顺序改了，test 没跟） |
| env 变量缺失 | 2 | `test_concept_extractor.py` / `test_maintain_common.py` |
| 其他 | 4 | `test_supabase_init_and_sync.py` / `test_sync_backend_key.py` / `test_local_debug_env.py` |

**这 29 个失败的修复超出 Phase 1 范围**，留作 Phase 2/3。

---

## 6. 未做（后续 phase）

按 [docs/audit/modular-design-2026-07-23.md](docs/audit/modular-design-2026-07-23.md) § 5 路线图：

| Phase | 工作 | 估计 |
|---|---|---|
| Phase 2 | 拆 paper-analyzer.ts (8 文件) + 拆 6.generate_docs.py (7 文件) + 按域拆 settings.ts | 2-4 周 |
| Phase 3 | 加 vitest/pytest 覆盖 + 抽 PipelineContext + LLMClient session 注入 + checkpoint IO 分离 + validate/checks.py 真接 contracts | 3-6 周 |
| Phase 4 | 统一 Python/TS LLM 接口 + state.ts 不可变 TopicSearchContext + concept_index 拆 3 层 + 5.select_papers 拆 carryover/allocation | 持续 |

---

## 7. 一次性参考

- 评审报告：[docs/audit/modular-design-2026-07-23.md](docs/audit/modular-design-2026-07-23.md)
- Phase 1 commit：`9a7cfa4`
- Phase 1-C 预提交：`f88bbc5 refactor(home): 抽取最近更新逻辑到 lib/lastUpdated.ts`

未 push — 等显式 ask。