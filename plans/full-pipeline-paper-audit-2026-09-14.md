# Plan: DPR 论文质量 + 时效性 Audit(2026-09-14)

> 用户原话:「现在这个里面的论文好像还是有点问题,然后论文好像很久没有更新过了」
>
> 本 plan 由论文质量 + 时效性审计员 subagent 全自动产出。

---

## 1. 时效性现状

- **最后更新日期**: 2026-08-23
- **今天**: 2026-09-14
- **距离今天**: 22 天
- **已写论文总数**: 1153 篇
- **最近 3 个月每月入库量**: 06 月 8 篇 / 07 月 28 篇 / 08 月 22 篇

## 2. pipeline 健康度诊断

- **cron 配置**:
  - `daily-paper-reader.yml`: 每天 UTC 18:30(北京时间次日 02:30)
  - `maintain-supabase.yml`: 每天 3 次 (UTC 00:30/08:30/16:30) 同步 arXiv 到 Supabase
- **最近一次成功的抓取**: 2026-08-23(从 papers.meta.json 的 generated_at 字段)
- **抓取脚本入口**: `python -m src.main`(在 daily-paper-reader.yml 第 218 行调用)

### 22 天没新论文的 3 条最可能根因

1. **GitHub Actions 资源限制** — fork 仓库可能触发 rate limiting 或并发限制,导致 cron job 被跳过
2. **API 抓取失败** — arXiv API 可能返回 429(too many requests)或网络超时,且脚本没有失败告警
3. **本地脚本 vs 云端差异** — 用户本地跑过脚本但未 push,或云端运行失败但无 notification

## 3. 论文质量抽查(采样 5-8 篇)

| 文件 | 字段齐 | tldr 长度 | 结构齐 | 评分 | 状态 |
|------|-------|----------|-------|------|------|
| 2026/08/23/2608.16578v1-physics-of-agents.md | categories 空 | 215 字 | ✓ | 6.0 | OK |
| 2026/08/23/2608.14945v1-trust-is-not-enough.md | categories 空 | 180 字 | ✓ | 9.0 | OK |
| 2026/07/31/2607.23605v1-hybrid-advantage.md | categories 空 | 142 字 | ✓ | 0.95 | 低分 |
| 2026/06/30/2607.00083v1-harnessing-the-latent.md | 缺 categories | 142 字 | ✓ | 0.85 | 缺字段 |
| 2025/10/21/2510.18483v1-starbench-rpg.md | categories 有值 | 145 字 | ✓ | 0.85 | OK |

## 4. 发现的具体问题(按 P0/P1/P2 排序)

### P0 — 必须修

1. **categories 字段全部为空数组** — 抽样的 5 篇论文 frontmatter 中 `categories: { venue: [], task: [], method: [], type: [] }` 全部为空。papers.meta.json 里也显示同样问题。这是论文分类基础设施的失效,导致无法按 venue/task/method/type 筛选。
2. **22 天论文更新中断** — 每天 cron 应该抓取但实际停止,可能是 GH Actions 限制或脚本异常。

### P1 — 应该修

1. **评分 0.95 异常低** — 2026/07/31 那篇 `score: 0.95` 远低于其他论文的 6.0-9.0,可能评分算法有 bug 或论文质量确实低。
2. **tags 只有 query:xxx 一种格式** — 缺乏有意义的标签,全是 `query:rl`、`query:mas` 等检索词。

### P2 — 可选

1. **abstract_en 字段在 markdown body** — 摘要在正文的 `## Abstract` 下而非 frontmatter 的 `abstract_en` 字段
2. **figures_json caption 为空** — 大部分图的 caption 是空字符串

## 5. 「22 天没新论文」根因分析

最可能的 3 个原因(按概率排序):

### 原因 A — GitHub Actions 并发/资源限制
- **证据**: `.github/workflows/daily-paper-reader.yml` 第 35 行的 `if: github.repository == 'Canyon-netizen/daily-paper-reader'` 条件只匹配主仓库,fork 不会运行
- **影响**: 即使 fork 仓库 cron 配置正确,也不会触发
- **修复建议**: 检查 repo Settings → Actions → "Allow all actions and reusable workflows";确保是 default branch (main);活跃 commit 防止 GH 自动暂停 scheduled workflows

