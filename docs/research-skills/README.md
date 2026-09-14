---
name: research-skills-readme
description: 7 份本地 research skill 文档索引 — 按科研 12 阶段映射 + cross-link 关系
metadata:
  type: project
  date: 2026-09-14
---

# Research Skills 索引

> 7 份「方法论级」技能文档,按科研全流程阶段组织。每份文档都是 standalone 可读的,但有强烈依赖关系。

## 阶段映射(2026-09-14 整合)

| 阶段 | Skill 文档 | 目标产出 | 时长 |
|------|------------|----------|------|
| **0. 方向定位** | [`defining-research-question.md`](defining-research-question.md) | 1 句话 research question + 3 gap 维度 | 半天 |
| **1. 文献检索** | [`how-to-lit-review.md`](how-to-lit-review.md) | 30 分钟方向综述 | 1 个月 |
| **2. 论文速读** | [`how-to-read-paper.md`](how-to-read-paper.md) | 1 小时从 paper 拿到 80% value | 每次 1 小时 |
| **3. 实验设计** | [`experiment-design.md`](experiment-design.md) | 可直接投稿的 ablation | 1 周 |
| **4. 论文写作** | [`writing-paper.md`](writing-paper.md) | draft → camera-ready | 3 个月 |
| **5. 审稿应对** | [`writing-rebuttal.md`](writing-rebuttal.md) | reviewer concern → 修订 | 1 周 |
| **6. 同行审稿** | [`writing-review.md`](writing-review.md) + [`reviewer-mindset.md`](reviewer-mindset.md) | 1-2 天 review | 1-2 天/篇 |

## 文档依赖图

```
defining-research-question(0)
    ↓
how-to-lit-review(1)
    ↓
how-to-read-paper(2)
    ↓
experiment-design(3) ──→ writing-paper(4)
    ↓                       ↓
reviewer-mindset(6) ←─── writing-review(6)
    ↓                       ↓
writing-rebuttal(5) ←───────┘
```

## 快速入口

- [ ] **我刚读了一篇 paper** → [`how-to-read-paper.md`](how-to-read-paper.md) §3 三遍阅读法
- [ ] **我要做方向综述** → [`how-to-lit-review.md`](how-to-lit-review.md) §2 5 步法
- [ ] **我有一个新方向,但不知道研究问题怎么写** → [`defining-research-question.md`](defining-research-question.md) §2 三种 gap
- [ ] **我要开始设计 ablation** → [`experiment-design.md`](experiment-design.md) §3 5 元素模板
- [ ] **我要从 draft 到 camera-ready** → [`writing-paper.md`](writing-paper.md) §1 5 阶段表
- [ ] **我要写同行 review** → [`writing-review.md`](writing-review.md) §1 + [`reviewer-mindset.md`](reviewer-mindset.md) §1
- [ ] **我要回应审稿人** → [`writing-rebuttal.md`](writing-rebuttal.md) §1 4 段结构

## 工具配合(每份文档末尾都列出)

| Skill | DPR 内部工具 | Nature skill / agents |
|-------|---------------|----------------------|
| `how-to-read-paper.md` | `/libraries/` + `--search-arxiv` + `/papers/<id>/` | `paper-analyze`, `paper-search`, `nature-reader` |
| `how-to-lit-review.md` | `/libraries/<id>/` + Ingest | `nature-academic-search` |
| `experiment-design.md` | `/ideas/`` + `/experiments/<id>/` | agents Designer (consumes this as prompt) |
| `writing-paper.md` | `/writing/<id>/` + `--compile-paper` | `nature-writing`, `nature-polishing` |
| `writing-rebuttal.md` | `/agents/<sid>/rebuttal/` | `nature-response` + agents Reviser |
| `writing-review.md` | `/agents/new-session/` free_form 模板 | agents Reviewer + `nature-citation` |
| `reviewer-mindset.md` | `/agents/new-session/` reviewer role | — |

## 关联文档

- 顶层总览:[`docs/research-workflow.md`](../research-workflow.md)(6 模块)
- 闭环设计:[`docs/agents-workflow.md`](../agents-workflow.md)(3 智能体)
- 概念沉淀:[`docs/concepts-system.md`](../concepts-system.md)
- 入库标准:[`docs/library/inclusion-standard.md`](../library/inclusion-standard.md)
- 路径规范:[`docs/path-spec.md`](../path-spec.md)

## 历史

- 2026-09-14:首次建索引,7 份本地 skill + 阶段映射 + 工具配合表