# 模块化设计审核报告 — daily-paper-reader

> **审查日期**：2026-07-23
> **审查范围**：`src/` (Python 流水线, 28,251 LoC / 94 模块)、`astro-src/` (Astro 站点, 20,874 LoC / 71 模块)、`tests/` (63 个 test_*.py)
> **审查方法**：1 阶段静态扫描 + 5 维度并行 review（内聚性 / 耦合度 / 接口设计 / 层次边界 / 包依赖与可测试性）+ 加权排序
> **审查方式**：5 个独立 subagent 各自 sha 完整代码库并按 schema 返 structured findings；主循环汇总、查重、按 severity 排序
> **审查 trigger**：用户要求"模块化设计部分"

## TL;DR

整套仓库目前 **可工作但耦合严重**：

- **7 个 critical** 模块化缺陷（2 个 Python、2 个 TS、2 个跨语言、1 个 schema 不一致）
- **18 个 high** 缺陷（涉及 4 个 god module / 4 个上帝配置层 / 10 个未测试核心模块）
- **核心症状**：**文件系统当 IPC**（6 步流水线靠 manifest 路径串接）、**模块级全局状态**（`GLOBAL_TOKENS` / `state.ts::S`）、**stub façade 长期占位**（`topic-search/state.ts`、`validate/checks.py`、`conference_sidebar.py` 动态 importlib）
- **最大信任点**：`src/6.generate_docs.py`（2455 行 god module）、`astro-src/scripts/paper-analyzer.ts`（3173 行浏览器 monolith）、`src/main.py`（6 步 subprocess 编排无 DI seam）
- **可借鉴的反例**：`test_citation_guard.py`（14.8 KB 覆盖 13.8 KB 源模块）证明作者具备写单测能力，但 60+ 核心模块仍裸奔

---

## 1. 仓库结构速览（先建立坐标）

```
src/                          28,251 LoC, 94 模块 (Python 3.11+)
├── main.py                   989 行  流水线 orchestrator (入口)
├── llm.py                    970 行  LLMClient + 6 provider + module-global 计数
├── 6.generate_docs.py        2,455 行 ⚠️ 已知 god module
├── 2.1/2.2/2.3/3/4/5         6 步流水线入口（均为 1k+ 行的 step 脚本）
├── conference_*.py           4 文件、~2.8k 行，会议子系统
├── concept_*.py              3 文件（图、索引、slug）
├── maintain/                 35+ 文件，AAAI/ACL/.../NeurIPS+初始化+同步
├── pipeline_v2/              checkpoint + state (PR-1 引入)
├── validate/                 contracts/ + rubrics/ + stub checks.py
├── src/validate/src/validate/    ⚠️ 残留空目录（误产物）
└── _utils.py                      共享工具

astro-src/                    20,874 LoC, 71 模块 (Astro 5 + TS)
├── pages/                    7 页面 (index / papers / paper-analyzer / topic / settings / conferences / concepts)
├── components/               4 组件 (DailyCalendar 944 行)
├── lib/                      16 文件 (paper.ts 17KB / schemas.ts 17KB / paper-relations.ts 26KB)
├── scripts/                  17 顶层 + topic-search/ 13 子文件
│   ├── paper-analyzer.ts     3,173 行 ⚠️ 浏览器 monolith
│   ├── settings.ts              968 行 ⚠️ 14 域杂物抽屉
│   ├── settings-page.ts         798 行
│   ├── paper-fulltext.ts        944 行
│   ├── paper-chat.ts            798 行
│   ├── paper-selection.ts       295 行
│   └── topic-search/            13 文件, ~6800 行
│       ├── pipeline.ts          831 行, 9 export
│       ├── actions.ts           645 行, 14 out 7 in 中心节点
│       ├── render.ts            535 行, 动态 import topic-search-v2
│       └── state.ts              43 行, mutable S singleton 占位
└── scripts/topic-search-v2.ts  421 行  ⚠️ 重复 SESSION_KEY、duplicate 路径

tests/                        63 个 test_*.py
└── 覆盖率：60+ 核心 src 模块无 test (main / llm / 6.generate_docs / all maintain/* / concept_*/...)
```

### 1.1 关键模块扇入扇出（高扇入 = 共享基础设施）

| 扇入 | 模块 | 风险 |
|---|---|---|
| 17 | `src/maintain/common.py` | 所有 maintain 脚本共享 run_step，单点改动影响全 maintain |
| 14 | `src/source_config.py` | 配置中枢 leaf，几乎所有 step 都 import |
| 9  | `src/maintain/init_factory.py` | 9 个 init_*.py 共享脚手架 |
| 5  | `src/llm.py` + `src/subscription_plan.py` | 4-5 个 step 各自 import 但混 `from llm` 与 `from src.llm` |
| 13 | `astro-src/scripts/settings.ts` | **上帝模块**：13 个 TS 文件直接 import |

### 1.2 跨语言共享真相源

| 概念 | Python 端 | TS 端 | 同步机制 |
|---|---|---|---|
| topic/subq 类型 | `src/llm.py` 等 | `astro-src/lib/schemas.ts` | 手动同步（schemas.ts 有 buildSubQ/buildRegenSubQ） |
| 4 维分类 | `src/taxonomy.py` + `config/taxonomies.json` | `astro-src/lib/taxonomies.ts` | 双向 import 同一 JSON，靠 PR review 拦截 |
| 概念图 | `src/concept_*.py` | `astro-src/lib/concept_graph.ts` | 文件系统（Python 写 JSON、TS 读） |
| 论文 frontmatter | `src/generate_docs_frontmatter.py`（写） | `astro-src/lib/paper.ts`（读） | 文件系统 + 单方面解析，无 schema 校验 |
| 校验 schema | `src/validate/contracts/*.json` | （无对应） | **10 个 JSON 没人 load**（见 § 4.4） |

