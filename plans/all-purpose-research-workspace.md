# 全能性科研工作网站 · 实验方案

> 立项日期: 2026-09-02
> 目标: 把 Daily Paper Reader 从「论文发现 + 精读」升级为覆盖「**发现 → 精读 → 组织 → 写作 → 复盘**」五段的端到端研究工作站。
> 0 后端原则不变 — 全部功能落在浏览器 (`localStorage` / `IndexedDB` / `dpr_user_*` Gist)。

---

## 0. 立项基础

### 0.1 已具备的能力（不再造轮）

| 能力 | 来源 | 复用方式 |
|---|---|---|
| 多源论文发现 | `daily-paper-reader.yml` + `docs/papers/` SSR | 不动 |
| 单篇精读 | `/papers/[arxiv]/` + paper-chat + paper-fulltext | 不动 |
| 库（公共 7 个） | `lib/libraries.ts` + `/libraries/` | 不动 |
| 个人图书馆 | `lib/user-library/` (v2) — star / status / note / trash + Gist 同步 | **作为 Project 的成员关系来源** |
| 用户文献库 | `lib/user-libraries/` (v4) — name / statement / paperIds[] / rubric / definition / conceptOverrides | **作为 Project 的元数据容器（扩展）** |
| 主题图谱 | `lib/concept_graph.ts` + `/concepts/` `/wiki/concepts/[slug]/` | 写作侧引用 |
| Citation graph | `/graph/[arxivId]/` + `lib/paper-relations/` (jaccard/tfidf/embedding/hybrid) | **驱动 Cross-paper compare + Re-read recommend** |
| Method debate | `src/method_debate.py` + `method-debate.css` + per-paper frontmatter | **直接喂 Compare 视图** |
| 引用导出 | `scripts/export/{bibtex,ris,csl-json}.ts` + Obsidian ZIP | **写作导出重用** |

### 0.2 已经做完的侦察（2026-09-02）

- 用户图书馆 status enum = `'unread' | 'reading' | 'read'`；`updatedAt` 被所有写覆盖，**没有 per-field `addedAt`/`statusChangedAt`** → 仪表板"天数"语义需要重新设计（见 §6.4）。
- paper-relations API = `computeRelations(list, opts)`，**没有 list-similarity helper** → 加 `findRelatedForList(ids, opts)`（见 §6.4）。
- `DPR_USER_LIBRARIES_CHANGE` 事件已有（`lib/events/names.ts:80`），命名沿用 `dpr:*-change`，新事件按 `bus.ts:201-218` 的 3 文件 ritual（names/types/bus）。
- NavBar 当前 9 个站内 entry + 1 个外链（`Navbar.astro:26-36`），`overflow-x: auto` 已开，但**不再加 entry**，4 个新功能全部走 subroute（见 §4.4）。
- `UserLibrary` 不是「贴近 Project 的另一套」——**它本身就是 Project 的最贴底盘**（recon 5 条全部命中 `commit-funnel` 模式 + Gist 单文件 `dpr-library.json` 复用），见 §3 重写。
- Method-debate 渲染模板在 `pages/papers/[arxiv].astro:283-343`（🆚 `<details>`）；compare 视图照搬样式骨架。
- Tab UX 模板在 `pages/paper-analyzer.astro:23-30`（ARIA `role="tablist"`），projects / compare / draft 都引用。
- `.dpr-surface` / `.dpr-section-header` 工具类已在 `global.css:293` / `:347`，新面板直接复用，**不抽新 Card 组件**。

---

## 1. 4 个功能概述

> 4 个功能互相正交、但都依赖同一个 **Project 实体** 作为容器。

| # | 功能 | 主入口 | 复用底盘 |
|---|---|---|---|
| ① | **项目工作区 (Projects)** | `/projects/` `/projects/[id]/` | `lib/user-libraries/` + 新增 `Project = UserLibrary + stages[] + drafts[]` |
| ② | **写作工作区 (Markdown + 自动引文)** | `/projects/[id]/writing/` `/writing/[draftId]/` | `paper-notes-editor.ts` + `[cite:arxivId]` resolver + `scripts/export/` |
| ③ | **跨论文对比视图 (A vs B)** | `/papers/compare/?ids=...` | `lib/paper-relations/` + `method_debate` frontmatter + `PaperListItem` |
| ④ | **阅读仪表板 + 重读推荐** | `/dashboard/`（首页上半部分嵌入卡片） | `lib/user-library/snapshot.ts` + 新加 `findRelatedForList()` + 派生 stage-change 日志（IDB） |

