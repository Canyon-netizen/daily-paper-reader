# Plan: DPR 文献库 Skill 整合 — 科研全流程接管(2026-09-14)

> 用户原话:「请你根据科研从头到尾全流程能够彻底接管科研的目标调研现有的 skill 还有给出如何彻底整合这个文件夹中内容」
>
> 本 plan 由 Skill 整合架构师 subagent 全自动审计产出。所有结论基于实测读取 `docs/research-skills/`、`docs/research-workflow.md`、`docs/agents-workflow.md`、`astro-src/scripts/agents/` 后的判断。

---

## 1. 现状盘点

### A. 本地 skill 文档(7 份,`docs/research-skills/`)

| 文档 | 用途 | 引用其他 skill |
|------|------|---------------|
| `experiment-design.md` | Phase 2-3 博士生设计可直接投稿的 ablation 实验 | 引用 `writing-paper.md`、`writing-rebuttal.md`、`how-to-read-paper.md` |
| `how-to-lit-review.md` | Phase 1 末-2 博士生 1 个月做出 30 分钟方向综述 | 引用 `how-to-read-paper.md`、`experiment-design.md`、`concepts-system.md` |
| `how-to-read-paper.md` | 入门博士生 1 小时内从 paper 拿到 80% 价值 | 引用 `phase-1-orientation.md` |
| `reviewer-mindset.md` | Phase 3-4 博士生写有用的 review | 引用 `writing-review.md`、`writing-rebuttal.md`、`how-to-read-paper.md`、`how-to-lit-review.md`、`phase-4-contribution.md` |
| `writing-paper.md` | Phase 2 末-3 博士生从 draft 到 camera-ready | 引用 `writing-rebuttal.md`、`writing-review.md`、`how-to-read-paper.md`、`experiment-design.md`、`agents-workflow.md` |
| `writing-rebuttal.md` | Phase 2-4 博士生回应审稿人 | 引用 `writing-paper.md`、`writing-review.md`、`reviewer-mindset.md`、`experiment-design.md`、`how-to-read-paper.md` |
| `writing-review.md` | Phase 3-4 博士生 1-2 天写建设性 review | 引用 `reviewer-mindset.md`、`how-to-read-paper.md`、`writing-rebuttal.md`、`writing-paper.md` |

**文档间互引**:
- `writing-paper.md` ← `writing-rebuttal.md` + `writing-review.md` + `experiment-design.md`
- `reviewer-mindset.md` ← `writing-review.md` + `writing-rebuttal.md`
- `how-to-lit-review.md` → `how-to-read-paper.md` + `experiment-design.md`
- `experiment-design.md` → `writing-paper.md` + `writing-rebuttal.md` + `how-to-read-paper.md`
- **缺失**:7 份文档无统一入口 README,无交叉引用图谱

### B. Nature 系统级 skill(分类)

| 类别 | Skills | 与 DPR 对接点 |
|------|--------|--------------|
| **文献搜索类** | `nature-academic-search`、`paper-search` | DPR 的 `/libraries/` + `--search-arxiv` CLI |
| **阅读分析类** | `paper-analyze`、`nature-reader`、`nature-figure` | DPR 的 `/papers/<id>/` 精读页 + 概念提取 |
| **写作投稿类** | `nature-writing`、`nature-polishing`、`nature-response` | DPR 的 `/writing/` + `--compile-paper` + LaTeX 模板 |
| **数据可视化** | `nature-data`、`nature-figure`、`dataviz` | DPR 的 `/graph/<arxivId>/` 引用图 + 实验结果可视化 |
| **Obsidian 沉淀** | `obsidian-markdown`、`obsidian-cli`、`obsidian-bases` | DPR 论文 markdown 导出 + 概念页同步 |
| **开发工作流** | `code-review`、`simplify`、`loop`、`workflow-authoring`、`run` | DPR 源码开发 + agents CLI 循环 |

**问题**:Nature skills 与本地 skill 文档**完全未对接**——7 份 `docs/research-skills/*.md` 无一处提及 Nature skill 作为执行后端。

### C. 项目内置 agents 闭环

| Agent | 职责 | 科研环节覆盖 |
|-------|------|------------|
| `designer.ts` | 读 project + candidates + 上一轮摘要 → 提出 Proposal | Idea 衍生、文献检索 |
| `feedback.ts` | 3 persona 评分 + Swiss-pair Elo 配对 | Idea 评估 |
| `gate.ts` | 阈值桶化(promoted/candidate/sketch/rejected) | 质量过滤 |
| `modifier.ts` | 真写 deliverable(md) | 论文写作、实验设计、综述产出 |
| `reviewer.ts` | simulated peer review,5 维评分 | 审稿应对 |
| `reviser.ts` | 接收 ReviewVerdict + draft → RevisionVerdict | 论文修订 |
| `pipeline.ts` | 7 stage 状态机(ideation→literature→experiment→draft→peer review→revise→export) | **全流程闭环** |

