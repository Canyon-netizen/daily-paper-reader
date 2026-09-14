# 入坑博士生成长地图（PhD Journey Map）

> **面向:** 入门博士生(尤其是 ML / NLP / Agents / CV 等方向)
> **目标:** 用这个网站,沿着 4 个阶段从"看论文都晕"成长到"能独立审稿 + 主导方向"
> **更新:** 2026-09-14（新增,作为整个文件夹重塑的入口文档）

---

## 1. 一图看懂你的成长路径

```
入门(0-3 月)                打基础(3-12 月)            深入(1-3 年)              贡献(3+ 年)
─────────────────  ─────────────────────────  ─────────────────────  ─────────────────────
"什么是 attention?"  "我能复现一篇 SoTA"    "我有自己的 idea"      "我能审稿、能带人"
     │                       │                      │                      │
     ▼                       ▼                      ▼                      ▼
  📚 读综述              🛠 跑代码              💡 推方向               👀 审稿 + 主导
  看经典                 做 ablation            写 proposal             开 workshop
  跟课 + 笔记            选 anchor 库           建自己的库              收徒 + 协作
```

每个阶段都有 4 件事要学会用本站点做：

| 阶段 | 文献库（library） | 想法（idea） | 实验（experiment） | 写作（writing） |
|------|-----------------|-------------|------------------|----------------|
| 入门 | 建一个 `novice` 画像库,装 30 篇综述/经典 | 看完一篇就写 1 条 idea | 不强求,先看 `docs/research-skills/` | 不强求,先看论文模板 |
| 打基础 | 建 `expert` 画像库,只收 SoTA | idea → 实验的比例到 1/3 | 1 个 ablation + 1 个 baseline | 写 1 篇 workshop note |
| 深入 | 建多个库,按子方向划分 | 自己的 idea 库 ≥ 30 条 | 主导 3+ 实验 | 写 1 篇 top venue 草稿 |
| 贡献 | 公共库 + 私库 + 审稿库 | 反哺新生的 idea | 主导完整研究方向 | 带新人 + 开源 release |

---

## 2. 4 个阶段详解（点击进各阶段文档）

### 📍 Phase 1 — Orientation（0-3 个月）
[`phase-1-orientation.md`](phase-1-orientation.md)

> **你的问题:** "我连 attention 是啥都说不清,怎么读 paper?"
>
> **此阶段最该用的功能:**
> - 建 1 个 `audienceProfile: 'novice'` 库,只收综述 + 经典
> - 开启 site 顶部的"搜索"面板,先搜概念(`/concepts/`)
> - 看 `docs/research-skills/` 里的《如何读一篇论文》
>
> **不要做的事:**
> - 不要订阅每天 arXiv 全量 — 一天 200 篇,新人会被淹没
> - 不要硬啃 Top venue 论文 — 先看综述和教学型博客
> - 不要一上来就 LLM 全自动 ingest — `novice` 画像的 defaultThreshold=0.55 已经过宽松

### 📍 Phase 2 — Foundation（3-12 个月）
[`phase-2-foundation.md`](phase-2-foundation.md)

> **你的问题:** "我能读懂论文,但不知道哪个值得深挖"
>
> **此阶段最该用的功能:**
> - 把 `audienceProfile` 切到 `'expert'`,defaultThreshold 自动变 0.75
> - 给每个子方向建 1 个库（共 3-5 个）
> - 每个库加 3-5 篇 anchor paper（看 [`docs/library-architecture.md`](../library-architecture.md) §3.1）
> - 跑 1 个 ablation,完整走 idea → experiment → writing 闭环
>
> **不要做的事:**
> - 不要建太多库 — 库多了没人维护
> - 不要追求"全" — 选 3 个你愿意 talk 10 分钟的方向

### 📍 Phase 3 — Depth（1-3 年）
[`phase-3-depth.md`](phase-3-depth.md)

> **你的问题:** "我有自己的 idea,但不知道该不该 push"
>
> **此阶段最该用的功能:**
> - 把 idea 库当 research log 写,≥30 条
> - 用 3 agents pipeline（`/agents/new-session/`）做 idea 探索
> - 用 Project 工作区（`/projects/`）做"论文 → 阶段 → 草稿"的物理分组
> - 跨库 concept merge:用 `LibraryConceptOverride.canonicalSlug`
>
> **不要做的事:**
> - 不要把所有 idea 都变成 experiment — 90% 会失败
> - 不要跳过 writing 阶段 — 不写下来,idea 就不是真的