> **隐含的「Project」实体** = 现有 `UserLibrary`（user-libraries/plural schema v4）的扩展——
> 它已经有名 / statement / paperIds / definition / conceptOverrides，
> 加 `stages[]`（分组）、`drafts[]`（写作）、`activity: IndexedDB`（事件审计）即可当作 Project 用，
> **不再新建实体**，不破坏现有 Gist 同步。

---

## 2. 共用架构

### 2.1 数据层

```
lib/
├── user-libraries/{store,types,activity-log,gist,index}.ts  (复用, 增量扩展)
│   ↳ types.ts 在 UserLibrary 上加:
│       stages: { id, name, paperIds[] }[]     // 空 = 不分组(legacy)
│       drafts: { id, markdown, savedAt }[]    // 多草稿
│       activity: 'idb' (见下)
│
├── projects/{activity, compare, draft-store, recommend}.ts   (新)
│   ↳ activity      IDB wrapper for stage-change / status-change audit log
│   ↳ compare       compare-set 短期 store (sessionStorage, 8 papers 软上限)
│   ↳ draft-store   markdown draft 持久化 + autosave + 版本戳
│   ↳ recommend     findRelatedForList() wrapper + 重新读取 /paper-relations.json
│
├── events/names.ts
│   ↳ 新增:
│       DPR_PROJECT_STAGE_CHANGE   ('dpr:project-stage-change')
│       DPR_DRAFT_AUTOSAVE         ('dpr:draft-autosave')  // 不发, 只读+节流
│       DPR_COMPARE_SET_CHANGE     ('dpr:compare-set-change')
│       DPR_READING_DASHBOARD_DIRTY ('dpr:reading-dashboard-dirty')
```

#### 2.1.1 IDB activity log（解决 §0.2 中"updatedAt 被覆盖"问题）

```ts
// lib/projects/activity.ts (新)
interface ActivityRow {
  id: string;         // cuid
  projectId: string;
  arxivId: string;    // canonical
  kind: 'added-to-stage'
      | 'removed-from-stage'
      | 'status-changed'  // requires explicit setStatus projects-side
      | 'note-added'
      | 'starred'
      | 'completed';
  prevValue?: string;
  value?: string;
  at: number;         // epoch ms
}
// schema: dpr_project_activity_v1, { projectId, at } 复合索引
// cap: 5000 行/项目, FIFO 截断
```

理由: `lib/user-library/types.ts` 只有 `updatedAt` 单时间戳且被 star / status / note 共写。本仓库选择**不破坏 lib v2 schema**（否则要 bump 4 个文件 + Gist migration），改为在 IDB 起**独立 audit 表**。Dashboard 跨 user-library / project / status 三类事件聚合。

#### 2.1.2 Draft store

```ts
// lib/projects/draft-store.ts (新)
interface Draft {
  id: string;         // cuid
  projectId: string;
  title: string;
  markdown: string;   // [cite:2607.01234v1] 写在文里, 渲染器解析
  cursorOffset?: number;  // 上次编辑位置 (可选)
  savedAt: number;
  wordCount: number;
}
// 全部存 IndexedDB (dpr_drafts_v1), 不进 localStorage (大文本爆配额)
// 5s autosave debounce, 关闭页面前强制一次 flush
```

#### 2.1.3 Compare-set store

```ts
// lib/projects/compare.ts (新)
interface CompareSet {
  ids: string[];      // canonical arxivId[], 2-4 个
  createdAt: number;
}
// sessionStorage (不持久化), 8 个上限软警告(后续走 URL ?ids=a,b,c)
// 与 /papers/?ids= 同源 — 选论文 → "加入对比" 按钮 → 写这里
```

### 2.2 引文解析（写作侧核心）

```ts
// lib/projects/citation.ts (新)
const CITE_PATTERN = /\[cite:([\w.-]+)(?:\|([^\]]+))?\]/g;
//   [cite:2607.01234]                  → arxiv 链接卡片
//   [cite:2607.01234\|section 3.2]     → 同上,带锚点 / 自定义 caption
// 渲染: lib/markdown/render.ts 新增 'writing' mode,
//   命中后查 PaperRepository.getByCanonical(id) 拿到 title/authors/year,
//   生成 <a class="dpr-cite" data-arxiv="..."> 卡片; export 时转 [N] 数字.
```

