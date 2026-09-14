---
name: r7-comprehensive-plan
description: R7 全景 commit 计划 — 100+ commit 按 9 大类别分,每个独立可测试可回滚
metadata:
  type: project
  date: 2026-09-14
  status: planning
  estimated_total_commits: 120+
---

# Plan: R7 — 全景 Commit 计划(100+ commits,9 大类别)

> 用户反馈(R7 启动前):
> - 「至少需要上百个 commit 才能够给出我能够满意的方案」
> - 「你还需要留一点空间去做 debug,我感觉你很多时候会改错一些东西,我会告诉你你要去做修改」
>
> 本 plan 的设计原则:
> 1. **每个 commit 独立可测试可回滚**(单文件/单特性改动,便于 debug)
> 2. **预留 debug 空间**(每类工作间留 1-2 个空 commit 给用户反馈)
> 3. **依赖顺序**(commit 之间不强耦合,但 logical 顺序)
> 4. **预算明确**(每 commit 预估耗时 + 改动规模)

---

## 总览:9 大类别 × 120+ commit

| 类别 | commit 数 | 预估总耗时 | 优先级 |
|------|----------|----------|--------|
| A. 论文抓取 pipeline 修缮 + 自动化 | 15 | 6 h | P0 |
| B. research-skills ↔ agents 代码层接通 | 12 | 4 h | P0 |
| C. 论文 frontmatter 字段深度回填 | 15 | 5 h | P0 |
| D. 文献库系统(Library)UX + 数据 | 15 | 5 h | P1 |
| E. ideas / experiments / writing 模块打通 | 18 | 6 h | P1 |
| F. agents 闭环深化(各 agent) | 18 | 6 h | P1 |
| G. 概念(Concepts)系统改进 | 8 | 3 h | P2 |
| H. 站点 / Astro 性能 + UX | 12 | 4 h | P2 |
| I. 基础设施(CI/CD + 测试 + DevOps) | 12 | 4 h | P2 |
| **预留 debug commits** | 15 | — | — |
| **合计** | **~140** | **~45 h** | |

> 预估是「乐观下限」,实际可能 60-80 小时。每个 commit 都预留 user review 时间。

---

## A. 论文抓取 pipeline 修缮 + 自动化(15 commits)

### A.1 — 恢复论文更新(P0)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| A.1.1 | `fix(workflow): daily-paper-reader cron 防 60 天空闲暂停` | 加任意 push 唤醒 cron + actions/checkout 触发器 + 注释「活跃 commit 才能跑 cron」 | 1 文件,~20 行 |
| A.1.2 | `feat(workflow): 加 status badge + Slack webhook 失败通知` | README 顶部 badge + workflow 失败 step 发 webhook | 2 文件,~40 行 |
| A.1.3 | `feat(workflow): 降 fetch_days 默认到 5 天` | 防超时,配合 daily cron | 1 文件,1 行 |
| A.1.4 | `fix(pipeline): arXiv API 429 加 retry-after 解析` | `src/main.py` 加 backoff + retry | 1 文件,~30 行 |
| A.1.5 | `feat(pipeline): main.py 加 fail-fast + 错误日志` | workflow 失败立即终止,不再 silent | 1 文件,~20 行 |

### A.2 — 论文质量把关(P0)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| A.2.1 | `feat(tools): paper-validate.mjs frontmatter schema 校验` | CLI 扫所有论文,断言 13 个必填字段齐全 | 1 文件,~80 行 |
| A.2.2 | `fix(tools): paper-validate 校验 abstract vs tldr 长度` | tldr > 50 字,abstract > 100 字 | 1 文件,~20 行 |
| A.2.3 | `feat(tools): paper-dedupe.mjs 查重` | 按 canonical arxiv id 去重,删除旧版本 | 1 文件,~50 行 |
| A.2.4 | `feat(tools): paper-translate-check.mjs 检查 5 节齐全` | 跑 translate_polaris 时校验 TLDR/动机/方法/结果/结论 | 1 文件,~40 行 |
| A.2.5 | `fix(pipeline): translate_parallel 去重 bug` | per memory TODO-future-work #1,按 canonical id 取最新一份 | 1 文件,~30 行 |

