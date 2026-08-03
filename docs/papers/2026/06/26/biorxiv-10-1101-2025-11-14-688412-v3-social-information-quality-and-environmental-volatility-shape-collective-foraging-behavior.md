---
title: Social Information Quality and Environmental Volatility Shape Collective Foraging
  Behavior
title_zh: 社会信息质量与环境波动性塑造集体觅食行为
authors: Chirkov, V., Kurvers, R. H. J. M., Deffner, D., Romanczuk, P.
date: 2026-06-26
generated_at: 2026-07-04 02:35:26 UTC
pdf: https://www.biorxiv.org/content/10.1101/2025.11.14.688412v3.full.pdf
categories:
  venue: []
  task:
  - mas
  method: []
  type: []
score: 0.8
evidence: 多智能体强化学习模拟集体觅食
tldr: 集体觅食需要在个体探索与社会信息利用之间权衡，但社会线索类型与环境波动如何塑造集体行为尚不清楚。本研究构建基于多智能体强化学习的空间显式模型，智能体追踪移动资源并在随机探索、私有追踪和社会吸引间选择，系统改变资源波动性与社会线索类型。结果显示，低质量线索产生脆弱策略，高质量信息则支持灵活多样的个体行为，揭示了信息质量与生态环境的交互是集体行为涌现的核心机制。
source: biorxiv
selection_source: fresh_fetch
motivation: 集体觅食需在探索与社会信息利用间权衡，但社会线索类型与环境波动如何共同塑造集体行为仍缺乏系统理解。
method: 构建空间显式多智能体强化学习模型，智能体追踪移动资源，在随机探索、私有追踪和社会吸引三种策略间选择，系统改变资源波动性与可用社会线索类型。
result: 低质量线索产生仅在稳定环境中有效的脆弱策略，高质量信息则使智能体选择性模仿并在不同波动条件下灵活切换个体追踪与探索行为。
conclusion: 信息质量与生态环境波动的交互是集体行为涌现的核心机制，为理解个体决策规则如何塑造集体觅食提供了统一框架。
---

## 摘要
集体觅食在整个动物界中普遍存在，使动物能够更有效地发现资源。然而，集体觅食者需要在私人探索和使用社会信息之间权衡一个关键取舍。社会信息可以以截然不同的形式出现，从简单的位置线索到复杂的收益信息。然而，关于可用的社会线索类型和环境波动性如何塑造集体觅食行为，人们仍知之甚少。我们使用一个空间显式模型来研究这一问题，在该模型中，智能体通过多智能体强化学习追踪一种移动资源。智能体在随机探索、私人追踪和社会吸引之间进行选择。我们系统地改变资源波动性以及可用社会线索的类型，以分析它们对个体和集体行为的影响。我们的结果表明，社会信息的质量决定了涌现的集体行为。低质量的社会线索（如位置、动作）导致一种脆弱的策略，该策略在稳定环境中有效，但随着波动性的增加会失效。相反，高质量的社会信息（如收益）能够促成行为多样性：智能体可以有选择地模仿他人，并根据环境波动性在个体追踪或探索之间灵活切换。我们的发现揭示了信息质量与生态背景之间的相互作用是从个体决策规则中涌现出不同形式集体行为的重要机制。

## Abstract
Collective foraging is widespread across the animal kingdom, allowing animals to more effectively discover resources. However, collective foragers need to balance a key trade off between private exploration and using social information. Social information can come in very distinct forms, ranging from simple positional cues to complex payoff information. However, how the types of available social cues and environmental volatility shape collective foraging behavior is not well understood. We address this using a spatially-explicit model in which agents track a mobile resource via multi-agent reinforcement learning. Agents choose between random exploration, private tracking, and social attraction. We systematically varied resource volatility and the type of available social cues to analyze their effect on individual and collective behavior. Our results show that the quality of social information dictates the emerging collective behavior. Low-quality social cues (e.g., positions, actions) result in a fragile strategy that is effective in stable environments but fails as volatility increases. Conversely, high-quality social information (e.g., payoffs) enables behavioral diversity: Agents selectively copy others and flexibly change between individual tracking or exploration depending on the environmental volatility. Our findings identify the interplay between information quality and ecological context as an important mechanism governing the emergence of distinct forms of collective behavior from individual decision rules.

