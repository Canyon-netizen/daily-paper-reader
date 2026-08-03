---
score: 0.0
---# Topic Seeds · Game AI · Vector · Skill2Vector

> **用途**:主题探索页 `/topic/` 阶段 1 的"种子论文清单"。
> 把下面 `arxiv_id` 一栏的值,逐条粘到主题页的"📚 添加参考论文 → 已知 arXiv ID / 链接"输入框即可加入种子。
> 模型会读取这些论文的 TLDR/方法/结果,生成 4-6 个迁移/探索方向。

- **方向**:游戏 AI / 智能体策略 / 玩家行为 → 稠密向量 / 嵌入 / 潜空间 / 权重空间
- **收集日期**:2026-07-21
- **总条目**:30(本地 6 + 外部 24)
- **关联本地笔记**:见每条"→ 本地"标记

> ⚠️ **2026-07-21 校正**:B 节里有 4 个 arXiv ID 在早期 WebSearch 里被错标(2503.18185 / 2412.13625 / 2410.08057 / 2402.04879 / 2404.12501),实际论文与本主题无关,已剔除;B1 区已用新检索的真 ID 2507.16473 补位。

---

## A. 本仓库已有笔记(可直接在主题页 `/papers/` 搜索选中,无需复制 ID)

| arXiv ID | 标题(简) | 与主题的关联 |
|---|---|---|
| 2606.06087 | LatentSkill:从上下文文本技能到权重内潜在技能 | hypernetwork 把技能编译成 LoRA,技能在权重空间形成可聚类/可缩放/可算术组合的语义几何 |
| 2606.30015 | ParametricSkills | 同思路在 SWE 任务上的扩展,45.8K 技能库 + EMA 持续学习 |
| 2607.00190 | Play Like Champions(StarCraft II) | 23,305 场职业比赛训引导 VAE,在潜空间生成反事实冠军路径 |
| 2607.00642 | Coachable Agents(地平线 / GT 赛车) | UVFA 把"风格"作为附加向量条件,运行时调度风格 |
| 2607.05352 | MIRA 多人交互世界模型(Rocket League) | 5B 潜在扩散模型 + 表示自编码器,多智能体紧耦合 |
| 2607.12097 | Playtrace Reconstructive Partitioning | "蛋糕"分层关卡表示 + 玩家轨迹重构分区 |

---

## B. 外部候选论文(待你确认后逐条粘到种子弹层)

### B1 · 无监督技能发现 / 技能潜空间(URL)

```
2410.07877    Constrained Skill Discovery: Quadruped Locomotion with Unsupervised RL
2410.11758    LAPA: Latent Action Pretraining from Videos (ICLR 2025)
2404.12999    Goal Exploration via Adaptive Skill Distribution (GEASD)
1907.08225    Dynamical Distance Learning for Semi-Supervised and Unsupervised Skill Discovery
2507.16473    Learning Temporal Abstractions via Variational Homomorphisms in Option-Induced Abstract MDPs
```

> ❌ **剔除**(WebSearch 给了假 ID,实际论文与本主题无关):
> - 2503.18185 → 实为 cybersecurity 综述
> - 2412.13625 → 实为等离子体物理
> - 2410.08057 → 实为数学(parking functions)
> - 2402.04879 → 实为 Twitter 抽样方法学
> - 2404.12501 → 实为 SPIdepth 自监督深度估计

### B2 · 技能 → 参数 / LoRA / 权重(对应 LatentSkill / ParametricSkills)

```
2406.01968    Cross-Embodiment Robot Manipulation Skill Transfer using Latent Space Alignment
```

> 其他同期工作(Text-to-LoRA / LoRAGen / Doc-to-LoRA / SHINE)请直接在主题页阶段 4 用"text-to-LoRA hypernetwork 2024 2025"等关键词联网搜 arXiv。

### B3 · 视频 / 行为预训练(潜动作 / 行为基础模型)

```
2402.12939    Discovering Behavioral Modes in Deep RL Policies Using Trajectory Clustering in Latent Space
```

> **OpenAI VPT (Video PreTraining, Baker et al. 2022)** —— Minecraft 行为基础模型。在 arXiv listing 中验证过 arXiv:2206.11796 是数学论文,实际 VPT 的真 arXiv ID **2206.11796v1 已被撤回/标错**,请改用 OpenReview/官方网站引用,或者在主题报告里以"OpenAI VPT 2022"作为背景提及。

### B4 · 游戏 / 对战策略与行为潜空间

```
2308.03526    AlphaStar Unplugged: Large-Scale Offline Reinforcement Learning (DeepMind)
```

> OpenAI Five (Dota 2, 2019)、Hide and Seek (2019-2020) 没有正式 arXiv 论文 ID,可只在主题报告里作为背景引用,不进入种子列表。

### B5 · 玩家 / NPC 行为嵌入(对照 Coachable Agents)

> 这一支以玩家 2vec / player2vec 类玩具实现 + 综述为主,arxiv 没有强势单篇。可在主题报告里讨论"风格向量(RL 条件)vs 玩家嵌入向量(离线行为序列)"的对比,不强求种子。

### B6 · 程序化内容生成(关卡 / 玩法作为向量)

> 关卡 GAN / PCGRL / MarioGAN 这一支在 arXiv 较散,主题阶段 4 可用"procedural content generation latent space 2024 2025"作为查询词联网搜。本地已有 [2607.12097] PRP + [2607.09095] 节奏关卡 token 化作为锚定。

### B7 · LLM Agent 技能库 / 技能检索 / 技能图谱

