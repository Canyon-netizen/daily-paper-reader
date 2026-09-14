# `docs/` 路径规范（唯一权威）

本文档是论文笔记在 `docs/` 下的目录与文件名约定的**唯一权威**。**任何**新增 / 移动 / 重命名文件前都必须先读它。

## 1. 目录命名

所有论文统一进 `docs/papers/`，按 **发表日**（不是 arxiv id YYMM）分桶到三层子目录：

```
docs/papers/<YYYY>/<MM>/<DD>/<arxiv-id>-<slug>.{md,txt}
```

`<YYYY>/<MM>/<DD>` 三段都来自 markdown frontmatter 的 `date: YYYY-MM-DD` 字段。bioRxiv 文件名内嵌 `YYYY-MM-DD` 也可直接提。

> 💡 **YYYY/MM/DD 路径同时驱动两个系统**：
> - URL slug：`/papers/<arxiv-id>-<slug>/`（不暴露中间层级）
> - 首页日历格：DailyCalendar 按 `YYYY/MM` 栅格展示当月论文，同一日多篇论文并入同一格子

> ⚠️ **arXiv id 的 YYMM 前缀不等于发表月**。例如 `2607.00083v1` 文件名 YYMM=2607，但
> 真实 frontmatter `date` 是 `2026-06-30`，应进 `2026/06/30/`，不是 `2026/07/01/`。
> 这是 commit 3166d40 (按 YYMM 分桶) 留下的历史 bug，引入 DD 子目录时一并修正。

| 写法 | 对应 Astro 路由 |
|---|---|
| `docs/papers/<YYYY>/<MM>/<DD>/<arxiv-id>-<slug>.md` | `astro-src/pages/papers/[arxiv].astro` |

**id 段数 = 4**（去掉 `papers/` 后：`YYYY/MM/DD/<basename>`）。`astro-src/lib/paper.ts` 的 `walk()` 递归扫所有子目录，跳过 `_*` 前缀目录与 `tutorial/` / `assets/` / `plans/`。`getStaticPaths` 用 `id.split('/').pop()` 取最后一段（basename）作 URL slug，所以 URL 仍是 `/papers/<basename>/`，不暴露中间层级。

迁移工具：`scripts/migrate-papers-by-day.mjs`（dry-run + `--apply`，会改 MD 与同名 .txt 到同一个目标目录）。DD 来源优先级：`.md` frontmatter `date` > 同 stem `.md` 日期 > arxiv YYMM + day=01 fallback。

## 2. 文件名约定

论文 markdown 文件名 = `<arxiv-id>-<slug>.md`：

- `<arxiv-id>` 必须是 arXiv 短 ID（`YYMM.NNNNN`，可带版本尾巴，如 `v1`、`v2`）。
- `<slug>` 是 ASCII kebab-case 标题摘要，由 `src/6.generate_docs.py:slugify` 生成。
- 同 ID 多版本只保留最高版本（v 越大越新）。**重复检查**由 `astro-src/scripts/build-arxiv-index.mjs` 自动做：按 canonical id（去掉 `vN`）分组，保留最高版本的 path，并为 canonical id 及每个见过的版本 id 建立别名统一指向该 path，因此前端无论用 `v1`/`v2` 还是无版本 id 查询都命中当前笔记。
- **版本落后自动刷新**：`.github/workflows/maintain-version-refresh.yml`（每周一，或手动触发）跑 `src/maintain/refresh_versions.py`，扫描本目录论文、对比 arXiv 最新版本，落后者用 `src/6.generate_docs.py --paper-id` 重生成新版本笔记并删除旧版本 `.md`/`.txt`/图目录，保持“v 越大越新”。

伴随文件：

- `<arxiv-id>-<slug>.txt`：PDF 抽取的正文（ArXiv 摘要 + intro + 部分正文），由 pipeline 留作 cache；站点不消费。
- `figures/arxiv/<id>/fig-*.webp`、`assets/figures/arxiv/<id>/fig-*.webp`：论文图，markdown 中以相对路径 `assets/figures/arxiv/<id>/fig-NNN.webp` 引用。

`docs/README.md` 是站点首页内容（由 `src/6.generate_docs.py:sync_home_readme_from_day_report` 生成）。

