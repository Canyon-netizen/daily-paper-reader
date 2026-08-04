# TODO: 之后继续应该完成的工作

> 2026-08-04 维护
> 当下状态:`main` @ `413b163`,493/493 论文带 5 节中文解读,build 绿(1489 页)。
> 这份文档列出本会话发现/遗留的下一步工作,按优先级和分类组织。

---

## 🔴 高优先级(影响日常使用)

### 1. daily pipeline 增量论文自动 translate

**问题**:GitHub Actions 的 daily paper pipeline(`[chore] daily paper pipeline`)每天会在 `docs/papers/2026/MM/DD/` 新增一批论文 + assets,但**不会自动跑 LLM 翻译**。目前流程是:

1. Pipeline 跑 → 30+ 新论文 commit 到 main
2. 用户 deploy 后发现右侧详情面板空白(没 wiki)
3. 我手工跑 `python -m src.translate_parallel data/_chunk_X.json` 补
4. 再手工 commit

**建议做法**:在 `.github/scripts/daily_pipeline.py`(或同位置的 yaml workflow)末尾加一个 hook,自动调 `src/translate_parallel.py` 对新论文打分 + 翻译 + 写 wiki + git commit。

具体步骤:
```python
# 1. diff: list papers added in this pipeline run (commit range)
# 2. write a chunk file with their names
# 3. call src/translate_parallel.py via subprocess
# 4. git add docs/papers/ && git commit
```

注意:LLM 速率限制(429)在并发 ≥ 8 时会触发,生产环境建议 concurrency=2 + 指数退避(已在 `call_librarian` 里有)。

### 2. `translate_parallel` 去重 bug

**问题**:`Path('docs/papers').rglob('2607.25308*.md')` 对同一篇论文返回 5 个路径(因为 daily pipeline 在不同日期目录复制了 5 次:07/29、07/30、07/31、08/02、08/03)。我的脚本只处理第一个匹配,导致**最新版 08/03/ 未翻译**,而旧版 07/29/ 已翻译。

**修法**:`src/translate_parallel.py` 接收 `data/_chunk_X.json` 时,**按 canonical arxiv id(去版本号)去重**,只翻译每个 id 的最新一份(日期最新者)。

```python
# 伪代码
seen = set()
for raw in DOCS_PAPERS.rglob('*.md'):
    cid = canonical_arxiv_id(raw.stem)  # 去掉 vN
    if cid in seen: continue
    seen.add(cid)
    # ... process latest mtime
```

### 3. `score` 字段格式不一致

**问题**:存量 `score: 8.0 / 9.0`(老格式)与 `score: 0.7 / 0.8`(新 0-1 格式)共存。我之前的 filter `score < 1.0` 漏了 8.0/9.0 格式,导致 8 篇论文没进翻译。

**修法**:`src/translate_polaris.py` 的 skip 条件 / `src/paper-filter.ts` 的 score 阈值需要**两套兼容**:
- `score >= 1.0` 且 `< 10` → 视为 legacy 8.0 格式,当作 1.0 处理(高分)
- `score < 1.0` → 0-1 格式
- 或者:`score > 1.0` 全部 normalize 到 `score / 10`

---

## 🟡 中优先级(影响工作流完整性)

### 4. `extractWikiArticle` 兼容性

**问题**:`src/translate_polaris.py` 现在 skip 已翻译的论文(看 body 是否有 `## 讨论与可借鉴点` 或 `## 结论`)。但**老 `translate_polaris.py` 旧版**(commit 3d1a64e 之前)用过的标题名是 `## TLDR`(无冒号) / `## 动机 / 方法 / 结果 / 结论`(4 节不是 5 节)。`## 结论` 这个 fallback 已经覆盖了 4 节版,但 `## TLDR` 没覆盖。

**修法**:补上旧版标题名作为 fallback:
```python
if not args.force and ("## 讨论与可借鉴点" in body
                      or "## 结论" in body
                      or "## TLDR" in body
                      or "## 动机" in body):
    skipped_body += 1
    continue
```

### 5. `topics` 的 121/221 概念 md YAML ScannerError

**问题**:之前 plan 里指出:121/221 个 `wiki/concepts/*.md` 的 frontmatter `display_name` 含未引号化的 `:`(例如 `Activation Steering: A Method`),`yaml.safe_load` 抛 `ScannerError`,导致 CI 构建时概念层为空,`/concepts/` 路由报错。