### 2.3 写作导出

复用既有 `scripts/export/{bibtex,csl-json}.ts`, 新加 `scripts/export/literature-review.ts`:
- 输入: draft.markdown + project.paperIds + 引文表
- 输出: `<slug>.md`(正文引文已替换为编号) + `<slug>.bib`(从 IDB 拉每个 paper frontmatter)

### 2.4 路由与 NavBar

新增 4 条路由, **不进 NavBar 顶层**(避免横向滚动区继续变窄):

| 路由 | 进入方式 |
|---|---|
| `/projects/` | 首页今日推荐卡片下"我的项目" + NavBar 「文献库」mega-menu |
| `/projects/[id]/` | 上述入口 + `/library/` 个人库卡片"打开项目" |
| `/projects/[id]/writing/` | 项目页「📝 写作」tab |
| `/projects/[id]/writing/[draftId]/` | draft 内部链接 |
| `/papers/compare/` | `/papers/[arxiv]/` 详情页"加入对比" 按钮 → sessionStorage → 链接 |
| `/dashboard/` | 首页 `<section class="dashboard-strip">` 在 DailyCalendar 上方; NavBar 不挂,设置页"打开仪表板"按钮可直达 |
| `/writing/[draftId]/` | (可选, deep link, 让用户可在 Gist 同步草稿时落到具体 draft) |

NavBar 不再改 entry 顺序, 但把"文献库" "全部论文" 改为 mega-menu dropdown 收纳子页(避免再加一个入口)。

---

## 3. 项目工作区 (①)

### 3.1 实体（基于 `UserLibrary` v4 增量扩展）

```ts
// lib/user-libraries/types.ts 增量
interface UserLibrary {
  // ... v4 已有字段 ...
  stages: ProjectStage[];          // 新增, 兼容兜底 []
  archivedAt?: number;             // 新增(同 definition.cadence='archived', 二选一)
  draftRefs: DraftRef[];           // 新增, 软引用(draft 本体在 IDB)
}

interface ProjectStage {
  id: string;          // cuid
  name: string;        // 1-32 字
  paperIds: string[];  // canonicalArxivId[], 加入顺序
  status: 'active' | 'done';
  createdAt: number;
}

interface DraftRef {
  id: string;          // 同 IDB dpr_drafts_v1.id
  title: string;       // 镜像以方便 list
  savedAt: number;
  wordCount: number;
}
```

- `lib/user-libraries/store.ts` schema 升 v5: 加载时如缺 `stages/draftRefs` 字段, 兜底 `[]`;
- `lib/user-libraries/activity-log.ts` (已存在) 复用: project-stage / draft 事件也走 `appendLibraryActivity`;
- 写入漏斗: `addStage / movePaperBetweenStages / archiveStage` 经过 `commit()`, 发 `DPR_PROJECT_STAGE_CHANGE`。

### 3.2 UI

#### `/projects/` 列表 (astro-src/pages/projects/index.astro)

```
┌─ 我的项目 ───────────────────────────────────┐
│ [+ 新建项目]                       [🔃排序▾] │
├──────────────────────────────────────────────┤
│ 📂 Project: Multi-Agent Debating  [活跃][emerald] │
│    "LLM-as-Judge 失败模式综合, 4 篇"         │
│    阶段 1 Arg Mediation (4)  ← 进度 ████░ 60% │
│    阶段 2 Voting (1)                          │
│    📝 草稿 2 · 🧩 高亮 12                     │
├──────────────────────────────────────────────┤
│ 📂 Project: PR-6 Elo 验证 [活跃][rose]        │
│    ...                                       │
└──────────────────────────────────────────────┘
```

- 顶部 dashboard strip 也复用这里 (`/dashboard/` 直接 redirect → `?view=list`)；
- 卡片可点击展开 → 阶段树视图 (PanelComponent: `ProjectCard.astro`);
- 每个卡片"打开" 跳 `/projects/[id]/`。

#### `/projects/[id]/` 详情

3 个 Tab(由现有 `PaperWorkbenchTabs.astro` 复用 Tab 组件):
- `📑 论文` ── `paperIds` + `stages` 树(图谱视图用 paper-relations)
- `📝 写作` ── 草稿列表, "+ 新建草稿" 按钮
- `🧩 高亮 / 笔记` ── `lib/user-library/highlights.ts` 已支持 per-paper, 此 tab 按本项目的 paperIds 过滤聚合

