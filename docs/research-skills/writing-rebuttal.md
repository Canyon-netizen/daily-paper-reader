# Research Skills Primer — 怎么写 Rebuttal(回应审稿人)

> **面向:** Phase 2 - Phase 4 博士生(自己投 paper 收到 reviews 后)
> **目标:** 1-2 周内把"reject 边缘"的 paper 拉回 accept,而不是和 reviewer 对骂

---

## 1. Rebuttal 的本质

**Rebuttal ≠ 反驳**。Re-but-tal 在学术语境是"重新打开讨论",不是"我要赢"。

| ❌ 错误认知 | ✅ 正确认知 |
|------|------|
| Reviewer 没懂我 → 我要解释清楚 | Reviewer 没懂我 → 我的写作让领域里 expert 都误解,这是 **我的问题** |
| Reviewer 错了 → 我要指出 | Reviewer 的角度我没 cover → rebuttal 给出新视角,作者赢 |
| Reviewer 太严 → 抱怨 | Reviewer 太严 → 用 data / experiment 解决他的 concern |
| Reject 不可接受 | Reject 是 reviewer 的判断,**不是世界末日**;rebuttal 是改变判断的最后机会 |

**核心原则**:Reviewer 是来帮你把 paper 改好的(即便他/她不是你导师)。**Rebuttal 是 listener-oriented writing**,不是 speaker-oriented。

---

## 2. Rebuttal 的 3 类格式(取决于 venue)

| Venue | 格式 | 时长 |
|------|------|------|
| **ICLR / NeurIPS 单盲** | 1 页 PDF,公开可见 | 1 周 |
| **ICML / ACL 双盲** | 1 页 text + 可选补充材料 | 1 周 |
| **期刊(TPAMI / IJCV)** | 自由长度,2-4 周 | 2-4 周 |

**ICLR/NeurIPS 1 页最难写**——比 paper 还难,因为每个字都要省。**下面主要讲 1 页 rebuttal 写法**。

---

## 3. Rebuttal 的 4 段结构

### 段 1 — Acknowledgement(2-3 行)

```
We thank all reviewers for their constructive comments. We address
each concern point-by-point below. Major changes:
- Added experiment on [dataset X] (Table R1)
- Refined theoretical analysis in §3 (Lemma 2)
- Added comparison with [baseline Y] (Table R2, Appendix)
```

**作用**:让 reviewer 知道"作者认真对待了" + 一眼看到改了啥。

### 段 2 — Point-by-point responses(N 行)

**每个 reviewer concern 编号**(R1.1, R1.2, R2.1, ...)。每条格式:

```
[Reviewer X.Y] <concern 一句话>
[Response]: <我们的回应>
[Change]: <paper 里加在哪 + 标红>
```

**3 个必备元素**:
1. **Quote reviewer**:把他的 concern 用 1 句话 quote 出来
2. **Give answer**:你做了什么 / 想了什么
3. **Point to change**:paper 里哪里改了(§X.Y / Table Z / Appendix A)

**没有 [Change] = 没改 = reviewer 会认为你在敷衍**。

### 段 3 — New experiments(0.5 页)

reviewer 要的实验你跑了 → **新表格** 加进来。

**关键**:新实验一定要和 reviewer 的 concern **直接对应**,不要跑无关实验凑数。

| 跑法 | 评价 |
|------|------|
| ✅ Reviewer 说"X baseline 缺失" → 加上 X 结果 | 命中 |
| ✅ Reviewer 说"out-of-distribution 测了吗" → 加 OOD 表 | 命中 |
| ❌ 加一个新 benchmark 但 reviewer 没要求 | 凑数,挤占宝贵 1 页空间 |

### 段 4 — Limitations / Future work(3-5 行)

承认 paper 还有 limitation,但指出 **bounded**:
```
We acknowledge that [limitation L] remains. Our method assumes
[condition C], which holds for [scenarios S] but not for [S'].
We discuss this in §6 and leave extension to future work.
```