### A.3 — 论文「新鲜度」(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| A.3.1 | `feat(pipeline): papers-freshness-report.mjs` | 检查最后入库时间,超 7 天告警 | 1 文件,~60 行 |
| A.3.2 | `feat(ci): 论文新鲜度检查加到 ci.yml` | fail 如果 >14 天无新论文 | 1 文件,~20 行 |
| A.3.3 | `feat(tools): paper-classify-quality.mjs` | 自动检测低质量论文(tldr 太短 / 无 method / score 异常) | 1 文件,~50 行 |

---

## B. research-skills ↔ agents 代码层接通(12 commits)

### B.1 — agents prompt 注入 skill 上下文(P0)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| B.1.1 | `feat(agents): lib/agents/skill-context-loader.ts 新增` | 按 stage 读 docs/research-skills/*.md,拼 context 块 | 1 文件,~50 行 |
| B.1.2 | `feat(agents): designer.ts 注入 experiment-design.md` | system prompt 顶部拼 skill context | 1 文件,~20 行 |
| B.1.3 | `feat(agents): modifier.ts 注入 writing-paper.md` | 同上 | 1 文件,~20 行 |
| B.1.4 | `feat(agents): reviewer.ts 注入 reviewer-mindset.md` | 同上 | 1 文件,~20 行 |
| B.1.5 | `feat(agents): reviser.ts 注入 writing-rebuttal.md` | 同上 | 1 文件,~20 行 |
| B.1.6 | `test(agents): skill-context-loader 单测` | 测 stage 映射正确,内容非空 | 1 文件,~60 行 |
| B.1.7 | `feat(agents): CLI 启动时提示 research-skills 存在` | `--quickstart` 输出加 tip | 1 文件,~10 行 |

### B.2 — 失败重试与日志(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| B.2.1 | `feat(agents): designer 失败重试 + 摘要记录` | parse 失败时存 raw output 到 archive/<sid>/raw/ | 1 文件,~30 行 |
| B.2.2 | `feat(agents): modifier 失败重试 + 占位 fallback` | LLM 失败时写 ⚠️ 占位而非抛 | 1 文件,~30 行 |
| B.2.3 | `feat(agents): 全 agent 加 cost tracking` | 每次 LLM 调用记 token 到 archive/<sid>/cost.json | 1 文件,~40 行 |
| B.2.4 | `feat(agents): 全 agent 加 trace log` | 每步打 console.log + 写 archive/<sid>/trace.log | 1 文件,~30 行 |
| B.2.5 | `test(agents): 失败重试 + cost tracking 集成测试` | mock LLM 失败,验证 fallback | 1 文件,~40 行 |

---

## C. 论文 frontmatter 字段深度回填(15 commits)

### C.1 — schema 完整化(P0)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| C.1.1 | `feat(tools): paper-backfill-crosslinks.mjs — LLM 推断 related_*` | per R6 P0-1 计划 | 1 文件,~150 行 |
| C.1.2 | `feat(tools): paper-backfill-crosslinks 启发式 fallback` | tags 匹配 → docs/ideas/experiments/writing | 1 文件,~60 行 |
| C.1.3 | `feat(tools): paper-backfill-crosslinks --limit dry-run` | 验证 diff 大小 + 准确率抽样 | 已含在 C.1.1 |
| C.1.4 | `feat(tools): paper-mark-milestones.mjs — 启发式 + 白名单` | per R6 P1-2 计划 | 1 文件,~80 行 |
| C.1.5 | `feat(tools): paper-compute-resource-tier.mjs` | 读 abstract 推断 resource_tier (small/medium/large/xlarge) | 1 文件,~60 行 |