---

## 论文详细总结（自动生成）

# 论文总结：社会信息质量与环境波动性塑造集体觅食行为

## 一、核心问题与研究动机

- **核心问题**：在集体觅食情境中，动物需要在**私人探索（private exploration）** 与 **社会信息利用（social information use）** 之间进行权衡；然而，社会线索可从简单的位置/动作信号到复杂的收益信号跨度极大，且其有效性高度依赖环境波动性。**社会线索的类型与质量，以及环境的稳定性，如何共同塑造个体决策规则与集体觅食行为？** 这是行为生态学中尚未被系统回答的问题。
- **背景与意义**：
  - 经典社会觅食模型（如 Giraldeau & Caraco 的 Producer-Scrounger、Laland 的 Social Learning Strategies）多依赖固定启发式与预设的功能形式，**难以刻画动物对多维社会信息的灵活整合**。
  - 在稳定环境中，简单线索已足够；但在热气流追踪、捕食移动猎物等**高波动性场景**下，简单的位置线索会迅速过时，只有高保真收益信号才能维持适应性。
  - 论文以集体觅食为切入点，借助**深度多智能体强化学习（MARL）** 作为"规范性优化工具"，揭示个体决策规则如何在不同信息质量与生态条件下涌现为不同的集体策略。

---

## 二、方法论

### 2.1 总体框架

- **建模思想**：将集体觅食形式化为**空间显式的资源追踪问题**。10 个全同智能体在 $20\times 20$ 的连续二维环境中跟踪一个做**相关随机游走（correlated random walk）** 的移动资源，每回合 1000 步。
- **资源动力学**：转向角 $\theta\sim U[0,2\pi)$，步长 $\ell$ 取自**截断 Pareto 分布**（形状参数 $\alpha=1$，$1\le\ell\le 100$），构成局部扩散+偶发长距离位移的混合运动模式（类似 Lévy walk 但有限矩）。
- **学习范式**：以 **MAPPO（Multi-Agent PPO）** 为核心算法，采用 **CTDE（集中训练—分散执行）**：训练时共享 Actor/Critic 网络权重以利于涌现协调，执行时仅用局部观测。
- **解码器架构**：Actor 与 Critic 均为 2 层隐藏层、每层 256 单元的 **MLP（tanh 激活）**，Actor 通过 sigmoid+Categorical 输出 3 个动作的概率。

### 2.2 智能体行为模型（三动作集）

智能体每个时间步 $t$ 在三种动作 $a_i(t)\in\{\text{Exploration},\ \text{Tracking},\ \text{Social Attraction}\}$ 中选择一种：

1. **Exploration（随机探索）**：以最大速度 $v_{\max}$ 做相关随机游走，转向角增量  
$$\Delta\phi \sim \mathrm{vonMises}(\mu=0,\kappa=2)$$
2. **Tracking（私有追踪，朝向资源中心）**：模型化为**有成本的剥削**，以概率 $p_{\text{track}}$ 向资源中心移动，否则静止（模拟感知/停顿成本）：
$$\mathbf{v}_i(t)=\begin{cases}v_{\max}\cdot \mathbf{u}_{\text{track}}(t), & \text{with prob. } p_{\text{track}}\\ \mathbf{0}, & \text{with prob. } 1-p_{\text{track}}\end{cases}$$
有效追踪速度 $v_{\text{tracking}}=p_{\text{track}}\cdot v_{\max}$，主实验设 $p_{\text{track}}=0.1$。
3. **Social Attraction（社会吸引，朝向被观察同伴）**：以 $v_{\max}$ 飞向观察到的同伴；若视野内无同伴或同伴不可见，触发大额惩罚 $r_{\text{penalty}}=-1$，并保持上一时刻速度。

**奖励函数**（仅基于与资源中心的距离）：
$$r_i(t)=\frac{1}{1+d_i(t)^2},\quad d_i(t)=\|\mathbf{x}_i(t)-\mathbf{x}_R(t)\|_2$$

### 2.3 观测向量（5 维）

$$\mathbf{o}_i(t)=(o_1,o_2,o_3,o_4,o_5)$$

