# Research Skills Primer — 怎么写论文

> **面向:** Phase 2 末 - Phase 3 博士生
> **目标:** 1 篇 top venue submission,从 draft 到 camera-ready

---

## 1. 写论文的 5 阶段

| 阶段 | 产出 | 时长 | 关键问题 |
|------|------|------|---------|
| **Outline** | 5-7 个 section 的标题 + 每段 1 句话 | 1 周 | 我的核心 claim 是什么? |
| **First draft** | 完整 draft,自己读得通 | 2-3 周 | 我每段都在 claim 还是 evidence? |
| **Internal review** | 合作者 + advisor 提的 comment 全消化 | 2 周 | 谁能 1 遍读懂? |
| **R1 submission** | 提交 + 等审稿 | 1 周 + 等待 | 哪些 claim 我必须有 ablation? |
| **Rebuttal + revision** | 修 comment + resubmit | 1-2 月 | 哪些 comment 是可以 argue 的? |

---

## 2. Outline 怎么写

### 2.1 5-7 个 section 的标准结构

**8 页会议论文(典型):**

```
1. Abstract(150 词)
2. Introduction(1 页)
3. Related Work(0.5-1 页)
4. Method(2-2.5 页)
5. Experiments(2.5-3 页)
6. Conclusion + Limitations(0.5 页)
References + Appendix
```

**4 页 workshop paper:**

```
1. Abstract(100 词)
2. Introduction(0.5 页)
3. Method(1.5 页)
4. Experiments(1 页)
5. Conclusion(0.3 页)
References
```

### 2.2 Outline 阶段就回答这 5 个问题

填进 `/writing/`,type=`outline`:

1. **核心 claim 是什么?** 1 句话
2. **和 SOTA 比,差在哪?** 1 段
3. **我的方法核心组件是哪些?** bullet 列表
4. **实验要回答什么问题?** 3-5 个 bullet
5. **我的 limitation 是什么?** 3 个

Outline 没填这 5 条 = 别开始写 draft。

---

## 3. First draft 怎么写

### 3.1 第一原则:**先写完,再修**

- 给自己 2 周写完整 draft,**禁止**回头改
- 每天写 ≥ 1 个 section
- 写不出就跳过,标 `TODO`,最后再回

### 3.2 每段都在 claim / evidence 之一

每个 paragraph 必须满足两种之一:
- **Claim**:"Our method achieves SOTA on benchmark X" — 用 1 句话总结
- **Evidence**:具体数字 / 表格 / 引用支撑

❌ 没用段:
> "We tried multiple approaches. The first didn't work. The second was better. Finally we settled on the third."

✅ 该段:
> "We evaluated three variants (Table 4): replacing X with Y improved BLEU by +0.3 (95% CI: [0.2, 0.4]). We adopt Y in the final model."

### 3.3 Method section 怎么写

模板(每段 1 个组件):
```
<Component name>.<What it does in 1 sentence>.

We illustrate this in Figure 3: <description>.

Mathematically, we define this as:
<Equation 1>.<Brief intuition in plain English>.

Compared to prior work that does X (<citation>), our approach Y because Z.
```

### 3.4 Experiments section 怎么写

模板(每个表格 1 段):
```
<Main result table>. Table 1 shows our method achieves X.X BLEU on WMT14,
outperforming the best baseline by +0.4 points (p < 0.01).<Why this matters>.

<Ablation table>. To understand which components contribute, we ablate X,
Y, Z (Table 2). Removing X has the largest impact (-0.8 BLEU), confirming
that X is the key component.

<Failure cases>. Figure 5 shows our method fails on examples with Z
characteristic. We hypothesize this is because Y. We leave this for
future work.
```

---

## 4. Internal review 怎么消化

把 draft 发给 3 类读者:

| 读者 | 关注点 | 给 1-2 天 |
|------|--------|----------|
| **合作者** | 技术对不对 | 改细节 |
| **Advisor** | 故事清不清楚 | 改 framing |
| **方向外人**(同实验室其他方向) | 1 遍读懂? | 改术语 / 抽象度 |

每类人给 1-2 天,不要同时发(免得被一堆 comment 淹没)。

### Reviewer mindset 切到自己

把 draft 假装是别人投的,你自己审:
- ✍️ "The main contribution is unclear" — 重写 Introduction
- ✍️ "Why is the baseline Y not included?" — 补实验
- ✍️ "The notation in §4.2 is inconsistent" — 统一符号