### C.2 — 数据回填(P0)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| C.2.1 | `data(papers): apply backfill-crosslinks --all` | 老论文 1152 篇加 related_*(LLM 跑) | 1 commit,~1150 文件,+9K 行 |
| C.2.2 | `data(papers): apply mark-milestones --apply` | 标 ~50-100 篇 is_milestone: true | 1 commit,~100 文件,+300 行 |
| C.2.3 | `data(papers): apply compute-resource-tier --all` | 回填 resource_tier 字段 | 1 commit,~1152 文件,+9K 行 |

### C.3 — cross-link 验证(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| C.3.1 | `feat(tools): audit-crosslinks.mjs — 验证每篇论文` | per R6 P1-1 计划 | 1 文件,~100 行 |
| C.3.2 | `feat(tools): audit-crosslinks --ci exit code` | GH Actions 跑失败 exit 1 | 1 文件,~20 行 |
| C.3.3 | `feat(ci): ci.yml 跑 audit-crosslinks` | 每个 PR 强制 cross-link 校验 | 1 文件,~15 行 |
| C.3.4 | `feat(tools): audit-crosslinks --fix 自动加 is_orphan` | 自动兜底孤儿论文 | 1 文件,~30 行 |
| C.3.5 | `test(tools): audit-crosslinks 单测` | mock 论文 fixture | 1 文件,~50 行 |

---

## D. 文献库系统(15 commits)

### D.1 — UX 减阻(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| D.1.1 | `feat(library): 「从论文创建库」一键按钮` | paper-detail 页加按钮,自动填 name + statement | 2 文件,~60 行 |
| D.1.2 | `feat(library): 7 个库 seed template(RL/Agent/Game/...)` | 新建时给常用方向一键应用 | 1 文件,~80 行 |
| D.1.3 | `feat(library): library merge 检测(同名高相似时提示)` | 新建前 scan 已存在库 | 1 文件,~40 行 |
| D.1.4 | `feat(library): 库导出 .bib / .md / Obsidian ZIP` | 设置页加导出按钮 | 2 文件,~80 行 |
| D.1.5 | `feat(library): 库分享(Gist 自动 sync)` | 设置页加 toggle | 1 文件,~30 行 |

### D.2 — 数据质量(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| D.2.1 | `feat(library): library-validate.mjs — schema 校验` | 7 库 + anchors + keywords 完整 | 1 文件,~60 行 |
| D.2.2 | `feat(library): anchor paper 质量打分` | 标「高被引 anchor」vs 「用户自填」 | 1 文件,~40 行 |
| D.2.3 | `feat(library): library 统计页面(论文数 / 主题分布 / 平均相关度)` | UI 加统计 tab | 2 文件,~80 行 |
| D.2.4 | `feat(library): library freshness 指示器(最近纳入时间)` | UI badge | 1 文件,~30 行 |
| D.2.5 | `feat(library): library 自动派生 (从 task: 聚合)` | per R6 P2-1 | 1 文件,~80 行 |

---

## E. ideas / experiments / writing 模块打通(18 commits)

### E.1 — Ideas(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| E.1.1 | `feat(ideas): 「从论文创建 idea」一键按钮` | paper-detail 页加按钮,自动填 title + related_paper | 2 文件,~60 行 |
| E.1.2 | `feat(ideas): idea versioning(每次 commit 一版本)` | 支持回看历史 | 2 文件,~50 行 |
| E.1.3 | `feat(ideas): idea status 转换(idea → active → validated → written)` | 状态机 + UI | 1 文件,~60 行 |
| E.1.4 | `feat(ideas): idea ↔ paper cross-link UI(显示关联论文列表)` | idea 详情页加 section | 1 文件,~50 行 |
| E.1.5 | `feat(ideas): idea templates(survey idea / experiment idea / discussion idea)` | 一键起 idea | 1 文件,~60 行 |