**闭环能力**:
- ✅ 已覆盖:1/2/3/4/5/10/11/12 阶段(方向定位到投稿)
- ❌ 缺失:6(笔记沉淀)——agents 不直接产出 DPR 内部 note;9(实验执行)——只规划,不跑实验
- ⚠️ 关键缺口:`pipeline.ts` 虽定义 7 stage,但与本地 skill 文档**无连接**——Designer 不知道读 `experiment-design.md`,Modifier 不知道参考 `writing-paper.md`

---

## 2. 科研全流程 12 阶段 × skill 矩阵

| 阶段 | 本地 skill | Nature skill | agents 闭环 | 缺口 |
|------|-----------|--------------|------------|------|
| **1. 方向定位** | ✗(无 topic ideation skill) | ✗ | `designer.ts` → proposal | 无本地 skill 教用户"怎么定义研究问题" |
| **2. 文献检索** | ✗ | `nature-academic-search`、`paper-search` | `--search-arxiv` + `web-search.ts` | 本地 skill 文档未提及工具 |
| **3. 文献筛选** | ✗ | ✗ | `gate.ts` 桶化 | 无 skill 教"筛选标准" |
| **4. 论文速读** | `how-to-read-paper.md`(✓) | `paper-analyze`、`nature-reader` | ✗ | skill 未指明用哪些工具 |
| **5. 论文精读** | `how-to-read-paper.md`(✓) | `nature-figure` | `pipeline.p_review_literature` | 同上 |
| **6. 笔记沉淀** | `how-to-read-paper.md`(4 产出位) | ✗ | ✗ | **P0 缺口**:agents 不写 DPR note |
| **7. 概念抽取** | `concepts-system.md`(✓) | ✗ | LLM 离线抽取 | 缺"概念怎么用于 idea" |
| **8. Idea 衍生** | ✗ | ✗ | `designer.ts` | 无 skill 教"怎么从笔记变 idea" |
| **9. 实验设计** | `experiment-design.md`(✓) | ✗ | `modifier.ts` → experiment_plan | skill 未与 agents 对接 |
| **10. 论文写作** | `writing-paper.md`(✓) | `nature-writing`、`nature-polishing` | `--compile-paper` + `paper-compiler.ts` | skill 未指明用 `--compile-paper` |
| **11. 审稿应对** | `writing-rebuttal.md` + `reviewer-mindset.md`(✓) | `nature-response` | `reviewer.ts` + `reviser.ts` | skill 未指明 DPR 假审稿训练 |
| **12. 投稿** | ✗ | `nature-paper2ppt` | `pipeline.p_export_final_paper` | 无本地 skill 教"投稿检查清单" |

---

## 3. 缺口分析(按 ROI 排序)

### P0(必须,影响科研主流程)

| 缺口位置 | 提议方案 | 预期 ROI |
|----------|----------|----------|
| **阶段 6 笔记沉淀**:agents 不产出 DPR note | `lib/agents/note-generator.ts`:每次 Modifier write 后同步写 `/writing/`,type=note | 打通 idea→笔记→概念的闭环 |
| **阶段 1 方向定位**:无 skill 教"怎么定义研究问题" | 新建 `research-skills/defining-research-question.md`:问题陈述模板、SMART 原则、3 种 gap 识别 | 减少 Designer proposal 跑偏 |
| **本地 skill ↔ agents 对接**:Designer/Modifier 不知道读 skill 文档 | `designer.ts` / `modifier.ts` 入口加 `// context: read docs/research-skills/*.md` 注释,CLI 启动时提示 | 提高 agent 产出质量 |

### P1(应该,影响效率)

| 缺口位置 | 提议方案 | 预期 ROI |
|----------|----------|----------|
| **阶段 2 文献检索**:skill 文档未提及 DPR 工具 | `how-to-lit-review.md` §3 加:"用 `/libraries/` + Ingest 或 `--search-arxiv`" | 用户知道用什么工具 |
| **阶段 10 论文写作**:skill 未指明 `--compile-paper` | `writing-paper.md` §7 加:"用 `/agents/<sid>/compile/` 自动装配 LaTeX" | 减少手动排版工作 |
| **阶段 11 审稿**:skill 未指明假审稿入口 | `reviewer-mindset.md` §7 加:"用 `/agents/new-session/` 选 free_form 模板跑假审稿" | 训练审稿能力 |
| **docs/research-skills/ 无入口 README** | 新建 `docs/research-skills/README.md`:7 份文档简介 + 阶段映射 + 交叉引用 | 新人 30 秒找到方向 |

### P2(可选,锦上添花)

| 缺口位置 | 提议方案 | 预期 ROI |
|----------|----------|----------|
| **阶段 12 投稿**:无 skill 教投稿检查 | 新建 `research-skills/submission-checklist.md`:各会议 deadline/format/checklist | 减少因格式被拒 |
| **阶段 9 实验设计**:skill 未与 agents 对接 | `experiment-design.md` §3 加:"Design proposal 可被 Designer 消费" | 实验规划更结构化 |
| **Nature skill 与本地 skill 完全未对接** | 7 份文档每份加 1 行:"用 [Nature skill] 自动化执行" | 统一工具认知 |

---