### 3.3 与个人图书馆 (`lib/user-library`) 的关系

- Project 是"主题级"的容器(论文集合), 个人图书馆 star / status 是"论文级"的状态。
- 同一篇论文可同时: `starred=true` (个人) + 在 3 个 Project 中(主题)。
- 在 `/projects/[id]/` 的论文列表, 每行显示**个人图书馆态**(星 / status), 让用户一眼看出"这 4 篇里我读了 1 篇"。

### 3.4 风险

| 风险 | 应对 |
|---|---|
| 升 schema v5 破现有 Gist 同步 | store 加载时只 forward-upgrade(v4 → v5), Gist 写回仍 v5; legacy v4 客户端拉 v5 doc 直接忽略增量字段即可(已在 v4 设计里预留) |
| stage 之间挪论文触发 `DPR_USER_LIBRARY_CHANGE`? | 不会 — `commit()` 只发 libraries 事件, 不发 user-library 事件; 个人态不动 |
| stage 命名重复 | stage 命名 ID 化 `cuid`, 名可重 |

---

## 4. 写作工作区 (②)

### 4.1 编辑器

- 复用 `astro-src/scripts/paper-notes-editor.ts`(已有 markdown editor + wikilink autocomplete), 升级支持:
  - `[cite:arxivId]` autocomplete — 键入 `[cite:` 触发 gitHub-style 弹出, 候选源 = `paper-search-corpus.json` (build-time 已有)。
  - 实时光标侧栏(preview pane), 右侧窄栏显示光标所在段的相关 paper card。
  - 5s debounce autosave → IDB `dpr_drafts_v1`; 离开页面 → `visibilitychange` flush。
  - 已读检查: draft 引用的 paper 必须在 `project.paperIds ∪ personal starred`, 否则 inline 黄底警告(不阻断)。

### 4.2 Markdown 渲染('writing' 模式)

`lib/markdown/render.ts` 新增 `renderWritingMode(md)`:
- KaTeX / 表格 / GFM 全开(同 chat 模式), 
- `[cite:xxx]` → inline `<a class="dpr-cite" data-arxiv="...">` 卡片; 点击展开 tooltip(title + 一句话 tldr); 
- 编号 `[N]` 由 export 时填, 编辑期用 `data-cite-idx` 暂隐。

### 4.3 导出

`/projects/[id]/writing/[draftId]/` 顶部按钮:
- `📥 导出 Literature Review (.md + .bib)` — 调 `scripts/export/literature-review.ts`:
  - 替换所有 `[cite:xxx]` 为 `[N]`, 在文末加 `## References` + 编号表。
  - `.bib` 内容: 从 `lib/paper-frontmatter/parse.ts` 拿 frontmatter, 用既有 `bibtex.ts` 序列化。
  - 文件名: `{project-slug}-{draft-slug}.md` / `.bib`, 走 `scripts/export/trigger-download.ts` (已存在)。
- `📥 导出 ZIP (含 .md + .bib + 全 paper frontmatter)` — 复用 `scripts/export/obsidian.ts` 风格, 0 npm 依赖, 手写 ZIP。

### 4.4 UI 入口

不挂 NavBar。`/projects/[id]/` "📝 写作" tab 是主入口,详情页"新建草稿"按钮 → `/projects/[id]/writing/new/` → 自动 cuid → `/projects/[id]/writing/[draftId]/`。

### 4.5 风险

| 风险 | 应对 |
|---|---|
| editor 库未引入 (现状是 textarea) | 不引 — 维持现状 + 自建 autocomplete popup(已有 paper-notes-editor.ts 实现) |
| 大草稿 (>500KB) IDB 写入超时 | 切到分块(每 200KB 一个 chunk, 列表合并), 实测 IDB 单条 30MB 上限够用 |
| `[cite:xxx]` 拼错 / 论文撤回 | 渲染时查 `PaperRepository.getByCanonical(id)`, 失败显示灰底 `?`, 不抛错 |

---

## 5. 跨论文对比视图 (③)

### 5.1 入口与数据

- `/papers/[arxiv]/` 右上"加入对比"按钮(已有星标按钮旁), 写 `lib/projects/compare.ts` 的 sessionStorage;
- 顶部栏按钮 "⚖️ 对比 (3)" 跳 `/papers/compare/?ids=a,b,c`;
- 不存在 sessionStorage 状态时, 也允许 URL `?ids=` 直入。