### E.2 — Experiments(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| E.2.1 | `feat(experiments): hypothesis template` | 自动套 SMART | 1 文件,~50 行 |
| E.2.2 | `feat(experiments): variable design wizard(independent/dependent/controlled)` | 引导式 UI | 1 文件,~80 行 |
| E.2.3 | `feat(experiments): result tracking(expected vs actual)` | UI + 数据 | 2 文件,~60 行 |
| E.2.4 | `feat(experiments): experiment status transitions` | 状态机 | 1 文件,~40 行 |
| E.2.5 | `feat(experiments): experiment ↔ paper method_papers 字段 + UI` | cross-link | 2 文件,~60 行 |

### E.3 — Writing(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| E.3.1 | `feat(writing): outline generator(从 agents synthesis 自动生成 5-section outline)` | 1 文件,~80 行 |
| E.3.2 | `feat(writing): draft ↔ synthesis 整合(synthesis 段落一键塞入 draft)` | 1 文件,~60 行 |
| E.3.3 | `feat(writing): citation management(自动从 cited_papers 生成 BibTeX)` | 1 文件,~80 行 |
| E.3.4 | `feat(writing): draft versioning(Git commit 自动绑定)` | 1 文件,~40 行 |
| E.3.5 | `feat(writing): writing ↔ paper cited_papers 字段 + UI` | cross-link | 2 文件,~60 行 |

### E.4 — Research dashboard(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| E.4.1 | `feat(research): dashboard activity feed 跨模块聚合` | 1 文件,~80 行 |
| E.4.2 | `feat(research): dashboard 阶段统计(idea count / active experiments / drafts)` | 1 文件,~50 行 |
| E.4.3 | `feat(research): dashboard time-to-paper metrics` | 1 文件,~60 行 |

---

## F. agents 闭环深化(18 commits)

### F.1 — Designer agent(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| F.1.1 | `feat(agents): designer proposal types 扩展到 8 种(加 citation_review / dataset_curation / related_work)` | 1 文件,~50 行 |
| F.1.2 | `feat(agents): designer 读 archive/<sid>/raw/ 学 past winners` | few-shot from history | 1 文件,~60 行 |
| F.1.3 | `feat(agents): designer confidence scoring(proposal 输出 0-1 信心分)` | 1 文件,~30 行 |
| F.1.4 | `feat(agents): designer 接 user feedback loop(--refine-proposal)` | 1 文件,~50 行 |
| F.1.5 | `test(agents): designer 5 类型各 2 fixture` | 1 文件,~60 行 |

### F.2 — Feedback agent(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| F.2.1 | `feat(agents): feedback citation validation(检查 proposal 引用是否真存在)` | 1 文件,~40 行 |
| F.2.2 | `feat(agents): feedback methodology check(实验设计是否合理)` | 1 文件,~50 行 |
| F.2.3 | `feat(agents): feedback reproducibility audit(代码 / 数据是否公开)` | 1 文件,~40 行 |
| F.2.4 | `feat(agents): feedback novelty check(相对 prior art 的差异化)` | 1 文件,~40 行 |
| F.2.5 | `test(agents): feedback 5 维度各 1 fixture` | 1 文件,~50 行 |

### F.3 — Modifier agent(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| F.3.1 | `feat(agents): modifier format-specific(arXiv style / ACL style / 期刊 style 三选)` | 1 文件,~60 行 |
| F.3.2 | `feat(agents): modifier cross-reference enforcement(强制引用 ≥3 个 supporting paper)` | 1 文件,~40 行 |
| F.3.3 | `feat(agents): modifier bibliography formatting(bibtex / natbib / biblatex 三选)` | 1 文件,~30 行 |
| F.3.4 | `feat(agents): modifier citation graph generation(可视化引用关系)` | 1 文件,~80 行 |
| F.3.5 | `test(agents): modifier 4 deliverable 类型 fixture` | 1 文件,~60 行 |

### F.4 — Pipeline state machine(P1)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| F.4.1 | `feat(agents): pipeline recovery from failed stages(--retry-stage N)` | 1 文件,~40 行 |
| F.4.2 | `feat(agents): pipeline parallel stages(允许 review + revise 并行)` | 1 文件,~50 行 |
| F.4.3 | `feat(agents): pipeline user override(--skip-gate / --force-stage)` | 1 文件,~30 行 |