## 3. `Paper.yearMonth` / `day` 派生

`Paper.id` 现在等于 `papers/<YYYY>/<MM>/<DD>/<basename>`，**已经包含**完整日期段：

- `yearMonth`：从 `Paper.id.split('/')[1:3]` 取（即 `YYYY/MM`）。
- `day`：从 `Paper.id.split('/')[3]` 取（即 DD 子目录名）；id 是 YYYY/MM 两段格式（legacy 数据）时退化为从 `frontmatter.date.slice(8, 10)` 取。

排序仍由 `frontmatter.date` 主导（与目录布局一致），`yearMonth`/`day` 主要用于展示。

## 4. 不要放在 `docs/` 下

以下文件类型**应当**放在别处：

| 类型 | 正确位置 | 原因 |
|---|---|---|
| 内部方案 / 计划文档 | `plans/`（PR #9 已迁） | 不应混入站点数据路径 |
| `.py` / `.js` / `.mjs` / `.sh` 等实验脚本 | `.scratch/`（gitignored）或 `scripts/` | 站点只消费 MD / 图片 / sidebar |
| 截图 / 教程配图 | `docs/tutorial/` 或 `others/`（详见方案 PR #10） | 与 README 引用相对稳定 |
| `_home_*.md`、`_404.md`、`_sidebar.md`、`config.yaml`、`tutorial/`、`assets/`、`README.md` | 仍在 `docs/` 顶层 | 站点外壳 |
| `papers/` | 仍在 `docs/` 下 | 唯一论文目录，不要移到别处 |

注意：`_` 前缀的目录会被 [astro-src/lib/paper.ts](astro-src/lib/paper.ts) 的 walk **跳过**，不会进入论文扫描路径——所以如果某个内部目录必须暂存在 `docs/` 下，用 `_` 前缀是最安全的临时挂法。

## 4.5 论文 frontmatter 必填与可选字段(2026-09-14 整合)

论文 `.md` 文件 frontmatter 推荐结构(灰色 = 已有,PWD 推荐加):

```yaml
---
title: "..."                # 必填,英文原题
title_zh: "..."              # 可选,中文译题
authors: "..."              # 必填
date: 2026-08-23            # 必填,arxiv 发表日
pdf: https://arxiv.org/pdf/...
score: 8.0                  # 必填,LLM 相关度 0-10
tldr: "..."                 # 必填,中文 100-300 字
evidence: "..."             # 可选,选论文时 1 句话依据
abstract_en: "..."          # 可选,英文 abstract(快读时显示)
tags: ["query:rlhf"]        # 可选,检索 tag(query: 前缀表示来源是检索词)
source: arxiv               # 必填
selection_source: fresh_fetch # 可选

categories:                 # 必填,2026-09-14 批量回填
  venue: [ICLR, NeurIPS]    # 会议名(arxiv preprint 默认空)
  task: [rlhf, agent]       # 任务
  method: [dpo, ppo]         # 方法
  type: [empirical]          # 类型

# === 2026-09-14 新增:跨模块链接(可选,但强烈推荐填) ===
related_ideas: []           # 关联 docs/ideas/<id>.md 路径
related_experiments: []     # 关联 docs/experiments/<id>.md 路径
related_writings: []        # 关联 docs/writing/<id>.md 路径
is_milestone: false         # 是否里程碑论文(高被引 / 范式定义)
                            # true 永久保留;false 半年后可考虑 deprecate
```

### 跨模块链接规则(2026-09-14 起强制)