**不要在 rebuttal 里吹** —— "我们的方法普适" 这种 reviewer 一眼识破。

---

## 4. 7 类 reviewer concern + 应对模板

### 4.1 "Missing baseline X"

> ❌ 差:"X is similar to Y, our comparison is sufficient."
> ✅ 好:"We have added X to Table 1 (shown in red). On benchmark B, our method achieves A vs X's A-1.2 (3% improvement). See §4.2 and Appendix C.1."

**原则**:补做实验 > 文字辩解。

### 4.2 "Theoretical analysis missing"

> ❌ 差:"Our method is intuitive; theoretical justification is beyond scope."
> ✅ 好:"We have added Lemma 1 (Appendix B) proving that [property P]. The proof relies on standard convexity; see Eq. (12)-(15)."

**原则**:补 1 个 lemma > 1 段空话。

### 4.3 "Experiments on small-scale dataset only"

> ❌ 差:"We will add larger-scale experiments in future work."
> ✅ 好:"We have run additional experiments on [large dataset L] (Table R2). Results show [trend T] consistent with our main claim. Implementation in Appendix D."

**原则**:跑 1 个新实验 > "future work"。

### 4.4 "Clarity / writing issues"

> ✅ 直接 ack + point to change:"We have thoroughly revised §3 to clarify the algorithm. The pseudocode in Algorithm 1 is now line-by-line annotated. See blue text in revised PDF."

### 4.5 "Reproducibility concerns"

> ✅ "Code at [anonymous URL], pretrained models at [URL]. Hyperparameters in Appendix E.1. All seeds (5) reported with std."

### 4.6 "Claim overreaches evidence"

> ❌ 差:"We believe our claim is valid."
> ✅ 好:"We agree; we have softened the claim in §1 from 'method M solves problem P' to 'method M advances the state-of-the-art on benchmarks B1-B3 by 3-7%'. See revised abstract."

**降 claim > 死守 claim**。降 claim 不丢人,死守被 reject 才丢人。

### 4.7 "Novelty insufficient"

> ⚠️ **最难改**。novelty 缺失 = 整 paper 的根基。
> - **如果 reviewer 错了**:quote 1-2 篇前人工作,逐条对比"我们不同在 X/Y/Z"
> - **如果 reviewer 对了**:承认 + 重新定位("Our contribution is [empirical study E] rather than [theoretical novelty N]")
> - **如果两条路都不通**:**降 claim + 改 framing**(可能从 contribution paper 变成 empirical study paper)

---

## 5. Tone 的 5 条铁律

1. **永远感谢**:每个 response 都以 "We thank the reviewer for..." 开头(1 行即可,不要堆 5 行)
2. **不要争对错**:用 "we have clarified/added/refined" 而不是 "we have proven the reviewer wrong"
3. **不要人身**:即便 reviewer 明显没懂,assume 他/她尽力了
4. **不要抱怨时长**:1 页限制下写不完 = 没抓到重点
5. **不要堆 emoji / "!"**:学术 rebuttal 不是社交媒体

**禁忌句式**:
- ❌ "The reviewer is mistaken."
- ❌ "This is a well-known result that we don't need to prove."
- ❌ "We strongly disagree."
- ❌ "All prior work has this issue too."

**推荐句式**:
- ✅ "We thank the reviewer for pointing this out."
- ✅ "We have added X in §Y (highlighted in blue)."
- ✅ "This is a great suggestion; we have addressed it by Z."
- ✅ "We agree that [concern C] is valid; we have refined..."

---

## 6. 时间表(1 周 rebuttal 的标准节奏)

| Day | 任务 | 输出 |
|------|------|------|
| Day 1 (收到) | 标红每个 reviewer concern, **不要立刻回**,先分类 | review matrix 表格 |
| Day 2 | 4 人 co-author 分 concern(谁答哪个) | 分工表 |
| Day 3-4 | 跑新实验(优先 reviewer 要的) | 新表格 + figure |
| Day 5 | 各人写自己负责的 response | 初稿 |
| Day 6 | 主笔人(通常是 1st author)合并 + 砍字到 1 页 | 第二稿 |
| Day 7 上午 | 全组 review + 最后一遍 proofread | final PDF |
| Day 7 晚 8 pm 前 | 提交(大多数 venue 截止是 deadline 当晚) | ✓ |

