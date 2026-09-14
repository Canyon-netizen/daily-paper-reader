# Research Skills Primer — 怎么做文献综述

> **面向:** Phase 1 末 - Phase 2 博士生
> **目标:** 1 个月内做出一份能讲 30 分钟的方向综述

---

## 1. 综述的 4 类（你要做的是哪种？）

| 类型 | 长度 | 受众 | 何时做 |
|------|------|------|--------|
| **背景综述**（Background lit review）| 1-3 页 | 论文 Related Work section | 写论文前 |
| **课堂综述**（Coursework） | 5-10 页 | 同班同学 / 自己内化 | Phase 1 末 |
| **方向综述**（Field survey） | 20-50 页 | 同领域 PhD / 暑校 talk | Phase 2 末 - Phase 3 |
| **Systematic review**（Meta-analysis 风格） | 50+ 页 | 期刊 | Phase 4+ |

**PhD 第 1 年该做的是"课堂综述"** —— 5-10 页,讲清楚方向 3-5 个核心问题,够用。

---

## 2. 综述的 5 步法

### Step 1 — 定义问题（半天）

用 1 段话回答：
- **我在综述什么?** 例:`reinforcement learning 中 exploration 的样本效率`
- **为什么现在做?** 例:`因为 2023-2025 出现了 X 类新方法,但缺统一对比`
- **谁会读?** 例:`我自己 + 同实验室 + 暑校 talk`

写 1 段到 `/ideas/`,type=`research_log`,标 `seed`。

---

### Step 2 — 找 anchor（1 周）

- 在 `/libraries/` 新建 1 个库,画像 `novice`(因为现在你在学),阈值 0.55
- 跑 Ingest,筛 30-50 篇
- 找 5-10 篇你"反复看到被引"的 = anchor
- 把 anchor 加进库的 `anchors` 字段

---

### Step 3 — 分类法（1 周）

读 anchor 论文的 Related Work,你需要总结出**分类轴**。

常见分类轴：
- 按**问题**(e.g. sparse reward / dense reward / curiosity-driven)
- 按**方法**(e.g. intrinsic reward / count-based / information-theoretic)
- 按**假设**(e.g. tabular / function approximation / multi-agent)
- 按**时间**(e.g. 2018-2020 / 2021-2023 / 2024+)

**最少 2 个分类轴**——单轴分类 = 学生作业,双轴 = 论文级。

写 1 段到 `/writing/`,type=`note`,标题"分类法 v1"。

---

### Step 4 — 填表（2-3 周）

建 1 张总表(Markdown 表 or Excel),行 = paper,列 = 你的分类轴 + 关键数字。

```
| Paper | Problem setting | Method family | Sample efficiency gain | Reproducible |
|---|---|---|---|---|
| Paper A | sparse | intrinsic | +20% | yes |
| Paper B | dense | curiosity | +15% | no |
| ... |
```

**最低 30 行**。表没填满 = 综述没做完。

---

### Step 5 — 写正文（1 周）

5-10 页综述结构：

```
1. 引言(1 页)
   - 这个方向是什么
   - 为什么现在做综述
   - 我们的分类法和别人的有什么不同

2. 背景(0.5 页)
   - 5 个核心术语定义

3. 分类法(2-3 页)
   - 你的双轴分类
   - 每类 2-3 个代表工作 + 关键数字

4. 趋势(1 页)
   - 时间线上的演化
   - 现在热点

5. Open Problems(1 页)
   - 3-5 个还没解决的问题
   - 每个 1 段,带"为什么这是 problem"

6. 结论(0.5 页)
   - 1 段总结
   - 给"刚入门者"的学习路径建议
```

---

## 3. 用 DPR 工具加速

| 任务 | 用什么 |
|------|--------|
| 找 anchor | `/libraries/` + 跑 Ingest |
| 找趋势 | `/concepts/` + 时间过滤 |
| 找最新热点 | 首页日历 → 最近 1 周 |
| 跨论文对比 | `/papers/compare/?ids=...` |
| 自动汇总 | `/agents/new-session/`,模板 `literature_review` |
| 写笔记 | `/writing/`,type=`note` |

**3 agents pipeline 怎么跑综述**:

```bash
node astro-src/scripts/agents-run.mjs \
  --new-session "RL exploration 综述" \
  --rounds 3 --preset balanced \
  --search-arxiv "exploration reinforcement learning"
```

跑完看 `/agents/<sid>/export/`,把 synthesis 的关键洞见写回综述 §5(Open Problems)。

---

## 4. 反模式

- ❌ **A-Z 罗列论文** — 没分类 = 没综述
- ❌ **复述 abstract** — 你应该提"它解决什么 gap",不是"它做什么"
- ❌ **没有"自己的判断"** — 综述 = 别人工作的总结 + 你的 framing
- ❌ **写"未来工作"时只引 1-2 个方向** — 至少 3 个 open problem
- ❌ **没填表就写** — 表是综述的骨架,先表后文

---

## 5. 检查清单

写完后自检：

- [ ] 有清晰的分类轴(双轴)
- [ ] 每类至少 2 个代表工作 + 数字
- [ ] 有"open problems"section(至少 3 个)
- [ ] 引言明确说"我们和之前综述 X 有什么不同"
- [ ] 总表 ≥ 30 行
- [ ] 给 1 个同方向硕士读,5 分钟内能复述你的分类法

---

## 6. 相关资源

- 读 paper: [`how-to-read-paper.md`](how-to-read-paper.md)
- 实验设计: [`experiment-design.md`](experiment-design.md)
- Concept 系统: [`../concepts-system.md`](../concepts-system.md)
- PhD 旅程: [`../onboarding/phd-journey.md`](../onboarding/phd-journey.md)