- **新论文**:`related_*` 字段可空,但 pipeline 应尝试从 tags + categories 推断,推荐 ≥1 条
- **老论文**:启发式扫描 docs/ideas/*.md / docs/experiments/*.md / docs/writing/*.md 的 `supporting_papers:` 字段,反查 paper_id,写入本论文
- **验证**:`scripts/audit-crosslinks.mjs`(下一批写)扫所有论文,确保每篇至少有 1 个外链 OR 显式标注 `is_orphan: true`

### milestone 标记规则

- `is_milestone: true` 用于:Transformer / AlphaGo / DPO / RLHF 原 paper 这类范式奠基
- `is_milestone: false`(默认):普通论文
- 自动化:`scripts/mark-milestones.mjs`(下一批写)按 arxiv citations + venue 影响因子推断

### categories 回填

如某篇论文 categories 为空,跑:

```bash
node astro-src/scripts/paper-backfill-categories.mjs --apply --limit 1  # 单篇测试
node astro-src/scripts/paper-backfill-categories.mjs --apply --all       # 全量回填
```

## 5. Astro 是怎么扫 `docs/` 的（避免误改）

- [`astro-src/lib/paper.ts`](astro-src/lib/paper.ts)：列出所有论文 ID，把 id 喂给对应路由。
- [`astro-src/scripts/build-arxiv-index.mjs`](astro-src/scripts/build-arxiv-index.mjs)：用正则 `^(\d{4}\.\d{4,5}(?:v\d+)?)` 从文件名提 ID，写到 `public/arxiv-index.json`。**不会**进新文件。
- `functions/api/proxy.ts`：站点运行时的 arXiv CORS 反代，与路径规范无关。（仓库内 `edge-functions/proxy.ts` 已在 2026-07-06 删除。）

任何新增 / 删除前要跑一次 `node astro-src/scripts/build-arxiv-index.mjs` 看新索引与预期一致，再 `npm run build`。

## 6. 修改 / 新增 checklist

1. 文件名是否符合 `<arxiv-id>-<slug>.md`？
2. 目标路径 `YYYY/MM/DD` 三段是否与 frontmatter `date` 一致（不是 arxiv id YYMM）？
3. 是否同步更新 `docs/_sidebar.md`？（pipeline 自动维护，但手工新增的论文要去 sidebar 注册）
4. `node astro-src/scripts/build-arxiv-index.mjs` 跑过且索引文件无意外增量？
5. `npm run build` 是否成功？

## 7. DailyCalendar 日历视图

首页 `/` 及 `docs/_home_notice.md` 嵌入的日历组件（commit `b9d350a4`）：

- **数据源**：SSR 阶段调用 `listPapers({sortBy:'date', dedup:true})`，由 `defaultPaperRepository` 返回论文列表。
- **分桶逻辑**：按 `frontmatter.date`（论文**发表日**，非入库日）分到 `YYYY/MM` 栅格，同一日多篇并入同一格子。
- **多版本处理**：同一 arxiv-id 多版本（`v1`/`v2`/...）自动取最新版本的 `date`（`v` 越大越新）。
- **前端组件**：`astro-src/components/DailyCalendar.astro`，样式在 `astro-src/styles/daily-calendar.css`。

> ⚠️ 注意：`docs/papers/<YYYY>/<MM>/<DD>/` 目录名是**入库日**（pipeline 执行日期），与日历展示的**发表日**（frontmatter `date`）是不同的口径。日历按发表日聚合是预期行为。

## 8. 用户自建文献库入库阈值（relevanceThreshold）

`LibraryDefinition.relevanceThreshold`（commit `e7842dfc`）控制论文入库用户自建文献库的**分数门限**：

- **默认值**：`0.5`（定义在 `astro-src/lib/user-libraries/types.ts:261`，由 `defaultLibraryDefinition()` 兜底）。
- **生效位置**：`astro-src/scripts/library-ingest.ts` 拉取 arXiv 候选 + `scorePaperRelevance()` 打分时；`opts.threshold` 来自 `library.definition.relevanceThreshold`。
- **过滤逻辑**：论文得分 `score` 低于阈值时仅标记为 `candidate` 状态、**不进入** `LibraryPaperMeta.status = 'included'`；高于或等于阈值的论文可被 `commitCandidateAsIncluded()` 提交。
- **用途**：让用户为不同文献库设置不同宽松度——例如「精读库」阈值设高（0.8+），「泛读库」设低（0.3）。

阈值在新建/编辑文献库时由用户配置，存储在 `LibraryDefinition.definition.relevanceThreshold` 字段。

> 📚 **完整文献库架构**（公共主题库 + 用户自建文献库 + 单篇论文用户态 + Daily feed 聚合 / 与 Polaris `direction_libraries` / `library_papers` / `user_library_entries` / `daily_feed_entries` 的逐字段映射 / 13 项与 Polaris 的差异）见 [`docs/library-architecture.md`](library-architecture.md)。本文档专注**路径规范**，那一层抽象不在此展开。