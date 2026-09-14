# Plan: R7 Follow-up — 全流程整合 P1/P2 余量(2026-09-14)

> 本 plan 列出 R6 全流程整合(4 commit:`c4cfe4850` / `9296e6c1e` / `b210c6da9` / `9f1a8237a`)后剩余的 P1/P2 修复项,按 ROI 排序,提供实施步骤与验证清单。
>
> 用户可下一轮启动本 plan 的子集;若全部启动预计 2-4 小时工作量。

---

## 1. R6 已落地(本轮回顾)

| Commit | 关键变更 | 数值 |
|---|---|---|
| `c4cfe4850` | `docs/research-skills/README.md`(7 份 skill 索引)+ `defining-research-question.md`(阶段 0 补缺)+ `research-workflow.md` §关联技能文档 + `agents-workflow.md` §5.0(7 stage × 7 skill 映射) | 4 文件,203 行 |
| `9296e6c1e` | `astro-src/scripts/paper-backfill-categories.mjs`(启发式回填)+ 1152 篇论文 frontmatter categories | 1153 文件,9333 行 |
| `b210c6da9` | `docs/feedback/paper-retrieval-recovery.md`(22 天无新论文恢复手册)+ `docs/path-spec.md` §4.5(5 个新字段) | 2 文件,170 行 |
| `9f1a8237a` | `plans/full-pipeline-{skill,paper,folder}-audit-2026-09-14.md`(3 份调研报告) | 3 文件,481 行 |

## 2. 剩余 P1/P2(本 plan 覆盖范围)

### P0 — 必须(直接影响科研主流程)

#### P0-1: 老论文批量加 `related_ideas / related_experiments / related_writings` 字段

**问题**:schema 已加(b210c6da9),但 1152 篇老论文的 related_* 字段都空。LLM 推断每篇 1-3 条 cross-link,需要批量跑。

**实施**:
```bash
# 新建 astro-src/scripts/paper-backfill-crosslinks.mjs
# 1. 扫描 docs/papers/**/*.md,只处理 related_* 为空的
# 2. 取 title + tldr + abstract,调 LLM 推断 1-3 个相关 docs/ideas/*.md / docs/experiments/*.md / docs/writing/*.md 路径
# 3. 启发式 fallback:若 LLM 失败,从 tags 推断(同名 tag 命中)
# 4. regex 最小化写入 frontmatter(同 backfill-categories 思路)
```

**预估 ROI**: 极高 — 真正把 1152 篇论文接入 docs/ideas / docs/experiments / docs/writing 链路,跨模块搜索/聚合成为可能。

**预估成本**: LLM 调用 ≈ 1152 × $0.005 = $5-10(用低成本模型 + batch);启发式 fallback ≈ 0 成本覆盖 50% 论文。

---

#### P0-2: `agents Designer/Modifier` 实际注入 `research-skills/*.md` 作为 prompt 上下文

**问题**:文档层(c4cfe4850)已说明「Designer 应读 `experiment-design.md`」,但代码层 `designer.ts` 真正读取 skill 文档的逻辑还没写。

**实施**:
```bash
# 改 astro-src/scripts/agents/designer.ts:
# 1. 新增 stage 上下文读取函数 loadSkillContextForStage(stage)
# 2. 根据 stage(idle/ideation/literature/experiment/draft/review/revise)
#    读取对应 docs/research-skills/*.md 的内容(whole file or section)
# 3. 拼到 designer prompt 顶部,作为"方法论上下文"注入
# 4. 同时改 modifier.ts / reviser.ts / reviewer.ts,各自读对应 skill
```

**预估 ROI**: 高 — agents 闭环产出质量提升(从「通用 LLM」变「DPR 方法论驱动 LLM」)。

**预估成本**: 0(只是加几行 readFileSync + 字符串拼接);性能影响极小(skill 文档总大小 < 30KB)。

---

### P1 — 应该(影响效率)

#### P1-1: `scripts/audit-crosslinks.mjs` — 验证每篇论文至少有 1 个外链 OR `is_orphan: true`

**问题**:cross-link schema 已加,但没人验证 — 论文作者可能忘了填 related_*,导致 docs/ 各模块无法交叉发现。