```
2305.16291    Voyager: An Open-Ended Embodied Agent with Large Language Models  (Minecraft + GPT-4 + 技能库 + 描述嵌入检索)
2606.29538    resource2skill: Distilling Executable Agent Skills from Human-Created Multimodal Resources  → 本地
```

> CoEvoSkills / SkillOpt / EvoSkill 等文本空间技能演化工作没有稳定 arXiv ID,主题报告里作为"权重空间 vs 文本空间技能演化"的对照组讨论。

---

## C. 推荐主题探索阶段 1 的"思路输入"原文

可直接复制到主题页"输入研究思路"框:

```
围绕"把游戏 AI / 智能体策略 / 玩家行为表示为稠密向量"这条主线,梳理 2024-2025 的代表性工作。子方向建议包括:
(1) 无监督 RL 中的技能发现 / 技能潜空间(DIAYN / DADS / VALOR / SkiLD / METRA / LGSD);
(2) skill → 参数 / LoRA / hypernetwork 的"权重化技能"(LatentSkill / ParametricSkills / SHINE / Text-to-LoRA / Doc-to-LoRA);
(3) 视频 / 潜动作预训练(VPT / LAPA / GALM / PIVOT)如何把行为压成 token 或 latent action;
(4) 游戏 / 对战的策略与行为潜空间(StarCraft AlphaStar 行为分析 / "Play Like Champions" 反事实路径 / OpenAI Five Dota 行为表征);
(5) 玩家与 NPC 行为嵌入做推荐 / 配对 / 风格控制(Coachable Agents UVFA / 玩家 2vec 类);
(6) 程序化内容生成中的"关卡 / 玩法"作为向量(PRP / 蛋糕表示 / MarioGAN / PCGRL);
(7) 技能图谱、技能路由、技能检索(Voyager / Skill Library + 向量库 / Skill2Vec 求职方向在 LLM agent 中的迁移)。
每子方向 3-5 篇代表性论文,中文速览 + 速读,关注"潜空间语义几何 / 跨任务迁移 / 组合性 / 与 LLM agent 的接口"四类共性挑战。
```

---

## D. 子方向与本地笔记对照(写主题报告时用)

| 子方向 | 本地锚定笔记 | 与外部候选的互补关系 |
|---|---|---|
| A · URL 技能发现 | 无本地直接对应 | LatentSkill 的"MDS 可视化 + 域内/跨域相似度"分析可作为"潜空间几何"对照基线 |
| B · 权重化技能 | [2606.06087] LatentSkill、[2606.30015] ParametricSkills、[2606.29538] resource2skill | B1 / B2 外部候选主要做"距离约束 / 跨形态对齐 / 跨任务泛化" |
| C · 视频预训练 | 无本地直接对应 | LAPA(2410.11758)+ 2402.12939 三件套(VPT 暂未列入种子) |
| D · 游戏策略潜空间 | [2607.00190] Play Like Champions | AlphaStar Unplugged(2308.03526)是"离线 RL + 行为分析"对照 |
| E · 玩家嵌入 | [2607.00642] Coachable Agents | 与 D 形成"策略端 vs 玩家端"两端 |
| F · PCG 关卡表示 | [2607.12097] PRP、[2607.09095] 节奏关卡 token | 主题阶段 4 联网搜 PCGRL / MarioGAN / GAN level |
| G · LLM 技能库 | [2606.29538] resource2skill | Voyager(2305.16291)是"代码即技能 + 描述嵌入检索"的经典 |

---

## E. 共性挑战清单(主题报告维度展开用)

1. **潜空间语义几何**:技能 / 行为嵌入是否形成可聚类、可插值、可算术组合的语义结构?(LatentSkill MDS / 2402.12939 聚类 / "Play Like Champions" 潜空间插值)
2. **跨任务 / 跨形态迁移**:同一向量是否能跨游戏 / 跨机器人形态复用?(Cross-Embodiment Alignment 2406.01968 / 跨形态 SkillTransfer)
3. **组合性**:技能向量的线性叠加是否对应功能叠加?(LatentSkill component merging / ParametricSkills update-space rank concat)
4. **与 LLM agent 的接口**:向量化的技能如何接入 prompt / 工具调用 / 技能路由?(Voyager 描述嵌入 / LatentSkill LoRA 注入)
5. **持续学习与漂移**:向量空间是否随新技能加入而漂移,如何做归一化与 EMA?(ParametricSkills Φ ← EMA(Φ, normalize(φ★)) / SKILL.md 增量索引)

---

## F. 使用步骤

1. 打开本地主题页 `/topic/`(若启 dev,先跑 `scripts/local-cors-proxy.mjs` + `astro dev`)。
2. 展开阶段 1 → 点 "📚 添加参考论文" → 展开"已知 arXiv ID / 链接"。
3. 把 B 节里需要的 ID(每次一个)粘进输入框 → 点 ➕ 添加。重复直到凑 6-10 条种子。
4. 关掉弹层 → 阶段 1 勾选"📚 基于已选 N 篇论文探索"卡片 → 点 🚀 开始迁移探索。
5. 阶段 5 自动生成的报告里,模型会读这些种子的 TLDR / 方法 / 结果做迁移方向拆解。

> 想批量粘贴多个 ID:把 B 节每行的 `NNNN.NNNNN` 用换行分隔直接一次性粘到输入框,目前 UI 一次提交只识别第一个匹配。如果需要批量,可在控制台执行:`addToSelection({arxivId:'2410.11758',title:'...',tldr:'...',method:'',result:'',tags:[],addedAt:Date.now()})`。