### 5.2 视图

`astro-src/pages/papers/compare.astro` SSR + `src/components/PaperCompareTable.astro`:

```
┌──── 2 篇 ────────────────────────────────────┐
│ 论文 A (2607.01234)        论文 B (2607.02345)│
├─ 标题 ──────────────── Peer Debate ──── Agentic Opt │
├─ 任务 (frontmatter) ── RL ──────────── Robustness │
├─ 方法 ──────────────── Elo debate ──── RA-Search │
├─ 数据集 ────────────── 4 ────────────── 6       │
├─ 评估指标 ──────────── avg + AUC ──── AUC + bias │
├─ method_debate pros ─ ┌─[A]训练简单 / [A]校准简单│
│                       ├─[B]样本鲁棒 / [B]LLM-judge│
├─ method_debate cons ─┌─[A]误差需自校准            │
│                       ├─[B]仅适用 pairwise        │
├─ 共同引用 ──────────── graph/edges (paper-relations)│
├─ 概念 / 标签 ────────── ...                   │
└──────────────────────────────────────────────┘
```

实现要点:
- 每行是独立的"维度":
  - `task / method / venue / date / datasets / metrics` → 直接读 `PaperListItem.frontmatter.categories` + `PaperListItem.frontmatter.metrics`
  - `method_debate pros / cons` → 读 per-paper frontmatter `method_pros_cons` (step5 LLM 写入, schema v4)
  - `共同引用` / `共指` → 调 `lib/paper-relations/computeRelations(list, { algorithm: 'hybrid', topK: 4 })` 实时算; 离线缓存 `/paper-relations.json` 已存在(precomputed)
  - `概念 / 标签` → PaperListItem.concepts + categories
- 行可拖换 / 折叠 / 隐藏(本地 state, 不持久化)。

### 5.3 与现有 `/graph/[arxivId]/` 的差异

| | `/graph/` | `/papers/compare/` |
|---|---|---|
| 视角 | 全图 (cytoscape) | 表格 1:1 |
| 输入 | 1 个 arxivId | 2-4 个 arxivId |
| 输出 | 图谱 (force-directed) | 行 × 列对齐 |

graph 改作入口 highlight: 行末加 `[🔗 在 graph 看]` 跳 `/graph/?focus=a,b,c`。

### 5.4 风险

| 风险 | 应对 |
|---|---|
| paper A 没 method_debate (LLM 跳过的) | UI 显示空行 + "🔄 在线生成" 按钮, 调 LLM router 加进 cache (限频 1 次/24h/paper) |
| 4+ 论文表过宽 | 横向滚动; >4 拒绝 |

---

## 6. 阅读仪表板 + 重读推荐 (④)

### 6.1 入口

- 首页 `/` 顶部 dashboard strip(今日推荐之上,1 行)
- `/dashboard/` 完整页(列表 + filter)
- 个人图书馆 `/library/` 顶部 banner

### 6.2 Dashboard 数据派生

```ts
// lib/projects/recommend.ts (新)
export interface DashboardSummary {
  byStatus: { unread: number; reading: number; read: number };
  staleReads: Array<{ arxivId: string; lastTouchDays: number }>;  // > 30 天
  newRelated: Array<{
    arxivId: string;
    relatedSinceDays: number;
    relatedToIds: string[];
    source: 'paper-relations' | 'embedding-cache';
  }>;
  weeklyAdds: number;
  totalProjects: number;
  totalDrafts: number;
  totalWords: number;
}
```

派生规则:
1. `byStatus` ── 调 `buildUserLibrarySnapshot()` → 聚合 `status Map`;
2. `staleReads` ── 读 IDB `dpr_project_activity_v1` 找最近一次 `status-changed:read`, 与 `Date.now()` 相减; **首版没有就 fallback 到 user-library store `updatedAt` 当上限**(更宽松, 真有 audit log 后变精确);
3. `newRelated` ── 调新加 `findRelatedForList(ids, opts)`, 与 `Date.now() - 30d` 内的 library 论文对比, 输出`新增但 cosine ≥ 0.65` 的候选;**首页只要前 5 条**;
4. 其他直接调 store 计.

### 6.3 新 helper — `findRelatedForList`