## 4. skill 整合的具体行动方案

### 4.1 docs/research-skills/ 内部整合

**问题**:7 份文档互相引用但无统一入口,新人找不到入口。

**行动**:
1. ✅ **已落地(c4cfe4850)**: 新建 `docs/research-skills/README.md`(阶段映射 + 工具配合表 + 快速入口)
2. **下一批**: 在每份文档末尾「相关资源」节加双向链接

### 4.2 本地 skill ↔ Nature skill 对接

**问题**:Nature skills 存在但本地 skill 文档完全未提及。

**行动**(下一批): 在每份 skill 文档的「工具配合」节加一行:
- `how-to-read-paper.md` §7 → 加「用 `paper-analyze` 或 `paper-search` 自动化」
- `how-to-lit-review.md` §3 → 加「用 `nature-academic-search` 扩候选」
- `writing-paper.md` §7 → 加「用 `nature-writing` / `nature-polishing` 润色」
- `writing-rebuttal.md` → 加「用 `nature-response` 模拟审稿人」
- `writing-review.md` §5 → 加「用 `nature-citation` 检查引用」

### 4.3 本地 skill ↔ agents 闭环对接

**问题**:agents 闭环能跑但产出质量依赖 prompt,缺少 skill 文档作为 prompt 上下文。

**行动**(下一批):
1. `designer.ts` 入口注释加:
   ```typescript
   // Designer reads docs/research-skills/experiment-design.md as context
   // to generate well-structured experiment_plan proposals
   ```
2. `modifier.ts` 入口注释加:
   ```typescript
   // Modifier reads docs/research-skills/writing-paper.md §3-4
   // to produce publishable-quality drafts
   ```
3. CLI `--new-session` 输出加:
   ```
   💡 Tip: See docs/research-skills/ for methodology guidance
   ```

### 4.4 新增 skill 建议

**✅已落地(c4cfe4850)**: `docs/research-skills/defining-research-question.md`(阶段 0 补缺)

**下一批 P1**:`docs/research-skills/submission-checklist.md`
- 各会议 deadline 表格(ICLR/NeurIPS/ICML/ACL)
- camera-ready 检查清单
- conflict of interest 声明模板

---

## 5. 「彻底接管科研」的最终验证清单(15 条)

- [ ] 「我有一个研究主题」→ 系统能在 5 分钟内用 `--search-arxiv` 拉回 50 篇候选
- [ ] 「我读了 20 篇」→ 系统能从 20 篇论文自动抽取概念网络 + 跨论文主题分组
- [ ] 「我要从笔记变 idea」→ Designer 能消费 `defining-research-question.md` 模板生成结构化 proposal
- [ ] 「我要设计实验」→ 实验设计 skill 文档可直接被 Designer 引用,产出带 hypothesis/variables/setup 的 experiment_plan
- [ ] 「我要写论文」→ `--compile-paper` 能把 synthesis 组装成 LaTeX,9 个会议模板可选
- [ ] 「我要假审稿训练」→ `/agents/new-session/` free_form 模板能跑 reviewer agent,产出 5 维评分
- [ ] 「我要回应审稿人」→ `writing-rebuttal.md` skill + `reviser.ts` 能把 reviewer concern 变成 RevisionVerdict
- [ ] 「我要投稿」→ 有各会议最新 deadline 表格 + camera-ready 检查清单
- [ ] 「我要跨工具」→ 本地 skill 文档每份都指明用哪个 Nature skill 或 DPR 工具
- [ ] 「我是新人」→ 30 秒内能在 `docs/research-skills/README.md` 找到当前阶段对应的 skill
- [ ] 「我要监控进度」→ pipeline 7 stage 状态在 `/agents/<sid>/pipeline/` 可视化
- [ ] 「我要评估产出」→ `--evaluate` 能对 session 产出整体评分 + 4 子分 + gate histogram
- [ ] 「我要持续迭代」→ autonomous loop 能自动跑多轮,每轮 commit + push
- [ ] 「我要学过去经验」→ `--few-shot-from N` 能让新 session 学过去胜出的 proposal
- [ ] 「我要沉淀知识」→ 每次 Modifier deliverable 自动同步写 note 到 `/writing/`

---

## 6. 一句话总结

本次调研的核心结论:**「本地 7 份 skill 文档 + Nature 系统级 skills + agents 闭环三层 skill 已初步建成,但关键缺两层对接——(1) skill 文档未指向 DPR 工具/agents CLI,(2) agents Designer/Modifier 未消费 skill 文档作为 prompt 上下文,导致科研全流程在'概念化'和'执行化'之间断裂。」**

**ROI 最高的修复是 P0-1(建 defining-research-question.md) + P0-2(笔记同步) + P1-4(建 research-skills/README.md)**,三者加起来不到 2 小时工作量,可显著提升 DPR 作为「完整科研工作流平台」的端到端可操作性。

**本次(c4cfe4850)已落地** P1-4 + P0-1(部分)。其余 P0-2 / P1-1~3 / P2 留下一批。

---

**变更日志**
- 2026-09-14:首次建立(全流程整合调研)