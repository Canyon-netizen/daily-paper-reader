# Research Skills Primer — Reviewer Mindset(审稿心态)

> **面向:** Phase 3 - Phase 4 博士生(被邀请审稿时)
> **目标:** 写一份**对作者有用、对学术社区有用、对你自己成长有用**的 review

---

## 1. Reviewer 的 3 个身份层

审稿时你同时扮演 3 个角色,缺一不可:

| 角色 | 任务 | 不做会怎样 |
|------|------|------|
| **作者守护者** | 找 paper 里**没被讲清楚**的闪光点,要求 author 加进去 | 优秀 paper 因为 reviewer 没看见价值而被 reject |
| **学术社区守门员** | 找 method / experiment / claim 里的**真实问题** | 烂 paper 进入 literature,浪费读者时间 |
| **未来读者** | 想象 5 年后读这篇 paper 的人会困惑什么 | paper 进入 literature 但**没法 reproduce**,成为僵尸引 |

**真正的 review** = 三者平衡。**只当守门员 → 你是 killjoy;只当守护者 → 你放水**。

---

## 2. 5 个常见错误 mindset

### 2.1 "我是来挑刺的"

> ❌ Mindset: "我审一篇 paper,必须找出 X 个 weaknesses,否则显得不认真。"

**为什么错**:reviewer 的目标是 **help paper 进步**,不是**证明自己比作者聪明**。

✅ Better mindset: "我审一篇 paper,要找出作者**没考虑到的角度**,帮 paper 变得更强。"

### 2.2 "必须给 reject"

> ❌ Mindset: "I CLR/NeurIPS 25% accept rate,所以 reject 大概率是正确选择。"

**为什么错**:accept rate 是 aggregate,**你这篇 paper 该不该 accept 取决于内容**,不取决于统计基线。

✅ Better mindset: "如果 paper 推进了 state-of-the-art / 解决了重要问题 / 提供了有价值的 insight → accept;否则 reject。"

### 2.3 "我没复现成功 = paper 是错的"

> ❌ Mindset: "我跑作者的 code 没出他的结果 → paper 是 fake / 不可复现。"

**为什么错**:
- 你可能装错环境 / 错 CUDA 版本 / 错 random seed
- 作者可能用了非公开的 data preprocessing
- **你大概率没复现成功是因为 reviewer 没把所有细节都跑一遍的时间**

✅ Better mindset: "我没复现成功 → 我把 environment / command / error 写进 review,**让作者澄清**,而不是直接 reject。"

### 2.4 "作者引用了 80 篇文献,我只看过 30 篇"

> ❌ Mindset: "我看过的 30 篇里作者漏引了 X,所以 author 文献 review 不全。"

**为什么错**:领域文献爆炸,作者不可能引所有。**作者漏引你看过的那 1-2 篇 ≠ 作者文献 review 不全**。

✅ Better mindset: "X 工作是同期的关键 baseline / 同方法,必须引(我指出来)。其它漏引如果不影响 paper claim,可以列为 minor 或不列。"

### 2.5 "我没理解 = 作者写得不好"

> ⚠️ **最容易出现的错误**。Reviewer 的盲点是:**领域知识不够所以看不懂**。

怎么区分?

| 信号 | 你看不懂的真实原因 |
|------|------|
| 读 3 遍还是不懂 | **作者写得烂** OR **超出你的 sub-field** |
| 读 1 遍半懂不懂 | **作者没解释清楚前置假设** |
| 读 1 遍懂 80% | **正常** —— paper 密度高,5-10% 不懂是常态 |

✅ Better mindset:
- 5-10% 不懂 → **写 question 让作者澄清**,不要写 weakness
- 50% 不懂 → **可能是 paper 写作问题**,也可能是你方向不对 → 先考虑 decline
- 90% 不懂 → **decline**,你不是合适的 reviewer

---

## 3. Reviewer 的 3 个义务

### 3.1 对作者的义务

1. **及时**(≤ 2 周内,绝大多数 venue 是这个期限)
2. **具体**(每条 concern 给 §/Table/Figure 引用)
3. **建设性**(每条 weakness 给 suggested fix)
4. **礼貌**(即便 reject 也对作者的劳动致谢)

### 3.2 对学术社区的义务

1. **不要放水** — 烂 paper 进 literature 浪费读者时间
2. **不要 kill** — 新颖但 incomplete 的 paper 可能是下一代工作的种子
3. **保护双盲** — 不主动 google author,即便你猜到了
4. **保护隐私** — 不在公开场合讨论 review 内容

### 3.3 对你自己的义务

1. **学新东西** — Review 是免费的 paper-reading 训练,比你自己读 5 篇 paper 更有 insight
2. **保持记录** — 写 1 个 review journal(用 `feedback_note` 事件记录),积累自己的 review profile
3. **保护时间** — 1 个 review = 1-2 周,如果同时 3 个 review,会拖死你的 research 时间

---

## 4. Reviewer 的 4 个心理陷阱

### 4.1 Anchoring(锚定)

> "我读了 abstract 觉得 method 简单,所以后续 reading 都按'method 简单'的预期走。"

✅ 解药:**第二遍 reading 时,假装你不知道 method 是什么,重读一遍**。

### 4.2 Halo effect(光环)

> "作者是 MIT 的 / Google 的,所以 paper 一定强。"

✅ 解药:**blind 评审:把作者名字 / 单位涂掉**。即便 single blind venue,你也应该按 blind 标准写 review。

### 4.3 Confirmation bias(确认偏差)

> "我决定 reject 后,所有 reading 都在找 reject 的证据。"

✅ 解药:**先写 strengths,再写 weaknesses**。Strengths 写完后再问自己"我有 balance 吗"。