```ts
// lib/paper-relations/list-related.ts (新)
export async function findRelatedForList(
  canonicalIds: string[],
  opts: {
    papers: PaperListItem[];
    algorithm?: 'hybrid' | 'embedding';
    topK?: number;
    sinceDate?: string;  // ISO
    minWeight?: number;
  },
): Promise<Array<{ arxivId: string; weight: number; relatedTo: string[] }>>;
```

实现: 跑 `computeRelations(opts.papers, { algorithm: opts.algorithm ?? 'hybrid', topK: opts.topK ?? 12 })`, 然后:
- 对每个 query id 收集 top-K 邻居(带方向);
- union-by-id, score = Σ weight, `relatedTo[]` = 命中的 query id 列表;
- 排除 query 本身;
- 默认按 `opts.sinceDate` (若提供) 过滤出版日期, 让"新增"维度显式可控。

### 6.4 IDB activity log → 仪表板时序精确度

如 §2.1.1, IDB `dpr_project_activity_v1` 记录所有"我做了什么"。
具体用法: 项目页里, 每当用户 *显式* 改 status(star / read), 我们同步 append activity:
```ts
// 改装 store.ts setReadingStatus / toggleStar (user-library, 单数),
// 不改 schema, 但同时 append 到 dpr_project_activity_v1 (新模块)
// 行 kind: 'status-changed' | 'starred' | 'completed'
// 注意:不影响 setReadingStatus 的签名 (向后兼容) — 只在 commit() 里多调一行 activity.append()
```

补 commit() 多一行副作用: `appendUserActivity(id, 'status-changed', { from, to })`。

### 6.5 UI

`/dashboard/` 页面:
- 顶部 KPI 条: 待读 / 在读 / 已读 / 项目数 / 草稿字数
- 第二段 "🔴 已 30+ 天没看" 卡片列表, 每行: 论文标题 + 上次摸的日期 + 重读按钮
- 第三段 "🆕 这 7 天相关新论文" 卡片, 每行: 新论文标题 + 链接到"cosine N 跟你的某老论文"
- 第四段 "⚡ 进度停滞的草稿" (>14 天未动的 draft)
- 全部空状态友好(`所有论文 7 天内都过了一眼!`)

### 6.6 风险

| 风险 | 应对 |
|---|---|
| paper-relations.json 大(cold read 慢) | 已有 `lib/paper-relations/embedding-cache.ts` 兜 IDB / 内存 |
| 推荐质量差 | 阈值 0.65 + 限频 + 用户可"× 不感兴趣"按钮调阈值(query feedback) |
| 私有 Gist 没这个表 | dashboard 是 local-only, 不同步 Gist(它属于"个人态", 跨设备 sync 成本高 价值低) |

---

## 7. 实施顺序

> 4 个功能按依赖关系串行,在各自内部并行。

### Phase A: 共用基础设施 (~0.5 day)  ← 现在启动

1. `lib/projects/` 新增 4 个文件(`activity.ts`, `compare.ts`, `draft-store.ts`, `recommend.ts`)
2. `lib/events/names.ts` 加 4 个事件常量 + type 别名（按 `bus.ts:201-218` ritual）
3. `lib/paper-relations/list-related.ts` 新加 helper
4. `lib/user-libraries/{types,store}.ts` 升 v5, 加 `stages[] / draftRefs[]`（forward-upgrade）

### Phase B: Project workspace (①) (~1 day)

5. `/projects/index.astro` + `ProjectCard.astro` + `/projects/[id]/` 框架
6. `astro-src/scripts/projects.ts` (orchestrator) + 子模块 `stages / drafts / activity-render`
7. 把"📝 写作" + "🧩 高亮" tab 用 `PaperWorkbenchTabs` 复用

### Phase C: 写作工作区 (②) (~1.5 day)

8. `lib/projects/citation.ts` (cite resolver) + `lib/markdown/render.ts` 加 'writing' 模式
9. `astro-src/scripts/projects-draft-editor.ts` (upgrade notes-editor + cite autocomplete)
10. `astro-src/pages/projects/[id]/writing/[draftId].astro`
11. `scripts/export/literature-review.ts` (新) + trigger-download 适配

### Phase D: 阅读仪表板 (④) (~1 day)

12. IDB activity-log wiring (`appendUserActivity` 接入 user-library `commit()` at `store.ts:150`)
13. `lib/projects/recommend.ts` dashboard summary 实现
14. `astro-src/pages/dashboard.astro` + KPI 卡片组件

