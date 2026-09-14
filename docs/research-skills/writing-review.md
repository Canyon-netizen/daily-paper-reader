# Research Skills Primer — 怎么写 Review(给别人审稿)

> **面向:** Phase 3 - Phase 4 博士生
> **目标:** 1-2 天内写出 1 篇建设性 review,既能帮作者,也能训练自己

---

## 1. Reviewer 的 3 类身份

| 身份 | 任务 | 时长 |
|------|------|------|
| **External reviewer** | 给 1 篇 paper 写 1-2 页 review | 1-2 周 |
| **Area chair (AC)** | 协调 3-4 个 reviewer + 写 meta-review | 2-3 周 |
| **Senior PC (SPC)** | 监督 AC + 处理 desk reject | 3-4 周 |

**PhD 第 3 年起通常被邀 external reviewer**,**第 5 年起可能 AC**。
**Phase 4 假审稿训练**(`/agents/` + reviewer 画像)可以提前 1 年练。

---

## 2. Review 的 5 段结构

**总长 1-2 页(IEEE/ACM/AAAI 标准),不要超过。**

### 段 1 — Summary(0.25 页)

用 3-5 句话讲清楚:
- Paper 解决什么问题
- 用了什么方法
- 在哪些 benchmark / 什么场景下测
- 主要结论是什么

**这一段不是给作者看的,是给 AC / 其他 reviewer 看的**——帮他们快速 get 上下文。

### 段 2 — Strengths(0.25 页)

列 3-5 条。每条 1-2 句,**具体到段或表格编号**:
> "The experimental setup in §4.1 is thorough: 5 benchmarks + 3 seeds + clear ablation in Table 4."

不要写"论文写得清楚"这种空话——**每条都要可验证**。

### 段 3 — Weaknesses(0.75-1 页)

列 5-10 条,**按重要性降序**。每条:
- **Concern**:1 句话
- **Why it matters**:为什么这是问题
- **Suggested fix**:作者可以怎么做

格式:
> **W1. Missing comparison with [baseline X].** The paper claims SOTA on benchmark Y but does not include the recent work of [citation], which reports X.X on the same setup (Table 2 in their paper). This comparison would significantly strengthen the empirical claim. **Suggested fix**: Add [baseline X] to Table 1.

弱点的 3 类:
- **Major**:影响 acceptance 决定(方法 / 实验 / claim 有问题)
- **Minor**:不影响 acceptance,但应改(写作 / 符号 / 漏引)
- **Optional**:建议,改不改都行

每条 strengths/weaknesses 标 [Major] / [Minor] / [Optional]。

### 段 4 — Questions(0.25 页)

5-10 个开放问题,作者可以在 rebuttal 答:
- "在分布外数据上的表现如何?"
- "Table 3 的 baseline Y 的超参是怎么调的?"
- "图 5 的失败 case 是 cherry-picked 还是 random sample?"

**好的 questions**:
- ✅ 作者能答出来 → 揭示论文深度的工具
- ✅ 暴露作者可能没考虑的角度
- ✅ 给 rebuttal 提供抓手

**坏的 questions**:
- ❌ 作者答不出来(没数据) → 写成 weakness,不要写成 question
- ❌ 太开放(like "为什么用 deep learning") → 不 productive

### 段 5 — Recommendation + Confidence(3 行)

```
Recommendation: <accept / weak_accept / borderline / weak_reject / reject>
Confidence: <1-5 / 5>

Brief justification: [1-2 句话总结这次 recommendation 的核心]
```

**Recommendation 和 Confidence 永远在最后**,不要在第一段就下结论。

---

## 3. 评审 7 步法(用 1-2 周)

### Day 1 — 第一遍扫读(2 小时)

按"读 paper 三遍法"第一遍:
- Title + Abstract + Conclusion
- Section 标题扫读
- 5 张表/图扫读

读完做笔记:1 句话总结 paper。

### Day 2 — 第二遍精读(4-6 小时)

按"读 paper 三遍法"第二遍:
- Introduction 全文
- Methods 核心算法
- 关键表格细读
- Limitations / Future work

读完做笔记:10 条 strengths + 10 条 weaknesses + 5 条 questions。

### Day 3 — 第三遍审稿视角(4 小时)

