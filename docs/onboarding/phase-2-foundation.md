# Phase 2 — Foundation（3-12 个月）

> **你现在的画像:** 深耕专家（`audienceProfile: 'expert'`）+ 入门小白（保留 1 个 novice 库）
> **本阶段目标:** 选准 3 个子方向,跑通 1 个 ablation,有 1 篇可发的 workshop note。

---

## 1. 这个阶段最该解决的事

Phase 1 你在"广撒网",Phase 2 你该**收网**：
- 选 3 个你愿意 talk 10 分钟的子方向
- 每个方向 1 个库（`expert` 画像,defaultThreshold=0.75）
- 跑 1 个完整的 idea → experiment → writing 闭环

---

## 2. 你的 3 个子方向库

| 字段 | 推荐配置 |
|------|---------|
| 名称 | `<你的方向名>:<子方向>`,例如 `RL:exploration` |
| 描述 | 1 句话说清"这个库关心什么问题" |
| 读者画像 | **深耕专家** |
| 关键词 | 10-20 个,包括方法名、benchmark 名、术语 |
| 排除关键词 | 你方向外但 arXiv 容易串进来的词 |
| 阈值 | 用画像默认 0.75,觉得太松再调到 0.8 |
| Anchor | 5-10 篇你认定的"必读" |

**为什么要切到 `expert` 画像?**

| 维度 | novice | expert | 这个阶段你更需要… |
|------|--------|--------|------------------|
| 新颖度 | 0 | 0.30 | **要新颖** |
| 实验严谨度 | 0 | 0.20 | **要严格 ablation** |
| 教学清晰度 | 0.30 | 0 | 不再需要"教学型" |
| 阈值 | 0.55 | 0.75 | 拒绝掉 SoTA-chasing 的废纸 |

完整维度对照: [`docs/library/inclusion-standard.md` §2](../library/inclusion-standard.md)

---

## 3. 1 个完整实验的最小闭环

### Step 1 — Idea 起

进 `/ideas/`,新建 1 条 idea:
- 标题:`<某个具体 ablation>`
- 描述(放 hypothesis):"如果我们把 X 换成 Y,在 benchmark Z 上,会看到 metric M 提升 ~15%"
- 关联论文:`<你想复现/改进的 2-3 篇>`
- 标签:`ablation` / `reproducibility` / 你的方向名
- 状态:`seed`(刚发芽)→ 2 周后变 `growing` → 1 个月后变 `mature`

### Step 2 — Experiment 设计

从 mature idea → 进 `/experiments/` 新建实验：
- **Hypothesis** 直接从 idea 拷
- **Method** 写"我会怎么改 X",1-2 段就够
- **Variables**:
  - independent:`X 怎么变`
  - dependent:`M 怎么测`
  - controlled:`其它不动的东西`
- **Expected results**:1-2 段,**带数字**
- **Status**:`planning`(你写完方案)

### Step 3 — Writing 留痕

实验开始那一刻,进 `/writing/`,type=`note`,建 1 篇"实验日志":
- 标题:`<日期> <实验名> 进展`
- 状态:`draft`
- 每跑完 1 个 epoch 回来补 1 节

### Step 4 — 关闭闭环

实验跑完,无论成败:
- 进 `/experiments/<id>/`,填 `actualResults`,状态改 `completed` 或 `failed`
- 在 `/writing/` 里那篇 note 末尾加 1 节"结论 + 下一步"
- 把结果**写回 idea 库**:`promoted`(idea 已被验证)或 `archived`(idea 失败,但有数据)

---

## 4. Workshop note 怎么写

到 Phase 2 末,你应该有 1 篇 workshop note(4 页)。结构:

```
1. Abstract(150 词)
   - 你的 hypothesis
   - 你做了什么
   - 你的数字

2. Introduction(1 页)
   - 为什么这个 hypothesis 重要
   - 别人做过什么,差在哪

3. Method(1.5 页)
   - 你的改动是什么
   - 为什么这么改

4. Experiments(1 页)
   - 表格 1:主要结果
   - 表格 2:ablation
   - 1 个 case study

5. Limitations(0.3 页)
   - 你知道但没解决的 3 件事
```

DPR 已经把 sections 结构写在 `/writing/` 的 template 里 —— 直接套。

---

## 5. 不要做的事

- ❌ **不要建超过 5 个库** — 你维护不过来
- ❌ **不要跑超过 3 个并行实验** — PhD 第 1 年并行超过 3 个 = 全都跑不完
- ❌ **不要追 Top venue 短期热度** — 你的 workshop note 比 NeurIPS rejected 强 100 倍
- ❌ **不要相信 LLM 给你的 idea** — 它给的 idea 95% 是"已发表的组合",不 novel
- ❌ **不要停止 Reading** — 实验期最容易断 paper reading,2 周不读就掉队

---

## 6. 1 年后该有的产出

- [ ] 3 个 `expert` 画像库,各 15-30 篇
- [ ] 1 个 `novice` 库保留(给同实验室新人用)
- [ ] ≥15 条 idea(5 条 mature,2 条 promoted)
- [ ] ≥3 个实验(1 completed,1 failed 但有数据,1 running)
- [ ] 1 篇 workshop note(或 workshop submission)
- [ ] 1 个"我对这个子方向的 3 句话总结"(能讲给外行)

---

## 7. 切换到 Phase 3 的信号

- [ ] 你能在 10 分钟内给 senior PhD 讲清楚"这方向的 3 个 open problem"
- [ ] 你的实验**失败也能讲出意义**(不是"跑挂了")
- [ ] 你能用 1 段话说"这个方向的 limitation / 别人都没做"
- [ ] 你开始有"自己的 idea"(不只是综述里抄的)
- [ ] 你的 writing 草稿能让合作者 1 遍读懂

---

## 8. 资料推荐

- 实验设计: [`docs/research-skills/experiment-design.md`](../research-skills/experiment-design.md)
- 写 rebuttal: [`docs/research-skills/writing-rebuttal.md`](../research-skills/writing-rebuttal.md)
- Project 工作区: `/projects/` —— Phase 3 才用
