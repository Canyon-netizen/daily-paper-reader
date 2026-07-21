# PR Plans — daily-paper-reader 增量能力迁移

> **目的**：把 [plans/polaris-absorption.md](../polaris-absorption.md)（7 个能力章节，1472 行）和 [plans/deepdive-feature.md](../deepdive-feature.md)（1 个独立能力，468 行）拆分为可串行/并行的 8 个 PR，每个 PR 一份独立 plan。
>
> **状态**：8 份 plan 全部写完，等待用户审核开工顺序。
> **生成时间**：2026-07-21

---

## 8 个 PR 概览

| PR | 名称 | 来源 | 依赖 | 优先级 | 预估 | 推荐开工 |
|----|------|------|------|--------|------|---------|
| **PR-A** | [Deep Dive v1（浏览器侧长文精读）](pr-a-deepdive.md) | deepdive-feature.md | 无 | **高** | 3 天 | **立即** |
| **PR-1** | [Pipeline Checkpoint 骨架](pr-1-pipeline-checkpoint.md) | polaris-absorption.md 能力 1 | 无 | 中 | 1 周 | **立即**（可与 PR-A 并行） |
| **PR-2** | [Sextant Validate（6 维确定性核查）](pr-2-validate.md) | polaris-absorption.md 能力 2 | PR-1 | 中 | 1.5 周 | PR-1 后 |
| **PR-3** | [LLM Stage Routing 雏形](pr-3-stage-router.md) | polaris-absorption.md 能力 7 | 无 | **高** | 1.5 周 | **立即**（可与 PR-1 并行） |
| **PR-4** | [Prompt Pack 1.0](pr-4-prompt-pack.md) | polaris-absorption.md 能力 3 | PR-3 | 中 | 1.5-2 周 | PR-3 后 |
| **PR-5** | [Concept Backlinks v1](pr-5-concept-backlinks.md) | polaris-absorption.md 能力 4 | PR-4 | 中 | 2 周 | PR-4 后 |
| **PR-6** | [Topic v2 辩论 stage](pr-6-topic-v2.md) | polaris-absorption.md 能力 5 | PR-4 | **低** | 2.5 周 | **暂缓**（单用户边际收益低） |
| **PR-7** | [Citation Guard](pr-7-citation-guard.md) | polaris-absorption.md 能力 6 | PR-5 | 中 | 2 周 | PR-5 后 |

**总时间估算**：约 12 周（4 人月）
**总 LOC 估算**：~6500 行（Python ~3200 + TS ~2700 + 配置/文档/测试 ~600）

---

## 推荐开工顺序（最少阻力路径）

### Wave 1（立即并行，零依赖）

| 并行 | PR | 理由 |
|------|----|------|
| 独立 | **PR-A** | 用户已选 A，可立即看到效果 |
| 独立 | **PR-1** | checkpoint 雏形，零破坏 |
| 独立 | **PR-3** | stage router，零破坏（吸掉 `resolve_summary_step_env` 旁路） |

**Wave 1 总工时**：~3.5 周（3 PR 并行）—— 立即收益，零破坏。

### Wave 2（Wave 1 完成后）

| 串行 | PR | 依赖 |
|------|----|------|
| 1 | **PR-2** | 依赖 PR-1（verdict 写进 checkpoint） |
| 2 | **PR-4** | 依赖 PR-3（路由生效后 pack 才有意义） |

**Wave 2 总工时**：~3 周（PR-2 与 PR-4 可并行）

### Wave 3（Wave 2 完成后）

| 串行 | PR | 依赖 |
|------|----|------|
| 1 | **PR-5** | 依赖 PR-4（doc.generate 阶段才有 LLM 可调） |
| 2 | **PR-7** | 依赖 PR-5（需要 concept graph） |

**Wave 3 总工时**：~4 周（PR-5 与 PR-7 可部分并行——PR-7 的 CLI 部分可不依赖 PR-5）

### Wave 4（可选）

| 串行 | PR | 备注 |
|------|----|------|
| 1 | **PR-6** | 计划文档明确建议「暂缓」——成本高、边际收益需 PR-4 成熟后再评估 |

---

## 依赖图（ASCII）

```
                ┌── PR-A Deep Dive v1 (独立, 立即)
                │
PR-1 Checkpoint ──┐
PR-2 Validate  ──┤
PR-3 Stage Router ──┐
PR-4 Prompt Pack ───┤   <-- 与 PR-A 在 paper-analyzer.ts:1176/1496 同一文件
                   │       必须 PR-3 先,再 PR-A v2; 或 v1 先 hardcoded,v2 再注入
PR-5 Concept ────┤
PR-6 Topic v2 ───┤
PR-7 Citation ───┘
```

