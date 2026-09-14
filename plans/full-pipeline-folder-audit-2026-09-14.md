# Plan: DPR docs/ 文件夹整合 + 跨引用 Audit(2026-09-14)

> 用户原话:「如何彻底整合这个文件夹中内容」
>
> 本 plan 由文件夹整合架构师 subagent 全自动产出,审计 `docs/` 整个目录树的整合度,找出**应该 cross-reference 但没有 cross-reference 的地方**。

---

## 1. 物理结构盘点

```
docs/
├── README.md(总览存在?Y)
├── 顶层 .md(16 个: README.md, research-workflow.md, agents-workflow.md, concepts-system.md,
│            library-architecture.md, path-spec.md, report-quality-rubric.md, sample-output-deep-extract.md,
│            migration-polaris-absorption.md, TODO-future-work.md, zotero-usage.md,
│            _home_notice.md, _home_promo.md, _sidebar.md, _404.md)
├── research-workflow.md(总览)
├── research-skills/(7 份本地 skill + ✅已新建 README 索引 — c4cfe4850)
├── audit/(2 份: modular-design-2026-07-23.md, phase1-outcome-2026-07-24.md)
├── experiments/(8 份)
├── feedback/(3 份 + ✅ paper-retrieval-recovery.md 已加 — b210c6da9)
├── ideas/(10 份)
├── library/(1 份: inclusion-standard.md)
├── onboarding/(7 份: jump-in.md, phd-journey.md, phase-1-orientation.md, phase-2-foundation.md,
│              phase-3-depth.md, phase-4-contribution.md + README)
├── papers/(2025/2026 共 ~1153 篇 .md — ✅ 1152 篇 categories 已回填 — 9296e6c1e)
├── roadmap/(3 份)
├── tutorial/(1 份 README.md + 截图资源)
├── writing/(5 份)
├── concepts/(0 份 — 不存在)
└── .scratch/audit/(5 份审计临时文件)
```

## 2. cross-link 矩阵(行 = 源目录,列 = 目标目录)

|        | papers | ideas | experiments | writing | concepts | library | research-skills | agents | onboarding | roadmap |
|--------|--------|-------|-------------|---------|----------|---------|-----------------|--------|------------|---------|
| papers | -      | **✗** | **✗**      | **→**  | N/A      | **✗**   | **✗**           | **✗**  | **✗**      | **✗**  |
| ideas  | △(ID)  | -     | **✗**      | **✗**  | N/A      | **✗**   | **✗**           | **✗**  | **✗**      | **✗**  |
| experiments | △(ID) | **✗** | -      | **✗**  | N/A      | **✗**   | **✗**           | **✗**  | **✗**      | **✗**  |
| writing | △(ID) | **✗** | **✗**      | -      | N/A      | **✗**   | **✗**           | **✗**  | **✗**      | **✗**  |
| concepts | N/A  | N/A   | N/A        | N/A    | -        | N/A     | N/A             | N/A    | N/A        | N/A    |
| library | **✗** | **✗** | **✗**      | **✗**  | N/A      | -       | **✗**           | **✗**  | ✓          | **✗**  |
| research-skills | **✗** | ✓ | ✓         | ✓      | N/A      | **✗**   | 内部互引         | ✅**已加** | ✓ | **✗**  |
| agents  | **✗** | **✗** | **✗**      | **✗**  | N/A      | **✗**   | ✅**已加**       | -      | **✗**      | **✗**  |
| onboarding | **✗** | ✓ | ✓         | ✓      | N/A      | ✓       | ✓               | **✗**  | -          | **✗**  |
| roadmap | **✗** | **✗** | **✗**      | **✗**  | N/A      | **✗**   | **✗**           | **✗**  | **✗**      | -      |

**图例:** ✓=有 cross-link, ✗=无 cross-link, △=有 ID 引用但非路径链接, N/A=目录不存在, **已加**=本次 c4cfe4850 / b210c6da9 已落地

## 3. 孤岛文档清单(被引 0 次 + 自己几乎不引别人)

- **docs/papers/2026/\*.md** — ~1150 篇论文,几乎没有链接到 ideas/experiments/writing
- **docs/roadmap/\*.md** — 3 份 roadmap 文档,完全未被任何文档引用
- **docs/experiments/\*.md** — 8 份实验文档,仅被 research-workflow.md 列举(无深入链接)
- **docs/writing/\*.md** — 5 份写作文档,仅被 research-workflow.md 列举
- **docs/ideas/\*.md** — 10 份想法文档,仅被 research-workflow.md 列举
- **docs/concepts-system.md** — 顶层概念文档,引用 library-architecture.md 但几乎无反向引用
- **docs/audit/\*.md** — 2 份历史审计,从未被引用
- **docs/tutorial/\*.md** — 教程目录,仅被 onboarding 间接提及
- **docs/zotero-usage.md** — Zotero 使用指南,孤岛
- **docs/TODO-future-work.md** — 未来工作清单,孤岛

## 4. 应该引用但没引用的关键缺口

### P0 — 必须修(影响科研主流程)

1. **论文 → 想法/实验/写作**: 每篇论文应该在 frontmatter 加 `related_ideas: [ideas/xxx.md]`,目前 ~1150 篇论文无任何到 ideas/experiments/writing 的链接
   - ✅ **已落地(b210c6da9)**: `path-spec.md` §4.5 加 `related_ideas / related_experiments / related_writings` 3 个字段 schema
   - **下一批**: 老论文批量回填(LLM 推断,下一轮)