| 维度 | 含义 | 信息类型 |
|------|------|----------|
| $o_1=r_i(t)$ | 自身收益 | 私人信息 |
| $o_2=\mathbb{I}(V_i(t)\ne\emptyset)$ | 同伴是否存在 | 基础社会线索 |
| $o_3=d_{ij}(t)$ | 与观察同伴的距离 | 位置型社会线索 |
| $o_4=a_j(t-1)$ | 同伴上一时刻动作 | 行为型社会线索 |
| $o_5=\tilde{r}_j(t)=r_j(t)+\epsilon,\ \epsilon\sim\mathcal{N}(0,\sigma^2)$ | 同伴收益（含噪声） | 收益型公共信息 |

- **注意力模型**：每步从视野 $r_{\text{vis}}=15$ 单位内的同伴中**均匀随机**选取 1 个作为焦点同伴（实验中也测试了 $r_{\text{vis}}\in\{10,5,1\}$ 的鲁棒性）。

### 2.4 仿真设计（$3\times 7$ 因子）

- **环境波动性（资源速度）**：$v_{\text{resource}}/v_{\max}\in\{0.1,\ 0.3,\ 0.5\}$（慢/中/快）。
- **社会信息质量（7 个条件，由低到高逐步添加）**：
  1. Private：仅 $o_1$
  2. +Distance：$o_1,o_2,o_3$
  3. +Action：$o_1,\dots,o_4$
  4. +Payoff (High Noise, $\sigma=0.1$)
  5. +Payoff (Medium Noise, $\sigma=0.05$)
  6. +Payoff (Low Noise, $\sigma=0.01$)
  7. +Payoff (No Noise, $\sigma=0$)

### 2.5 训练与评估

- **训练算法**：MAPPO（clip surrogate + MSE value loss + entropy bonus），优势函数采用 **GAE**。
- **训练规模**：每个（速度 × 信息 × 随机种子）组合训练 **480 次迭代 × 50 万帧 = 2.4 亿环境交互**。
- **种子**：每种条件 **7 个独立随机种子**。
- **评估**：训练末段（第 400–480 次迭代）每 20 次迭代评估一次，共 5 个评估点 × 每点 1000 episode = 每种子 5000 episode；最终指标取 7 种子的中位数与 **95% bootstrap CI**。
- **策略一致性分析**：对每条件 7 个种子的动作组成向量做余弦相似度+层次聚类；剔除 <3.5% 的"未收敛"种子（仅发生在非社会条件中）。
- **动作概率热图**：将评估期连续观测离散化为 2D 网格，按颜色层 + alpha 混合呈现三种动作频率。

---

## 三、实验设计

### 3.1 场景与数据

- 本文为**基于智能体的仿真研究**（agent-based simulation），无外部数据集。
- 仿真环境通过 **VMAS v1.4.3**（向量化多智能体模拟器）实现，MARL 基于 **PyTorch 2.5.1 + TorchRL 0.6.0 + TensorDict 0.6.2**。
- 训练日志使用 **wandb 0.19.2**，可视化使用 **Matplotlib 3.9.0 + Seaborn 0.13.2**。

### 3.2 "基准"与对比方法

- 本研究**没有外部 benchmark**，核心是**自构造的对照框架**：
  - **跨条件对照**：在 $3$（资源速度）$\times$ $7$（信息条件）= **21 种主实验条件**之间系统对比。
  - **跨算法对照**：在主结果外，还以 **IPPO（Independent PPO，完全去中心化）** 复现所有主实验，作为 MAPPO 的对照（参看 Fig. S4–S5）。
  - **跨超参对照**：
    - 追踪成本 $1-p_{\text{track}}\in\{0.7,\ 0.8,\ 0.95\}$（即 $v_{\text{tracking}}\in\{0.3,\ 0.2,\ 0.05\}\times v_{\max}$）；
    - 视野范围 $r_{\text{vis}}\in\{15,\ 10,\ 5,\ 1\}$。
- 这些条件之间构成了对"信息质量"、"环境波动性"、"追踪成本"、"学习算法"以及"感知限制"的多因子解构分析。

### 3.3 评估指标

- **归一化收益** $\mathcal{R}$（收集奖励 / 最大可能奖励）。
- **三种动作占比**（Tracking / Exploration / Social Attraction）。
- **2D 动作概率热图**（按观测状态分箱）。
- **策略余弦相似度**（用于剔除异常种子）。

---