### 4.4 Sunk cost(沉没成本)

> "我已经花 4 小时读这篇 paper,所以必须写 2 页 review 才值。"

✅ 解药:**如果 paper 真的是烂 paper,3 句话 reject 是合理的**。Reviewer 时间宝贵,不要用长度证明努力。

---

## 5. Reviewer 的 7 步法(实战流程)

详见 [`writing-review.md`](writing-review.md) § 3,这里只列大纲:

1. **Day 1**:abstract + figures(1 小时) — decide accept/reject/revise
2. **Day 2-3**:细读全文(3-4 小时)
3. **Day 4**:跑 code / 重算关键实验(可选)
4. **Day 5**:列 strengths(20 分钟)
5. **Day 6**:列 weaknesses(1 小时)
6. **Day 7**:列 questions + 写 recommendation
7. **Day 8**:重读 review,检查 tone,提交

**总时长**:~10 小时。**Senior reviewer 1-2 周是合理的**。

---

## 6. Reviewer 的 4 个 reflection questions(提交前自问)

写完 review 后,问自己:

1. **"如果我是作者,我能从这份 review 里学到东西吗?"**
   - 如果不能 → 你没给 suggested fix
2. **"这份 review 是不是只针对这一篇 paper,还是领域里所有 paper 都适用?"**
   - 如果后者 → 你的 concern 写得太空,作者没法 fix
3. **"我有没有因为作者引用了我没看过的 paper 而扣分?"**
   - 如果有 → 这是你方向不够,不是 paper 问题
4. **"如果 5 年后我 review 自己的 review,我会后悔写了某条吗?"**
   - 如果会 → 那条可能不专业 / 情绪化,删掉

---

## 7. 怎么在 DPR 里训练

### 假审稿(Phase 3)

进 `/agents/new-session/`,选 `free_form` 模板,goal:
```
你是一位 ICLR 2026 senior reviewer(经验 50+ paper reviews)。
对 archive/<sid>/ 里的 synthesis 做 simulated peer review。
按 5 维打分(methodological_soundness / novelty_vs_prior_art /
reproducibility / claim_calibration / clarity),给出:
- Strengths(3-5 条,具体到 §)
- Weaknesses(5-10 条,每条带 suggested fix)
- Questions(5-10 条,作者能答)
- Recommendation(accept / weak_accept / revise / weak_reject / reject)
- Confidence(1-5)
约束:语气 constructive,无攻击性;总长 1-2 页。
```

跑完对比你自己的 review(如果你投过类似 paper)。**LLM 假审稿会暴露你的盲点** —— LLM 会问出你没问的角度。

### 真审稿后 reflection(Phase 3+)

每次写完真 review,**强制自己写 1 段 100 字的 reflection**(用 `feedback_note` 事件记录):
- 哪条 concern 我最有把握?
- 哪条 concern 我应该 ask 而不是写 weakness?
- 哪条建议 author 改完我会再读一遍吗?

**1 年下来 5-10 篇 review + reflection = 比读 50 篇 paper 更有 insight**。

---

## 8. 何时 decline 一篇 review

**decline 是正常的,不是失礼**。常见正当理由:

| 理由 | 怎么处理 |
|------|------|
| **方向不 match**(离你 sub-field > 1 跳) | Decline,推荐同事 |
| **时间 conflict**(2 周内有 deadline) | Decline,但说明原因("reviewing 3 papers this cycle") |
| **利益冲突**(作者是同事 / 学生 / 合作者) | Decline,告知 chair |
| **已经 review 过 arxiv 版本** | Decline,说明看过 |
| **Paper 写得 90% 不懂** | Decline,说明方向不 match |

**decline 时**:1 句话说明理由 + 推荐 1-2 个 alternative reviewer(可选项,但 chair 会感谢)。

**不要**:decline 时抱怨("这 paper 看起来就 reject")、decline 太晚(decline 截止前 1 天 = chair 灾难)。

---

## 9. Reviewer 的 reward

**短期**:venue 给 reviewer credit,有的给 free registration / travel grant。

**中期**:你的 review 质量 → senior PC / AC 注意到 → 邀你当 AC。

**长期**:你成为领域 reviewer pool 里的 trusted reviewer → editor / 期刊邀你 → 学术声誉 + 影响力。

**隐性 reward**:**审稿训练你的学术品味** —— 你会发现自己写的 paper 越来越难被 reject,因为你已经学会了 reviewer 的视角。

---

## 10. 终极 mindset

> **"Review 是 service,不是 attack。"**

每一篇 paper 的背后:
- 1-2 年的工作时间
- 4 个 author 的 reputation
- 数百万 GPU hours 的算力
- 数万次 experiment 的 trial-and-error

**你的 review 是这份劳动的终审**。如果你的 review 让 paper 变得更强,**你不仅帮了作者,也帮了未来 5 年引用这篇 paper 的人**。

**This is the most leverage you can have in academia**:1 个 review 影响 1 篇 paper → 那篇 paper 影响 50 篇后续工作 → 50 篇后续工作影响 1000 篇 → ...

**做好 review 是对学术社区最大的 contribution 之一**。

---

## 11. 相关资源

- 怎么写 review: [`writing-review.md`](writing-review.md)
- 怎么写 rebuttal(从作者视角看 reviewer): [`writing-rebuttal.md`](writing-rebuttal.md)
- 怎么读 paper(理解 reviewer 的视角): [`how-to-read-paper.md`](how-to-read-paper.md)
- 文献综述: [`how-to-lit-review.md`](how-to-lit-review.md)
- Phase 4 假审稿训练: [`../onboarding/phase-4-contribution.md`](../onboarding/phase-4-contribution.md)