---

## 2. Critical 缺陷（7 项 — 必须处理）

### 🔴 C1. `src/conference_sidebar.py` 动态 importlib 加载 `6.generate_docs.py`，制造两份独立模块身份

**维度**：耦合度
**文件**：[src/conference_sidebar.py:109-118](src/conference_sidebar.py#L109-L118) + [src/6.generate_docs.py](src/6.generate_docs.py)

```python
# conference_sidebar.py L109-118
src_dir = ROOT_DIR / 'src'
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))
spec = importlib.util.spec_from_file_location('dpr_generate_docs_for_conference', module_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
_GENERATE_DOCS_MODULE = module
```

**为什么是 critical**：
- 绕开 Python 包管理，把 `6.generate_docs.py` 伪装成 `dpr_generate_docs_for_conference` 二次加载
- 同一进程内存在 2 份 `LLM_CLIENT` / `TODAY_STR` 等 module-level 常量，**monkey-patch 看不到**
- 修改 6.generate_docs.py 内部函数时，conference_sidebar 静默失效
- 显式违反"用文件系统当 IPC + 不再动态加载"的模块化原则

**建议**：抽取 `src/conference_sidebar_shared.py` 共享 `build_conference_marker / write sidebar block` 等纯函数，6.generate_docs 与 conference_sidebar 都从这里 import；删除 dynamic-loader hack。

---

### 🔴 C2. step 脚本混用 `from llm import` 与 `from src.llm import`，包边界不稳定

**维度**：耦合度
**文件**：`src/0.enrich_config_queries.py:13` / `src/3.rank_papers.py:11` / `src/4.llm_refine_papers.py:13` / `src/6.generate_docs.py:22` / `src/llm_router.py:20`

```python
# 4 个 step 脚本
from llm import ClientFactory
from llm import ClientFactory, LLMClient

# 仅 llm_router.py 写
from src.llm import ClientFactory, parse_provider_model
```

**为什么是 critical**：
- 同一仓库两种 import 风格并存，根因是 `main.py:55` 强行 `PYTHONPATH=ROOT_DIR` 让两种写法都能 resolve
- 任何对 `src/llm.py` 的内部重构（签名变更、router 注入）会被 4 个非 `src.*` 调用点漏掉 type-check
- `src/` 并未被当作稳定包使用 → 重构时无法保证 caller 同步

**建议**：统一为 `from src.llm import ...`；删除 31 处 `sys.path.insert` hack；改用 `python -m src.main` 启动。

---

### 🔴 C3. `astro-src/scripts/paper-analyzer.ts` 3,173 行浏览器 monolith

**维度**：内聚性
**文件**：[astro-src/scripts/paper-analyzer.ts](astro-src/scripts/paper-analyzer.ts)

把 8 类不相关职责塞在一个文件：

| 行号 | 职责 | 类别 |
|---|---|---|
| 159-635 | 设置 UI、provider preset、Gist 同步、模型列表 | UI/凭证 |
| 985-1113 | arXiv 搜索 / 解析 / PDF 抓取 | 数据获取 |
| 805-908 | PDF.js 文本提取 | 数据处理 |
| 1351-1749 | LLM 调用、分段、重试、错误格式化 | 数据处理 |
| 1750-2027 | RAG 三阶段精读编排 | 业务编排 |
| 2178-2395 | Markdown / frontmatter 渲染 | 渲染 |
| 2049-2487 | GitHub 保存 + workflow 轮询 | IO |
| 661-3173 | 历史面板 + DOM 事件绑定 | UI |

**为什么是 critical**：
- 单文件 import 18 个 settings.ts symbols + katex + pdfjs-dist + browsers DOM
- topic-search/pipeline.ts 仅为了拿 `searchArxiv` / `fetchArxivPdf` / `callLLM` 三个 export，就把 3173 行 + 所有 DOM 副作用拖进 leaf 依赖图
- 整个 `astro-src/` 没有任何 `.test.ts`，1 KB 的入口测试都没有

**建议**：拆 8 个文件 `arxiv-client.ts` / `pdf-extract.ts` / `llm-invoke.ts` / `deepdive.ts` / `note-render.ts` / `github-publish.ts` / `analyzer-settings-ui.ts` / `analyzer-page.ts`，纯逻辑库不含 DOM。

---

### 🔴 C4. `src/6.generate_docs.py` `process_paper` 单函数 360 行 god module

**维度**：内聚性
**文件**：[src/6.generate_docs.py:1321-1682](src/6.generate_docs.py#L1321-L1682)

`process_paper` 函数分 3 大分支（md 已存在补齐 / glance-only / 全量生成），每分支重复调用 `ensure_text_content / maybe_generate_paper_media / ensure_paper_formulas / translate / generate_glance`，通过 `paper['llm_categories']` 这类**就地 mutation 隐式传状态**给下游 `build_markdown_content / extract_sidebar_tags`。

**为什么是 critical**：
- 整文件 2,455 行混了 LLM 封装 / arXiv 抓取 / XML 解析 / 中文翻译 / 深度总结 / 速览 / tags 归一化 / sidebar 树维护 / 日报生成 / 首页 README / 路径规划 / 媒体公式钩子 11 类职责
- 模块级 `LLM_CLIENT` 全局 + 函数内 mutation 是"可工作但不可单独验证"的状态
- 已在 PR 拆出 `generate_docs_frontmatter / md_helpers / md_io / text_utils` 4 个辅助模块，但主体仍未动

**建议**：拆 `llm_docs.py` / `arxiv_meta.py` / `summarize.py` / `tags.py` / `sidebar.py` / `day_report.py` / `paper_pipeline.py`（仅 3 个小函数 handler）。

---

### 🔴 C5. `src/main.py` 用 6 个 subprocess 串接 6 步，IPC 隐式靠文件路径

**维度**：层次 / 边界
**文件**：[src/main.py:47-56](src/main.py#L47-L56) + [src/main.py:761-897](src/main.py#L761-L897)

```python
# main.py:L47-56
def run_step(label, args, env=None):
    merged = {**os.environ, **(env or {})}
    merged["PYTHONPATH"] = ROOT_DIR  # 强行注入
    subprocess.run(args, check=True, env=merged, cwd=ROOT_DIR)
```

**为什么是 critical**：
- 6 步 `pipeline` 间数据靠 `archive/<run_date_token>/raw|filtered|rank|recommend/*.json` 文件名约定传递 — 经典"文件系统当 IPC"
- 7 处硬编码 path 模板（`raw_path / bm25_path / embedding_path / rrf_path / rerank_path / llm_path / recommend_path`）散在 L829-848
- 任何新 step 都要：手写 path 模板 + 在 subprocess 里重新 load 同一份 yaml + 可能在 Gist 解析失败时静默 fallthrough
- `run_step_with_checkpoint` 是 PR-1 引入的"薄壳"——本质靠 caller 改一行调用，没抽象层

**建议**：抽 `src/pipeline/context.py` 定义 `PipelineContext(archive_dir, run_date_token, raw_path, ...)` + `Step(subprocess_args, checkpoint_id)`，6 步改成 `pipeline.run([Step(...), Step(...)])`，所有 path 拼装由 context 统一派生。

---

### 🔴 C6. `astro-src/pages/index.astro` 在 frontmatter 直接 fetch GitHub Actions API + 自写 readGhToken

**维度**：层次 / 边界
**文件**：[astro-src/pages/index.astro:46-102](astro-src/pages/index.astro#L46-L102)

页面层应该只负责 layout + 调 lib 数据，但 `index.astro` frontmatter 段直接编排了：
1. `readGhToken()` 大小写兜底（process.env + dotenv + .toUpperCase）
2. `fetchLastSuccessRunDate()` 直接调 GitHub Actions REST API
3. 3 类失败 hint 文案（NO_TOKEN / 401 / 网络异常）散在页面
4. `dailyLean` 二次映射 `paperPlainTitle + resolveTaskKey` 业务逻辑（在 `lib/paper.ts` 已有 `resolveTaskKey` 暴露情况下，页面又重复一份）

**为什么是 critical**：
- 跨层引用外部 REST API，边界渗漏
- 改 GitHub API 走 proxy / 换数据源时需要改页面 markdown，而不是改 lib
- fallthrough 文案由页面写，数据层看不到

**建议**：抽 `astro-src/lib/lastUpdated.ts` 暴露 `getLastUpdatedDate(): Promise<{label, isFallback}>`，warn 文案用 `console.warn` 统一输出，home.astro 只 await 拿结果。

---

### 🔴 C7. `src/validate/contracts/*.schema.json` 与脚本实读字段完全不匹配（validate 形同虚设）

**维度**：接口设计
**文件**：[src/validate/contracts/0.enrich_config_queries.schema.json](src/validate/contracts/0.enrich_config_queries.schema.json) + [src/0.enrich_config_queries.py:140-142](src/0.enrich_config_queries.py#L140-L142)

**两处对比**：

| 字段 | 0.enrich_config_queries schema 要求 | 0.enrich_config_queries.py 实际读 |
|---|---|---|
| 路径 | `config.query_text` | `subscriptions.keywords[*].keyword` |
| 字段 | `prefixed_text` | `subscriptions.keywords[*].related` + `rewrite` |
| 来源 | argv 形态（早期模板残留） | `config.yaml` 树形 |

类似的 bug 也在 `1.1.fetch.raw.schema.json`：要求 `paper_id/pdf_url`，但 fetch_arxiv.py 实际写 `id/link`。

**为什么是 critical**：
- 10 个 `contracts/*.schema.json` 没有任何 Python loader 真正解析它们
- `_check_schema_valid` 只做 `key in field_value` —— 不解析 JSON schema
- 即使有人跑 validate，过永远过，**根本抓不到 enrich 实际缺 related/rewrite 的真问题**
- 这是接口设计的典型 bug：schema 与实现脱节

**建议**：把 required_keys 改为 jsonpath 风格表达；在 main() 末尾 dump `_meta: { required: [...] }` 让 schema 直接读；为所有 contracts/*.schema.json 写 CI verify step（schema valid + 脚本实读字段匹配 require 列表）。

---

## 3. High 缺陷（18 项 — 按主题分组）

### 3.1 两个上帝模块：耦合度爆表

#### 🔴 H1. `astro-src/scripts/settings.ts` 968 行 14 域杂物抽屉（被 13 个文件 import）

**维度**：耦合度 + 内聚性
**文件**：[astro-src/scripts/settings.ts](astro-src/scripts/settings.ts)

13 个文件直接 import（grep 23 个匹配），承担 14 个互不相关的持久化域：

| 域 | 关键函数 |
|---|---|
| githubToken / githubRepo | `loadGitHubToken`, `loadGitHubRepo` |
| autoSaveAnalyzer / deepDive | `loadAutoSaveAnalyzerToGitHub`, `loadDeepDiveSettings` |
| hiddenPapers | `loadHiddenPapers` + `pushHiddenPapersToGist` / `pullHiddenPapersFromGist` |
| selection | `loadSelection` + `emitSelectionChange` |
| llm / provider / proxy | `loadSettings`, `loadProvider`, `getCustomProxy` |
| gistId / gistToken | `getGistId`, `getGistToken` |
| topics / categories | `getTopics`, `loadCategories` |
| userTags | `pullUserTagsFromGist`, `pushUserTagsToGist` |

**问题**：
- "本地持久化" + "远程 REST 同步"两个抽象层压在一起（`pushHiddenPapersToGist` 写在 settings.ts L399-423）
- 任意域 schema 变更要改这个被全站 import 的巨型文件
- **MEMORY 4cfa5fa 已经踩过这个雷**："两路写 selection 不共享事件源"，本质就是低内聚导致的耦合
- `GH_OWNER_KEY / GH_REPO_KEY / GH_WORKFLOW_KEY` 三个 raw key 绕过 STORAGE_KEYS 表

**建议**：按域拆 store 模块 `credentials-store.ts / repo-store.ts / deepdive-store.ts / collection-store.ts / llm-config-store.ts / topics-store.ts / categories-store.ts`；把 Gist pull/push 抽到独立 `gist-sync.ts`。

---

#### 🔴 H2. `src/maintain/common.py` 扇入 17（被 17 个 maintain 脚本 import）

**维度**：耦合度
**文件**：[src/maintain/common.py](src/maintain/common.py)

```python
# 17 个 import 站点
from src.maintain.common import run_step, cleanup_backend, default_raw_path
```

- `run_step` / `cleanup_backend` / `default_raw_path` 是所有 maintain 流程的共享脚手架
- PR-3 抽出来的 init_factory 也是 maintain 共享的（图 9 扇入）
- 任何 common.py 改动都会被 17 个脚本同步触发

**建议**：维持现状（这是合理的基础设施层），但加 1-2 个 test 固定契约；特别是 `run_step` 的 PYTHONPATH/cwd 行为应被 unit test 钉死。

---

### 3.2 topic-search/ 子目录：拆分良好但 3 个 fat module 仍残留

#### 🔴 H3. `topic-search/actions.ts` 14-out 7-in 中心节点 + seeds-modal 双向依赖

**维度**：耦合度
**文件**：[astro-src/scripts/topic-search/actions.ts:13](astro-src/scripts/topic-search/actions.ts#L13) + [seeds-modal.ts:16](astro-src/scripts/topic-search/seeds-modal.ts#L16)

**依赖图**：
```
actions.ts ──► render.ts ──► pipeline.ts
   ▲                              │
   └── seeds-modal.ts ────────────┘
actions.ts ◄── seeds-modal.ts (双向)
```

**问题**：
- actions.ts 单行 import 14 个 symbols（`decomposeIdea / searchForDirection / summarizeOne / chatWithReport / validateSubqHitCount / SUMMARIZE_CONCURRENCY / PDF_PREFETCH_CONCURRENCY / pdfTextCache / prefetchOnePdf`）
- seeds-modal.ts 从 actions.ts 导入 `setCurrent / ensureSession / doSummarize / persistSession / loadStore / saveStore` 5 个 actions 内部实现 —— 弹层不该对 actions 实现细节有依赖
- `actions.ts:544` 用 `await import('./llm-call')` 动态 import 一个本文件顶部 static import 链上的模块 —— 静态/动态边界混乱
- `SUMMARIZE_CONCURRENCY` / `PDF_PREFETCH_CONCURRENCY` 常量从 pipeline.ts 漏出，被 caller 引用

**建议**：加 `index.ts` 对外只 export 7 个 high-level actions；内部 `pipeline-internal` 单独 module 或全部 private；seeds-modal 改为 import 自 `index.ts`。

---

#### 🔴 H4. `topic-search/state.ts` mutable 全局 S singleton（11 个 leaf 隐式 service locator）

**维度**：耦合度 + 层次边界
**文件**：[astro-src/scripts/topic-search/state.ts:26-39](astro-src/scripts/topic-search/state.ts#L26-L39)

```typescript
// state.ts:26-39
export const S: State = {
  getSession: () => { throw new Error('S.getSession() called before orchestrator init'); },
  ...
};
export function setStateImplementation(impl: State): void { Object.assign(S, impl); }

// topic-search.ts:31-34 在 module top-level mutate
S.getSession = () => current;
S.setSession = (s) => { current = s; };
```

**问题**：
- 11 个 leaf 文件（state / llm-call / actions / pipeline / render / init / status / report-markdown / seeds-modal / prompts / concurrency）都 `import { S } from './state'`
- `Object.assign` 注入实现，等于把 state.ts 实现职责外部化
- topic-search-v2.ts 还**重复定义 SESSION_KEY** `'dpr_topic_session_v1'` (L40) —— 两份 session 真相源
- 多 tab 复用同一 window 时第二个实例会覆盖第一个，状态串台

**建议**：把 S 改成不可变 `class TopicSearchContext`；用 `setContext(ctx)` 注入；删除 topic-search-v2 的 SESSION_KEY 重复。

---

#### 🔴 H5. `topic-search/pipeline.ts` 9 export 混步骤 + pdfCache

**维度**：层次边界
**文件**：[astro-src/scripts/topic-search/pipeline.ts:116-621](astro-src/scripts/topic-search/pipeline.ts#L116-L621)

```typescript
export { decomposeIdea, exploreFromSeeds, searchForDirection,
         summarizeOne, chatWithReport,
         validateSubqHitCount, validateAndRewriteSubqs,
         pdfTextCache, prefetchOnePdf }  // 9 exports
```

- 9 个 export 混"步骤推进"（前 7 个）+ "PDF 全文缓存"（后 2 个）
- `pdfTextCache` 是 IO 资源应独立 `pdf-cache.ts`
- `render.ts:512` 动态 import topic-search-v2 — 渲染层与"判定要不要 v2 路径"耦合

**建议**：拆 `pipeline/index.ts`（5 个步骤 export）+ `pipeline/pdfCache.ts`；render.ts 不再动态 import v2。

---

### 3.3 Python 子系统低内聚

#### 🔴 H6. `src/llm.py` 1 类 ~635 行 + 模块级 GLOBAL_TOKENS

**维度**：内聚性 + 可测试性
**文件**：[src/llm.py:67-701](src/llm.py#L67-L701)

LLMClient 混入 6 类正交职责：
1. HTTP 端点构造 + 重试轮换（L108-146）
2. provider 名称推断（L147）
3. JSON 提取 / 修复 / 解析（L185-285）—— 纯字符串处理
4. response_format schema 构造（L286-304）
5. 结构化输出降级探测（L305）
6. chat / chat_structured / rerank 主逻辑（L349-701）

外加模块级 `GLOBAL_TOKENS` / `GLOBAL_TIME_SECONDS`（L30-37）+ `global GLOBAL_TIME_SECONDS`（L470）直接写全局。

**问题**：
- HTTP 路径不可测（`import requests` 顶层 + 内部 `requests.post`，没法注入 Session）
- GLOBAL_TOKENS 跨测试串扰
- 现有 `test_llm_base_url.py` / `test_llm_structured_output.py` 只覆盖 URL/prompt 分支，**从不触 HTTP 路径**

**建议**：
- 抽 `json_repair.py` / `response_format.py` / `endpoint.py`
- LLMClient 接受 `session: requests.Session | None = None`
- 用量统计迁到实例 `_cum_tokens` / `_cum_time_seconds`，删除模块全局
- 提供 `FakeTransport` 给 pytest

---

#### 🔴 H7. `src/conference_sidebar.py` 重复 log/slugify/load_json + importlib 动态加载

**维度**：内聚性
**文件**：[src/conference_sidebar.py:104-121](src/conference_sidebar.py#L104-L121)

- log 在 `conference_retrieval.py:66` 与 `conference_pipeline.py:29` 重复定义
- slugify / load_json / norm_text 在 sidebar.py 又各造一份
- `load_generate_docs_module()` 用 importlib 动态 exec 加载 `6.generate_docs.py` 反向依赖日常页 god module 复用其内部函数
- 自身承担 10 组责任：frontmatter 解析 / sidebar 标记 / topic key 构造 / glance 字段 / PDF url / 图表 / 媒体 / markdown 写出 / sidebar 树合并

**建议**：新建 `conference/common.py`（log/slugify/load_json/norm_text 共享）；把 generate_docs 与 conference_sidebar 都要用的 summarize/figure/frontmatter 提到独立 shared 模块。

---

#### 🔴 H8. `src/concept_index.py` 混 frontmatter 解析 + JSON writer + Markdown renderer

**维度**：层次边界
**文件**：[src/concept_index.py:23-127](src/concept_index.py#L23-L127)

- 自写 `_parse_front_matter` + `_fallback_yaml` + `_consume_block` 100+ 行 yaml 解析 fallback
- 含 `_render_concept_md` + `_render_origin_section` + `_render_reverse_links_section` + `_replace_block` Markdown 渲染
- 含 `_write_concept_graph`（JSON）+ `_write_concept_index`（JSON）写文件
- 含 `_replace_block` 改 markdown 文件

**问题**：与 `src/generate_docs_frontmatter.py` frontmatter 解析职责重叠、与 `src/generate_docs_md_helpers.py` 写 md 模板职责重叠。

**建议**：拆 3 层 `src/concept_frontmatter.py`（共享 parser）+ `src/concept_writer.py`（3 种 sink）+ `src/concept_index.py`（仅 orchestrator）。

---

#### 🔴 H9. `src/5.select_papers.py` 1,159 行 carryover + 4 配额算法 + tag 归一化

**维度**：内聚性
**文件**：[src/5.select_papers.py](src/5.select_papers.py)

- carryover 持久化 / 合并 / 标签解析（L120-773）
- 4 套选择/配额算法 `round_robin_select / allocate_uniform / allocate_low_bias / interleave_layers`（L393-708）
- 顶层 mode 编排 `process_mode / process_mode_all_quick_min_score / force_all_into_quick`（L774-928）

**建议**：拆 `carryover.py` / `allocation.py`（纯函数）/ `tags_norm.py`；select_papers.py 仅保留 process_mode 编排。

---

#### 🔴 H10. `src/main.py` 夹 140 行 trace 调试 + rerank 回退业务

**维度**：内聚性
**文件**：[src/main.py:360-724](src/main.py#L360-L724) + [src/main.py:427-518](src/main.py#L427-L518)

- `parse_trace_ids / build_paper_index / collect_query_hits / print_trace_retrieval / print_trace_llm` 140 行 trace 调试
- `score_to_stars / build_ranked_from_sim_scores / prepare_rerank_fallback / should_skip_rerank` 评分业务

**建议**：抽出 `trace_debug.py` + `rerank_fallback.py`；main.py 只保留 run_step + main 编排。

---

### 3.4 测试覆盖率严重不足

#### 🔴 H11. 60+ 核心 src 模块无 test（87 src 模块中仅 27 有对应 test_<name>）

**维度**：可测试性
**文件**：`tests/` 全仓

| 类别 | 缺测试的模块 |
|---|---|
| 6 步流水线 | `2.1/2.2/2.3/3/4/5/6.generate_docs.py` + `main.py` |
| 核心 | `llm.py` / `llm_router.py` / `llm_usage_logger.py` |
| 概念子系统 | `concept_extractor.py` / `concept_index.py` / `concept_slug.py` |
| 媒体 | `paper_figures.py` / `paper_formulas.py` / `paper_paths.py` |
| 维护 | `maintain/*` 35+ 文件全无 |
| 校验 | `validate/checks.py` / `validate/contracts/*.json` 10 个 JSON 没人读 |
| 状态 | `pipeline_v2/state.py` |

`test_main_pipeline.py` 用 `patch('run_step')` 绕过，**从未跑过真实 subprocess** —— 流水线契约实际被演练的覆盖率接近 0。

**建议**：优先给 src/llm.py (FakeTransport) + src/main.py (subprocess executor 注入) + src/pipeline_v2/state.py 加测试。

---

#### 🔴 H12. `src/pipeline_v2/checkpoint.py` 真逻辑 + 文件系统 + flock 三层混

**维度**：可测试性
**文件**：[src/pipeline_v2/checkpoint.py:149-183](src/pipeline_v2/checkpoint.py#L149-L183)

- `sys.platform` 条件导入 `fcntl`（Windows dev 路径无锁）
- `open(lock, 'w') + flock + mkstemp + os.replace` 都在 `checkpoint_write()`
- test_pipeline_checkpoint.py 只测 Linux happy path，Windows dev 静默无锁

**建议**：拆 `checkpoint.py`（纯逻辑）+ `checkpoint_io.py`（fs/flock，接受 `_Backend` protocol 可注入 in-memory backend）。

---

#### 🔴 H13. `src/validate/checks.py` 是 stub（rubric/load contract 都没接）

**维度**：可测试性
**文件**：[src/validate/checks.py:203-226](src/validate/checks.py#L203-L226)

- `_judge_rubric()` 永远返回 True，注释 "Real implementation would involve LLM call"
- 10 个 `contracts/*.schema.json` 没人 load
- `rubrics/` 目录空
- `src/validate/src/validate/` 是空目录（**误产物**）

**建议**：抽 `load_contract(step_id)` + `load_acceptance(step_id)`；替换 `_judge_rubric` 为可注入 `Judge` protocol。

---

#### 🔴 H14. `src/sitecustomize.py` 是 magic shim（没人 wire）

**维度**：可测试性
**文件**：[src/sitecustomize.py](src/sitecustomize.py)

7 行文件，唯一作用是 `from local_env import load_local_env; load_local_env()`。但 `conftest.py` / `pytest.ini` / `pyproject.toml` 都没引用它。

**问题**：
- prod vs pytest 可能不一致地读取 `.env`
- `DPR_DISABLE_DOTENV` 存在但没人测

**建议**：要么在每个 `__main__` + pytest fixture 显式 call `load_local_env()`，要么走 `PYTHONSTARTUP=src/sitecustomize.py` 路径并在 README 文档化。

---

#### 🔴 H15. `astro-src/scripts/paper-analyzer.ts` 3,173 行 + 全 astro-src 0 个 `.test.ts`

**维度**：可测试性
**文件**：[astro-src/scripts/paper-analyzer.ts](astro-src/scripts/paper-analyzer.ts)

- `find astro-src -name '*.test*'` = 0 命中
- 整个浏览器侧没有任何 JS/TS 单测覆盖
- `topic-search/state.ts` (纯函数) / `topic-search/json-heal.ts` (纯函数) / `topic-search/concurrency.ts` (44 行) 均可测但未测

**建议**：加 vitest 到 devDependencies；先测 `state.ts` + `json-heal.ts` + `concurrency.ts`；paper-analyzer.ts 拆完后才有戏。

---

### 3.5 其它 high 问题

#### 🔴 H16. `src/main.py` `run_step()` 没有 executor 注入 seam

**维度**：可测试性
**文件**：[src/main.py:47-56](src/main.py#L47-L56)

`subprocess.run(args, check=True, env=merged, cwd=ROOT_DIR)` 是唯一编排原语，6 个 call site 都 funnel 这里。`merged["PYTHONPATH"] = ROOT_DIR` 硬编码环境变量，**任何 test 跑 main.py 都会污染父进程 env**。

**建议**：把每个 step 改成 `def main(argv=None, *, db=None, http=None) -> int`；run_step 接受可选 `_executor: Callable[[list[str], dict], int]`。

---

#### 🔴 H17. Python LLMClient vs TS `callChatCompletion` 接口完全不对齐

**维度**：接口设计
**文件**：[src/llm.py:349](src/llm.py#L349) + [astro-src/lib/llm.ts:32-125](astro-src/lib/llm.ts#L32-L125)

| 维度 | Python LLMClient | TS callChatCompletion |
|---|---|---|
| kwargs 命名 | snake_case (`max_tokens`, `response_format`) | camelCase (`maxTokens`, `reasoningModelPattern`) |
| 返回字段 | `tokens / raw_response / message / finish_reason` | `content / finishReason / raw / isDeepSeek / reasoningDisabled` |
| JSON 容错 | 5 步候选降级 (`parse_json_content`) | 单一 `finalizeLLMJson` 路径 |
| structured 调用 | `chat_structured_safe` 封装 refusal + finish_reason + parse_error + retry | 全部散在 caller (json-heal.ts + llm-call.ts) |

**问题**：同一调用模式（"extract concepts from outline"）在两端要写两套。

**建议**：写 `docs/api/llm-bridge.md` 接口映射表，钉死任何一端扩展时需同步另一端的 PR 描述。

---

#### 🔴 H18. `src/maintain/init_factory.py` ROOT_DIR 路径深度 4 层

**维度**：耦合度
**文件**：[src/maintain/init_factory.py:34-36](src/maintain/init_factory.py#L34-L36)

```python
SCRIPT_DIR = os.path.dirname(__file__)
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
```

配合 sys.path hack（见 § C2 / H2），任何修改目录结构或打包成 zipapp 都会让 ROOT_DIR 计算错位；CI 与本地路径表达式不一致。

**建议**：用 `importlib.resources.files('src')` + cache；所有 init_*.py 读 `init_factory.cached_root()`。

---

## 4. Medium 缺陷（按主题）

### 4.1 跨层 / 边界渗漏

| # | 维度 | 文件 | 要点 |
|---|---|---|---|
| M1 | 内聚性 | `astro-src/components/DailyCalendar.astro:95` | 944 行单组件承担 4 类职责（SSR 聚合 / 日历网格 / HTML 卡片 / 事件总线）；SSR/client 各自重写 escapeHtml |
| M2 | 内聚性 | `src/main.py:585` | 夹 140 行 trace 调试 + rerank 业务（详见 H10） |
| M3 | 层次 | `astro-src/scripts/topic-search/pipeline.ts:116` | 9 export 混步骤 + pdfCache（详见 H5） |
| M4 | 边界 | `src/concept_extractor.py:55` | `_load_yaml_dict` 自写 yaml 解析；`src/concept_index.py` 100+ 行 yaml fallback；`src/generate_docs_frontmatter.py` 独立 parser —— 三处独立实现，无共享 frontmatter util |
| M5 | 耦合 | `astro-src/lib/schemas.ts:23` | 反向 type-import `AnalysisResult, ArxivEntry` 自 3173 行 paper-analyzer monolith |

### 4.2 接口设计

| # | 维度 | 文件 | 要点 |
|---|---|---|---|
| M6 | 接口 | `src/paper_figures.py:960` | 没公开 facade，6 个 caller 直接 import 私有 `_helper`（`_absolute_dir / _relative_prefix / _safe_asset_key / _load_cached_figures / _save_figures_meta`） |
| M7 | 接口 | `astro-src/scripts/settings.ts:21` | 同时 import + export `STORAGE_KEYS / GITHUB_REPO_DEFAULT / GitHubRepoConfig`（3 行 identity re-export）；`GH_OWNER_KEY / GH_REPO_KEY / GH_WORKFLOW_KEY` 3 个 raw key 绕过 STORAGE_KEYS 表 |
| M8 | 接口 | `astro-src/scripts/topic-search/actions.ts:13` | 单行 14 symbols 导入 + L544 动态 import llm-call，caller 暴露过多 pipeline 内部细节 |
| M9 | 可测试 | `src/conference_sidebar.py:1` | 36 KB 域模块无单测，对比 `test_citation_guard.py` 14.8 KB 覆盖 13.8 KB 源模块，证明作者具备写测试能力 |

### 4.3 跨语言共享未对齐

| # | 维度 | 文件 | 要点 |
|---|---|---|---|
| M10 | 接口 | `src/paper_paths.py:1` | Python 端**没有** `listPapers / getPaperMeta`（题面假设不成立）；Python 多处自实现（6.generate_docs / conference_pipeline / conference_sidebar），与 TS 端 `lib/paper.ts` 边界错位 |

### 4.4 校验 stub / dead artefacts

| # | 维度 | 文件 | 要点 |
|---|---|---|---|
| M11 | 可测试 | `src/validate/checks.py:203` | `_judge_rubric` 总是 True；10 个 `contracts/*.json` 没人 load；`rubrics/` 空；`src/validate/src/validate/` 目录误产物 |
| M12 | 边界 | `src/validate/src/validate/checks.py` | **空目录**（误产物）应清掉；`src/maintain/fetchers/__pycache__/fetch_biorxiv.pyc` 等老 .pyc 残留 |

---

## 5. 整体改进路线图（按 ROI 排序）

### Phase 1 — 立即能做的隔离（1-2 周）

> **目标**：把"两个 god module"和"两个耦合元凶"切开，但不重写业务。

1. **统一 import 风格**（C2）—— 4 个 step 改 `from src.llm import`，删 31 处 `sys.path.insert`，加 `pyproject.toml`：`from src.X import` 强制。
2. **拆 conference_sidebar 的 dynamic loader**（C1）—— 把 6.generate_docs 与 conference_sidebar 共享函数提到 `src/conference_sidebar_shared.py`。
3. **修 validate contracts schema 不匹配**（C7）—— 把 schema 改成 jsonpath 或从 main() 末尾 dump `_meta`，加 1 个 CI verify step。
4. **抽 `lib/lastUpdated.ts`**（C6）—— index.astro 只 await `getLastUpdatedDate()`。
5. **删 dead artefacts** —— `src/validate/src/validate/` 空目录、`fetchers/__pycache__/fetch_*.pyc` 残留。

### Phase 2 — 主 god module 拆骨架（2-4 周）

> **目标**：拆 6.generate_docs.py 与 paper-analyzer.ts，但不重写逻辑。

1. **拆 6.generate_docs.py**（C4）—— 7 个子模块 `llm_docs.py / arxiv_meta.py / summarize.py / tags.py / sidebar.py / day_report.py / paper_pipeline.py`；`process_paper` 拆 `handle_existing / handle_glance_only / handle_full`。
2. **拆 paper-analyzer.ts**（C3）—— 8 个文件 `arxiv-client.ts / pdf-extract.ts / llm-invoke.ts / deepdive.ts / note-render.ts / github-publish.ts / analyzer-settings-ui.ts / analyzer-page.ts`。
3. **拆 settings.ts**（H1）—— `credentials-store.ts / repo-store.ts / deepdive-store.ts / collection-store.ts / llm-config-store.ts / topics-store.ts / categories-store.ts` + `gist-sync.ts`。

### Phase 3 — 加测试 + 抽 DI seam（3-6 周）

> **目标**：让核心模块可单测。

1. **加 vitest + pytest 测试覆盖**（H11）—— 优先 `src/llm.py` (FakeTransport) + `src/main.py` (executor 注入) + `src/pipeline_v2/state.py` + `astro-src/scripts/topic-search/{state,json-heal,concurrency}.ts`。
2. **抽 `PipelineContext` + `Step` abstraction**（C5）—— main.py 走 `pipeline.run([Step(...), Step(...)])`。
3. **LLMClient 接受 `session=` 注入**（H6）—— 删除 GLOBAL_TOKENS / GLOBAL_TIME_SECONDS。
4. **checkpoint.py 拆纯逻辑 + IO**（H12）—— 加 `_Backend` protocol，test 用 in-memory backend。
5. **validate/checks.py 真正接 contracts / rubrics**（H13）—— 替换 stub `_judge_rubric` 为可注入 `Judge` protocol。

### Phase 4 — 长期演进（持续）

1. **统一 Python LLMClient 与 TS callChatCompletion 接口语义**（H17）—— 写 `docs/api/llm-bridge.md` 接口映射表。
2. **topic-search/state.ts 改成不可变 `TopicSearchContext`**（H4）—— 删 mutable S singleton + topic-search-v2 SESSION_KEY 重复。
3. **concept_index.py 拆 3 层**（H8）—— `concept_frontmatter.py / concept_writer.py / concept_index.py`。
4. **5.select_papers.py 拆 carryover / allocation / tags_norm**（H9）。

---

## 6. 附录

### 6.1 审查覆盖度

- **静态扫描**：4 个并行 agent（Python 指标 / TS 指标 / Astro 组件 / 跨语言 import）
- **维度 review**：5 个并行 agent（内聚性 / 耦合度 / 接口设计 / 层次边界 / 可测试性）
- **去重**：每个 agent 独立返 structured findings，主循环汇总
- **未做 cross-validate**：原计划中 verify 阶段因脚本 API 误用全部失败（`agent()` 不返 thenable）
- **未做修复**：本次仅审查，不动代码

### 6.2 已知反例（值得借鉴）

- **`test_citation_guard.py`（14.8 KB）** 覆盖 `src/citation_guard.py`（13.8 KB）—— 1:1 全覆盖
- **`astro-src/lib/schemas.ts`** 集中 `SubQ / Candidate / Summary / TopicReport` + `buildSubQ / buildRegenSubQ` helpers —— 跨 topic-search 复用，是好实践
- **PR-3 `init_factory.py`** 抽出 9 个 init_*.py 共享脚手架 —— 是 maintain 子系统的好抽象
- **`src/maintain/common.py`** 17 扇入 — 合理的基础设施层（虽然没测试）

### 6.3 已知 stub / 占位

- **`astro-src/scripts/topic-search/state.ts`** 注释明确说"step 14 时再迁移" — 原计划未落地
- **`src/validate/checks.py`** `_judge_rubric` 始终 True — 注释承认"Real implementation would involve LLM call"
- **`src/conference_sidebar.py`** 动态 importlib 反向依赖 generate_docs — 临时缝补，未收敛
- **`astro-src/scripts/topic-search-v2.ts`** 421 行 + `_storage` 重复 SESSION_KEY — 与主路径双轨运行

### 6.4 残留 / 异常产物

- `src/validate/src/validate/checks.py` —— **空目录**（误产物）
- `src/maintain/fetchers/__pycache__/fetch_biorxiv.pyc` 等老 .pyc 残留（fetch_biorxiv.py 源码已合并到 fetch_biorxiv_family.py）

### 6.5 关键 issue 风险评级（影响 / 修复成本）

| Issue | 影响 | 修复成本 | 建议 |
|---|---|---|---|
| C1 conference_sidebar 动态加载 | 易静默失效 | 中 | 立即 |
| C2 import 风格混乱 | 重构风险 | 低 | 立即 |
| C3 paper-analyzer 3.1k monolith | 阻碍 topic-search 测试 | 高 | Phase 2 |
| C4 6.generate_docs 2.5k god | 改 1 处 5 处测 | 高 | Phase 2 |
| C5 main.py 文件系统 IPC | 全流水线契约 | 高 | Phase 3 |
| C6 index.astro 跨层 fetch | 改 API 改页面 | 低 | 立即 |
| C7 schema 与脚本不匹配 | validate 形同虚设 | 低 | 立即 |
| H1 settings.ts 14 域 | 任意域改动全站 | 中 | Phase 2 |
| H3-H5 topic-search fat module | 阻挡 edge case 修 | 中 | Phase 2 |
| H6 llm.py 不可测 | 重构 6 step 都风险 | 中 | Phase 3 |
| H11 60+ 核心模块无测 | 任何重构都裸奔 | 高 | 持续 |
| H17 Python/TS LLM 接口不对齐 | 同一逻辑写两套 | 中 | Phase 4 |