按 reviewer 视角:
- 想"我会怎么 attack 这篇 paper 的 main claim"
- 想"我会问作者什么问题"
- 想"哪个实验我没看到"
- 想"哪个 baseline 该被包括"

### Day 4-5 — 写第一稿 review(4-6 小时)

按上面 5 段结构写,**别追求完美**,先写完。

### Day 6-7 — 冷却 + 重读(2 小时)

放下 1-2 天后回来重读:
- 哪些 weakness 太 harsh?
- 哪些 strength 太 weak?
- Question 是否真的 productive?

### Day 8 — 终稿(2 小时)

提交前最后检查:
- Recommendation 和 Confidence 是否一致
- 是否 1-2 页(没超)
- 格式是否符合 venue 要求

---

## 4. 推荐语气

### 4.1 3 类语气

| 类型 | 何时用 | 例 |
|------|--------|-----|
| **Appreciative** | 写得好的部分 | "The ablation study in Table 4 is particularly thorough and informative." |
| **Constructive** | 弱点 | "The paper would benefit from including [X]. The authors could address this by [Y]." |
| **Neutral** | 不确定的问题 | "It is unclear how the method scales to [Z]. Could the authors clarify?" |

### 4.2 避免

- ❌ **"The paper is wrong"** → ✅ **"The paper would benefit from clarifying [X]"**
- ❌ **"This is a known result"** → ✅ **"The connection to [prior work] should be made more explicit"**
- ❌ **"The experiments are not enough"** → ✅ **"Specific experiments that would strengthen the paper: [list]"**
- ❌ **"The writing is poor"** → ✅ **"Section 4 would benefit from clearer notation / motivation"**

---

## 5. 怎么在 DPR 里训练

### 假审稿(Phase 4)

进 `/agents/new-session/`,选 `free_form` 模板,goal:
```
对 archive/<sid>/ 里的 synthesis 做 simulated peer review。
按 reviewer 画像打分(5 维:methodological_soundness / novelty_vs_prior_art /
reproducibility / claim_calibration / clarity),对每个 claim 指出
"证据不足"或"baseline 缺失"。最后给 1 个 recommendation ∈
{accept, weak_accept, revise, weak_reject, reject}。
```

跑 1 轮看 LLM 怎么审——然后**你自己**写 1 份 review,对比差距。

### 真审稿

1. 你接到 review invitation → 接受前先看 paper title/abstract
2. **不要硬接受**——如果 paper 离你方向 > 1 个 sub-field 远,decline
3. 接受后按上面 7 步法跑
4. 提交 review 后,等 rebuttal
5. rebuttal 出来 → 重读 paper + review → 写最终 recommendation

详见 [`reviewer-mindset.md`](reviewer-mindset.md)。

---

## 6. 常见陷阱

- ❌ **审稿当学术攻击** — review 是 service,不是 kill
- ❌ **写 5 页** — 1-2 页上限,超 = reviewer 自己没总结
- ❌ **不给作者出路** — 每条 weakness 都要给 suggested fix
- ❌ **Recommendation 太早** — 不要第一段就 reject
- ❌ **漏引 / 漏 comparison 都不提** — 这是 major concern,别放过
- ❌ **自己没跑过类似实验就否定作者的实验** — 谨慎

---

## 7. 检查清单

提交 review 前:

- [ ] 5 段结构(Summary / Strengths / Weaknesses / Questions / Recommendation)
- [ ] 总长 1-2 页
- [ ] Strengths ≥ 3 条,每条具体到段/表
- [ ] Weaknesses ≥ 5 条,每条带 suggested fix
- [ ] Questions 5-10 条,作者能答
- [ ] Recommendation + Confidence 在最后
- [ ] 语气 constructive,无攻击性
- [ ] 自己重读 1 遍确认没拼写错误

---

## 8. 相关资源

- Reviewer mindset 详细: [`reviewer-mindset.md`](reviewer-mindset.md)
- 怎么读 paper: [`how-to-read-paper.md`](how-to-read-paper.md)
- 怎么写 rebuttal: [`writing-rebuttal.md`](writing-rebuttal.md)
- 怎么写 paper: [`writing-paper.md`](writing-paper.md)