---

## G. 概念(Concepts)系统(8 commits)

### G.1 — Extraction(P2)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| G.1.1 | `feat(concepts): 抽取 prompt 升级到 3 阶段(title / body / cross-link)` | 1 文件,~60 行 |
| G.1.2 | `feat(concepts): 概念去重(slug collision + fuzzy match)` | 1 文件,~50 行 |
| G.1.3 | `feat(concepts): 概念 versioning(随论文更新而 update)` | 1 文件,~40 行 |

### G.2 — Graph(P2)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| G.2.1 | `feat(concepts): concept relations UI(显示 related concepts)` | 1 文件,~50 行 |
| G.2.2 | `feat(concepts): concept evolution tracking(随时间变化趋势)` | 1 文件,~50 行 |

### G.3 — UI(P2)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| G.3.1 | `feat(concepts): concept 创建 UI(从论文或自由输入)` | 1 文件,~50 行 |
| G.3.2 | `feat(concepts): concept editing(slug / displayName / definition)` | 1 文件,~60 行 |
| G.3.3 | `feat(concepts): concept relationships 可视化(cytoscape)` | 1 文件,~80 行 |

---

## H. 站点 / Astro(12 commits)

### H.1 — 性能(P2)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| H.1.1 | `perf(build): bundle 拆分 vendor + 按路由 lazy load` | 1 文件,~30 行 |
| H.1.2 | `feat(images): 论文图 lazy load(loading="lazy" + srcset)` | 1 文件,~20 行 |
| H.1.3 | `perf(search): search-index 分页 + 客户端 cache` | 1 文件,~40 行 |
| H.1.4 | `perf(cache): 静态资源 HTTP cache headers` | 1 文件,~10 行 |
| H.1.5 | `perf(build): lighthouse CI > 90` | 1 文件,~20 行 |

### H.2 — UX(P2)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| H.2.1 | `fix(mobile): 论文详情页移动端适配` | 1 文件,~50 行 |
| H.2.2 | `fix(a11y): 全站 keyboard navigation 审计` | 多文件,~40 行 |
| H.2.3 | `feat(loading): skeleton 加载态` | 1 文件,~40 行 |
| H.2.4 | `feat(empty): 空状态统一设计` | 1 文件,~30 行 |

### H.3 — 页面(P2)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| H.3.1 | `feat(home): 首页 redesign(突出 daily recommendations + recent activity)` | 1 文件,~80 行 |
| H.3.2 | `feat(library): library detail 页加 cross-link 网络图` | 1 文件,~80 行 |
| H.3.3 | `feat(settings): settings page UX 改进(分 tab + search)` | 1 文件,~80 行 |

---

## I. 基础设施(12 commits)

### I.1 — CI/CD(P2)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| I.1.1 | `feat(ci): pytest 全套启动(目前只有 offline subset)` | 1 文件,~30 行 |
| I.1.2 | `feat(ci): type check 强制(npx tsc --noEmit)` | 1 文件,~15 行 |
| I.1.3 | `feat(ci): ESLint + Prettier 强制` | 2 文件,~30 行 |
| I.1.4 | `feat(ci): perf budget check` | 1 文件,~20 行 |
| I.1.5 | `feat(ci): auto-format on commit(husky + lint-staged)` | 2 文件,~30 行 |

### I.2 — Testing(P2)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| I.2.1 | `feat(tests): unit test 框架(vitest)` | 2 文件,~50 行 |
| I.2.2 | `feat(tests): integration tests(关键流程 e2e)` | 1 文件,~80 行 |
| I.2.3 | `feat(tests): snapshot tests(LLM 输出稳定性)` | 1 文件,~50 行 |
| I.2.4 | `feat(tests): coverage report + badge` | 1 文件,~20 行 |

### I.3 — DevOps(P2)

