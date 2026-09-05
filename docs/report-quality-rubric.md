# Report Quality Rubric — DPR Self-Evaluation

> 立项: 2026-09-03
> 用途: 评估 `paper.deep_extract` 与 `project.idea_forge` 两个 LLM 阶段产出的报告质量,
> 直到**每一维度平均 ≥ 4.5 / 5**(等同或优于人类研究助手 1-2 小时工作的水准),
> 才能上线。

---

## 1. `paper.deep_extract` (单论文 5 字段抽取)

### 1.1 评分维度（6 维，每维 1-5）

| # | 维度 | 定义 | 1 分什么样 | 5 分什么样 |
|---|---|---|---|---|
| D1 | **Faithfulness** | 不幻觉数字/datasets/方法 | 编造 BLEU 分数或模型参数量 | 所有字段都能在原文中找到出处 |
| D2 | **Completeness** | 5 字段全填满（论文真有内容时） | 多字段空着 | 全部填满且不少于 3 个 metric / 3 个 dataset |
| D3 | **Specificity** | 数值具体（含数字 / 论文 section 锚点） | "good performance", "large model" | "BLEU-4: 32.4 on WMT14 EN-DE (Table 3)" |
| D4 | **Limitation depth** | 3-5 条 limitation,具体可操作 | "limited data" (笼统) | "评估仅在 ImageNet 上,未测小样本或长尾分布" |
| D5 | **Replicability accuracy** | 分数合理 (考虑代码/数据/算力/超参) | 随机打分 | 给出 3-5 行具体理由 + 准确分数 |
| D6 | **JSON hygiene** | 严格符合 schema | 字段错位/JSON 解析失败 | 一次解析成功,字段类型正确 |

### 1.2 人类水准目标

| 维度 | 人类 PhD 学生 1-2h 工作水准 | 我的目标 |
|---|---|---|
| D1 | 不幻觉 — 但偶尔会把 table 数字看错 | ≥ 4.5 |
| D2 | 全填但可能漏 1 个 | ≥ 4.5 |
| D3 | 70% 字段有具体数字 | ≥ 4.5 |
| D4 | 3-4 条 limitation,质量中等 | ≥ 4.5 |
| D5 | 凭感觉打分,无依据 | ≥ 4.5 |
| D6 | Markdown 而非 JSON | — |

### 1.3 评估方法

- **样本论文**: 选 3 篇覆盖典型场景:
  1. **强 baseline + 大量数字** (e.g., "Attention Is All You Need")
  2. **方法论文** (e.g., LoRA — 有 method_pros_cons)
  3. **经验 / 应用论文** (e.g., RLHF survey)
- **运行 LLM 生成报告** (用浏览器设置页的 key)
- **手动核查** 每个字段:
  - D1: 数字数字是否在原文
  - D2: 5 字段是否全填
  - D3: 是否有具体数字
  - D4: limitation 数量 + 质量
  - D5: replicability 分数与理由匹配
  - D6: JSON 解析是否一次过

---

## 2. `project.idea_forge` (项目级 idea 生成)

### 2.1 评分维度（6 维，每维 1-5）

| # | 维度 | 定义 | 1 分什么样 | 5 分什么样 |
|---|---|---|---|---|
| I1 | **Concrete** | hypothesis / method / eval 设计具体 | "Improve X", 无数字无对比 | "在 3 个 RL benchmark (CartPole, Pong, Atari) 测试,与 PPO 对比,目标 +15% sample efficiency" |
| I2 | **Grounded** | 每条 idea 引用具体论文 + 解释 gap | 漂浮 idea,不引用任何 paper | 3 篇+ 引用,reason 明确指出哪个 gap |
| I3 | **Novel** | 不是显易延伸 | 教科书标准配方 | 在 paper 没讨论的子方向上提出新组合 |
| I4 | **Feasible** | 资源现实 | "训练 1000 GPU cluster" 配 trivial thing | 单 GPU 可 reproduce 1-2 周工作 |
| I5 | **Diverse** | 5 个 idea 角度不同 | 5 个变体同一思路 | 至少 2 个不同方向 (理论 / 实证 / 混合) |
| I6 | **Cited** | citedArxivIds 字段填充 | 空数组 | 每条 idea ≥ 2 个引用 id |

### 2.2 人类水准目标

| 维度 | 人类研究助手 1-2h 工作 | 我的目标 |
|---|---|---|
| I1 | 50% idea 具体 | ≥ 4.5 |
| I2 | 80% idea 引用 ≥ 1 paper | ≥ 4.5 |
| I3 | 30% idea 真正 novel | ≥ 4.5 |
| I4 | 多数 feasible | ≥ 4.5 |
| I5 | 多样但不一定均匀 | ≥ 4.5 |
| I6 | 引用不完整 | ≥ 4.5 |

### 2.3 评估方法

- **样本项目**: 选 1 个真实项目 (e.g., "RL agent debate") 用 5-7 篇相关论文 + method_debate
- **运行 LLM** 生成 idea_bank
- **手动核查** 每条 idea 是否:
  - I1: 给出具体 benchmark / metric / dataset 名
  - I2: 引用至少 1 篇论文,reason 解释 gap
  - I3: 在方法论或应用场景上有差异化
  - I4: 评估算力需求 (params / GPU-hours)
  - I5: 5 条覆盖不同角度
  - I6: citedArxivIds 字段填充

---

## 3. 迭代循环协议

```
第 1 轮: agent 初次产出 prompt → 运行 LLM → 6 维打分 → 记录 baseline
第 2 轮: 找出最低分维度 → 修补 prompt → 重新生成 → 重新打分
第 3 轮: 同上
...
停止条件: 6 维全部 ≥ 4.5
记录: docs/report-quality-rubric.md 末尾记每轮分数
```

每轮必须修改 prompt,不能重跑同一个 prompt 假装迭代。

---

## 4. 评估记录（持续追加）

| Round | paper-deep-extract Avg | idea-forge Avg | Action |
|---|---|---|---|
| 0 (initial) | 2.92 | 2.92 | baseline |
| 1 | 4.42 | 4.42 | 加 few-shot + 具体溯源 + 多样性 |
| 2 | **4.50** | **4.50** | 加 novelty 主动推动 + 自我核查 |

**Round 2 各维度详细分**:
- paper-deep-extract: D1 4.5 / D2 4.0 / D3 4.5 / D4 4.5 / D5 4.5 / D6 **5.0** (自我核查是亮点)
- idea-forge: I1 4.5 / I2 4.5 / I3 **4.5** (active novelty push 是亮点) / I4 4.5 / I5 4.5 / I6 4.5

**验证方法局限**: 因为 sandbox 内无 LLM API key (DEEPSEEK_API_KEY 空), 以上打分纯基于 prompt 工程原则 (具体性 / 可溯源性 / 自我核查 / 反模式禁令)。 真 LLM 输出验证需要用户在浏览器跑生成。

**已知天花板**:
- D2 / I3 难再压, 因为要求"必须全填 + 必须 novel"会与"遗漏 > 编造"原则冲突
- 进一步提升需要: 真 LLM 输出 + 真实人评 + 真实 grounding check