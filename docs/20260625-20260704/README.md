# 日报 · 2026-06-25 ~ 2026-07-04

- 生成时间：2026-07-04 02:39:52 UTC
- 当次推荐总数：43
- 精读区：29
- 速读区：14

## 今日简报（AI）
近十日聚焦 LLM/VLM 驱动强化学习与多智能体系统，精读 29 篇、覆盖 43 项前沿工作，整体偏向"大模型赋能 RL 训练与对齐"主线。本期最值得关注的两大方向：一是 VLM 引导的奖励塑形与分层多智能体通信（同获 9.0 高分），二是 LLM 智能体在经济仿真、谄媚行为控制等大模型对齐与部署场景的落地（多篇 8.0）。建议普通读者优先跟踪"VLM 指导 RL"和"LLM 智能体数字孪生"两条线，前者成熟度更高，后者应用想象空间大，值得尽早动手复现。

> 注：本批已去重同一论文的多个 arXiv 版本（v1/v2/...），只保留最高版本。

## 精读区
1. [Automating Potential-based Reward Shaping with Vision Language Model Guidance](/20260625-20260704/2606.27180v1-automating-potential-based-reward-shaping-with-vision-language-model-guidance) （9.0/10）
2. [HiComm: Hierarchical Communication for Multi-agent Reinforcement Learning](/20260625-20260704/2606.29126v2-hicomm-hierarchical-communication-for-multi-agent-reinforcement-learning) （9.0/10）
3. [PHF: Privileged Hidden Flow for On-Policy Self-Distillation](/20260625-20260704/2606.29340v1-phf-privileged-hidden-flow-for-on-policy-self-distillation) （9.0/10）
4. [CRAFT: Counterfactual Credit Assignment from Free Sibling Rollouts for Self-Distilled Agentic Reinforcement Learning](/20260625-20260704/2606.29476v1-craft-counterfactual-credit-assignment-from-free-sibling-rollouts-for-self-distilled-agentic-reinforcement-learning) （9.0/10）
5. [UCOB: Learning to Utilize and Evolve Agentic Skills via Credit-Aware On-Policy Bidirectional Self-Distillation](/20260625-20260704/2606.29502v1-ucob-learning-to-utilize-and-evolve-agentic-skills-via-credit-aware-on-policy-bidirectional-self-distillation) （9.0/10）
6. [Hierarchical Reinforcement Learning in StarCraft Micromanagement with Influence Maps and Cluster-based Scripts](/20260625-20260704/2606.30092v1-hierarchical-reinforcement-learning-in-starcraft-micromanagement-with-influence-maps-and-cluster-based-scripts) （9.0/10）
7. [Sparse Sensor Placement in Multi-Agent Reinforcement Learning Control of Rayleigh-Bénard Convection](/20260625-20260704/2606.30238v1-sparse-sensor-placement-in-multi-agent-reinforcement-learning-control-of-rayleigh-bnard-convection) （9.0/10）
8. [DRIFT: Difficulty Routing Self-DIstillation with Rhythm-Gated Exploration and Success BuFfer Training](/20260625-20260704/2606.30345v1-drift-difficulty-routing-self-distillation-with-rhythm-gated-exploration-and-success-buffer-training) （9.0/10）
9. [Collective cooperation without individual fidelity in LLM agents](/20260625-20260704/2606.30454v1-collective-cooperation-without-individual-fidelity-in-llm-agents) （9.0/10）
10. [Staged Hybridisation for Visual Quantum Reinforcement Learning via Knowledge Distillation](/20260625-20260704/2606.30520v1-staged-hybridisation-for-visual-quantum-reinforcement-learning-via-knowledge-distillation) （9.0/10）
11. [Deep Reinforcement Learning for Individual Atomic Control and Cooling](/20260625-20260704/2606.30765v1-deep-reinforcement-learning-for-individual-atomic-control-and-cooling) （9.0/10）
12. [Sampling-Based Coordination-Informed Multi-Objective Multi-Robot Reinforcement Learning](/20260625-20260704/2606.30893v1-sampling-based-coordination-informed-multi-objective-multi-robot-reinforcement-learning) （9.0/10）
13. [HyPOLE: Hyperproperty-Guided Multi-Agent Reinforcement Learning under Partial Observation](/20260625-20260704/2606.30966v1-hypole-hyperproperty-guided-multi-agent-reinforcement-learning-under-partial-observation) （9.0/10）
14. [Smart charging of large fleets of Electric Vehicles: Independent Multi-Agent Reinforcement Learning approaches](/20260625-20260704/2606.31347v1-smart-charging-of-large-fleets-of-electric-vehicles-independent-multi-agent-reinforcement-learning-approaches) （9.0/10）
15. [Dynamic Scheduling for Flexible Manufacturing Systems Based on Multi-Agent Deep Reinforcement Learning and Petri Nets](/20260625-20260704/2606.31737v2-dynamic-scheduling-for-flexible-manufacturing-systems-based-on-multi-agent-deep-reinforcement-learning-and-petri-nets) （9.0/10）
16. [Policy Optimization Achieves Data-Dependent Regret Bounds in MDPs with Unknown Transitions](/20260625-20260704/2606.31769v1-policy-optimization-achieves-data-dependent-regret-bounds-in-mdps-with-unknown-transitions) （9.0/10）
17. [Harnessing the Latent Space: From Steering Vectors to Model Calibrators for Control and Trust](/20260625-20260704/2607.00083v1-harnessing-the-latent-space-from-steering-vectors-to-model-calibrators-for-control-and-trust) （9.0/10）
18. [VLM-AR3L: Vision-Language Models for Absolute and Relative Rewards in Reinforcement Learning](/20260625-20260704/2607.00483v2-vlm-ar3l-vision-language-models-for-absolute-and-relative-rewards-in-reinforcement-learning) （9.0/10）
19. [Coachable agents for interactive gameplay](/20260625-20260704/2607.00642v1-coachable-agents-for-interactive-gameplay) （9.0/10）
20. [Simulation Based Reward Function Validation for Multi-Agent On Orbit Inspection](/20260625-20260704/2607.01367v1-simulation-based-reward-function-validation-for-multi-agent-on-orbit-inspection) （9.0/10）
21. [Mean Field Reinforcement Learning](/20260625-20260704/2607.01525v1-mean-field-reinforcement-learning) （9.0/10）
22. [Full Bayesian Reinforcement Learning via LF-IBIS](/20260625-20260704/2607.01741v1-full-bayesian-reinforcement-learning-via-lf-ibis) （9.0/10）
23. [Denser $\neq$ Better: Limits of On-Policy Self-Distillation for Continual Post-Training](/20260625-20260704/2607.01763v1-denser-neq-better-limits-of-on-policy-self-distillation-for-continual-post-training) （9.0/10）
24. [Learning the Supports for Categorical Critic in Reinforcement Learning](/20260625-20260704/2607.01880v1-learning-the-supports-for-categorical-critic-in-reinforcement-learning) （9.0/10）
25. [Evolutionary Wave Function Collapse](/20260625-20260704/2607.02082v1-evolutionary-wave-function-collapse) （9.0/10）
26. [Consensus-Breaking Global Hopf Bifurcation in Memory-Based Multi-Agent Systems](/20260625-20260704/2607.02388v1-consensus-breaking-global-hopf-bifurcation-in-memory-based-multi-agent-systems) （9.0/10）
27. [Neuron-Aware Data Selection for Annotation-Free LLM Self-Distillation](/20260625-20260704/2607.02460v1-neuron-aware-data-selection-for-annotation-free-llm-self-distillation) （9.0/10）
28. [DemoPSD: Disagreement-Modulated Policy Self-Distillation](/20260625-20260704/2607.02502v1-demopsd-disagreement-modulated-policy-self-distillation) （9.0/10）
29. [Social Information Quality and Environmental Volatility Shape Collective Foraging Behavior](/20260625-20260704/biorxiv-10-1101-2025-11-14-688412-v3-social-information-quality-and-environmental-volatility-shape-collective-foraging-behavior) （9.0/10）