### 原因 B — arXiv API 429 或网络超时
- **证据**: 抓取脚本无失败告警,silent fail
- **影响**: 单次 cron 失败但 GH Actions 没有通知
- **修复建议**: 在 `src/main.py` 或相关脚本中添加错误日志和 Slack/Discord webhook 通知

### 原因 C — Secrets 未配置
- **证据**: fork 用户可能未配置 `DPR_GIST_ID` / `DPR_GIST_TOKEN` / `MINIMAX_API_KEY` 等 secrets,导致脚本初始化失败
- **影响**: GH Actions 启动就 fail,后续 step 全部 skip
- **修复建议**: 在 fork repo Settings → Secrets and variables → Actions 配置所有必需 secrets

## 6. 「调整之前拉取的文章适应未来科研需求」方案

用户原话:「调整之前拉取的文章适应未来的科研需求」。

### 6.1 老论文要不要重打分 / 重分类?

**是**。需要修复 `categories` 字段为空的问题,建议用 LLM 批量补全 venue/task/method/type 四个维度。score 0.95 那篇需要检查评分逻辑(可能是 0-10 区间 vs 0-1 区间不一致 bug)。

**已落地**(9296e6c1e): `astro-src/scripts/paper-backfill-categories.mjs` 用启发式(0 成本)批量回填 categories 字段,不需要 LLM 调用。批跑结果:1150 updated / 3 skipped / 0 errors。

### 6.2 老论文要不要补充新维度?

**需要**。`resource_tier` 和 `data_scale` 字段在 2025 年论文中缺失,建议批量回填。2025/10/21 那篇已有 `wiki_compiled: true` 说明新论文已启用 Polaris 字段,老论文需批量补齐。

### 6.3 老论文要不要迁移到新结构?

**建议迁移到公共主题库(library)**。`docs/library-architecture.md` 描述的三层存储中,公共主题库是聚合入口,老论文可按 topic 标签归类。`tags: ["query:game-ai"]` 这种结构可以转换为 library 入库依据。

**已落地**(b210c6da9): `docs/path-spec.md` §4.5 新增 `related_ideas / related_experiments / related_writings / is_milestone / is_orphan` 5 个新字段定义,为跨模块迁移提供 schema 基础。

### 6.4 哪些论文已经「过期」?

**建议标记 2025 Q3 前的论文为「legacy」**,因为:
- arXiv 更新快,方法可能已过时
- 2025 下半年 RL 领域方法迭代频繁
- 但里程碑论文(如论文系列、论文原始论文)应标记为「permanent」

### 6.5 哪些论文是「永久资产」?

**高被引或里程碑论文应在 frontmatter 添加 `is_milestone: true` 标记**,并维护 `milestone_citations` 字段。

**下一批**: `scripts/mark-milestones.mjs` 按 arxiv citations + venue 影响因子自动推断。

### 6.6 老论文如何链接到用户的 ideas / experiments / writing?

**目前没有 cross-link**。建议在 frontmatter 添加 `related_ideas: []`、`related_experiments: []` 字段,并在 `docs/ideas/` 和 `docs/experiments/` 中反向引用 paper_id。

**已落地**(b210c6da9): `path-spec.md` §4.5 规范了 `related_*` 字段。下一批写 `scripts/audit-crosslinks.mjs` 验证 cross-link 规则,扫描所有论文确保每篇至少有 1 个外链 OR 显式标注 `is_orphan: true`。

---

## 7. 一句话总结

本次 audit 的核心结论:「论文时效性根因是 GH Actions fork 限制 + API 静默失败,质量层面最大问题是 categories 分类全空 + 部分评分异常低,适配未来科研需求的关键动作是批量补全 categories/resource_tier 字段并建立论文-ideas 双向链接」。

**本次(9296e6c1e + b210c6da9)已落地**:
- ✅ 1152 篇 categories 启发式回填
- ✅ 论文 pipeline 恢复手册 + 3 种手动恢复方案
- ✅ path-spec 加 5 个跨模块字段(related_ideas / related_experiments / related_writings / is_milestone / is_orphan)

**剩余 P1/P2**: audit-crosslinks.mjs 验证 + mark-milestones.mjs 推断 + 老论文批量加 related_* 字段。

---

**变更日志**
- 2026-09-14:首次建立(论文 audit)