**修法**:
- `src/concept_index.py` 的写出函数 `_render_concept_md` 改用 `yaml.safe_dump` 序列化,而不是手写 `name: value` 拼接。
- `src/concept_index.py` 加 `_validate_concept_labels` 预检:所有 display_name 必须 quote or escape `:`。
- 加 `tests/test_concept_index_regression.py` 钉住这个回归。

### 6. `Paper.wikiContent` 流水线尾部

**问题**:`PaperListItem.wikiContent` 字段已经接入工作台详情面板(`pages/libraries/[id].astro` + `scripts/user-libraries-ui.ts`),但 **build 之后** 工作台才会显示 5 节中文。如果某篇论文**没在 build 时被 SSR 抓过**(比如新加的 + 还没 build 过),客户端可能拿不到。**建议**:build 之前跑一次 `bun run build:prewarm` 预热 paper-disk cache,或者在客户端的 `renderUserLibraryDetail` 加一个 fallback: 若 `wikiContent` undefined,走 `/papers/{id}/#paper-compile-section` 拉实时编译。

---

## 🟢 低优先级(渐进增强)

### 7. Polaris 能力对照表(还未 ship 的)

| 能力 | DPR 状态 | 实现难度 |
|---|---|---|
| 公共库 chat tab 个人库已工作台,公共库**还没接通** | 中 |  |
| Digest 自动 cron(每日定时生成) | LLM 已在,缺调度 | 中 |
| 库 budget(token 配额)Polaris 强制,本仓库**无限制** | 静态站不需要 |  |
| 公共库 anchor 强制 included(Polaris 行为) | 已 ship(Govern tab 配 anchor) |  |
| Per-paper relevance 详细 reason(已 ship) | |  |
| Library visibility **admin approval**(Polaris 状态机) | 单人站无 admin |  |
| `getStaticPaths` 论文详情页的 vN 版本去重 | **已 ship**(`canonicalArxivId`) |  |
| Polariscitation 的 `figures_json` / `formulas_json` 跨 paper 共享 | 各自存,浪费空间 | 高 |
| LLM `prompt-pack.ts` 的 `library.compile` 包 |  |  |

### 8. ConceptRelink 跨库合并

**问题**:Polaris 的 `POST /libraries/{id}/concepts/relink` 支持把概念合并到另一 slug(`canonicalSlug`)。DPR 已有 `LibraryConceptOverride.canonicalSlug` 字段(`9746e78` commit),但**没接 UI**。

**修法**:在概念卡 ConceptsTab 加一个「🔗 合并到」按钮,弹层让用户选目标 slug(从全站概念列表),调 `setLibraryConceptOverride(libId, slug, { canonicalSlug: targetSlug })`。

### 9. 论文 metadata 字段完善

**现状**:`Paper` 已有 wikiContent / concepts / figures / tables,但 **Ingest tab 拉新论文** 的时候只填了 score 字段(用旧 `score: 8.0` 格式),缺:
- `tldr` 字段(从 abstract 自动生成 1-2 句)
- `evidence` 字段(从 abstract 抽核心方法 1 句)
- `tags`(用 arxiv categories + LLM 分类)

**修法**:`scripts/library-ingest.ts` 拉论文后,加一个 LLM step 生成 tldr/evidence/tags。

### 10. Pre-built search index 兼容老 SCORE 格式

**问题**:`lib/paper-filter.ts` 的 `filterByScore` 假设 score ∈ [0, 1]。但 **legacy `score: 8.0` 格式**会全过(8.0 ≥ 默认 0.6)。

**修法**:在 `lib/paper.ts` 的 `readPaper` / `readPaperListItem` 加一行:
```typescript
if (typeof score === 'number' && score > 1) score = score / 10;
```

把 legacy 8.0 归一为 0.8。`paper-frontmatter/parse.ts` 的 `sanitizeScore` 同步。

---

## 📋 立即可做的清理(无功能影响)

### 11. 删除 dead code

- `data/_chunk_*.json` / `data/_run_chunk_*.py` / `data/_need_wiki_*.json` — 已删。
- `src/translate_parallel.py` 的 `async def call_one(...)` — 死代码,无 caller。可以删。
- `src/translate_polaris.py` 的 `if front.get("wiki_compiled") is True and not front.get("_force_recompile"):` 旧 skip 块 — 已经移到 `translate_one` 内部,**外层 main 循环的 if front.get("wiki_compiled") is True: continue** 已经是 dead code(因为之前那行被移除)。检查并清理。

