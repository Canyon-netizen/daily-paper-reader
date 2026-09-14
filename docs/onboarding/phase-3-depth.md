# Phase 3 — Depth（1-3 年）

> **你现在的画像:** 多个库混搭,主导 1 个方向
> **本阶段目标:** 有 1 篇 top venue 投稿,有 1 个反哺社区的 concept。

---

## 1. 这个阶段你已经能做什么

- 快速判断一篇论文是 novel / solid / overclaim
- 主导 1 个完整研究方向(从 idea 到 submission)
- 给同组同学讲清楚方向的来龙去脉
- 1 小时内写出 1 篇像样的实验报告

---

## 2. Project 工作区(`/projects/`)怎么用

到 Phase 3,你会有**多线并行的项目**——不再 1 个方向 1 个库,而是 1 个方向 1 个 Project,里面按阶段切。

```
Project: RL Exploration Robustness
├── Stage: Reading(已读,内化)
│   └── papers: [15 篇 anchor + recent]
├── Stage: Hypothesizing(假设待验证)
│   └── papers: [3 篇 baseline]
├── Stage: Implementing(在跑)
│   └── papers: [2 篇直接相关]
├── Stage: Writing(在写)
│   └── papers: [5 篇 Related Work]
└── Drafts:
    ├── ICML submission v3
    ├── Workshop note
    └── Blog post explaining it
```

每个 Project = 1 个 `UserLibrary` + `stages[]` + `drafts[]`(已在 [`docs/library-architecture.md`](../library-architecture.md) §3.2 提到)。

---

## 3. 你的 idea 库怎么管

Phase 2 末你有 15 条 idea,Phase 3 你会有 50+ 条。问题:**怎么不让自己淹没?**

### 三类 idea,三件事

| 类型 | 例子 | 处理 |
|------|------|------|
| **强信号**(实验已验证) | "X 在 Y 上 +12%" | → promote 进 Project,作为 submission 核心 claim |
| **弱信号**(只跑了 1 次) | "X 在 Y 上 +3%" | → 进 `archive/`,标"待复现" |
| **纯探索**(还没跑) | "如果把 X 套到 Z?" | → 进 idea 库,标 `seed`,1 个月后回来复审 |

### 30 天复审

每月最后 1 天,打开 idea 库,把 1 个月前的 `seed` 类 idea:
- 还感兴趣 → 升 `growing`
- 失去兴趣 → 升 `archived`
- 不确定 → 留 `seed`,再给 30 天

这条规矩是 Phase 3 最重要的习惯,不做 → 1 年后 idea 库 200 条垃圾。

---

## 4. 用 3 agents pipeline 做 idea 探索

到 Phase 3,**手工读 paper 已经不够用了**——你需要 LLM 帮你 digest 100 篇。

进 `/agents/new-session/`,选模板 `literature_review`:
- Goal: 填你最近 1 个月的 reading 主题
- Rounds: 3-5
- Preset: `balanced`

跑完后:
- `/agents/<sid>/export/` 看 markdown 总览
- `/agents/<sid>/pdf/` 一键出打印就绪 HTML
- 把 synthesis 里的关键洞见写回你的 idea 库

详见 [`docs/agents-workflow.md`](../agents-workflow.md)。

---

## 5. 反哺社区:写好 1 个 concept 页面

到 Phase 3,你应该**为 1 个核心概念写 wiki**:
- 进 `/wiki/concepts/<slug>/`
- 正文结构:
  1. 一句话定义
  2. 历史(谁最早提出)
  3. 主流变体(3-5 个,带对比表)
  4. 你的 sub-field 怎么用
  5. **反向链接**(自动生成,但你要核对)

为什么这值钱?因为这是别的 PhD 进你方向的"第一站"。写好一个概念页面 = 在社区立 flag。

---

## 6. 不要做的事

- ❌ **不要把 LLM 探索当主路径** — 它帮你 digest,不能帮你 think
- ❌ **不要追求所有 idea 都被验证** — 90% 该 archived,不要假装它"将来会做"
- ❌ **不要把 Project 工作区当 file storage** — stage 之间移动论文 = 真的改了 thinking
- ❌ **不要停止读 paper** — 现在不读,3 年后审稿看不懂
- ❌ **不要等到 "perfect" 才写** — 写下来才能改

---

## 7. 3 年后该有的产出

- [ ] 1 篇 top venue submission(accepted 或 reject+resubmit)
- [ ] ≥1 个 `/wiki/concepts/<slug>/` 你主笔的概念页
- [ ] ≥1 个贡献到 `/libraries/<id>/` 的公共库
- [ ] ≥3 个 Project 工作区(其中 1 个已完成,1 个在进行,1 个 backup)
- [ ] idea 库 ≥30 条 active,≤50 条 archived,0 条僵尸
- [ ] ≥1 次给同实验室 / 暑校的 talk(45 分钟讲清楚 1 个方向)

---

## 8. 切换到 Phase 4 的信号

- [ ] 你能审稿(给 top venue reviewer 写 1 页 review 不卡)
- [ ] 你能 1 小时内给 1 年级 PhD 讲清楚 1 个 open problem
- [ ] 你有 ≥1 个"我主导"的方向(不只是 follow 别人)
- [ ] 你开始有学生 / 实习生带

---

## 9. 资料推荐

- 3 agents 入门: [`docs/agents-workflow.md` §5](../agents-workflow.md)
- 怎么写 review: [`docs/research-skills/writing-review.md`](../research-skills/writing-review.md)
- Concept 系统: [`docs/concepts-system.md`](../concepts-system.md)