## 四、资源与算力

- **GPU**：单卡 **NVIDIA A100 或 V100S**（每训练运行一张）。
- **训练时长**：平均 **17.9 小时 / 运行**（标准差 1.8 小时）。
- **总规模估算**：21 种主条件 × 7 种子 = **147 个训练运行**，每运行 2.4 亿环境交互，总计约 **350 亿环境交互步**。
- 主实验训练之外，还进行追踪成本、视野范围、IPPO 等大量辅助训练（具体小时数未在正文给出，仅给出"主实验平均时长"）。
- 配套的开源代码（环境 + 训练 + 评估管线）已发布于 Zenodo（DOI: 10.5281/zenodo.20817076），训练好的模型参数与汇总评估 rollout 单独存档（DOI: 10.5281/zenodo.20819723）。

---

## 五、实验数量与充分性

- **主实验矩阵**：3（资源速度）$\times$ 7（信息条件）$\times$ 7（种子）= **147 次训练运行**，每运行 2.4 亿交互。
- **鲁棒性/敏感性实验**：
  - 追踪成本（3 个水平）；
  - 视觉范围（4 个水平，但 $r_{\text{vis}}\in\{10,5,1\}$ 未跨种子）；
  - 去中心化训练 IPPO（跨 7 种子）。
- **统计可靠性**：7 个独立种子 + 95% bootstrap CI + 策略一致性聚类过滤，确保了策略的统计稳定性。
- **公平性**：
  - 同一硬件、同一训练步数、同一评估协议应用于所有条件；
  - MAPPO 与 IPPO 使用相同的训练/评估流程；
  - 同一指标体系贯穿全文。
- **充分性评价**：总体实验规模大、统计严谨、对核心变量（信息质量、波动性、追踪成本、算法、感知）的解构较为系统；但**仅一个被试群体（10 智能体）、单一资源、单回合长度**，外部生态效度仍受限于模型简化（详见第八部分）。

---

## 六、主要结论与发现

1. **社会信息的价值高度依赖环境波动性**（Fig. 2）：
   - 在**慢速资源**下，加入距离/动作线索即带来巨大收益（$\Delta\mathcal{R}=0.409$、$0.202$），进一步提升收益信号收益甚微。
   - 在**快速资源**下，距离线索仍有用（$\Delta\mathcal{R}=0.291$），动作线索几乎无价值（$\Delta\mathcal{R}=0.049$），而**降低收益噪声**才是关键（$\Delta\mathcal{R}=0.252$）。
   - 所有条件下，性能在 $\sigma\le 0.05$ 后即饱和，说明学到的策略对适度的信息噪声具有鲁棒性。

2. **个体行为发生情境依赖的迁移**（Fig. 3）：
   - 低质量信息下，智能体**几乎完全放弃 Exploration**（平均 $0\%$），用以提升位置信号的信噪比。
   - 高质量收益信号下，智能体大幅减少 Tracking，转向 Exploration + Social Attraction 平衡（例如在 $v_{\text{resource}}=0.5$ + 无噪声收益时：Exploration≈50.3%，Attraction≈48.5%，Tracking≈1.3%）。

3. **涌现三种核心集体策略**（Fig. 4–5）：
   - **Cohesive Tracking**（低质量信息下锁定）：以私有追踪为主，社会吸引仅用于维持聚团；对生态条件高度敏感。
   - **Track-or-Copy**（高质量信息 + 追踪可行）：默认私有追踪，但若发现**收益更高的同伴**则"copy the successful"——动作概率图中表现为对角线分界。
   - **Explore-or-Copy / Distributed Sensing**（高质量信息 + 追踪失效）：放弃追踪、随机探索，仅在发现更成功的同伴时跟随；成功探索者成为"临时信息中枢"，整体涌现**分布式集体感知**。

4. **策略选择的统一驱动量**（Fig. 5A）：社会信息质量决定**灵活性**，私有追踪的**可行性**（由 $v_{\text{tracking}}/v_{\text{resource}}$ 共同决定）决定**使用哪条策略**。

5. **鲁棒性**：
   - 改变追踪成本与改变资源速度产生**镜像式的策略迁移**——证明策略选择由"追踪可行性"统一刻画。
   - IPPO 下三种核心策略仍涌现，但 Cohesive Tracking 性能下降，**揭示其依赖集中训练带来的群体协调**。
   - 视野 $r_{\text{vis}}=10$、$5$ 时性能基本不变，$r_{\text{vis}}=1$ 时才显著退化。