### 📍 Phase 4 — Contribution（3+ 年）
[`phase-4-contribution.md`](phase-4-contribution.md)

> **你的问题:** "我能写能审,但怎么带人？怎么反哺社区？"
>
> **此阶段最该用的功能:**
> - 给社区贡献公共库（`astro-src/lib/libraries.ts` 的 PR）
> - 用 `audienceProfile: 'reviewer'` 跑一个"假审稿"流水线
> - 把 `wiki/concepts/<slug>.md` 写好,成为他人入门的第一站
> - 在 `/agents/<sid>/pdf/` 出一份 synthesis 给合作者
>
> **不要做的事:**
> - 不要停止自己的 reading — 审稿人最容易犯的错是"我用 5 年前的视角审现在的 paper"

---

## 3. 如何选你的读者画像（audienceProfile）

每个用户库都可以挂一个 `audienceProfile`,这会改变 LLM 给你打分的方式。

| 你在… | 推荐 profile | 默认阈值 | 关键维度 |
|------|-------------|---------|---------|
| 入门 / 跨领域 | `novice` | 0.55 | 教学清晰度 / 奠基性 |
| 深耕 / 找 SoTA | `expert` | 0.75 | 新颖度 / 实验严谨度 |
| 审稿 / Area Chair | `reviewer` | 0.65 | 方法严谨度 / 相对新颖度 |
| 工业落地 | `practitioner` | 0.60 | 生产就绪 / 成本效率 |

详细评分维度见 [`docs/library/inclusion-standard.md`](../library/inclusion-standard.md)。

---

## 4. 跟着这个地图走 = 自动采集你的反馈

每次你做这些动作,系统都会自动收集一条 `dpr_library_feedback` 记录到 localStorage：

- 新建 / 删除库（`library_created` / `library_deleted`）
- 切换画像 / 调阈值（`library_profile_changed` / `library_threshold_changed`）
- 把候选论文 include / exclude（`paper_included` / `paper_excluded`）
- 标记"这篇不符合本库"（`paper_marked_irrelevant`）

这是为了让你 1 个月后能回头看："我作为 1 年级 PhD 时,经常 exclude 掉哪些 paper？" — 这些数据最终会反哺到 rubric 校准上（[`docs/library/inclusion-standard.md` §5](../library/inclusion-standard.md)）。

你可以随时在 `/settings/` 清空这些记录。

---

## 5. 站内地图（按角色重新组织的入口）

```
📚 论文 + 库（核心 80% 时间）
  ├── /  ← 首页日历
  ├── /papers/<id>/  ← 单论文精读
  ├── /libraries/  ← 公共主题库
  └── /libraries/<my-lib>/  ← 你自己的库（按画像打分）

💡 研究流程
  ├── /research/  ← 仪表盘（想法 / 实验 / 写作 / 路线图 一目了然）
  ├── /ideas/  ← 想法库
  ├── /experiments/  ← 实验记录
  ├── /writing/  ← 写作草稿
  └── /projects/  ← Project 工作区（论文按阶段分组）

🧠 概念与图谱
  ├── /concepts/  ← 概念列表
  ├── /wiki/concepts/<slug>/  ← 概念详情（带反向链接）
  └── /graph/<arxivId>/  ← 单论文引用图

🤖 Agents（深度探索，Phase 3+ 再玩）
  ├── /agents/  ← Agent 工作台
  ├── /agents/pipelines/  ← 7-stage 全流程
  └── /agents/<sid>/pdf/  ← Synthesis PDF 导出

⚙️ 设置
  └── /settings/  ← 主题 / LLM key / Gist 同步 / 反馈清空
```

---

## 6. 相关文档

- [`docs/research-skills/`](../research-skills/) — 研究技能 primer（怎么读 paper / 怎么做 lit review / 怎么写 rebuttal）
- [`docs/library/inclusion-standard.md`](../library/inclusion-standard.md) — 4 个画像的入库标准
- [`docs/library-architecture.md`](../library-architecture.md) — 文献库架构权威文档
- [`docs/onboarding/jump-in.md`](jump-in.md) — 10 分钟快速上手指南
