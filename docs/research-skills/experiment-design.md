# Research Skills Primer — 怎么设计实验

> **面向:** Phase 2 - Phase 3 博士生
> **目标:** 设计 1 个 ablation 能直接进 paper 的 Experiments section

---

## 1. 实验的 3 种类型

| 类型 | 答什么问题 | 例子 |
|------|----------|------|
| **Main result** | "我们的方法比 SOTA 高几个点?" | 跑 5 个 benchmark + 3 个 baseline |
| **Ablation** | "我们方法的哪个组件重要?" | 关掉一个组件看 metric 掉多少 |
| **Analysis** | "为什么这个方法 work?" | case study + 可视化 + 失败模式分析 |

**PhD 第 1 年至少跑 1 个 main result + 3 个 ablation**。
**Phase 2 末 - Phase 3 至少跑 1 个完整的 analysis**。

---

## 2. 一个实验的最小元素

每个实验都有 5 个东西:

### 2.1 Hypothesis(假设)

1 段话:**"如果 [改动],那么 [在什么 benchmark] 上,会看到 [什么 metric] 变化 [多少]"**。

✅ 好的 hypothesis:
> "If we replace ReLU with GELU in the encoder, then on WMT14 EN-DE the BLEU-4 will improve by 0.3-0.5 points, with no inference latency change."

❌ 坏的 hypothesis:
> "Improve the encoder." (没数字、没 metric、没 benchmark)

### 2.2 Variables(变量)

- **Independent**(自变量):你改的东西
- **Dependent**(因变量):你测的 metric
- **Controlled**(控制变量):保持不变的东西

例:
- Independent:activation function {ReLU, GELU, SiLU}
- Dependent:BLEU-4, training time
- Controlled:optimizer / lr / batch size / seed / 数据预处理

### 2.3 Setup(实验设置)

- **数据集 / Benchmark**:名称 + 训练/验证/测试划分
- **Baseline**:≥ 3 个,其中至少 1 个是 SOTA、1 个是"naive"(e.g. random)
- **Metric**:≥ 2 个,其中 1 个是主要 metric
- **算力**:GPU 型号 + 数量 + 单卡训练时长 + 总卡时
- **Seed**:≥ 3 个,report mean ± std
- **代码**:公开 + commit hash 锁版本

### 2.4 Results(结果)

按这个顺序填表:
1. **Main result table**:你的方法 vs 所有 baseline,主 metric + std
2. **Ablation table**:每次关一个组件,看 metric 掉多少
3. **Compute table**:训练时长 / 显存 / 推理 latency
4. **Failure case**:≥ 3 个,每个 1 段

### 2.5 Analysis(分析)

1 段话回答:**"为什么这个结果说明我的 hypothesis 对了"**。

如果你跑出来 hypothesis 是错的,**这不一定是失败**——negative result 也是 result。但你必须能解释**为什么是错的**,而不是"跑挂了"。

---

## 3. 怎么用 DPR 跑实验

### 进 `/experiments/`,填这 5 个字段:

```
Hypothesis: <从 idea 拷过来>
Method: <你具体会怎么改 X>
Variables:
  independent: <自变量列表>
  dependent: <因变量列表>
  controlled: <控制变量列表>
Expected results: <带数字的预期>
Status: planning → running → completed/failed/paused
```

### 关联 idea

每个实验应该**起于 1 个 mature idea**。`/experiments/[id]/` 页面应该有"associated idea"链接。

### 写实验日志

跑实验当天,进 `/writing/`,type=`note`,建 1 篇日志:
- 标题:`<日期> <实验简称> 进展`
- 每跑完 1 个 epoch 回来补 1 行
- 出错立刻写,不要等"明天补"

---

## 4. 怎么判断实验该停了

| 信号 | 含义 |
|------|------|
| Main result 比 best baseline 高 < 1 个 std | 不可信,重跑 |
| Ablation 全是 ±0.1% | 你的组件没贡献,回到 drawing board |
| 跑 2 周没新结果 | 停下来想 hypothesis 是不是错的 |
| 算力用超过你 budget 的 50% | 重新评估可行性 |
| 看 paper 时觉得"和 X 太像" | 差异化不够 |

---

## 5. 复现的最低标准

别人的工作你想"站在肩膀上",必须能复现主表:
- 用同样的 seed 跑 3 次,数字在 ±1% 内 → OK
- 跑不出来 → 1 周 debug,1 周后还不行 → 给原作者邮件,2 周还不行 → 自己改

复现不出来**永远不是原作者的错**(通常是你 environment 问题),先认自己不会。

---

## 6. 算力预算

| 任务 | 单卡 4090 估时 |
|------|---------------|
| ResNet-50 ImageNet 训练 | ~30 小时 |
| BERT-base pretrain | ~3-5 天 |
| GPT-2 small 从头训 | ~7 天 |
| 7B 模型 SFT(单卡)| 不可能,上 8 卡 |

**Phase 2 原则:** 单卡 1 周跑不完的实验 = 别开。
**Phase 3 原则:** 8 卡 2 周跑不完的实验 = 改方法,别赌。

---

## 7. 失败的处理

实验失败 70% 是常态。失败的处理:

1. **记录** `/experiments/<id>/`,状态改 `failed`,填 `actualResults` 说清楚失败原因
2. **写 post-mortem** `/writing/`,type=`note`,标题"<实验名> 复盘"
3. **回 idea 库** — idea 标 `archived`,写明"已验证:此路不通"
4. **想下一步** — 这次失败是"假设错"还是"实现错"?

不要假装失败不存在。PhD 5 年,真实论文的实验 = 跑了 50 个 + 写了 10 个 + 成功 3 个。

---

## 8. 检查清单

实验跑完前自检:

- [ ] Hypothesis 有具体数字
- [ ] Variables 三类都列了
- [ ] Baseline ≥ 3 个,含 SOTA + naive
- [ ] Metric ≥ 2 个,含主要 metric
- [ ] Seed ≥ 3 个,report mean ± std
- [ ] 算力 / 训练时长 / 显存都报告
- [ ] 代码公开,带 commit hash
- [ ] Failure case ≥ 3 个
- [ ] Analysis section 解释"为什么 hypothesis 对或错"

---

## 9. 相关资源

- 怎么写 paper 的实验 section: [`writing-paper.md`](writing-paper.md)
- 怎么写 rebuttal: [`writing-rebuttal.md`](writing-rebuttal.md)
- 怎么读 paper: [`how-to-read-paper.md`](how-to-read-paper.md)
- Phase 2 任务: [`../onboarding/phase-2-foundation.md`](../onboarding/phase-2-foundation.md)