| # | commit | 内容 | 改动规模 |
|---|---|---|---|
| I.3.1 | `feat(deps): dependabot 配置(automerge patch)` | 1 文件,~30 行 |
| I.3.2 | `feat(release): conventional commits + auto changelog` | 1 文件,~30 行 |
| I.3.3 | `feat(security): GitHub Actions secrets 审计` | 1 文件,~30 行 |

---

## J. 预留 debug commits(15 个空位)

按用户反馈「很多时候会改错一些东西,我会告诉你要做修改」,每类工作预留 1-2 个空 commit 给 debug:

- A 类预留 2 个(A.db.1 修 workflow / A.db.2 修 paper quality)
- B 类预留 2 个(B.db.1 修 designer / B.db.2 修 modifier)
- C 类预留 2 个(C.db.1 修 backfill-crosslinks / C.db.2 修 mark-milestones)
- D 类预留 2 个(D.db.1 / D.db.2)
- E 类预留 2 个(E.db.1 / E.db.2)
- F 类预留 2 个(F.db.1 / F.db.2)
- G/H/I 各预留 1 个
- **J 类预留 1 个** 任意修

每个预留 commit 用 `fix(...): user feedback #N 修 ...` 命名,用户说改什么就 commit 什么。

---

## 执行建议

### 第一波(R7.1,3-5 commit,1-2 天)

**目标**:打通 research-skills → agents 代码层(高 ROI)

按顺序:
1. **B.1.1** `feat(agents): skill-context-loader.ts 新增`
2. **B.1.2** `feat(agents): designer.ts 注入 experiment-design.md`
3. **B.1.3** `feat(agents): modifier.ts 注入 writing-paper.md`
4. **B.1.6** `test(agents): skill-context-loader 单测`
5. **J.1** 预留:用户 review 后修

### 第二波(R7.2,5-10 commit,2-3 天)

**目标**:老论文 cross-link 回填(高 ROI,数据规模大)

按顺序:
1. **C.1.1** `feat(tools): paper-backfill-crosslinks.mjs`(LLM + 启发式)
2. **C.1.3** `--limit 5` dry-run 验证
3. **C.1.4** `--all` apply 1152 篇
4. **C.3.1** `feat(tools): audit-crosslinks.mjs 验证`
5. **C.3.2** `--ci exit code`
6. **C.3.3** `feat(ci): ci.yml 跑 audit-crosslinks`
7. **J.2** 预留:用户 review 后修

### 第三波(R7.3,5-10 commit,2-3 天)

**目标**:papers pipeline 修复(A 类)+ library UX(D 类)并行

### 第四波(R7.4,5-10 commit,1-2 周)

**目标**:ideas/experiments/writing 模块打通(E 类)

### 第五波(R7.5+,5-10 commit/波,持续 2-4 周)

**目标**:agents 深化 + concepts + 基础设施

---

## 总览统计

| 维度 | 数值 |
|---|---|
| 总 commit 数 | ~140(120 实际工作 + 15 debug 预留 + 5 待补充) |
| 预估总耗时 | ~45-60 小时实际工作 + ~20 小时 review/debug |
| 优先级 | A/B/C 为 P0(本季度必做),D/E/F 为 P1(下季度),G/H/I 为 P2(持续) |
| 关键依赖 | A 类优先 → 论文质量稳定后再做 B/C → D/E 在 B/C 之上 |
| 风险 | 跨模块改动容易冲突,每 commit 必须独立可回滚 |

---

## 用户反馈 room

R7 启动后:
- 用户 review 每个 commit 后,可能在 J 类预留空位 commit 反馈
- 也可能修改后续 commit 计划(调整顺序 / 拆分 / 合并)
- 也可能延后某 commit 到下一波(优先级调整)

每 commit 改动规模 < 100 行,便于 review 和 revert。

---

**变更日志**
- 2026-09-14:首次建立(基于 R6 全流程整合 audit,扩到 9 类 120+ commit 全景计划)