**实施**:
```bash
# 新建 astro-src/scripts/audit-crosslinks.mjs
# 1. 扫 docs/papers/**/*.md
# 2. 每篇检查:
#    - related_ideas / related_experiments / related_writings 至少有 1 个非空
#    - 或 is_orphan: true
# 3. 失败论文 list 输出(可对接 GitHub Actions 失败告警)
# 4. CLI --fix 自动给空白论文加 is_orphan: true
```

**预估 ROI**: 中 — 让 cross-link schema 真正落地,不被遗忘。

---

#### P1-2: `scripts/mark-milestones.mjs` — 自动标记里程碑论文

**问题**:`is_milestone: true` 已加 schema,但没自动化 — 用户手填 1152 篇不可能。

**实施**:
```bash
# 新建 astro-src/scripts/mark-milestones.mjs
# 启发式:
# 1. arxiv citations > 100 → is_milestone: true(arxiv API semantic scholar)
# 2. venue == NeurIPS/ICML/ICLR + year <= 2024 + title 含 "first"/"novel"/"breakthrough" → 是
# 3. 用户手填白名单(doc/library/milestone-whitelist.md)→ 是
# 4. 其他默认 false
```

**预估 ROI**: 中 — 标 ~50-100 篇里程碑,UI 可加"⭐ 永久资产"筛选。

---

#### P1-3: `docs/research-skills/submission-checklist.md`

**问题**:P2 阶段 12 投稿无 skill 文档。

**实施**:新建 `docs/research-skills/submission-checklist.md`,包含:
- ICLR/NeurIPS/ICML/ACL/EMNLP/CVPR 6 个会议 deadline 表格(2026-2027)
- camera-ready 检查清单(8 项:页数/字体/参考文献格式/伦理声明/...)
- conflict of interest 声明模板
- OpenReview 提交步骤(每会议差异)

**预估 ROI**: 中 — 用户投稿前 1 份文档查完,避免低级错误被 desk reject。

---

### P2 — 可选(锦上添花)

#### P2-1: 老论文迁移到公共主题库

**问题**:library 公共主题库基于 `task:` / `method:` frontmatter 字段(已有,9296e6c1e 填过)。但目前 7 个 LIBRARIES 是配置文件 hardcode,没自动从论文派生。

**实施**:
```bash
# 新建 astro-src/scripts/regenerate-libraries-from-papers.mjs
# 1. 扫 docs/papers/**/*.md,按 task 聚合
# 2. 7 个 task 桶:rl / multi-agent / game-ai / llm-agent / reasoning / robotics / computer-vision
# 3. 每个桶生成 library seed 候选论文 ID
# 4. 更新 astro-src/lib/libraries.ts 自动派生 LIBRARIES
```

**预估 ROI**: 低 — 7 个 LIBRARIES 是 manual 配置,自动派生收益有限。

---

#### P2-2: `docs/roadmap/README.md`

**问题**:3 份 roadmap 完全未被引用,用户找不到。

**实施**:新建 `docs/roadmap/README.md` 总览,加到 `onboarding/jump-in.md` 引用。

**预估 ROI**: 低 — 锦上添花。

---

## 3. ROI 排序与建议执行顺序

按 ROI × 实施成本 排序,推荐 R7 执行序列:

| 顺序 | 项 | ROI | 成本 | 备注 |
|---|---|---|---|---|
| 1 | **P0-2** agents prompt 注入 skill 上下文 | 高 | 极低 | 代码改动 < 50 行 |
| 2 | **P1-1** audit-crosslinks.mjs 验证 | 中 | 低 | 让 P0-1 真正落地 |
| 3 | **P0-1** 老论文批量加 related_* | 极高 | 中(LLM 成本) | 配合 P1-1 形成闭环 |
| 4 | **P1-2** mark-milestones.mjs 推断 | 中 | 低 | 标 ~50-100 篇里程碑 |
| 5 | **P1-3** submission-checklist.md | 中 | 低 | 1 份静态文档 |
| 6 | **P2-1** library 自动派生 | 低 | 中 | 可选 |
| 7 | **P2-2** roadmap README | 低 | 极低 | 可选 |

**最小高 ROI 子集** = 1 + 2 + 3 = **P0-2 + P1-1 + P0-1**,约 3 小时工作量。

## 4. 实施步骤(若 R7 启动最小子集)