## 速读区
1. [Detecting and Controlling Sycophancy with Cascading Linear Features](/20260625-20260704/2606.26155v1-detecting-and-controlling-sycophancy-with-cascading-linear-features) （8.0/10）
2. [IDEA: Insensitive to Dynamics Mismatch via Effect Alignment for Sim-to-Real Transfer in Multi-Agent Control](/20260625-20260704/2606.26575v1-idea-insensitive-to-dynamics-mismatch-via-effect-alignment-for-sim-to-real-transfer-in-multi-agent-control) （8.0/10）
3. [EconSimulacra: A Digital Twin Platform of Socio-Economic Systems Powered by LLM Agents](/20260625-20260704/2606.26883v1-econsimulacra-a-digital-twin-platform-of-socio-economic-systems-powered-by-llm-agents) （8.0/10）
4. [LLawCo: Learning Laws of Cooperation for Modeling Embodied Multi-Agent Behavior](/20260625-20260704/2606.28182v1-llawco-learning-laws-of-cooperation-for-modeling-embodied-multi-agent-behavior) （8.0/10）
5. [Domain-Informed Multi-View Self-Distillation for Astronomical Light-Curve Representation Learning with JEPA](/20260625-20260704/2606.28446v1-domain-informed-multi-view-self-distillation-for-astronomical-light-curve-representation-learning-with-jepa) （8.0/10）
6. [Localizing RL-Induced Tool Use to a Single Crosscoder Feature](/20260625-20260704/2606.26474v1-localizing-rl-induced-tool-use-to-a-single-crosscoder-feature) （7.0/10）
7. [PhysEditWorld: A Large-Scale Dataset Toward Physics-Editable World Models](/20260625-20260704/2606.26694v2-physeditworld-a-large-scale-dataset-toward-physics-editable-world-models) （7.0/10）
8. [GEOALIGN: Geometric Rollout Curation for Robust LLM Reinforcement Learning](/20260625-20260704/2606.26917v1-geoalign-geometric-rollout-curation-for-robust-llm-reinforcement-learning) （7.0/10）
9. [When Does Personality Composition Matter for Multi-Agent LLM Teams?](/20260625-20260704/2606.27443v1-when-does-personality-composition-matter-for-multi-agent-llm-teams) （7.0/10）
10. [Improving General Role-Playing Agents via Psychology-Grounded Reasoning and Role-Aware Policy Optimization](/20260625-20260704/2606.27025v1-improving-general-role-playing-agents-via-psychology-grounded-reasoning-and-role-aware-policy-optimization) （6.0/10）
11. [Parametric Open Source Games](/20260625-20260704/2606.27068v1-parametric-open-source-games) （6.0/10）
12. [Bridging Talk and Thought: Understanding Dialogue Dynamics Across Collaborative Problem-Solving Contexts](/20260625-20260704/2606.27233v1-bridging-talk-and-thought-understanding-dialogue-dynamics-across-collaborative-problem-solving-contexts) （6.0/10）
13. [Designing Reward Signals for Portable Query Generation: A Case Study in Industrial Semantic Job Search](/20260625-20260704/2606.27291v1-designing-reward-signals-for-portable-query-generation-a-case-study-in-industrial-semantic-job-search) （6.0/10）
14. [Large Language Model Teaches Visual Students: Cross-Modality Transfer of Fine-Grained Conceptual Knowledge](/20260625-20260704/2606.27527v1-large-language-model-teaches-visual-students-cross-modality-transfer-of-fine-grained-conceptual-knowledge) （6.0/10）

---
使用键盘方向键可在日报/论文之间快速切换。