---

## 每个 PR 的内部结构

每份 plan 文档（[pr-a-deepdive.md](pr-a-deepdive.md) 等）严格按 13 节模板：

1. **目标** — 一段话讲清楚解决什么问题、用户能看到什么变化
2. **设计原则** — 1-5 条约束
3. **改动清单** — 新增 / 改动文件清单（含行数估算）
4. **JSON 数据形态** — 每个新落盘文件的 schema 样例（无则省略）
5. **配置开关** — `config.yaml` / `config.user.yaml` 新增字段
6. **核心 API / 算法** — 主要函数签名 + 关键代码片段
7. **复用已有能力** — 避免重复造轮子
8. **与 Polaris 的差异** — 逐字段对照
9. **测试方案** — 手工 + 单测 case
10. **风险与回滚** — 严重度 + 缓解 + 回滚
11. **验收清单** — checkbox list
12. **Effort 估算** — 工作项 + 工时

---

## 不吸收清单（明确排除）

来自 [polaris-absorption.md](../polaris-absorption.md)「不吸收清单」章节（共 9 项）：

- ❌ 多用户 / RBAC / `project_members`
- ❌ SSH Experiment Lab / GPU 调度
- ❌ Yjs CRDT 协同编辑
- ❌ WebSocket / SSE 长连接
- ❌ Voyage 阶段化 UI（Navigator 面板 / Sextant 红绿灯）
- ❌ MCP Tool Registry（26 工具）
- ❌ Plan 动态插入（`engine.py:765-837`）
- ❌ Human gate（`engine.py:422-489`）
- ❌ Backfill Concept Definition 批 LLM（`concepts.py:250-401`）

**理由**：DPR 是单用户零服务器哲学，引入任何一项都破。

---

## TL;DR for maintainer

1. **先做什么**：**PR-A**（Deep Dive，用户已选）+ **PR-1**（Checkpoint 雏形）+ **PR-3**（Stage Router 雏形）——三个**零破坏、纯增量、立刻收益**，可并行 3.5 周
2. **接着做**：PR-2（Sextant 6 维）+ PR-4（Prompt Pack）——约 3 周
3. **然后做**：PR-5（Concept Backlinks）+ PR-7（Citation Guard）——约 4 周
4. **暂缓**：PR-6（Topic v2 辩论）——成本高、收益对单用户边际、需 PR-4 成熟后再评估

---

## 用户视角汇总（每个 PR 完成后用户能看到什么）

| PR | 用户视角变化 |
|----|-------------|
| **PR-A** | 速读卡片下多「📖 生成长文精读」按钮 → 8 章节中文长文（不写盘） |
| **PR-1** | cron 中途 kill 不浪费 LLM 配额；断点续跑 |
| **PR-2** | docs 顶部偶现 `> ⚠️ Step X 验收未通过` 提示（默认 disabled） |
| **PR-3** | 速读用 deepseek、精读用 MiniMax-M3；`archive/llm_usage_<YYYY-MM>.jsonl` 累计 |
| **PR-4** | 改会议风格换 pack（`nips-style:2026-07-15`）不 fork 代码；Gist 同步 |
| **PR-5** | 多 `/concepts` 页面：概念网格 + 出处论文 + 反向链接（Obsidian 可渲染） |
| **PR-6** | Topic 模式多「开启辩论排序」开关；可视化 Elo 排行榜 |
| **PR-7** | Deep Dive 顶部偶现 `> ⚠️ 1 处引用未通过核查`；`/papers/<id>/citations` 报告页 |

---

## 下一步

1. **审核 PR-A plan**：[pr-a-deepdive.md](pr-a-deepdive.md) — 用户已在 deepdive-feature.md 选 A
2. **审核 PR-1 plan**：[pr-1-pipeline-checkpoint.md](pr-1-pipeline-checkpoint.md)
3. **审核 PR-3 plan**：[pr-3-stage-router.md](pr-3-stage-router.md)
4. 三个都 OK 后 → 按 Wave 1 并行开工
5. Wave 1 完成后 → Wave 2 / 3

如果想**调整开工顺序**（比如先做 PR-5 不做 PR-3），告诉我，我会重排依赖图。