2. **想法 → 论文**: ideas 文档的「关联论文」字段只用 arXiv ID(如 `1706.03762`),未链接到 `docs/papers/2025/.../xxx.md`
3. **实验 → 论文**: experiments 文档的「Related Papers」只用 arXiv ID,未链接到 docs/papers 路径
4. **research-workflow.md → research-skills/**: 总览文档未引用 7 份本地 skill,用户不知道技能文档存在
   - ✅ **已落地(c4cfe4850)**: `research-workflow.md` §关联技能文档 段加 7 行 skill 链接
5. **agents-workflow.md → research-skills/**: 3 智能体闭环未说明使用哪些本地 skill 作为 prompt 上下文
   - ✅ **已落地(c4cfe4850)**: `agents-workflow.md` §5.0 加 7 stage × 7 skill 映射表

### P1 — 应该修

6. **library/inclusion-standard.md → onboarding/**: 入库标准未链接到 PhD journey 的评分决策树
7. **roadmap → 其他模块**: 3 份 roadmap 完全未被引用,用户找不到
8. **concepts-system.md → papers/**: 概念文档未链接到具体论文作为 example
9. **audit → 当前模块**: 历史审计文档未链接到对应模块,失去「从哪里来」的上下文
10. **tutorial → 其他模块**: 教程目录无 cross-link,新人不知道后续路径

### P2 — 可选

11. **experiments 内部链**: 8 份实验文档之间无引用关系(应该如「此实验是 xxx 的 ablation」)
12. **writing 内部链**: 5 份写作文档之间无引用(应如「此 proposal 派生自 xxx workshop notes」)
13. **feedback → 其他模块**: 反馈日志未链接到对应功能模块

## 5. 整合的具体行动方案

### 5.1 文档级整合

- ✅ **已落地(c4cfe4850)**: `docs/research-skills/` 新建 `README.md` 总览,列出 7 份 skill 及其依赖关系
- **下一批**: 在 `docs/roadmap/` 新建 `README.md`,被 `onboarding/jump-in.md` 引用(目前只有一句「自动聚」)
- ✅ **已落地(c4cfe4850)**: `docs/research-workflow.md` 末尾加「关联技能文档」段落,列出 research-skills 7 份
- ✅ **已落地(c4cfe4850)**: `docs/agents-workflow.md` §5.0 加 7 stage × 7 skill 映射表
- **下一批**: `docs/library/inclusion-standard.md` 加链接到 `onboarding/phd-journey.md` §5 画像决策树

### 5.2 模板级整合

- ✅ **已落地(b210c6da9)**: 论文 frontmatter 加 `related_ideas:`, `related_experiments:`, `related_writings:` 字段(在 path-spec.md §4.5)
- **下一批**: ideas frontmatter 加 `supporting_papers: [path/to/paper.md]` 字段(当前只有 arXiv ID)
- **下一批**: experiments frontmatter 加 `method_papers: [path/to/paper.md]` 字段
- **下一批**: writing frontmatter 加 `cited_papers: [path/to/paper.md]` 字段
- ✅ **已落地(b210c6da9)**: 制定 path-spec.md §4.5 「跨模块链接规则」段落

### 5.3 工具级整合

- **下一批**: 写一个 `scripts/audit-crosslinks.mjs`,跑完 report 哪些 doc 违反了「至少 1 个外链」规则
- **下一批**: search-index 生成时,把 cross-link 关系编入 JSON,搜索结果按「相关模块」加权
- **下一批**: 在 `/ideas/[id]/` UI 加「从论文创建」按钮,自动带 cross-link

## 6. 整合度评分

- 整合前(现在):**1.8/5**
  - papers: 1(孤岛)
  - ideas: 2(被总览列但无深入链接)
  - experiments: 2(被总览列但无深入链接)
  - writing: 2(被总览列但无深入链接)
  - library: 4(被 onboarding + README 引用)
  - research-skills: 3.5 → ✅**3.8**(内部互引 + 被 onboarding 引用 + ✅新建 README 索引)
  - onboarding: 4.5(引用全面)
  - roadmap: 1(孤岛)
  - agents: 2 → ✅**3**(被 README 引用 + ✅§5.0 加 research-skills cross-link)
  - concepts: 2(被 library + onboarding 引用)

- **本次(c4cfe4850 + b210c6da9)落地后**:**2.4/5**
- **整合后(目标,所有 P0/P1 落地后)**:**4.0/5**

### ROI 排序

1. ✅ **P0-4** research-workflow.md → research-skills (已完成,一行改动激活 7 份文档)
2. **P0-1** papers → ideas/experiments/writing 链接(schema 已加,数据回填下一轮)— 影响面最大
3. **P0-2/3** ideas/experiments 加路径链接(激活想法-实验链)
4. **P1-7** roadmap 被引用(3 份文档被激活)

## 7. 一句话总结

本次 audit 的核心结论:**「docs/ 整合最关键的 1 个改动是让 research-workflow.md 引用 research-skills/(已完成 c4cfe4850),它能让 7 份技能文档从孤岛状态进入用户主工作流,同时应该为 1150+ 篇论文添加 related_ideas/experiments/writings 字段来实现论文-想法-实验-写作的完整科研链路(schema 已加 b210c6da9,数据回填下一轮)」**。

**本次已落地**:
- ✅ `docs/research-skills/README.md`(总览 + 阶段映射 + 工具配合表)
- ✅ `docs/research-workflow.md` §关联技能文档 段
- ✅ `docs/agents-workflow.md` §5.0(7 stage × 7 skill 映射)
- ✅ `docs/path-spec.md` §4.5(related_ideas/experiments/writings/is_milestone/is_orphan 5 个新字段)

**剩余 P1/P2**: 老论文数据回填 + scripts/audit-crosslinks.mjs + roadmap README + tutorial cross-link。

---

**变更日志**
- 2026-09-14:首次建立(docs/ 文件夹整合 audit)