### Step 1: P0-2 — agents prompt 注入 skill 上下文(45 min)

1. 读 `astro-src/scripts/agents/designer.ts` 现有 prompt 拼装逻辑
2. 新增 `loadSkillContextForStage(stage)`,按 stage 读 `docs/research-skills/*.md` 对应文件
3. designer.ts 在 system prompt 拼接 `+ skillContext`
4. 同样改 `modifier.ts` / `reviser.ts` / `reviewer.ts`
5. 单元测试:跑 `--quickstart "test"`,检查 archive/<sid>/rounds/round_001.json 的 system prompt 是否含 skill 文档内容

### Step 2: P1-1 — audit-crosslinks.mjs 验证(30 min)

1. 新建 `astro-src/scripts/audit-crosslinks.mjs`
2. CLI:
   - `--check`: 列出缺 cross-link 的论文
   - `--fix`: 自动加 `is_orphan: true`
   - `--ci`: 失败时 exit code 1(供 GH Actions)
3. 输出格式:表格(arxiv-id, missing_field, suggested_fix)
4. 加到 `.github/workflows/ci.yml` 跑 --ci(确保新论文有 cross-link)

### Step 3: P0-1 — 老论文批量加 related_*(60-90 min,含 LLM 调用时间)

1. 新建 `astro-src/scripts/paper-backfill-crosslinks.mjs`
2. 启发式 + LLM 混合:先 tags 匹配同名 docs/ideas/*.md;LLM fallback 处理 tag 不命中的
3. 用本地 8124 代理(per memory `llm-proxy-8124-and-key-hiding`)
4. regex 最小化写入(同 backfill-categories 思路)
5. batch 1152 篇 — `--limit 5` dry-run 验证 → `--all` apply

## 5. 验证清单

R7 完成后,以下 10 条应全部 ✓:

- [ ] agents Designer 在 archive/<sid>/rounds/round_001.json 的 system prompt 包含 `experiment-design.md` 节选
- [ ] `audit-crosslinks.mjs --check` 输出 0 篇缺 cross-link(全部论文都有 related_* 或 is_orphan)
- [ ] `audit-crosslinks.mjs --ci` 在 GH Actions 跑通,新论文自动 fail 如果缺 cross-link
- [ ] `mark-milestones.mjs --apply` 输出 ~50-100 篇 is_milestone: true
- [ ] `submission-checklist.md` 含 ICLR/NeurIPS/ICML 6 会议 deadline 表格
- [ ] docs/audit 目录下存在 R7 plan(本 plan 落地为 PDF 或 markdown)
- [ ] agents Modifier 在 archive/<sid>/rounds/round_001.json 的 system prompt 包含 `writing-paper.md` 节选
- [ ] 老论文 frontmatter 含 `related_ideas / related_experiments / related_writings` 任一非空
- [ ] `/libraries/<id>/` UI 显示里程碑论文筛选(可选)
- [ ] docs/research-skills/README.md 快速入口被验证(30 秒内定位)

## 6. 风险与备选

| 风险 | 缓解 |
|---|---|
| agents 注入 skill 后 prompt 超过 LLM context window | skill 文档 30KB,远低于 200K context,无影响 |
| 老论文 LLM 推断 related_* 准确率低(< 50%) | 启发式 tags 匹配优先(0 成本,准确率 ~70%);LLM 仅 fallback |
| milestone 推断误报 | 白名单兜底(用户手填清单);自动仅给"suggestion",需 --apply 才写 |
| audit-crosslinks --fix 误加 is_orphan | 先 --check 输出预览,确认无误再 --fix |
| submission-checklist 过期 | 顶部加 "最后更新: 2026-09-14,有效期 6 个月" |

## 7. 一句话总结

R6 已闭环「论文时效性 + 质量 + 跨模块 schema + research-skills 整合」;R7 最小高 ROI 子集是 **P0-2(agents 注入 skill) + P1-1(audit-crosslinks) + P0-1(老论文加 related_*)**,约 3 小时工作量,可让科研全流程整合从「架构设计」推进到「端到端可操作」。

**本 plan 应在新一轮 loop(或用户手动启动)时执行**。

---

**变更日志**
- 2026-09-14:首次建立(R7 follow-up plan,基于 R6 全流程整合 audit)