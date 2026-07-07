<div class="dpr-home-notice-card">
  <h3 class="dpr-home-notice-title">🚀 Start Here</h3>
  <ul class="dpr-home-notice-list">
    <li><a href="#/tutorial/README">使用教程</a></li>
  </ul>
</div>

## 每次日报
- 最新运行日期：2026-06-28 ~ 2026-07-07
- 运行时间：2026-07-07 06:18:08 UTC
- 运行状态：成功
- 本次总论文数：39
- 精读区：24
- 速读区：15

### 今日简报（AI）
近十天精选 39 篇论文聚焦模型自蒸馏与推理增强，围绕"思维模型训练"与"多智能体协同"两大主线展开深度讨论。最值得关注的两个方向：一是 On-Policy Self-Distillation（自我策略蒸馏）在思维模型中的重塑与 Privileged Hidden Flow 优化路径，二是知识边界感知与少数派哨兵机制在多智能体辩论和搜索代理中的实用价值。普通读者可优先精读 10 分的《Rethinking On-Policy Self-Distillation》建立主线认知，再以 Langshaw、KbSD 等速读文拓展应用场景。
- 详情：[本次日报](#本次日报)

### 精读区论文标签
1. [Rethinking On-Policy Self-Distillation for Thinking Models](/papers/2607.05184v1-rethinking-on-policy-self-distillation-for-thinking-models)  
   标签：评分：10.0/10、query:self-distillation
   evidence：直接研究模型从自身学习的同策略自蒸馏方法
2. [PHF: Privileged Hidden Flow for On-Policy Self-Distillation](/papers/2606.29340v1-phf-privileged-hidden-flow-for-on-policy-self-distillation)  
   标签：评分：9.0/10、query:self-distillation
   evidence：在策略自蒸馏对齐教师隐藏状态轨迹
3. [CRAFT: Counterfactual Credit Assignment from Free Sibling Rollouts for Self-Distilled Agentic Reinforcement Learning](/papers/2606.29476v1-craft-counterfactual-credit-assignment-from-free-sibling-rollouts-for-self-distilled-agentic-reinforcement-learning)  
   标签：评分：9.0/10、query:self-distillation
   evidence：自蒸馏智能体强化学习与师生蒸馏
4. [UCOB: Learning to Utilize and Evolve Agentic Skills via Credit-Aware On-Policy Bidirectional Self-Distillation](/papers/2606.29502v1-ucob-learning-to-utilize-and-evolve-agentic-skills-via-credit-aware-on-policy-bidirectional-self-distillation)  
   标签：评分：9.0/10、query:self-distillation
   evidence：在策略双向自蒸馏，模型在不同技能上下文间自我学习
5. [Hierarchical Reinforcement Learning in StarCraft Micromanagement with Influence Maps and Cluster-based Scripts](/papers/2606.30092v1-hierarchical-reinforcement-learning-in-starcraft-micromanagement-with-influence-maps-and-cluster-based-scripts)  
   标签：评分：9.0/10、query:game-ai
   evidence：星际争霸微操的分层强化学习
6. [DRIFT: Difficulty Routing Self-DIstillation with Rhythm-Gated Exploration and Success BuFfer Training](/papers/2606.30345v1-drift-difficulty-routing-self-distillation-with-rhythm-gated-exploration-and-success-buffer-training)  
   标签：评分：9.0/10、query:self-distillation
   evidence：自蒸馏框架让大语言模型从自身输出中学习
7. [Deep Reinforcement Learning for Spacecraft Attitude Control During Atmospheric Re-Entry](/papers/2606.31291v1-deep-reinforcement-learning-for-spacecraft-attitude-control-during-atmospheric-re-entry)  
   标签：评分：9.0/10、query:rl
   evidence：深度强化学习应用于航天器姿态控制，连续离线策略强化学习
8. [Safe Online Learning via Smooth Safety-Structured Policy Composition](/papers/2606.31320v1-safe-online-learning-via-smooth-safety-structured-policy-composition)  
   标签：评分：9.0/10、query:rl
   evidence：安全在线强化学习与策略组合
9. [Dynamic Scheduling for Flexible Manufacturing Systems Based on Multi-Agent Deep Reinforcement Learning and Petri Nets](/papers/2606.31737v1-dynamic-scheduling-for-flexible-manufacturing-systems-based-on-multi-agent-deep-reinforcement-learning-and-petri-nets)  
   标签：评分：9.0/10、query:mas
   evidence：结合Petri网的多智能体深度强化学习用于调度
10. [VLM-AR3L: Vision-Language Models for Absolute and Relative Rewards in Reinforcement Learning](/papers/2607.00483v1-vlm-ar3l-vision-language-models-for-absolute-and-relative-rewards-in-reinforcement-learning)  
   标签：评分：9.0/10、query:rl
   evidence：面向开放式环境RL的VLM奖励设计
11. [AI Native Games: A Survey and Roadmap](/papers/2607.00527v2-ai-native-games-a-survey-and-roadmap)  
   标签：评分：9.0/10、query:game-ai
   evidence：AI原生游戏综述,涵盖对话、任务、角色与世界的生成式AI
12. [Coachable agents for interactive gameplay](/papers/2607.00642v1-coachable-agents-for-interactive-gameplay)  
   标签：评分：9.0/10、query:game-ai
   evidence：强化学习在3A游戏中通过UVFA训练可指导的游戏智能体
13. [Reference-Governed Distributed Safe Gradient Flow for Safe Optimal Output Agreement of Multi-Agent Systems](/papers/2607.02192v1-reference-governed-distributed-safe-gradient-flow-for-safe-optimal-output-agreement-of-multi-agent-systems)  
   标签：评分：9.0/10、query:mas
   evidence：多智能体系统安全分布式梯度流一致性
14. [Neuron-Aware Data Selection for Annotation-Free LLM Self-Distillation](/papers/2607.02460v1-neuron-aware-data-selection-for-annotation-free-llm-self-distillation)  
   标签：评分：9.0/10、query:self-distillation
   evidence：无标注LLM自蒸馏与在线策略数据选择
15. [DemoPSD: Disagreement-Modulated Policy Self-Distillation](/papers/2607.02502v2-demopsd-disagreement-modulated-policy-self-distillation)  
   标签：评分：9.0/10、query:self-distillation
   evidence：同策略自蒸馏,模型同时充当师生
16. [Entropy Regularization Improves Policy Robustness in Continuous-Time Reinforcement Learning](/papers/2607.03168v1-entropy-regularization-improves-policy-robustness-in-continuous-time-reinforcement-learning)  
   标签：评分：9.0/10、query:rl
   evidence：熵正则化连续时间强化学习的鲁棒性理论保证
17. [MUTE: Return-Preserving Communication Unlearning for Efficient Multi-Agent Coordination](/papers/2607.03473v1-mute-return-preserving-communication-unlearning-for-efficient-multi-agent-coordination)  
   标签：评分：9.0/10、query:mas
   evidence：多智能体强化学习协作与通信优化
18. [Mask-based Predictive Representations for Reinforcement Learning](/papers/2607.04153v1-mask-based-predictive-representations-for-reinforcement-learning)  
   标签：评分：9.0/10、query:rl
   evidence：面向样本高效深度强化学习的自监督掩码预测辅助任务
19. [Regime-Conditional Stabilisation of LLM-Augmented Cooperative Multi-Agent Reinforcement Learning](/papers/2607.04470v1-regime-conditional-stabilisation-of-llm-augmented-cooperative-multi-agent-reinforcement-learning)  
   标签：评分：9.0/10、query:mas
   evidence：使用LLM生成奖励的协作多智能体强化学习
20. [Integrated Altruistic and Fairness Preference Induces Advanced Mutual Cooperation in Sequential Social Dilemmas](/papers/2607.04710v1-integrated-altruistic-and-fairness-preference-induces-advanced-mutual-cooperation-in-sequential-social-dilemmas)  
   标签：评分：9.0/10、query:mas
   evidence：多智能体强化学习实现社会困境合作
21. [Multi-Robot Open Adaptive Teaming Across Unseen Environments, Partners, and Scales](/papers/2607.04972v1-multi-robot-open-adaptive-teaming-across-unseen-environments-partners-and-scales)  
   标签：评分：9.0/10、query:mas
   evidence：多机器人开放自适应组队,基于超图博弈的团队级合作协调
22. [Non-Convex Sparse Reinforcement Learning via Non-Monotone Inclusions](/papers/2607.04990v1-non-convex-sparse-reinforcement-learning-via-non-monotone-inclusions)  
   标签：评分：9.0/10、query:rl
   evidence：非凸稀疏强化学习的理论分析
23. [Relational Multi-Agent Reinforcement Learning for Dynamic Pricing in High-Speed Railway Markets](/papers/2607.05179v1-relational-multi-agent-reinforcement-learning-for-dynamic-pricing-in-high-speed-railway-markets)  
   标签：评分：9.0/10、query:mas
   evidence：面向动态定价的关系型多智能体强化学习方法
24. [Fitted Occupancy-Ratio Evaluation without Bellman Completeness](/papers/2607.05375v1-fitted-occupancy-ratio-evaluation-without-bellman-completeness)  
   标签：评分：9.0/10、query:rl
   evidence：离线强化学习策略评估与Bellman理论分析

### 速读区论文标签
1. [Minority Sentinel: When to Overturn Majority Voting in Multi-Agent LLM Debates](/papers/2606.29270v1-minority-sentinel-when-to-overturn-majority-voting-in-multi-agent-llm-debates)  
   标签：评分：8.0/10、query:mas
   evidence：多智能体LLM辩论与集体决策
2. [Langshaw: Declarative Interaction Protocols Based on Sayso and Conflict](/papers/2606.29601v1-langshaw-declarative-interaction-protocols-based-on-sayso-and-conflict)  
   标签：评分：8.0/10、query:mas
   evidence：用于协调的多智能体交互协议语言
3. [KbSD: Knowledge Boundary aware Self-Distillation for Behavioral Calibration in Agentic Search](/papers/2606.29863v1-kbsd-knowledge-boundary-aware-self-distillation-for-behavioral-calibration-in-agentic-search)  
   标签：评分：8.0/10、query:self-distillation
   evidence：用于智能体搜索中知识边界校准的自蒸馏框架
4. [RoAd-RL: A Unified Library and Benchmark for Robust Adversarial Reinforcement Learning](/papers/2606.29867v1-road-rl-a-unified-library-and-benchmark-for-robust-adversarial-reinforcement-learning)  
   标签：评分：8.0/10、query:rl
   evidence：面向深度强化学习的对抗鲁棒性统一基准
5. [SAGA: Scene-Aware, Goal-Evolving Agents for Long-Horizon CivRealm Strategy Planning](/papers/2606.29932v1-saga-scene-aware-goal-evolving-agents-for-long-horizon-civrealm-strategy-planning)  
   标签：评分：8.0/10、query:game-ai
   evidence：用于CivRealm长期策略游戏规划的多智能体大模型框架
6. [DistilledGemma: Balanced Efficiency-Accuracy for Person-Place Relation Extraction from Multilingual Historical Articles](/papers/2606.29130v1-distilledgemma-balanced-efficiency-accuracy-for-person-place-relation-extraction-from-multilingual-historical-articles)  
   标签：评分：7.0/10、query:self-distillation
   evidence：三阶段知识蒸馏流水线平衡效率与精度
7. [Mixture of Debaters: Learn to Debate at Architectural Level in Multi-Agent Reasoning](/papers/2606.29425v1-mixture-of-debaters-learn-to-debate-at-architectural-level-in-multi-agent-reasoning)  
   标签：评分：7.0/10、query:mas
   evidence：多智能体辩论框架，动态角色分配与协调
8. [Mechanistically Eliciting Latent Behaviors in Language Models](/papers/2606.29604v1-mechanistically-eliciting-latent-behaviors-in-language-models)  
   标签：评分：7.0/10、query:intervention
   evidence：发现可解释的低秩扰动以引发LLM内部潜在行为
9. [Budgeted Act-or-Defer Multi-Agent LLM Deliberation with Local Reliability Bounds](/papers/2606.29654v1-budgeted-act-or-defer-multi-agent-llm-deliberation-with-local-reliability-bounds)  
   标签：评分：7.0/10、query:mas
   evidence：多智能体审议中的预算化行动或推迟决策
10. [ARKD: Adaptive Reinforcement Learning-Guided Bidirectional KL Divergence Distillation for Text Generation](/papers/2606.29869v1-arkd-adaptive-reinforcement-learning-guided-bidirectional-kl-divergence-distillation-for-text-generation)  
   标签：评分：7.0/10、query:self-distillation
   evidence：强化学习引导的LLM知识蒸馏压缩
11. [RESOURCE2SKILL: Distilling Executable Agent Skills from Human-Created Multimodal Resources](/papers/2606.29538v1-resource2skill-distilling-executable-agent-skills-from-human-created-multimodal-resources)  
   标签：评分：6.0/10、query:self-distillation
   evidence：将多模态资源蒸馏为可执行智能体技能
12. [DAIN: Dynamic Agent-Based Interaction Network for Efficient and Collaborative Multimodal Reasoning](/papers/2606.30189v1-dain-dynamic-agent-based-interaction-network-for-efficient-and-collaborative-multimodal-reasoning)  
   标签：评分：6.0/10、query:mas
   evidence：多智能体协作过程与智能体间通信协调
13. [The Illusion of Agentic Complexity in README.md Generation: Evaluating Single-Agent vs. Multi-Agent RAG Systems](/papers/2606.30524v1-the-illusion-of-agentic-complexity-in-readmemd-generation-evaluating-single-agent-vs-multi-agent-rag-systems)  
   标签：评分：6.0/10、query:mas
   evidence：单智能体与多智能体RAG架构的实证比较
14. [MESA: Prioritizing Vulnerable Communication Channels for Securing Multi-Agent Systems](/papers/2606.30602v1-mesa-prioritizing-vulnerable-communication-channels-for-securing-multi-agent-systems)  
   标签：评分：6.0/10、query:mas
   evidence：多智能体通信通道优先级与协调安全
15. [Investigating Multi-Agent Deliberation in Law](/papers/2606.30906v1-investigating-multi-agent-deliberation-in-law)  
   标签：评分：6.0/10、query:mas
   evidence：借鉴法庭程序的多智能体审议框架用于法律推理