---

## 5. Rebuttal 怎么写

审稿意见一般 3 类:

### 5.1 致命类(Must address)

"主要 claim 不成立" / "实验有 bug" / "对比不公平"

**应对**:必须做新实验 + 改文。**不要 argue**,argue 必死。

### 5.2 改进类(Should address)

"应加 baseline X" / "应做 ablation Y"

**应对**:尽量补。补不了要在 rebuttal 里清楚说明"为什么没补、是否影响结论"。

### 5.3 边界类(Nice to have)

"应讨论 limitation Z" / "应改表述 W"

**应对**:**反驳 + 解释**。这类意见通常 reviewer 没仔细想,你可以 argue。

### Rebuttal 结构

每个 reviewer comment 1 段:
```
We thank the reviewer for [1 句 positive acknowledgment].
[Quoted reviewer concern in italic]

Response:
- [Point 1]:<你的回答 2-3 句,带数字 if applicable>
- [Point 2]:<你的回答 2-3 句>
- (Optional) New experiment in §X.Y: <1 句话说明>

[Optional: brief concluding sentence about why this strengthens the paper]
```

**反驳语气**:感谢 + 给证据 + 不卑不亢。**不要怼 reviewer**。

---

## 6. 常见错误

- ❌ **Introduction 写 2 页** — Introduction 1 页,过 1.5 页 = 必有冗余
- ❌ **Method 用太多符号** — 每个符号首次出现都给 1 句直觉
- ❌ **Experiments 只报 main table** — 必报 ablation + failure case
- ❌ **不写 Limitations** — 现在不写 = reviewer 帮你写
- ❌ **References 不全** — 漏引 1 篇该方向核心 paper = 立刻被拒
- ❌ **Abstract 写 200+ 词** — 150 词上限,超 = 没重点

---

## 7. 用 DPR 工具

| 任务 | DPR 入口 |
|------|---------|
| Outline 起稿 | `/writing/`,type=`outline` |
| 论文草稿 | `/writing/`,type=`paper` |
| Sections 结构化编辑 | 单论文编辑器的 section 字段 |
| 引用图 | `/graph/<arxivId>/` |
| 自动 LaTeX 编译 | `/agents/<sid>/compile/`(把 synthesis 装成 paper) |
| 自动总结 | `/agents/new-session/`,选 `paper_draft` 模板 |

### `--compile-paper` 怎么用

到 Phase 3,你可以用 agents pipeline 把 round outputs 装成 1 篇 draft:
```bash
node astro-src/scripts/agents-run.mjs \
  --new-session "<你的 paper 题目>" \
  --rounds 5 --preset balanced
node astro-src/scripts/agents-run.mjs \
  --session <sid> --compile-paper \
  --latex-template acl
```

输出 `archive/<sid>/paper/`:
- `paper.md` —— Markdown 版
- `paper.tex` —— LaTeX 版(选 9 个会议模板之一)
- `refs.bib` —— 自动生成的 bib 文件

详见 [`docs/agents-workflow.md` §5.1](../agents-workflow.md)。

---

## 8. 检查清单

### Outline 完成

- [ ] 5-7 个 section,每段 1 句话
- [ ] 核心 claim 1 句话清晰
- [ ] Limitation 至少 3 条列出

### First draft 完成

- [ ] 每个 paragraph 都是 claim 或 evidence
- [ ] Method 每段 1 个组件
- [ ] Experiments 每个表格 1 段解释
- [ ] Limitations section 已写
- [ ] Abstract 150 词内
- [ ] References ≥ 30 篇

### 提交前

- [ ] 3 类读者各审过 1 遍
- [ ] 自己以 reviewer 视角审过
- [ ] LaTeX 编译过,无 warning
- [ ] PDF 不超页数限制
- [ ] Supplementary 完整
- [ ] Reproducibility checklist 填好(代码公开 + 数据公开 + 超参表)

---

## 9. 相关资源

- 怎么写 rebuttal: [`writing-rebuttal.md`](writing-rebuttal.md)
- 怎么写 review(给别人的 paper): [`writing-review.md`](writing-review.md)
- 怎么读 paper: [`how-to-read-paper.md`](how-to-read-paper.md)
- 实验设计: [`experiment-design.md`](experiment-design.md)
- Agents 写 paper: [`../agents-workflow.md`](../agents-workflow.md)