### Phase E: 跨论文对比 (③) (~0.5 day)

15. `lib/projects/compare.ts` sessionStorage 实现（key = `dpr_compare_set_v1`）
16. `astro-src/pages/papers/compare.astro` + `PaperCompareTable.astro`（react-style 渲染模板复用 `pages/papers/[arxiv].astro:283-343`）
17. `/papers/[arxiv].astro` 加"➕ 加入对比"按钮
18. `/papers/` 列表批量对比入口

### Phase F: 集成 + 验收 (~0.5 day)

19. `astro-src/components/NavBar.astro:26-36` 「文献库」mega-menu 收纳"我的项目"，新功能**不挂顶层**
20. 首页 `pages/index.astro` dashboard strip 嵌入（用 `.dpr-section-header` 工具类）
21. 单元测试: `tests/projects/*` + `tests/paper-relations/list-related.test.ts` + `tests/exports/literature-review.test.ts`
22. `bun run check` + `bun run build` 通过

> 总计 **~5.5 day** 工作量。配合 ultracode 并行 sub-agent, 估计单会话 1-2 小时内出 PR。

---

## 8. 风险总览

| 类别 | 风险 | 缓解 |
|---|---|---|
| 数据 | schema 升 v5 破现有 Gist | forward-upgrade, 老 doc 自动字段补齐 |
| 数据 | IDB 大单条写超时 | chunk + 测试 30MB 上限 |
| 性能 | paper-relations 全量跑(800+ 篇) cold start 慢 | 已有 embedding-cache 兜底; 新 helper 复用 |
| 路由 | NavBar 9 entry 已到临界 | 不再加 entry, 走 mega-menu / subroute |
| 渲染 | markdown render 'writing' mode 性能 | 已存在 render orchestrator 模式, 测试 100KB draft 渲染 < 100ms |
| LLM | 方法 debate 缺失的论文对比行空 | 触发 fallback "在线生成", 限频 1 次/24h/paper |
| 测试 | happy-dom 对 IDB 支持弱 | 加 fake-idb 或 happy-dom polyfill |

---

## 9. 验收标准

每条 feature 都要过下面 4 维:

1. **单元** — `bun test tests/projects` 全绿, 新 helper ≥ 80% 覆盖
2. **类型** — `bun run check` (astro check) 零新增 error
3. **构建** — `bun run build` 通过, 体积增量 < 200KB (gzipped client JS)
4. **手工冒烟** — 下列 4 个流程:
   - 新建项目 → 添加论文 → 挪阶段 → 加草稿 → 引文导出
   - dashboard strip: stale + new related 各显示 ≥ 1 条(在 seed 数据上)
   - 选 3 篇有 method_debate 的论文 → compare 页看到 pros/cons 行
   - 改某篇 status → IDB activity log 新增一行, dashboard `lastTouchDays` 重算

---

## 10. 后续 (`/writing/[draftId]/` deep link / 多设备 Gist sync 草稿)

- **后续 1**: `lib/projects/draft-store.ts` 接 Gist, 让 draft 跨设备; UI 加 "🔄 同步" 按钮, 沿用 user-libraries gist.ts 模式
- **后续 2**: stage → meeting 排程 (类似 journal club slot) — 暂搁
- **后续 3**: 写作侧 AI assist (autocomplete 一句话) — 暂搁

---

## 11. commit / PR 计划

按 Phase A → F 顺序, 每 Phase 1 个 commit (参考 [[feedback_auto_commit_no_auto_push]]):

- `feat(projects): introduce Project workspace entity & IDB activity log`
- `feat(draft): markdown writing workspace with [cite:arxivId]`
- `feat(dashboard): reading dashboard with stale + new-related recommendations`
- `feat(compare): cross-paper side-by-side compare view`
- `feat(navbar): mega-menu for libraries/projects`
- `docs(readme): update site map + site workflow section`

加 1 个 `chore(pr): write CHANGELOG entry` 收尾。

---

## 附 A. 不动的事 (out of scope)

- **不**做新后端 / SSR endpoint — 维持 0 服务器
- **不**引入 editor 库 (CodeMirror / Monaco) — 0 npm deps 是本仓库传统
- **不**做实验执行 / notebook runtime — Polaris 已选择性跳过
- **不**做多人协作 / 共享草稿 — Gist sync 够了