### 12. 测试覆盖

- `src/translate_polaris.py` 完全没单元测试。
- `src/translate_parallel.py` 也没。
- `src/paper.ts:extractWikiArticle` 刚加的,没测。

**加** `tests/test_translate_skip.py`、`tests/test_extract_wiki.py`。

### 13. `bun run check` 清理

**现状**:`bun run check` 报 57 个 pre-existing type 错误(`ConceptRef` 重复 import 等)。这些都是历史遗留,**不影响 build**。建议:
- 短期:在 `tsconfig.json` 加 `// @ts-expect-error` 注释绕过
- 长期:统一用 `astro-tsconfig/base` 重构

---

## 🔗 重要 commit 列表(本会话)

```
413b163  feat(translate): 合并 origin/main + 给 30 篇新论文补 5 节中文解读(493/493)
06f9ba0  feat(translate): 463/463 论文带 5 节中文解读(100% coverage)
a48834a  merge: daily paper pipeline (28 new papers from b6a2bc3)
7307948  feat(library): 右侧详情面板就地显示 Polaris 5 节中文解读
4471a30  fix(library): 编译按钮就地填充,不再跳到论文页
6794cb0  feat(papers): /papers/ 默认按相关度排序 + 顶部 sort 切换
9a7e23e  fix(library): 论文页 URL 用 basename(避免双 prefix 404)
9746e78  feat(library): concept relink per-library(Polaris concept_relink)
38d18ab  feat(library): 库内论文 LLM 批量重打分(Polaris voyage agent 客户端版)
d496433  feat(library): 个人库 Graph / Chat tab(Polaris 工作台同构)
fcc6141  feat(library): AI 访谈生成 statement(Polaris NewLibraryModal 客户端版)
9754080  feat(library): 虚拟滚动 PapersTab(Polaris 工作台同构)
b706979  feat(library): Digest tab —— LLM 每日简报(Polaris digests/generate 客户端版)
41a89bf  feat(library): Ingest —— arXiv listing + LLM 批量打分
f2716c3  feat(library): per-library paper status (Polaris library_papers) + tldrNote
97a7f97  feat(library): EditLibraryModal + Govern tab(P8a LibraryDefinition UI)
d168cea  feat(library): LibraryDefinition P8a schema
```

## 🎯 验收标准(下次重新跑时)

1. `bun run build` 绿(1489 页, ~20s)
2. `python -c "...coverage check..."` → 493/493 (100%)
3. 右侧详情面板就地显示 5 节中文解读(无需点「编译」)
4. `/papers/` 默认按相关度排序
5. 公共库 `/libraries/<id>/` 和个人库 `/libraries/?id=<u>` 两种路径都 work

---

## 📞 关键文件索引

| 文件 | 作用 |
|---|---|
| `src/translate_polaris.py` | LLM 翻译(单文件, ThreadPoolExecutor) |
| `src/translate_parallel.py` | LLM 翻译(asyncio + run_in_executor, 8 并发) |
| `src/paper-frontmatter/parse.ts` | `extractWikiArticle` 抽 5 节段 |
| `astro-src/lib/paper.ts` | `Paper.wikiContent` / `PaperListItem.wikiContent` 字段 |
| `astro-src/lib/user-libraries/types.ts` | `LibraryDefinition` / `LibraryPaperMeta` / `LibraryConceptOverride` |
| `astro-src/lib/user-libraries/store.ts` | 单一写入漏斗 commit(), schemaVersion=4 |
| `astro-src/scripts/user-libraries-ui.ts` | 渲染个人库详情面板(8 个 tab + 中文解读) |
| `astro-src/pages/libraries/[id].astro` | 公共库工作台(8 个 tab + 中文解读) |
| `astro-src/scripts/library-ingest.ts` | Ingest:arXiv listing + LLM 评分 |
| `astro-src/scripts/library-digest.ts` | Digest:LLM 每日简报 |
| `astro-src/scripts/library-rescore.ts` | 库内 LLM 批量重打分 |
| `astro-src/scripts/library-statement-interview.ts` | AI 访谈 3 步生成 statement |
| `astro-src/scripts/virtual-list.ts` | 通用虚拟滚动 |
| `.env` | `LLM_API_KEY` / `LLM_BASE_URL=https://api.minimaxi.com/v1` / `LLM_MODEL=MiniMax-M2.7-highspeed` |