6. **与 Producer–Scrounger 框架的关系**：Explore-or-Copy 是动态、非固定角色的 P-S 变体——高质量收益信号使个体能在"探索者"与"搭便车者"角色间实时切换，避免了"失败者互抄"的负向信息级联。

---

## 七、优点与亮点

- **方法论层面**：
  - 利用 **MARL 作为规范性优化工具**，绕过手工设计启发式，自动发现个体→集体的涌现映射。
  - 显式地、逐维度地**解构社会信息质量**（距离 → 动作 → 不同噪声水平的收益），相比二元"有/无社会信息"更精细。
  - 同时检验**外部环境波动**与**内部追踪成本**对策略的影响，并指出二者本质上是同一驱动量。
  - CTDE（MAPPO）与完全去中心化（IPPO）双算法对照，揭示哪些策略依赖集中协调、哪些不依赖。
- **实验层面**：
  - 21 条件 × 7 种子 + 多重鲁棒性测试，统计严谨（95% bootstrap CI）。
  - 策略一致性聚类剔除异常种子，使报告的"涌现策略"具有可信度。
  - 提供动作概率热图与连续帧视频，使定性可视化与定量指标相互印证。
  - 完整开源代码 + 训练好的模型 + 评估 rollout，最大化可复现性。
- **理论层面**：
  - 把"信息质量"和"环境波动性"统一为**驱动集体策略涌现的两个核心维度**，为后续行为生态学实验提供可检验的预测。

---

## 八、不足与局限

- **生态简化**：
  - 仅**单一移动、非消耗性资源**，未涉及多资源、消耗性资源、捕食风险、群体大小变化等更复杂的生态压力。
  - 资源运动模式虽借鉴 Lévy-like 经验规律，但本身只代表一类轨迹形态，结论在更广资源动力学下的外推性未知。
- **个体同质性**：主实验全部为**同质策略共享参数**（一种 Actor），虽通过 IPPO 验证了非同质条件仍能涌现核心策略，但 IPPO 下性能显著下降，**异质化是否带来专业化（如固定 P/S 角色）尚未正面验证**。
- **认知与感知限制**：
  - 智能体**无记忆**（仅当前时间步观测），无法累积轨迹或建立"声誉"，与动物真实学习能力差距较大。
  - **每步仅采样 1 个同伴**（均匀随机），未考虑距离加权注意力、视野边缘效应，或视觉+听觉等多模态融合。
  - 社会信息获取被建模为**低成本**，而现实中获取高质量收益信号本身存在显著认知/机会成本；论文承认这是简化，但未量化其后果。
- **成本不对称假设**：模型预设**私有追踪成本 > 社会吸引成本**，若该假设逆转则整套策略格局会改变；论文承认但未给出不同相对成本下的完整相位图。
- **样本与统计**：
  - **视野范围鲁棒性测试未跨种子**，削弱了该结论的统计力度。
  - 智能体群体规模固定为 $N=10$，未测试群体规模对策略/性能的影响。
  - 每回合长度 1000 步、资源/智能体初始化于 $10\times10$ 中心区域，对超长回合与边界效应的覆盖不足。
- **可解释性与潜在偏差风险**：
  - MAPPO 中 Critic 使用了**所有智能体的联合观测作为全局状态近似**，可能引入隐式信息共享，从而高估低质量社会信息条件下的协调能力（IPPO 实验在一定程度上缓解但未完全消除该担忧）。
  - 策略剔除准则（余弦相似度 $<0.9$）较激进，可能掩盖一部分真实存在的多模态策略；论文也承认这影响了 3.5% 的运行（多在非社会条件）。
- **应用与外推**：
  - 学习所得策略对应**数亿步的最优解**，动物在生命周期内不可能经历如此规模的试错；论文将其定位为"规范性优化"，但对真实行为的预测力仍需**针对性动物实验或人类群体实验**加以验证。
  - 对**人类觅食决策**或**人工集群系统（机器人、无人机）的工程迁移**提供了概念性启发，但实际部署还需考虑通信、能耗、可靠性等额外约束。

（完）
