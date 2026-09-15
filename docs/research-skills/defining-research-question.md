# Research Skills — 怎么定义研究问题

> **面向:** Phase 1 末 - Phase 2 博士生(刚有方向但还没成形 RQ)
> **目标:** 1 句话写出可执行的研究问题,避免「跑偏 3 个月才发现方向错了」

---

## 1. 什么是「好」的研究问题

3 个要素同时满足:

| 要素 | 含义 | 反例 |
|------|------|------|
| **具体** (Specific) | 不是「改进 X」,而是「X 在 Z 场景下减少 Y 的 N%」 | "improve LLM" → 太宽 |
| **可测** (Measurable) | 论文能给出量化指标和 baseline | "make it faster" → 怎么算快? |
| **有价值** (Valuable) | 同行会想引用,有方法论/数据/理论贡献 | "extend method X to Y" → 为什么要扩展? |

**SMART 公式**:Specific + Measurable + Achievable + Relevant + Time-bound

## 2. 三种 Gap 识别

写 RQ 前,先回答「**我要解决的问题,前人留下什么空白?**」

### 2.1 方法 gap(performance)

- **症状**:现有 SOTA 在某任务上 < 50% / 边界 case 失败
- **例**:SOTA LLM 在 medical QA 上 hallucination ~ 30%,**RQ**:能不能在 medical 领域把 hallucination 降到 < 10%?
- **怎么验证**:跑 baseline + 看 failure case + 找到 common pattern

### 2.2 数据 gap(coverage)

- **症状**:现有数据集 / benchmark 缺某个场景
- **例**:现有 agent benchmark 都是 web 任务,**RQ**:能不能构造一个 multi-step tool-use benchmark 覆盖 long-horizon planning?
- **怎么验证**:列出现有 benchmark + 标注 coverage matrix + 找空白格子

### 2.3 理论 gap(explanation)

- **症状**:某现象被观察到,但**为什么**没人解释清楚
- **例**:RLHF 训练 loss 降但下游指标抖动,**RQ**:为什么 PPO 的 reward model variance 会导致下游不稳定?
- **怎么验证**:列出现有解释 + 找出每个解释不能 cover 的现象

## 3. RQ 模板

把上面 3 要素 + 1 类 gap 拼成一句话:

```
「在 [场景] 下,现有 [方法/数据/理论] 存在 [gap 类型:performance/coverage/explanation] 问题。
本文提出 [方法/数据集/分析],在 [指标] 上达到 [目标],验证 [假设/贡献]。」
```

**实例**:
- ❌ 弱 RQ:「我们用 DPO 做 RLHF」(没具体场景 / 指标)
- ✅ 强 RQ:「在 medical QA 场景,现有 RLHF 的 reward model 在 30% 的 case 上产生严重 hallucination;本文提出 contrastive reward shaping,在 MedQA 的 strict-accuracy 上从 60% 提升到 75%。」

## 4. 反模式(避免)

| 反模式 | 为什么差 | 改成 |
|--------|---------|------|
| 「我们提出 X 方法」 | X 是什么 / 为什么 / 解决什么没说 | 「针对 Y 的 Z 问题,我们提出 X」 |
| 「We are the first to」 | 没贡献,只是时间差 | 「之前的 X 不能解释 Y 现象;我们解释 Y 并验证」 |
| 「improvement on benchmark A」 | 一个 benchmark 不够,容易 overfit | 「在 3 个 benchmark + 2 个真实场景上」 |
| RQ 太宽("improve LLM safety") | 1 篇文章解决不了 | 缩到 1 个具体 failure mode |

## 5. 与其他 skill 的关系

- **方向已定,但 RQ 不清** → 用本文档模板写 1 句 RQ
- **RQ 已定,要找前人工作** → [`how-to-lit-review.md`](how-to-lit-review.md)
- **RQ 已定,要读 paper 验证可行性** → [`how-to-read-paper.md`](how-to-read-paper.md)
- **RQ 已定,要设计实验验证** → [`experiment-design.md`](experiment-design.md)

## 6. DPR 工具配合

- **记录 RQ**:`/ideas/` 新建 idea,frontmatter `kind: research_question`,字段:
  ```yaml
  kind: research_question
  status: active
  hypothesis: "<1 句话 RQ>"
  gaps: [method|coverage|theory]
  target_venue: "NeurIPS 2026"
  ```
- **验证 RQ**:agents Designer (consumes this doc) → 出 Proposal[type=experiment_plan]
- **追踪 RQ 进度**:`/research/` dashboard 显示 active RQ + 相关 ideas/experiments

## 7. 30 分钟实战

1. **5 min** — 写下当前脑里的方向(1 段乱写的话)
2. **5 min** — 用 §2 识别属于哪种 gap(method/data/theory)
3. **10 min** — 用 §3 模板拼出 RQ 1.0
4. **5 min** — 用 §4 反模式自检(改 1-2 处)
5. **5 min** — 写进 `/ideas/`,触发 agents Designer 看是否跑偏

---

**变更日志**
- 2026-09-14:新建(对应科研全流程阶段 0,补足 RQ 定义这一缺口)