**最后 1 小时**:不要大改 —— 只修 typo + 重新检查 [Change] 标签对得上 paper。

---

## 7. 怎么在 DPR 里训练

### 假 rebuttal(Phase 3+)

进 `/agents/new-session/`,选 `free_form` 模板,goal:
```
你是一篇投到 ICLR 2026 的 paper 作者。reviews 已经收到,
包含 3 个 reviewer 的 12 个 concerns。请扮演 "作者",为每个 concern
写 1-2 段 rebuttal response,包括:
- Quote reviewer concern
- Your response
- Where you change in the paper (§X.Y, Table Z, Appendix A)
约束:总长 ≤ 1 页 PDF,语气 constructive,不要辩解。
```

跑完对比你和真实作者写的 rebuttal(如果你投过的话),**第 1 次跑会让你意识到 1 页的限制多狠**。

### 真 rebuttal

按 §6 时间表跑。**Day 1 不要立刻写** —— 你需要时间从"被批评"的冲击中恢复。Phase 2 博士生最容易在这一步情绪化。

---

## 8. 常见陷阱

- ❌ **逐条反驳(没有 [Change])** — reviewer 看不到 paper 改了 = 当作没改
- ❌ **新实验跑完没更新 paper** — 加了 Table R1 但没在 §4.2 引用 = 浪费 1 页空间
- ❌ **字数爆了** — 1 页塞不下 = 你没抓重点,砍掉 30% 还说同样事
- ❌ **过早提交** — 留 2-3 小时 buffer,deadline 当天网络/系统会爆
- ❌ **没标红 paper** — 改完不标红 = reviewer 找不到改动
- ❌ **个人色彩** — "I think..." 改成 "We have...";author 群是 1 个 entity
- ❌ **rebuttal 当作正式 paper** — 1 页里塞太多 cite / 太多 notation

---

## 9. 检查清单

提交 rebuttal 前:

- [ ] 每条 reviewer concern 都回应了,**无遗漏**
- [ ] 每条 response 都有 [Change] + paper 里 §/Table/Figure 标红
- [ ] 总长 ≤ 1 页(I CLR / NeurIPS)
- [ ] 语气 constructive,无 "the reviewer is mistaken" 类句式
- [ ] 每个 author 都看过一遍
- [ ] 拼写、引用、表格编号都对得上
- [ ] 至少留 2 小时 buffer(deadline 前)
- [ ] 提交后备份 PDF + raw text

---

## 10. 如果最终被 reject

**这是常态,不是失败**。ICLR accept rate ~25%,NeurIPS ~26%。即便是 senior 教授 1 投就中的 paper 也是少数。

**下一步**:
1. 读 meta-review,看 AC 怎么总结
2. 把 reviewer concerns 整理成"改进 list"——即便 reject 了,reviewer 的建议是免费的
3. 改完投下一个 venue(arxiv 不用动,改 paper)
4. 6 个月后再看:80% 的 reject paper 经过 1-2 轮 review 都达到了 accept 标准

**记住**: NeurIPS 2018 的 BERT、ICLR 2020 的 GPT-3 都被 reject 过(后来以更完整版重投接收)。**Rejection ≠ End**。

---

## 11. 相关资源

- 怎么写 paper: [`writing-paper.md`](writing-paper.md)
- 怎么写 review: [`writing-review.md`](writing-review.md)
- 怎么审稿(心态): [`reviewer-mindset.md`](reviewer-mindset.md)
- 实验设计: [`experiment-design.md`](experiment-design.md)
- 怎么读 paper(理解 reviewer 的视角): [`how-to-read-paper.md`](how-to-read-paper.md)
